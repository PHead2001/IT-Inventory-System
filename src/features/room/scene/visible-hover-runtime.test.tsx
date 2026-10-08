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
const mocks = vi.hoisted(() => ({ three: vi.fn(), frame: vi.fn() }));
vi.mock('@react-three/fiber', () => ({
  useThree: mocks.three,
  useFrame: mocks.frame,
}));
import { VisibleHoverTracker } from './visible-hover-runtime';

afterEach(() => {
  vi.restoreAllMocks();
  document.body.replaceChildren();
});
it('retains its own hover button handoff but clears hover and cursor behind unrelated opaque overlays', () => {
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
    expect.objectContaining({ target: { code: 'ITC-D01', label: 'Drawer 1' } }),
  );
  expect(canvas.style.cursor).toBe('pointer');
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
});
