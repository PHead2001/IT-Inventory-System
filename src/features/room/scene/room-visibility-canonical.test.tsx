import { fireEvent, render, screen } from '@testing-library/react';
import { Children, isValidElement, type ReactNode } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import {
  BoxGeometry,
  Group,
  MathUtils,
  Mesh,
  MeshBasicMaterial,
  OrthographicCamera,
  Vector3,
  type Object3D,
} from 'three';
import { loadItCloset } from '../load';
import { toScenePosition } from '../coordinates';
import RoomScene from './room-scene';
import {
  cameraFacingDirectionInLocalSpace,
  cameraFacingLabelPosition,
} from './camera-math';
import { RoomVisibilityBatch } from './room-visibility-runtime';
import {
  ProjectedVisibleSurface,
  defaultSurfaceLimits,
  maxSurfaceContinuationFrames,
} from './projected-visible-surface';

const rendered = vi.hoisted(() => ({ children: null as ReactNode }));
afterEach(() => vi.restoreAllMocks());
vi.mock('./safe-canvas', () => ({
  SafeCanvas: ({ children }: { children: ReactNode }) => {
    rendered.children = children;
    return <canvas />;
  },
}));

// Invoke only the hook-free physical geometry components from the real JSX.
// This preserves canonical node transforms, physical furniture decorations,
// envelope/openings, material opacity, owner ancestry and invisible hitboxes.
// Lighting, lines, DOM labels and pass-through floor artwork do not occlude.
function physicalScene() {
  const scene = new Group();
  const visit = (children: ReactNode, parent: Object3D) =>
    Children.forEach(children, (child) => {
      if (!isValidElement<Record<string, unknown>>(child)) return;
      const { type, props } = child;
      if (
        typeof type === 'function' &&
        ['Envelope', 'NodeVisual', 'Solid', 'OpeningVisual'].includes(type.name)
      ) {
        visit(
          (type as (props: Record<string, unknown>) => ReactNode)(props),
          parent,
        );
        return;
      }
      if (type === 'group' || type === 'mesh') {
        const object =
          type === 'mesh'
            ? new Mesh(new BoxGeometry(), new MeshBasicMaterial())
            : new Group();
        if (Array.isArray(props.position))
          object.position.fromArray(props.position as [number, number, number]);
        if (Array.isArray(props.rotation))
          object.rotation.set(...(props.rotation as [number, number, number]));
        object.userData = (props.userData as Record<string, unknown>) ?? {};
        parent.add(object);
        visit(props.children as ReactNode, object);
        return;
      }
      if (parent instanceof Mesh && type === 'boxGeometry') {
        parent.geometry.dispose();
        parent.geometry = new BoxGeometry(
          ...(props.args as [number, number, number]),
        );
        return;
      }
      if (
        parent instanceof Mesh &&
        (type === 'meshStandardMaterial' ||
          type === 'meshBasicMaterial' ||
          (typeof type === 'function' && type.name === 'SelectionMaterial'))
      ) {
        parent.material.opacity = (props.opacity as number | undefined) ?? 1;
        return;
      }
      if (typeof type === 'function' && type.name === 'CameraFacingLabel') {
        // Preserve the real origin/anchor topology without mounting Drei DOM or
        // invoking the visibility hook in this physical-geometry probe.
        const origin = new Group(),
          anchor = new Group();
        origin.userData.visibilityProbe = {
          node: props.node,
          size: props.size,
        };
        origin.add(anchor);
        parent.add(origin);
        return;
      }
      if (
        typeof type === 'function' &&
        ['SceneDepth', 'SelectionEdges'].includes(type.name)
      )
        return;
      visit(props.children as ReactNode, parent);
    });
  visit(rendered.children, scene);
  return scene;
}

