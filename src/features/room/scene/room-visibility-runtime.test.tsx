import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render } from '@testing-library/react';
import { useFrame } from '@react-three/fiber';
import {
  BoxGeometry,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  OrthographicCamera,
  Raycaster,
  Scene,
  Vector3,
} from 'three';
import {
  ProjectedVisibleSurface,
  defaultSurfaceLimits,
} from './projected-visible-surface';
import {
  RoomVisibilityBatch,
  RoomVisibilityProvider,
  useRoomVisibilityBatch,
} from './room-visibility-runtime';
import { createRoomLabelRegistry } from './label-layout-runtime';

const runtime = vi.hoisted(() => ({
  state: {} as Record<string, unknown>,
  frames: [] as { frame: () => void; priority: number }[],
}));
vi.mock('@react-three/fiber', () => ({
  useThree: () => runtime.state,
  useFrame: (frame: () => void, priority = 0) => {
    runtime.frames.push({ frame, priority });
  },
}));
beforeEach(() => {
  runtime.frames = [];
});

const viewport = { left: 0, top: 0, right: 400, bottom: 400 };
function fixture(limits = {}) {
  const scene = new Scene(),
    camera = new OrthographicCamera(-5, 5, 5, -5, 0.1, 100);
  camera.position.set(0, 0, 10);
  camera.lookAt(0, 0, 0);
  camera.updateProjectionMatrix();
  const origin = new Group();
  origin.userData.roomHoverTarget = { code: 'ITC-S1A', label: 'Shelf 1A' };
  const mesh = new Mesh(
    new BoxGeometry(2, 2, 2),
    new MeshBasicMaterial({ side: DoubleSide }),
  );
  origin.add(mesh);
  scene.add(origin);
  const projection = new ProjectedVisibleSurface(scene, camera, {
    ...defaultSurfaceLimits,
    maxMilliseconds: 5000,
    ...limits,
  });
  return {
    scene,
    camera,
    origin,
    mesh,
    projection,
    batch: new RoomVisibilityBatch(scene, camera, projection),
  };
}
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
describe('shared room visibility transaction', () => {
  it('refreshes once and shares authoritative ray work across labels, then reuses proven same-view results', () => {
    const { scene, origin, batch, projection } = fixture();
    const second = origin.clone();
    second.position.x = 3;
    second.userData.roomHoverTarget.code = 'ITC-S1B';
    scene.add(second);
    const refresh = vi.spyOn(projection, 'refresh'),
      ray = vi.spyOn(Raycaster.prototype, 'intersectObject');
    batch.refresh(viewport, []);
    expect(batch.resolve(origin, 'ITC-S1A', new Vector3(0, 0, 1)).status).toBe(
      'visible',
    );
    expect(batch.resolve(second, 'ITC-S1B', new Vector3(0, 0, 1)).status).toBe(
      'visible',
    );
    expect(refresh).toHaveBeenCalledOnce();
    expect(ray).toHaveBeenCalledTimes(2);
    expect(projection.stats.rays).toBe(2);
    expect(batch.finish()).toEqual([]);
    batch.refresh(viewport, []);
    expect(batch.resolve(origin, 'ITC-S1A', new Vector3(0, 0, 1)).status).toBe(
      'visible',
    );
    expect(batch.resolve(second, 'ITC-S1B', new Vector3(0, 0, 1)).status).toBe(
      'visible',
    );
    expect(ray).toHaveBeenCalledTimes(2);
    expect(projection.stats.revisionReused).toBe(true);
  });
  it('distinguishes a completely hidden target from an unfinished query and latches only the measured revision', () => {
    const hidden = fixture();
    const blocker = new Mesh(
      new BoxGeometry(4, 4, 1),
      new MeshBasicMaterial({ side: DoubleSide }),
    );
    blocker.position.z = 4;
    hidden.scene.add(blocker);
    hidden.batch.refresh(viewport, []);
    expect(
      hidden.batch.resolve(hidden.origin, 'ITC-S1A', new Vector3(0, 0, 1))
        .status,
    ).toBe('hidden');
    expect(hidden.batch.finish()).toEqual([]);
    const unknown = fixture({ maxTriangles: 0 }),
      find = vi.spyOn(unknown.projection, 'find');
    unknown.batch.refresh(viewport, []);
    const result = unknown.batch.resolve(
      unknown.origin,
      'ITC-S1A',
      new Vector3(100, 0, 1),
    );
    expect(result.status).toBe('unresolved');
    expect(unknown.batch.finish()).toEqual(['ITC-S1A']);
    for (let frame = 0; frame < 4; frame++) {
      unknown.batch.refresh(viewport, []);
      expect(
        unknown.batch.resolve(
          unknown.origin,
          'ITC-S1A',
          new Vector3(100, 0, 1),
        ),
      ).toBe(result);
      unknown.batch.finish();
    }
    expect(find).toHaveBeenCalledOnce();
    unknown.batch.retry();
    unknown.batch.refresh(viewport, []);
    unknown.batch.resolve(unknown.origin, 'ITC-S1A', new Vector3(100, 0, 1));
    expect(find).toHaveBeenCalledTimes(2);
  });
  it('invalidates visible results after actual camera, geometry, material and DOM-mask changes', () => {
    const { batch, origin, mesh, camera, projection } = fixture();
    const query = () => batch.resolve(origin, 'ITC-S1A', new Vector3(0, 0, 1));
    batch.refresh(viewport, []);
    expect(query().status).toBe('visible');
    batch.finish();
    const revision = projection.revision;
    camera.position.x = 20;
    camera.lookAt(20, 0, 0);
    batch.refresh(viewport, []);
    expect(query().status).toBe('hidden');
    expect(projection.revision).toBeGreaterThan(revision);
    batch.finish();
    camera.position.x = 0;
    camera.lookAt(0, 0, 0);
    batch.refresh(viewport, [viewport]);
    expect(query().status).toBe('hidden');
    batch.finish();
    batch.refresh({ ...viewport, left: 20, right: 420 }, []);
    expect(query().status).toBe('visible');
    batch.finish();
    mesh.material.visible = false;
    batch.refresh(viewport, []);
    expect(query().status).toBe('hidden');
    batch.finish();
    mesh.material.visible = true;
    mesh.geometry.translate(20, 0, 0);
    mesh.geometry.getAttribute('position').needsUpdate = true;
    batch.refresh(viewport, []);
    expect(query().status).toBe('hidden');
  });
  it('allows a changed DOM measurement to retry unknown work while retaining a single shared projection', () => {
    const { batch, origin, projection } = fixture({ maxTriangles: 0 }),
      find = vi.spyOn(projection, 'find');
    batch.refresh(viewport, []);
    batch.resolve(origin, 'ITC-S1A', new Vector3(100, 0, 1));
    batch.finish();
    batch.refresh({ ...viewport, left: 5, right: 405 }, []);
    batch.resolve(origin, 'ITC-S1A', new Vector3(100, 0, 1));
    expect(find).toHaveBeenCalledTimes(2);
    expect(projection.stats.triangles).toBe(1);
  });
  it('does not repeat incomplete fingerprinting on demand frames, and removes unmounted fallback codes', () => {
    const { batch, origin, scene, projection } = fixture({ maxOperations: 0 }),
      traverse = vi.spyOn(scene, 'traverse');
    for (let frame = 0; frame < 4; frame++) {
      batch.refresh(viewport, []);
      expect(batch.resolve(origin, 'ITC-S1A', new Vector3()).status).toBe(
        'unresolved',
      );
      expect(batch.finish()).toEqual(['ITC-S1A']);
    }
    expect(traverse).not.toHaveBeenCalled();
    expect(projection.stats.operations).toBe(0);
    batch.refresh(viewport, []);
    expect(batch.finish()).toEqual([]);
  });
  it('refreshes the actual opaque-mask result on scroll and overlay movement while the camera stays fixed', () => {
    const { scene, camera, origin } = fixture();
    const surface = document.createElement('div'),
      canvas = document.createElement('canvas'),
      panel = document.createElement('div');
    surface.dataset.roomSurface = 'true';
    panel.dataset.roomObstruction = 'true';
    surface.append(canvas, panel);
    document.body.append(surface);
    const rect = {
      ...viewport,
      x: 0,
      y: 0,
      width: 400,
      height: 400,
      toJSON() {},
    };
    vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue(rect);
    vi.spyOn(panel, 'getClientRects').mockReturnValue([
      rect,
    ] as unknown as DOMRectList);
    let panelTop = 0;
    vi.spyOn(panel, 'getBoundingClientRect').mockImplementation(() => ({
      ...rect,
      top: panelTop,
      bottom: panelTop + 400,
      toJSON: () => ({ ...viewport, top: panelTop, bottom: panelTop + 400 }),
    }));
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
    vi.stubGlobal(
      'requestAnimationFrame',
      vi.fn(() => 1),
    );
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    const result = vi.fn();
    const frame = () =>
      runtime.frames
        .sort((a, b) => a.priority - b.priority)
        .forEach(({ frame }) => frame());
    const invalidate = vi.fn(frame);
    runtime.state = { scene, camera, gl: { domElement: canvas }, invalidate };
    function Query() {
      const batch = useRoomVisibilityBatch();
      useFrame(
        () => result(batch.resolve(origin, 'ITC-S1A', new Vector3(0, 0, 1))),
        -0.25,
      );
      return null;
    }
    const view = render(
      <RoomVisibilityProvider
        onUnresolvedChange={() => {}}
        retryRef={{ current: null }}
      >
        <Query />
      </RoomVisibilityProvider>,
    );
    const registry = createRoomLabelRegistry(vi.fn());
    const cleanup = registry.connect(canvas, invalidate);
    act(frame);
    expect(result.mock.lastCall?.[0].status).toBe('hidden');
    const initialCamera = camera.matrixWorld.toArray();
    panelTop = -500;
    act(() => surface.dispatchEvent(new Event('scroll', { bubbles: false })));
    expect(result.mock.lastCall?.[0].status).toBe('visible');
    panelTop = 0;
    act(() => registry.invalidateLayout());
    expect(result.mock.lastCall?.[0].status).toBe('hidden');
    panelTop = -500;
    act(() => registry.invalidateLayout());
    expect(result.mock.lastCall?.[0].status).toBe('visible');
    expect(camera.matrixWorld.toArray()).toEqual(initialCamera);
    cleanup();
    view.unmount();
    surface.remove();
  });

  it('mounts one provider, snapshots DOM masks once, resolves all anchors before publishing, and invalidates only on explicit retry', () => {
    const { scene, camera, origin } = fixture();
    const surface = document.createElement('div'),
      canvas = document.createElement('canvas'),
      panel = document.createElement('div');
    surface.dataset.roomSurface = 'true';
    panel.dataset.roomObstruction = 'true';
    surface.append(canvas, panel);
    document.body.append(surface);
    const rect = vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({
      ...viewport,
      x: 0,
      y: 0,
      width: 400,
      height: 400,
      toJSON() {},
    });
    vi.spyOn(panel, 'getClientRects').mockReturnValue([
      viewport,
    ] as unknown as DOMRectList);
    const obstruction = vi
      .spyOn(panel, 'getBoundingClientRect')
      .mockReturnValue({
        ...viewport,
        left: 500,
        right: 600,
        x: 500,
        y: 0,
        width: 100,
        height: 400,
        toJSON() {},
      });
    const invalidate = vi.fn(),
      notify = vi.fn(),
      retryRef = { current: null as (() => void) | null },
      result = vi.fn();
    runtime.state = { scene, camera, gl: { domElement: canvas }, invalidate };
    function Query() {
      const batch = useRoomVisibilityBatch();
      useFrame(
        () => result(batch.resolve(origin, 'ITC-S1A', new Vector3(0, 0, 1))),
        -0.25,
      );
      return null;
    }
    const view = render(
      <RoomVisibilityProvider onUnresolvedChange={notify} retryRef={retryRef}>
        <Query />
      </RoomVisibilityProvider>,
    );
    const refresh = vi.spyOn(ProjectedVisibleSurface.prototype, 'refresh');
    const frame = () =>
      act(() =>
        runtime.frames
          .sort((a, b) => a.priority - b.priority)
          .forEach(({ frame }) => frame()),
      );
    frame();
    expect(result.mock.lastCall?.[0].status).toBe('visible');
    expect(rect).toHaveBeenCalledOnce();
    expect(obstruction).toHaveBeenCalledOnce();
    expect(refresh).toHaveBeenCalledOnce();
    expect(notify).not.toHaveBeenCalled();
    expect(invalidate).not.toHaveBeenCalled();
    act(() => retryRef.current!());
    expect(invalidate).toHaveBeenCalledOnce();
    frame();
    expect(invalidate).toHaveBeenCalledOnce();
    view.unmount();
    expect(retryRef.current).toBeNull();
    surface.remove();
  });
});
