import { afterEach, expect, it, vi } from 'vitest';
import {
  BoxGeometry,
  Color,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshDepthMaterial,
  OrthographicCamera,
  PlaneGeometry,
  ShaderLib,
  ShaderMaterial,
  Vector4,
  WebGLRenderTarget,
  type Scene,
  type WebGLRenderer,
} from 'three';
import { createContactCapture } from './contact-capture';
import { createSceneEffectsStore } from './scene-effects-state';

afterEach(() => vi.restoreAllMocks());

function renderer(
  failPass = 0,
  shaderFailPass = 0,
  incompletePass = 0,
  lostPass = 0,
  missingFramebuffer = false,
) {
  const originalTarget = new WebGLRenderTarget(8, 8);
  let target = originalTarget,
    viewport = new Vector4(4, 5, 600, 400),
    scissor = new Vector4(6, 7, 300, 200),
    scissorTest = true;
  let color = new Color('#abcdef'),
    alpha = 0.7;
  const scenes: {
    count: number;
    positions: number[][];
    geometries: unknown[];
  }[] = [];
  let calls = 0;
  let bindings = 0;
  const previousShaderError = vi.fn();
  const context = {
    FRAMEBUFFER: 0x8d40,
    FRAMEBUFFER_COMPLETE: 0x8cd5,
    FRAMEBUFFER_BINDING: 0x8ca6,
    getParameter: vi.fn(() => (missingFramebuffer ? null : {})),
    isContextLost: vi.fn(() => lostPass > 0 && calls >= lostPass),
    checkFramebufferStatus: vi.fn(() =>
      bindings === incompletePass ? 0x8cd6 : 0x8cd5,
    ),
    getError: vi.fn(),
  };
  const gl = {
    autoClear: false,
    autoClearColor: false,
    autoClearDepth: false,
    autoClearStencil: false,
    xr: { enabled: true },
    debug: {
      checkShaderErrors: false,
      onShaderError:
        previousShaderError as WebGLRenderer['debug']['onShaderError'],
    },
    getContext: () => context,
    getRenderTarget: () => target,
    getActiveCubeFace: () => 2,
    getActiveMipmapLevel: () => 1,
    setRenderTarget: vi.fn((next: WebGLRenderTarget) => {
      bindings++;
      target = next;
    }),
    getViewport: (result: Vector4) => result.copy(viewport),
    setViewport: vi.fn((next: Vector4) => {
      viewport = next.clone();
    }),
    getScissor: (result: Vector4) => result.copy(scissor),
    setScissor: vi.fn((next: Vector4) => {
      scissor = next.clone();
    }),
    getScissorTest: () => scissorTest,
    setScissorTest: vi.fn((next: boolean) => {
      scissorTest = next;
    }),
    getClearColor: (result: Color) => result.copy(color),
    getClearAlpha: () => alpha,
    setClearColor: vi.fn((next: Color | string, value: number) => {
      color = new Color(next);
      alpha = value;
    }),
    render: vi.fn((scene: Scene) => {
      expect(gl.debug.checkShaderErrors).toBe(true);
      expect(
        gl.autoClearColor && gl.autoClearDepth && gl.autoClearStencil,
      ).toBe(true);
      scenes.push({
        count: scene.children.length,
        positions: scene.children.map((object) => [
          object.matrix.elements[12],
          object.matrix.elements[13],
          object.matrix.elements[14],
        ]),
        geometries: scene.children.map((object) => (object as Mesh).geometry),
      });
      calls++;
      if (calls === shaderFailPass)
        gl.debug.onShaderError?.(
          context as unknown as WebGLRenderingContext,
          {} as Parameters<
            NonNullable<WebGLRenderer['debug']['onShaderError']>
          >[1],
          {} as WebGLShader,
          {} as WebGLShader,
        );
      if (calls === failPass) throw new Error('capture GPU failure');
    }),
  };
  return {
    gl,
    typed: gl as unknown as WebGLRenderer,
    originalTarget,
    scenes,
    context,
    previousShaderError,
    state: () => ({
      target,
      viewport: viewport.toArray(),
      scissor: scissor.toArray(),
      scissorTest,
      color: color.getHexString(),
      alpha,
      autoClear: gl.autoClear,
      autoClearColor: gl.autoClearColor,
      autoClearDepth: gl.autoClearDepth,
      autoClearStencil: gl.autoClearStencil,
      xr: gl.xr.enabled,
      checkShaderErrors: gl.debug.checkShaderErrors,
      onShaderError: gl.debug.onShaderError,
    }),
  };
}

