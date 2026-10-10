import { expect, it, vi } from 'vitest';
import {
  ACESFilmicToneMapping,
  Color,
  CustomBlending,
  LinearSRGBColorSpace,
  Mesh,
  MeshBasicMaterial,
  NoToneMapping,
  OneFactor,
  OrthographicCamera,
  Scene,
  ShaderMaterial,
  SRGBColorSpace,
  Texture,
  Vector4,
  WebGLRenderTarget,
  ZeroFactor,
  type WebGLRenderer,
} from 'three';
import {
  captureRawSceneColor,
  createBloomOverlay,
  createSceneBloomFrames,
} from './scene-bloom-runtime';

function setup(complete = true, supported = true) {
  const target = new WebGLRenderTarget(2, 2),
    clearColor = new Color('red');
  const viewport = new Vector4(1, 2, 300, 200),
    scissor = new Vector4(3, 4, 100, 80);
  const values = {
    target: target as WebGLRenderTarget | null,
    face: 2,
    mip: 3,
    viewport,
    scissor,
    scissorTest: true,
    clearColor,
    clearAlpha: 0.7,
  };
  const oldShaderError = vi.fn();
  const gl = {
    toneMapping: ACESFilmicToneMapping as WebGLRenderer['toneMapping'],
    toneMappingExposure: 1.25,
    outputColorSpace: SRGBColorSpace as WebGLRenderer['outputColorSpace'],
    autoClear: true,
    autoClearColor: true,
    autoClearDepth: false,
    autoClearStencil: true,
    shadowMap: { enabled: true, autoUpdate: true },
    xr: { enabled: true },
    debug: { onShaderError: oldShaderError },
    getRenderTarget: () => values.target,
    getActiveCubeFace: () => values.face,
    getActiveMipmapLevel: () => values.mip,
    setRenderTarget: vi.fn(
      (next: WebGLRenderTarget | null, face = 0, mip = 0) => {
        values.target = next;
        values.face = face;
        values.mip = mip;
      },
    ),
    getViewport: (out: Vector4) => out.copy(values.viewport),
    setViewport: (next: Vector4) => {
      values.viewport = next.clone();
    },
    getScissor: (out: Vector4) => out.copy(values.scissor),
    setScissor: (next: Vector4) => {
      values.scissor = next.clone();
    },
    getScissorTest: () => values.scissorTest,
    setScissorTest: (next: boolean) => {
      values.scissorTest = next;
    },
    getClearColor: (out: Color) => out.copy(values.clearColor),
    getClearAlpha: () => values.clearAlpha,
    setClearColor: (next: Color, alpha: number) => {
      values.clearColor = next.clone();
      values.clearAlpha = alpha;
    },
    getContext: () => ({
      FRAMEBUFFER: 1,
      FRAMEBUFFER_COMPLETE: 2,
      checkFramebufferStatus: () => (complete ? 2 : 3),
    }),
    render: vi.fn(),
  };
  const renderer = gl as unknown as WebGLRenderer;
  const rawColor = captureRawSceneColor(renderer);
  // The wrapper changes tone mapping after the normal renderer baseline was read.
  gl.toneMapping = NoToneMapping;
  const failures = vi.fn(),
    frames = vi.fn(),
    render = vi.fn(),
    overlay = { draw: vi.fn(), dispose: vi.fn() };
  const composer = { inputBuffer: new WebGLRenderTarget(2, 2), render };
  const scene = new Scene(),
    camera = new OrthographicCamera();
  scene.background = new Color('blue');
  scene.overrideMaterial = new MeshBasicMaterial();
  camera.layers.mask = 5;
  const runtime = createSceneBloomFrames(
    renderer,
    scene,
    camera,
    rawColor,
    overlay,
    failures,
  );
  const cleanup = runtime.attach(composer, () => supported, frames);
  const snapshot = () => ({
    ...values,
    viewport: values.viewport.toArray(),
    scissor: values.scissor.toArray(),
    clearColor: values.clearColor.toArray(),
    toneMapping: gl.toneMapping,
    exposure: gl.toneMappingExposure,
    output: gl.outputColorSpace,
    autoClear: gl.autoClear,
    color: gl.autoClearColor,
    depth: gl.autoClearDepth,
    stencil: gl.autoClearStencil,
    background: scene.background,
    override: scene.overrideMaterial,
    layers: camera.layers.mask,
    shadowEnabled: gl.shadowMap.enabled,
    shadowAutoUpdate: gl.shadowMap.autoUpdate,
    xr: gl.xr.enabled,
  });
  const mutate = () => {
    gl.setRenderTarget(composer.inputBuffer, 6, 7);
    values.viewport = new Vector4(9, 10, 20, 30);
    values.scissor = new Vector4(7, 8, 4, 5);
    values.scissorTest = false;
    values.clearColor = new Color('green');
    values.clearAlpha = 0.1;
    gl.autoClear = false;
    gl.autoClearColor = false;
    gl.autoClearDepth = true;
    gl.autoClearStencil = false;
    gl.toneMapping = ACESFilmicToneMapping;
    gl.toneMappingExposure = 9;
    gl.outputColorSpace = LinearSRGBColorSpace;
    camera.layers.mask = 1 << 11;
    scene.background = null;
    scene.overrideMaterial = new MeshBasicMaterial();
    gl.shadowMap.enabled = false;
    gl.shadowMap.autoUpdate = false;
    gl.xr.enabled = false;
  };
  return {
    gl,
    renderer,
    values,
    target,
    composer,
    failures,
    frames,
    render,
    cleanup,
    scene,
    camera,
    oldShaderError,
    runtime,
    overlay,
    rawColor,
    snapshot,
    mutate,
  };
}

