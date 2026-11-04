import { Vector3, type Camera, type Object3D } from 'three';
import type { LabelArea } from './label-layout';

/** Packing-only space around the existing ray-verified physical anchor. Never
 * feed this rectangle back into physical visibility or add another raycast. */
export function labelPickReservation(
  origin: Object3D,
  anchor: Vector3,
  camera: Camera,
  viewport: { left: number; top: number; width: number; height: number },
): LabelArea | null {
  if (
    ![
      ...anchor.toArray(),
      viewport.left,
      viewport.top,
      viewport.width,
      viewport.height,
    ].every(Number.isFinite) ||
    viewport.width <= 0 ||
    viewport.height <= 0
  )
    return null;
  const projected = origin.localToWorld(anchor.clone()).project(camera);
  if (
    ![projected.x, projected.y, projected.z].every(Number.isFinite) ||
    Math.abs(projected.x) > 1 ||
    Math.abs(projected.y) > 1 ||
    Math.abs(projected.z) > 1
  )
    return null;
  const x = viewport.left + ((projected.x + 1) * viewport.width) / 2,
    y = viewport.top + ((1 - projected.y) * viewport.height) / 2;
  const area = { left: x - 6, top: y - 6, right: x + 6, bottom: y + 6 };
  return Object.values(area).every(Number.isFinite) &&
    area.left < area.right &&
    area.top < area.bottom
    ? area
    : null;
}
