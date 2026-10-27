import { act, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import {
  BoxGeometry,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  Raycaster,
  Scene,
} from 'three';
import { RoomLabelHtml } from './room-label-html';
import {
  LabelLayoutProvider,
  createRoomLabelRegistry,
} from './label-layout-runtime';

const runtime = vi.hoisted(() => ({
  state: {} as Record<string, unknown>,
  frame: (() => {}) as () => void,
}));
vi.mock('@react-three/fiber', () => ({
  useThree: (selector?: (state: typeof runtime.state) => unknown) =>
    selector ? selector(runtime.state) : runtime.state,
  useFrame: (frame: () => void) => {
    runtime.frame = frame;
  },
}));
// Use the installed Html implementation, including its projection-change gate
// and actual Three raycasting. Only the R3F renderer boundary is supplied here.
vi.mock('@react-three/drei', () => import('@react-three/drei/web/Html.js'));

afterEach(() => {
  delete (HTMLElement.prototype as unknown as Record<string, unknown>)
    .matrixWorld;
  delete (HTMLElement.prototype as unknown as Record<string, unknown>)
    .updateWorldMatrix;
});

it('rechecks real occlusion after camera orbit and occluder movement with fixed label projection and zoom', async () => {
  const scene = new Scene();
  const camera = new PerspectiveCamera(50, 1, 0.1, 100);
  camera.position.set(0, 0, 10);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();
  const blocker = new Mesh(new BoxGeometry(2, 2, 2), new MeshBasicMaterial());
  blocker.position.set(0, 0, 5);
  scene.add(blocker);
  const host = document.createElement('div');
  const canvas = document.createElement('canvas');
  host.append(canvas);
  document.body.append(host);
  // DOM rendering supplies a stationary identity group where R3F normally
  // provides Three.Group. Geometry, camera, and intersection tests stay real.
  Object.defineProperties(HTMLElement.prototype, {
    matrixWorld: { configurable: true, value: new Matrix4() },
    updateWorldMatrix: { configurable: true, value: () => {} },
  });
  runtime.state = {
    gl: { domElement: canvas },
    camera,
    scene,
    size: { width: 400, height: 400 },
    raycaster: new Raycaster(),
    events: {},
    viewport: {},
  };
  const view = render(
    <LabelLayoutProvider registry={createRoomLabelRegistry(vi.fn())}>
      <RoomLabelHtml occlude eps={1}>
        <span>Stationary label</span>
      </RoomLabelHtml>
    </LabelLayoutProvider>,
  );
  try {
    await act(async () => {});
    act(() => runtime.frame());
    expect(screen.getByText('Stationary label')).not.toBeVisible();
    // Orbit around the stationary origin. Its projected pixel and zoom stay
    // unchanged, but the fixed opaque box no longer intersects the sightline.
    camera.position.set(10, 0, 0);
    camera.lookAt(0, 0, 0);
    act(() => runtime.frame());
    expect(screen.getByText('Stationary label')).toBeVisible();
    camera.position.set(0, 0, 10);
    camera.lookAt(0, 0, 0);
    act(() => runtime.frame());
    expect(screen.getByText('Stationary label')).not.toBeVisible();
    blocker.position.x = 10;
    scene.updateMatrixWorld(true);
    act(() => runtime.frame());
    expect(screen.getByText('Stationary label')).toBeVisible();
    blocker.position.x = 0;
    scene.updateMatrixWorld(true);
    act(() => runtime.frame());
    expect(screen.getByText('Stationary label')).not.toBeVisible();
  } finally {
    view.unmount();
    host.remove();
    blocker.geometry.dispose();
    blocker.material.dispose();
  }
});
