import { expect, it, vi } from 'vitest';
import {
  BoxGeometry,
  Color,
  Group,
  Mesh,
  MeshBasicMaterial,
  Vector4,
  WebGLRenderTarget,
  type Scene,
  type WebGLRenderer,
} from 'three';
import { createContactCapture } from './contact-capture';
import { createSceneEffectsStore } from './scene-effects-state';

function renderer(failPass = 0) {
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
  const gl = {
    autoClear: false,
    xr: { enabled: true },
    getRenderTarget: () => target,
    getActiveCubeFace: () => 2,
    getActiveMipmapLevel: () => 1,
    setRenderTarget: vi.fn((next: WebGLRenderTarget) => {
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
      scenes.push({
        count: scene.children.length,
        positions: scene.children.map((object) => [
          object.matrix.elements[12],
          object.matrix.elements[13],
          object.matrix.elements[14],
        ]),
        geometries: scene.children.map((object) => (object as Mesh).geometry),
      });
      if (++calls === failPass) throw new Error('capture GPU failure');
    }),
  };
  return {
    gl,
    typed: gl as unknown as WebGLRenderer,
    originalTarget,
    scenes,
    state: () => ({
      target,
      viewport: viewport.toArray(),
      scissor: scissor.toArray(),
      scissorTest,
      color: color.getHexString(),
      alpha,
      autoClear: gl.autoClear,
      xr: gl.xr.enabled,
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