it('deterministically continues the canonical topology within unchanged frame and aggregate ceilings', () => {
  const room = loadItCloset();
  const view = render(
    <RoomScene
      room={room}
      bindings={[]}
      selectedCode={null}
      highlightedCodes={[]}
      focusRequest={{ code: null, requestId: 0 }}
      onSelect={() => {}}
      onReady={() => {}}
      onFocusComplete={() => {}}
      onFailure={() => {}}
      canFocusSelected={false}
      onRequestFocus={() => {}}
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: 'More map controls' }));
  fireEvent.click(screen.getByRole('button', { name: 'Show labels' }));
  const scene = physicalScene();
  const owners: Group[] = [];
  let meshes = 0;
  scene.traverse((object) => {
    if (object instanceof Mesh) meshes++;
    if (object instanceof Group && object.userData.roomHoverTarget)
      owners.push(object);
  });
  expect(meshes).toBeGreaterThan(60);
  expect(owners).toHaveLength(28);
  const camera = new OrthographicCamera(-80, 80, 80, -80, 0.1, 3000);
  const target = new Vector3(...toScenePosition(room.camera.target));
  const azimuth = MathUtils.degToRad(room.camera.azimuthDegrees);
  const elevation = MathUtils.degToRad(room.camera.elevationDegrees);
  camera.position
    .copy(target)
    .add(
      new Vector3(
        300 * Math.cos(elevation) * Math.sin(azimuth),
        300 * Math.sin(elevation),
        300 * Math.cos(elevation) * Math.cos(azimuth),
      ),
    );
  camera.lookAt(target);
  camera.updateProjectionMatrix();
  // Each budget checkpoint consumes a fixed synthetic quantum. CI scheduling,
  // OS pauses and GC cannot turn an observational timing sample into failure.
  let now = 0;
  const clock = vi
    .spyOn(performance, 'now')
    .mockImplementation(() => (now += 0.002));
  const projection = new ProjectedVisibleSurface(scene, camera);
  const batch = new RoomVisibilityBatch(scene, camera, projection);
  const viewport = { left: 0, top: 0, right: 375, bottom: 375 };
  const states = new Map<Group, string>();
  let frames = 0;
  const guards: number[] = [];
  do {
    batch.refresh(viewport, []);
    if (projection.revisionChecked)
      guards.push(projection.stats.elapsedMilliseconds);
    for (const owner of owners)
      states.set(
        owner,
        batch.resolve(
          owner,
          owner.userData.roomHoverTarget.code,
          new Vector3(10000, 10000, 10000),
        ).status,
      );
    batch.finish();
    frames++;
  } while (batch.needsFrame && frames < maxSurfaceContinuationFrames + 1);
  // Synthetic-clock progress evidence; prior real host timing was observational.
  console.info('Canonical room deterministic continuation', {
    meshes,
    labels: owners.length,
    frames,
    guardMilliseconds: guards,
    work: projection.stats,
    states: [...states.values()],
  });
  expect(guards.length).toBeGreaterThan(0);
  expect(frames).toBeGreaterThan(1);
  expect(frames).toBeLessThanOrEqual(maxSurfaceContinuationFrames);
  expect([...states.values()]).not.toContain('pending');
  expect([...states.values()]).not.toContain('unresolved');
  expect(projection.stats.operations).toBeLessThan(
    defaultSurfaceLimits.maxOperations,
  );
  expect(projection.stats.triangles).toBeLessThan(
    defaultSurfaceLimits.maxTriangles,
  );
  expect(projection.stats.fragments).toBeLessThan(
    defaultSurfaceLimits.maxFragments,
  );
  expect(batch.needsFrame).toBe(false);
  view.unmount();
  clock.mockRestore();
});