it('restores all composer state on success BEFORE exactly one raw screen render and consumes the current bloom texture once', () => {
  const state = setup(),
    original = state.snapshot(),
    texture = new Texture();
  state.render.mockImplementation(state.mutate);
  state.composer.render(0.016);
  expect(state.snapshot()).toEqual(original);
  expect(state.frames).toHaveBeenCalledOnce();
  expect(state.gl.render).not.toHaveBeenCalled();
  state.gl.render.mockImplementation(() => {
    expect(state.values.target).toBeNull();
    expect(state.snapshot()).toEqual({
      ...original,
      target: null,
      face: 0,
      mip: 0,
      toneMapping: ACESFilmicToneMapping,
    });
    expect(state.gl.toneMappingExposure).toBe(1.25);
  });
  state.runtime.draw(texture, 0.22);
  expect(state.gl.render).toHaveBeenCalledExactlyOnceWith(
    state.scene,
    state.camera,
  );
  expect(state.overlay.draw).toHaveBeenCalledExactlyOnceWith(
    state.renderer,
    texture,
    0.22,
  );
  expect(state.snapshot()).toEqual(original);
  state.runtime.draw(texture, 0.22);
  expect(state.overlay.draw).toHaveBeenCalledOnce();
  state.cleanup();
  expect(state.composer.render).toBe(state.render);
  expect(state.gl.debug.onShaderError).toBe(state.oldShaderError);
});

it('restores mutated targets, layers, materials, background and renderer state before raw fallback and never overlays a stale successful texture after a throw', () => {
  const state = setup(),
    original = state.snapshot(),
    texture = new Texture();
  state.composer.render(0.016);
  state.runtime.draw(texture, 0.22);
  state.overlay.draw.mockClear();
  state.gl.render.mockClear();
  state.render.mockImplementation(() => {
    state.mutate();
    throw new Error('depth draw failed');
  });
  state.composer.render(0.016);
  expect(state.snapshot()).toEqual(original);
  expect(state.gl.render).not.toHaveBeenCalled();
  state.gl.render.mockImplementation(() =>
    expect(state.snapshot()).toEqual({
      ...original,
      target: null,
      face: 0,
      mip: 0,
      toneMapping: ACESFilmicToneMapping,
    }),
  );
  state.runtime.draw(texture, 0.22);
  expect(state.gl.render).toHaveBeenCalledOnce();
  expect(state.overlay.draw).not.toHaveBeenCalled();
  expect(state.snapshot()).toEqual(original);
  state.composer.render(0.016);
  state.runtime.draw(texture, 0.22);
  expect(state.render).toHaveBeenCalledTimes(2);
  expect(state.failures).toHaveBeenCalledExactlyOnceWith('composer-render');
});

