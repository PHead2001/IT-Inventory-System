import {
  Camera,
  Group,
  Raycaster,
  Vector2,
  Vector3,
  type Object3D,
} from 'three';
import { visibleRoomHit } from './visible-hover';
import type { LabelArea } from './label-layout';
import {
  ProjectedVisibleSurface,
  type SurfaceWork,
} from './projected-visible-surface';

export type ExposedAnchorResult =
  | { status: 'visible'; anchor: Vector3; stats: SurfaceWork }
  | { status: 'hidden'; stats: SurfaceWork }
  | { status: 'pending'; reason: string; stats: SurfaceWork }
  | { status: 'unresolved'; reason: string; stats: SurfaceWork };

const witnesses = new WeakMap<Group, Vector3>();
const pendingRays = new WeakMap<
  Group,
  {
    context: ProjectedVisibleSurface;
    revision: number;
    point: { x: number; y: number; z: number };
    hit: ReturnType<typeof visibleRoomHit>;
  }
>();

/** Preferred and previous verified rays are inexpensive witnesses only.
 * Exhaustive fallback uses actual projected surfaces, never box samples. A
 * caller-owned context is refreshed once before all labels in a demand frame. */
export function resolveExposedTargetAnchor(
  scene: Object3D,
  camera: Camera,
  origin: Group,
  code: string,
  preferred: Vector3,
  viewport?: LabelArea,
  obstructions: LabelArea[] = [],
  context?: ProjectedVisibleSurface,
  signal?: AbortSignal,
): ExposedAnchorResult {
  const ray = new Raycaster();
  const ndc = new Vector2();
  let anchor: Vector3 | null = null;
  const emptyStats: SurfaceWork = {
    triangles: 0,
    overlaps: 0,
    fragments: 0,
    operations: 0,
    revisionReused: false,
    rays: 0,
    elapsedMilliseconds: 0,
  };
  if (signal?.aborted)
    return { status: 'unresolved', reason: 'cancelled', stats: emptyStats };
  const projection = context ?? new ProjectedVisibleSurface(scene, camera);
  if (projection.scene !== scene || projection.camera !== camera)
    return {
      status: 'unresolved',
      reason: 'projection context belongs to another scene or camera',
      stats: emptyStats,
    };
  if (!context) projection.refresh(signal);
  let budgetFailure = projection.checkpoint();
  if (budgetFailure)
    return {
      status: projection.pending ? 'pending' : 'unresolved',
      reason: budgetFailure,
      stats: projection.stats,
    };
  const verify = (projected: { x: number; y: number; z: number }) => {
    if (
      Math.abs(projected.x) > 1 ||
      Math.abs(projected.y) > 1 ||
      Math.abs(projected.z) > 1
    )
      return false;
    if (viewport) {
      const x =
        viewport.left +
        ((projected.x + 1) * (viewport.right - viewport.left)) / 2;
      const y =
        viewport.top +
        ((1 - projected.y) * (viewport.bottom - viewport.top)) / 2;
      if (
        obstructions.some(
          (rect) =>
            x >= rect.left &&
            x <= rect.right &&
            y >= rect.top &&
            y <= rect.bottom,
        )
      )
        return false;
    }
    ndc.set(projected.x, projected.y);
    const pending = pendingRays.get(origin);
    const retained =
      pending?.context === projection &&
      pending.revision === projection.revision &&
      pending.point.x === projected.x &&
      pending.point.y === projected.y &&
      pending.point.z === projected.z
        ? pending
        : null;
    budgetFailure = projection.checkpoint(!retained);
    if (budgetFailure) return false;
    ray.setFromCamera(ndc, camera);
    const visible = retained
      ? retained.hit
      : visibleRoomHit(ray.intersectObject(scene, true));
    budgetFailure = projection.checkpoint();
    if (budgetFailure) {
      if (projection.pending)
        pendingRays.set(origin, {
          context: projection,
          revision: projection.revision,
          point: { x: projected.x, y: projected.y, z: projected.z },
          hit: visible,
        });
      return false;
    }
    pendingRays.delete(origin);
    if (visible?.target?.code !== code) return false;
    const depth = visible.hit.point.clone().project(camera).z;
    if (depth < -1 || depth > 1) return false;
    witnesses.set(origin, origin.worldToLocal(visible.hit.point.clone()));
    anchor = origin.worldToLocal(
      visible.hit.point.clone().addScaledVector(ray.ray.direction, -0.3),
    );
    return true;
  };
  if (!projection.hasPendingQuery(code))
    for (const local of [preferred, witnesses.get(origin)]) {
      if (local && verify(origin.localToWorld(local.clone()).project(camera)))
        return { status: 'visible', anchor: anchor!, stats: projection.stats };
    }
  if (budgetFailure)
    return {
      status: projection.pending ? 'pending' : 'unresolved',
      reason: budgetFailure,
      stats: projection.stats,
    };
  const result = projection.find(code, verify, viewport, obstructions, signal);
  if (result.status === 'visible')
    return { status: 'visible', anchor: anchor!, stats: result.stats };
  return result;
}

/** Compatibility for existing geometry callers. Production consumers must use
 * resolveExposedTargetAnchor so incomplete work is not classified as hidden. */
export function exposedTargetAnchor(
  scene: Object3D,
  camera: Camera,
  origin: Group,
  _size: [number, number, number],
  code: string,
  preferred: Vector3,
  viewport?: LabelArea,
  obstructions: LabelArea[] = [],
) {
  const result = resolveExposedTargetAnchor(
    scene,
    camera,
    origin,
    code,
    preferred,
    viewport,
    obstructions,
  );
  return result.status === 'visible' ? result.anchor : null;
}