it('captures real current caster world matrices in three owned passes and preserves source geometry on disposal', () => {
  const store = createSceneEffectsStore('room:1'),
    parent = new Group();
  const source = new Mesh(new BoxGeometry(10, 10, 10), new MeshBasicMaterial());
  parent.position.set(30, 12, -40);
  source.position.x = 4;
  parent.add(source);
  parent.updateMatrixWorld(true);
  store.registerVisual('red', 'ITC-RED', parent);
  const sourceDispose = vi.spyOn(source.geometry, 'dispose');
  const depthDispose = vi.spyOn(MeshDepthMaterial.prototype, 'dispose');
  const blurDispose = vi.spyOn(ShaderMaterial.prototype, 'dispose');
  const blurGeometryDispose = vi.spyOn(PlaneGeometry.prototype, 'dispose');
  const capture = createContactCapture(100, 100, 96, 512),
    fake = renderer();
  const before = fake.state();
  capture.capture(fake.typed, store.getCasters(), new Color('#102030'));
  expect(fake.scenes).toHaveLength(3);
  expect(fake.scenes[0]).toMatchObject({
    count: 1,
    positions: [[34, 12, -40]],
    geometries: [source.geometry],
  });
  expect(fake.state()).toEqual(before);
  expect(fake.gl.setRenderTarget).toHaveBeenLastCalledWith(
    fake.originalTarget,
    2,
    1,
  );
  const targets = [
    ...new Set(fake.gl.setRenderTarget.mock.calls.map(([target]) => target)),
  ].filter((target) => target !== fake.originalTarget);
  expect(targets).toHaveLength(2);
  const ownedDisposals = targets.map((target) => vi.spyOn(target, 'dispose'));
  capture.dispose();
  capture.dispose();
  ownedDisposals.forEach((dispose) => expect(dispose).toHaveBeenCalledOnce());
  expect(sourceDispose).not.toHaveBeenCalled();
  expect(depthDispose).toHaveBeenCalledOnce();
  expect(blurDispose).toHaveBeenCalledOnce();
  expect(blurGeometryDispose).toHaveBeenCalledOnce();
});

it('rejects a missing framebuffer instead of mistaking the complete default framebuffer for capture success', () => {
  const capture = createContactCapture(100, 100, 96, 512),
    fake = renderer(0, 0, 0, 0, true),
    before = fake.state();
  expect(() => capture.capture(fake.typed, [], new Color())).toThrow(
    'Incomplete room contact framebuffer',
  );
  expect(fake.gl.render).not.toHaveBeenCalled();
  expect(fake.context.checkFramebufferStatus).not.toHaveBeenCalled();
  expect(fake.state()).toEqual(before);
  capture.dispose();
});

it.each([1, 2, 3])(
  'rejects incomplete framebuffer before pass %i and restores the renderer without draining GL errors',
  (pass) => {
    const capture = createContactCapture(100, 100, 96, 512),
      fake = renderer(0, 0, pass),
      before = fake.state();
    expect(() => capture.capture(fake.typed, [], new Color())).toThrow(
      'Incomplete room contact framebuffer',
    );
    expect(fake.gl.render).toHaveBeenCalledTimes(pass - 1);
    expect(fake.context.checkFramebufferStatus).toHaveBeenCalledWith(
      fake.context.FRAMEBUFFER,
    );
    expect(fake.context.getError).not.toHaveBeenCalled();
    expect(fake.state()).toEqual(before);
    capture.dispose();
  },
);