it.each([0, NaN, -1])(
  'draws the unchanged raw scene without a zero/invalid intensity overlay (%s)',
  (intensity) => {
    const state = setup();
    state.composer.render(0.016);
    state.runtime.draw(new Texture(), intensity);
    expect(state.gl.render).toHaveBeenCalledOnce();
    expect(state.overlay.draw).not.toHaveBeenCalled();
  },
);
it('does not overlay missing textures, shader failures or an unsupported material workaround', () => {
  const state = setup();
  state.composer.render(0.016);
  state.runtime.draw(null, 0.22);
  expect(state.overlay.draw).not.toHaveBeenCalled();
  state.render.mockImplementation(() => state.gl.debug.onShaderError());
  state.composer.render(0.016);
  state.runtime.draw(new Texture(), 0.22);
  expect(state.overlay.draw).not.toHaveBeenCalled();
  expect(state.failures).toHaveBeenCalledExactlyOnceWith('shader-program');
  const unsupported = setup(true, false);
  unsupported.composer.render(0.016);
  unsupported.runtime.draw(new Texture(), 0.22);
  expect(unsupported.render).not.toHaveBeenCalled();
  expect(unsupported.overlay.draw).not.toHaveBeenCalled();
  expect(unsupported.gl.render).toHaveBeenCalledOnce();
  expect(unsupported.failures).toHaveBeenCalledExactlyOnceWith(
    'unsupported-material-workaround',
  );
});
it('latches framebuffer failure without an extra guard-owned raw draw', () => {
  const state = setup(false),
    original = state.snapshot();
  state.composer.render(0.016);
  expect(state.gl.render).not.toHaveBeenCalled();
  state.runtime.draw(new Texture(), 0.22);
  expect(state.render).not.toHaveBeenCalled();
  expect(state.gl.render).toHaveBeenCalledOnce();
  expect(state.overlay.draw).not.toHaveBeenCalled();
  expect(state.snapshot()).toEqual(original);
  expect(state.failures).toHaveBeenCalledExactlyOnceWith(
    'incomplete-framebuffer',
  );
});
it('does not overlay after a shader failure during the raw scene draw', () => {
  const state = setup();
  state.composer.render(0.016);
  state.gl.render.mockImplementation(() => state.gl.debug.onShaderError());
  state.runtime.draw(new Texture(), 0.22);
  expect(state.overlay.draw).not.toHaveBeenCalled();
  expect(state.failures).toHaveBeenCalledExactlyOnceWith('shader-program');
});
it('restores entry state after an overlay throw', () => {
  const state = setup(),
    original = state.snapshot();
  state.composer.render(0.016);
  state.overlay.draw.mockImplementation(() => {
    state.mutate();
    throw new Error('overlay');
  });
  state.runtime.draw(new Texture(), 0.22);
  expect(state.snapshot()).toEqual(original);
  expect(state.failures).toHaveBeenCalledExactlyOnceWith('screen-render');
});
it('owns additive RGB resources, preserves destination alpha, never samples base and disposes only its geometry/material', () => {
  const overlay = createBloomOverlay(),
    texture = new Texture();
  const textureDispose = vi.spyOn(texture, 'dispose');
  const gl = {
    render: vi.fn(),
    autoClear: true,
    autoClearColor: true,
    autoClearDepth: true,
    autoClearStencil: true,
    xr: { enabled: true },
  };
  overlay.draw(gl as unknown as WebGLRenderer, texture, 0.22);
  const scene = gl.render.mock.calls[0][0] as Scene,
    mesh = scene.children[0] as Mesh,
    material = mesh.material as ShaderMaterial;
  expect(material).toMatchObject({
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
    blending: CustomBlending,
    blendSrc: OneFactor,
    blendDst: OneFactor,
    blendSrcAlpha: ZeroFactor,
    blendDstAlpha: OneFactor,
  });
  expect(material.uniforms.bloomMap.value).toBe(texture);
  expect(material.uniforms.intensity.value).toBe(0.22);
  expect(material.fragmentShader.match(/\* intensity/g)).toHaveLength(1);
  expect(Object.keys(material.uniforms)).toEqual(['bloomMap', 'intensity']);
  expect(gl).toMatchObject({
    autoClear: false,
    autoClearColor: false,
    autoClearDepth: false,
    autoClearStencil: false,
  });
  const geometryDispose = vi.spyOn(mesh.geometry, 'dispose'),
    materialDispose = vi.spyOn(material, 'dispose');
  overlay.dispose();
  overlay.dispose();
  expect(geometryDispose).toHaveBeenCalledOnce();
  expect(materialDispose).toHaveBeenCalledOnce();
  expect(textureDispose).not.toHaveBeenCalled();
});
