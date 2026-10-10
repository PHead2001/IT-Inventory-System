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

/** Real exposed face samples, not a DOM anchor or transparent picking box,
 * establish whether a location is physically in the current camera view. */
export function exposedTargetAnchor(
  scene: Object3D,
  camera: Camera,
  origin: Group,
  size: [number, number, number],
  code: string,
  preferred: Vector3,
  viewport?: LabelArea,
  obstructions: LabelArea[] = [],
) {
  const ray = new Raycaster();
  const ndc = new Vector2();
  const candidates = [preferred.clone()];
  // Scene axes are [room X, room Z, -room Y]. Include corners inset from
  // seams, so a partially exposed face can survive a hidden center anchor.
  for (let axis = 0; axis < 3; axis++) {
    const other = [0, 1, 2].filter((value) => value !== axis);
    for (const sign of [-1, 1])
      for (const u of [0, -0.85, 0.85])
        for (const v of [0, -0.85, 0.85]) {
          const point = new Vector3();
          point.setComponent(axis, (sign * size[axis]) / 2);
          point.setComponent(other[0], (u * size[other[0]]) / 2);
          point.setComponent(other[1], (v * size[other[1]]) / 2);
          candidates.push(point);
        }
  }
  scene.updateMatrixWorld(true);
  origin.updateWorldMatrix(true, false);
  camera.updateMatrixWorld();
  for (const local of candidates) {
    const world = origin.localToWorld(local.clone());
    const projected = world.clone().project(camera);
    if (
      Math.abs(projected.x) > 1 ||
      Math.abs(projected.y) > 1 ||
      Math.abs(projected.z) > 1
    )
      continue;
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
        continue;
    }
    ndc.set(projected.x, projected.y);
    ray.setFromCamera(ndc, camera);
    const visible = visibleRoomHit(ray.intersectObject(scene, true));
    if (visible?.target?.code !== code) continue;
    // Move towards the camera along this tested ray, retaining Html occlusion
    // against other opaque furniture while avoiding self-occlusion at a seam.
    return origin.worldToLocal(
      visible.hit.point.clone().addScaledVector(ray.ray.direction, -0.3),
    );
  }
  return null;
}