it.each([1, 2])(
  'rejects a nonthrowing owned shader link failure on pass %i and leaves the host shader hook intact',
  (pass) => {
    const capture = createContactCapture(100, 100, 96, 512),
      fake = renderer(0, pass),
      before = fake.state();
    expect(() => capture.capture(fake.typed, [], new Color())).toThrow(
      'Failed room contact shader',
    );
    expect(fake.gl.render).toHaveBeenCalledTimes(pass);
    expect(fake.previousShaderError).not.toHaveBeenCalled();
    expect(fake.context.getError).not.toHaveBeenCalled();
    expect(fake.state()).toEqual(before);
    capture.dispose();
    const successor = createContactCapture(100, 100, 96, 512),
      healthy = renderer();
    expect(() =>
      successor.capture(healthy.typed, [], new Color()),
    ).not.toThrow();
    expect(healthy.gl.render).toHaveBeenCalledTimes(3);
    successor.dispose();
  },
);

it('rejects a context lost during a pass and restores renderer settings', () => {
  const capture = createContactCapture(100, 100, 96, 512),
    fake = renderer(0, 0, 0, 2),
    before = fake.state();
  expect(() => capture.capture(fake.typed, [], new Color())).toThrow(
    'Lost room contact context',
  );
  expect(fake.gl.render).toHaveBeenCalledTimes(2);
  expect(fake.state()).toEqual(before);
  capture.dispose();
});

it('patches the installed Three depth shader and refuses unsupported shader text', () => {
  const capture = createContactCapture(100, 100, 96, 512),
    fake = renderer();
  const store = createSceneEffectsStore('room:1'),
    parent = new Group();
  parent.add(new Mesh(new BoxGeometry(), new MeshBasicMaterial()));
  store.registerVisual('red', 'ITC-RED', parent);
  capture.capture(fake.typed, store.getCasters(), new Color());
  const scene = fake.gl.render.mock.calls[0][0];
  // Copies have been released from the capture scene. Inspect the material
  // during its actual pass rather than retaining any source geometry.
  fake.gl.render.mockImplementationOnce((scene) => {
    const material = (scene.children[0] as Mesh).material as MeshDepthMaterial;
    const shader = {
      uniforms: {},
      vertexShader: ShaderLib.depth.vertexShader,
      fragmentShader: ShaderLib.depth.fragmentShader,
    } as Parameters<MeshDepthMaterial['onBeforeCompile']>[0];
    material.onBeforeCompile(shader, fake.typed);
    expect(shader.fragmentShader).toContain(
      'vec4(contactColor, pow(1.0 - fragCoordZ, 2.0));',
    );
    expect(shader.uniforms).toHaveProperty('contactColor');
    // A mismatch latches until the pass returns, avoiding exceptions inside
    // Three's onBeforeCompile/render bookkeeping.
    material.onBeforeCompile(
      { ...shader, fragmentShader: 'unsupported' },
      fake.typed,
    );
  });
  expect(() =>
    capture.capture(fake.typed, store.getCasters(), new Color()),
  ).toThrow('Unsupported room contact depth shader');
  expect(scene.children).toHaveLength(0);
  capture.dispose();
});

it('cleans both targets when construction fails before material allocation', () => {
  const dispose = vi.spyOn(WebGLRenderTarget.prototype, 'dispose');
  vi.spyOn(
    OrthographicCamera.prototype,
    'updateMatrixWorld',
  ).mockImplementation(() => {
    throw new Error('camera construction');
  });
  expect(() => createContactCapture(100, 100, 96, 512)).toThrow(
    'camera construction',
  );
  expect(dispose).toHaveBeenCalledTimes(2);
});