it('settles the actual 375px Drawer 1 camera when More opens and closes without changing the camera', () => {
  const room = loadItCloset();
  const view = render(
    <RoomScene
      room={room}
      bindings={[]}
      selectedCode="ITC-D01"
      highlightedCodes={[]}
      focusRequest={{ code: 'ITC-D01', requestId: 1 }}
      onSelect={() => {}}
      onReady={() => {}}
      onFocusComplete={() => {}}
      onFailure={() => {}}
      canFocusSelected
      onRequestFocus={() => {}}
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: 'More map controls' }));
  fireEvent.click(screen.getByRole('button', { name: 'Show labels' }));
  const scene = physicalScene();
  const probes: Group[] = [];
  scene.traverse((object) => {
    if (object instanceof Group && object.userData.visibilityProbe)
      probes.push(object);
  });
  expect(probes).toHaveLength(28);
  // Read-only hosted diagnostic on 997c: 375x812 viewport, actual 315x408
  // canvas, Drawer 1 focus and real 220x200 More rectangle. No private data.
  const camera = new OrthographicCamera(-157.5, 157.5, 204, -204, 0.1, 3000);
  camera.position.set(82.15403469828617, 353.1394727412389, 185.7365358949958);
  camera.zoom = 3.170755395994425;
  camera.lookAt(8, 43.5, -18);
  camera.updateProjectionMatrix();
  expect(camera.projectionMatrix.elements[0]).toBe(0.020131780292028098);
  expect(camera.projectionMatrix.elements[5]).toBe(0.015542918607815807);
  const viewport = { left: 30, top: 57.046875, right: 345, bottom: 465.046875 };
  const more = { left: 126, top: 50.046875, right: 346, bottom: 250.046875 };
  let now = 0;
  vi.spyOn(performance, 'now').mockImplementation(() => (now += 0.002));
  const projection = new ProjectedVisibleSurface(scene, camera);
  const batch = new RoomVisibilityBatch(scene, camera, projection);
  let closedResults:
    { code: string; status: string; reason: string | null }[] | undefined;
  for (const [phase, masks] of [
    ['closed', []],
    ['open', [more]],
    ['closed-again', []],
  ] as const) {
    const states = new Map<
      string,
      ReturnType<RoomVisibilityBatch['resolve']>
    >();
    let frames = 0;
    do {
      batch.refresh(viewport, [...masks]);
      for (const origin of probes) {
        const { node, size } = origin.userData.visibilityProbe;
        const preferred = node.interaction?.labelAnchor
          ? cameraFacingLabelPosition(
              size,
              cameraFacingDirectionInLocalSpace(camera, origin),
              node.interaction.labelAnchor,
            )
          : [0, size[2] / 2 + 0.15, 0];
        states.set(
          node.locationCode,
          batch.resolve(
            origin,
            node.locationCode,
            new Vector3().fromArray(preferred),
          ),
        );
      }
      batch.finish();
      frames++;
    } while (batch.needsFrame && frames <= maxSurfaceContinuationFrames);
    const results = [...states].map(([code, result]) => ({
      code,
      status: result.status,
      reason: 'reason' in result ? result.reason : null,
    }));
    if (phase === 'closed') closedResults = results;
    if (phase === 'closed-again') expect(results).toEqual(closedResults);
    if (phase === 'open') {
      expect(results.find((result) => result.code === 'ITC-D01')?.status).toBe(
        'visible',
      );
      expect(results.find((result) => result.code === 'ITC-D04')?.status).toBe(
        'visible',
      );
    }
    console.info(
      '375px More visibility transaction',
      JSON.stringify({ phase, frames, work: projection.stats, results }),
    );
    expect(frames).toBeLessThanOrEqual(maxSurfaceContinuationFrames);
    expect(
      results.filter(
        (result) =>
          result.status === 'unresolved' || result.status === 'pending',
      ),
      phase,
    ).toEqual([]);
    expect(projection.stats.operations).toBeLessThan(
      defaultSurfaceLimits.maxOperations,
    );
    expect(projection.stats.triangles).toBeLessThan(
      defaultSurfaceLimits.maxTriangles,
    );
    expect(projection.stats.fragments).toBeLessThan(
      defaultSurfaceLimits.maxFragments,
    );
    expect(batch.needsFrame).toBe(false);
  }
  view.unmount();
});
