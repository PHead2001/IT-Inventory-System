import { act, render } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import {
  Group,
  Mesh,
  BoxGeometry,
  MeshBasicMaterial,
  OrthographicCamera,
  Raycaster,
  Vector3,
} from 'three';
import {
  createSceneEffectsStore,
  type SceneEffectsStore,
} from './scene-effects-state';
const mocks = vi.hoisted(() => ({
  three: vi.fn(),
  frame: vi.fn(),
  effects: null as SceneEffectsStore | null,
}));
vi.mock('@react-three/fiber', () => ({
  useThree: mocks.three,
  useFrame: mocks.frame,
}));
vi.mock('./scene-effects-context', () => ({
  useOptionalSceneEffects: () => mocks.effects,
}));
import { VisibleHoverTracker } from './visible-hover-runtime';

afterEach(() => {
  mocks.effects = null;
  vi.restoreAllMocks();
  document.body.replaceChildren();
});
it('retains only a visual latch during its own lift while actual hover clears, then refreshes on pointer/camera/other geometry changes', () => {
  const canvas = document.createElement('canvas');
  document.body.append(canvas);
  vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({
    left: 0,
    top: 0,
    width: 200,
    height: 200,
  } as DOMRect);
  Object.defineProperty(document, 'elementFromPoint', {
    configurable: true,
    value: () => canvas,
  });
  const scene = new Group(),
    mesh = new Mesh(new BoxGeometry(), new MeshBasicMaterial());
  mesh.userData.roomHoverTarget = { code: 'ITC-D01', label: 'Drawer 1' };
  scene.add(mesh);
  const camera = new OrthographicCamera();
  const raycast = vi.spyOn(Raycaster.prototype, 'intersectObjects');
  const hit = [
    { object: mesh, distance: 1, point: new Vector3() },
  ] as ReturnType<Raycaster['intersectObjects']>;
  raycast.mockReturnValue(hit);
  const effects = createSceneEffectsStore('hover-test');
  mocks.effects = effects;
  effects.registerVisual('drawer', 'ITC-D01', scene);
  mocks.three.mockReturnValue({
    camera,
    gl: { domElement: canvas },
    scene,
    invalidate: vi.fn(),
  });
  const onHit = vi.fn();
  render(
    <VisibleHoverTracker
      showAllLabels={false}
      retainDuringLabelHandoff={false}
      onHit={onHit}
      onCanvasLeave={vi.fn()}
    />,
  );
  const pointer = () =>
    act(() =>
      canvas.dispatchEvent(
        new MouseEvent('pointermove', { clientX: 50, clientY: 50 }),
      ),
    );
  const frame = () =>
    act(() => (mocks.frame.mock.calls.at(-1)?.[0] as () => void)());
  pointer();
  expect(effects.getSnapshot().hoverCode).toBe('ITC-D01');
  const finish = effects.beginCasterMotion('hover:drawer', 'drawer', true);
  raycast.mockReturnValue([]);
  frame();
  expect(onHit).toHaveBeenLastCalledWith(null);
  expect(canvas.style.cursor).toBe('auto');
  expect(canvas.dataset.hoverVisibleCode).toBe('');
  expect(effects.getSnapshot().hoverCode).toBe('ITC-D01');
  finish();
  frame();
  expect(effects.getSnapshot().hoverCode).toBe('ITC-D01');
  pointer();
  expect(effects.getSnapshot().hoverCode).toBeNull();
  raycast.mockReturnValue(hit);
  pointer();
  raycast.mockReturnValue([]);
  camera.position.x += 10;
  frame();
  expect(effects.getSnapshot().hoverCode).toBeNull();
  raycast.mockReturnValue(hit);
  pointer();
  raycast.mockReturnValue([]);
  effects.beginCasterMotion('reveal:other', 'other');
  frame();
  expect(effects.getSnapshot().hoverCode).toBeNull();
});
it.each([
  [true, true],
  [false, true],
  [true, false],
])(
  'retains hover while selection enabled=%s and per-code eligibility=%s',
  (selectionEnabled, eligible) => {
    const host = document.createElement('div');
    const wrapper = document.createElement('div');
    const canvas = document.createElement('canvas');
    canvas.style.cursor = 'crosshair';
    wrapper.append(canvas);
    host.append(wrapper);
    document.body.append(host);
    vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({
      left: 0,
      top: 0,
      width: 200,
      height: 200,
    } as DOMRect);
    let top: Element = canvas;
    Object.defineProperty(document, 'elementFromPoint', {
      configurable: true,
      value: vi.fn(() => top),
    });
    const scene = new Group();
    const mesh = new Mesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial());
    mesh.userData.roomHoverTarget = { code: 'ITC-D01', label: 'Drawer 1' };
    scene.add(mesh);
    vi.spyOn(Raycaster.prototype, 'intersectObjects').mockReturnValue([
      { object: mesh, distance: 1, point: new Vector3() },
    ] as ReturnType<Raycaster['intersectObjects']>);
    mocks.three.mockReturnValue({
      camera: new OrthographicCamera(),
      gl: { domElement: canvas },
      scene,
      invalidate: vi.fn(),
    });
    const onHit = vi.fn();
    const view = render(
      <VisibleHoverTracker
        showAllLabels={false}
        retainDuringLabelHandoff
        selectionEnabled={selectionEnabled}
        selectionAvailable={(code) => eligible && code === 'ITC-D01'}
        onHit={onHit}
        onCanvasLeave={vi.fn()}
      />,
    );
    act(() =>
      canvas.dispatchEvent(
        new MouseEvent('pointermove', { clientX: 50, clientY: 50 }),
      ),
    );
    expect(onHit).toHaveBeenLastCalledWith(
      expect.objectContaining({
        target: { code: 'ITC-D01', label: 'Drawer 1' },
      }),
    );
    expect(canvas.style.cursor).toBe(
      selectionEnabled && eligible ? 'pointer' : 'auto',
    );
    const ownButton = document.createElement('button');
    ownButton.dataset.hoverTooltip = 'true';
    host.append(ownButton);
    top = ownButton;
    act(() => mocks.frame.mock.calls.at(-1)?.[0]());
    expect(canvas.dataset.hoverVisibleCode).toBe('ITC-D01');
    const overlay = document.createElement('div');
    host.append(overlay);
    top = overlay;
    act(() => mocks.frame.mock.calls.at(-1)?.[0]());
    expect(onHit).toHaveBeenLastCalledWith(null);
    expect(canvas.dataset.hoverVisibleCode).toBe('');
    expect(canvas.style.cursor).toBe('auto');
    // A different scene's tooltip is also an unrelated overlay.
    const otherButton = document.createElement('button');
    otherButton.dataset.hoverTooltip = 'true';
    document.body.append(otherButton);
    top = otherButton;
    act(() => mocks.frame.mock.calls.at(-1)?.[0]());
    expect(onHit).toHaveBeenLastCalledWith(null);
    view.unmount();
    expect(canvas.style.cursor).toBe('crosshair');
  },
);