it('cleans all earlier owned resources when blur material construction fails', () => {
  const targets = vi.spyOn(WebGLRenderTarget.prototype, 'dispose');
  const depths = vi.spyOn(MeshDepthMaterial.prototype, 'dispose');
  const geometries = vi.spyOn(PlaneGeometry.prototype, 'dispose');
  vi.spyOn(ShaderMaterial.prototype, 'setValues').mockImplementation(() => {
    throw new Error('blur allocation');
  });
  expect(() => createContactCapture(100, 100, 96, 512)).toThrow(
    'blur allocation',
  );
  expect(targets).toHaveBeenCalledTimes(2);
  expect(depths).toHaveBeenCalledOnce();
  expect(geometries).toHaveBeenCalledOnce();
});

it('restores renderer state after a mid-blur exception and does not retain source casters', () => {
  const store = createSceneEffectsStore('room:1'),
    parent = new Group();
  parent.add(new Mesh(new BoxGeometry(), new MeshBasicMaterial()));
  store.registerVisual('black', 'ITC-BLACK', parent);
  const capture = createContactCapture(100, 100, 96, 512),
    fake = renderer(2),
    before = fake.state();
  expect(() =>
    capture.capture(fake.typed, store.getCasters(), new Color('#102030')),
  ).toThrow('capture GPU failure');
  expect(fake.state()).toEqual(before);
  capture.dispose();
  expect(() => capture.capture(fake.typed, [], new Color())).toThrow(
    'Disposed room contact capture',
  );
});

it('makes retained contact capture and compile callbacks inert after original-session retirement and disposes exactly once', () => {
  let current = true;
  const capture = createContactCapture(100, 100, 96, 512, () => current);
  const fake = renderer();
  const store = createSceneEffectsStore('room:1');
  const parent = new Group();
  parent.add(new Mesh(new BoxGeometry(), new MeshBasicMaterial()));
  store.registerVisual('drawer', 'ITC-D01', parent);
  let compile!: MeshDepthMaterial['onBeforeCompile'];
  const callbacks: { shaderError: WebGLRenderer['debug']['onShaderError'] } = {
    shaderError: null,
  };
  fake.gl.render.mockImplementationOnce((scene) => {
    compile = ((scene.children[0] as Mesh).material as MeshDepthMaterial)
      .onBeforeCompile;
    callbacks.shaderError = fake.gl.debug.onShaderError;
  });
  capture.capture(fake.typed, store.getCasters(), new Color());
  const targetDispose = vi.spyOn(WebGLRenderTarget.prototype, 'dispose');
  current = false;
  fake.gl.render.mockClear();
  fake.gl.setRenderTarget.mockClear();
  const before = fake.state();
  const shader = {
    uniforms: {},
    vertexShader: ShaderLib.depth.vertexShader,
    fragmentShader: ShaderLib.depth.fragmentShader,
  } as Parameters<MeshDepthMaterial['onBeforeCompile']>[0];
  const fragment = shader.fragmentShader;
  compile(shader, fake.typed);
  callbacks.shaderError?.(
    {} as WebGLRenderingContext,
    {} as Parameters<NonNullable<WebGLRenderer['debug']['onShaderError']>>[1],
    {} as WebGLShader,
    {} as WebGLShader,
  );
  capture.capture(fake.typed, store.getCasters(), new Color());
  expect(shader.fragmentShader).toBe(fragment);
  expect(shader.uniforms).toEqual({});
  expect(fake.gl.render).not.toHaveBeenCalled();
  expect(fake.gl.setRenderTarget).not.toHaveBeenCalled();
  expect(fake.state()).toEqual(before);
  capture.dispose();
  capture.dispose();
  expect(targetDispose).toHaveBeenCalledTimes(2);
  compile(shader, fake.typed);
  expect(shader.uniforms).toEqual({});
});
