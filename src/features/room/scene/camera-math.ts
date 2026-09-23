import {
  MathUtils,
  Matrix4,
  Spherical,
  Vector3,
  type Camera,
  type Object3D,
} from 'three';
import type { RoomBinding } from '../bindings';
import { toScenePosition } from '../coordinates';

export type OrbitMode = 'guided' | 'free';
// OrbitControls uses spherical coordinates and needs a nonzero pole gap.
export const FREE_POLAR_EPSILON = 1e-4;

export function floorDoubleClickAllowed(
  pointerDelta: number,
  gestureActive: boolean,
  lastManualMotionAt: number,
  now: number,
) {
  return pointerDelta <= 5 && !gestureActive && now - lastManualMotionAt > 500;
}

/** The viewer-facing direction in a label group's coordinates.
 * Orthographic pan changes position but leaves this direction unchanged.
 */
export function cameraFacingDirectionInLocalSpace(
  camera: Camera,
  origin: Object3D,
) {
  origin.updateWorldMatrix(true, false);
  return camera
    .getWorldDirection(new Vector3())
    .negate()
    .transformDirection(new Matrix4().copy(origin.matrixWorld).invert());
}

/** Scene-local anchor on the visible side of a room-axis-aligned box. */
export function cameraFacingLabelPosition(
  size: readonly [number, number, number],
  localCamera: Vector3,
  authoredAnchor: readonly [number, number, number],
): [number, number, number] {
  const margin = 0.8;
  // At steep elevations a side label sits behind its own box. Put it on the
  // visible horizontal face; geometry occlusion still applies (including floor).
  if (
    Math.abs(localCamera.y) >
    Math.max(Math.abs(localCamera.x), Math.abs(localCamera.z))
  )
    return [
      MathUtils.clamp(authoredAnchor[0], -size[0] / 2, size[0] / 2),
      Math.sign(localCamera.y) * (size[2] / 2 + margin),
      -MathUtils.clamp(authoredAnchor[1], -size[1] / 2, size[1] / 2),
    ];
  const authoredXFace =
    Math.abs(authoredAnchor[0] / (size[0] / 2)) >=
    Math.abs(authoredAnchor[1] / (size[1] / 2));
  const tangent = authoredXFace
    ? authoredAnchor[1] / (size[1] / 2)
    : authoredAnchor[0] / (size[0] / 2);
  const facingX =
    Math.abs(localCamera.x / size[0]) >= Math.abs(localCamera.z / size[1]);
  if (facingX)
    return [
      Math.sign(localCamera.x || 1) * (size[0] / 2 + margin),
      authoredAnchor[2],
      -MathUtils.clamp(tangent * (size[1] / 2), -size[1] / 2, size[1] / 2),
    ];
  return [
    MathUtils.clamp(tangent * (size[0] / 2), -size[0] / 2, size[0] / 2),
    authoredAnchor[2],
    Math.sign(localCamera.z || 1) * (size[1] / 2 + margin),
  ];
}

/** Move the orbit pivot without changing the camera's offset from it. */
export function recenteredPosition(
  position: Vector3,
  target: Vector3,
  canonical: Vector3,
) {
  return position.clone().add(canonical.clone().sub(target));
}

export function nearestGuidedAzimuth(
  angle: number,
  limits: readonly [number, number],
) {
  const center = (limits[0] + limits[1]) / 2;
  const equivalent =
    angle + Math.round((center - angle) / (Math.PI * 2)) * Math.PI * 2;
  return MathUtils.clamp(equivalent, limits[0], limits[1]);
}
/** Compute before mutating the camera: rotation must preserve distance and elevation. */
export function rotatedOffset(
  position: Vector3,
  target: Vector3,
  delta: number,
  limits: readonly [number, number],
) {
  const orbit = new Spherical().setFromVector3(position.clone().sub(target));
  orbit.theta =
    Number.isFinite(limits[0]) && Number.isFinite(limits[1])
      ? MathUtils.clamp(
          nearestGuidedAzimuth(orbit.theta, limits) + delta,
          limits[0],
          limits[1],
        )
      : orbit.theta + delta;
  return new Vector3().setFromSpherical(orbit);
}

/** Rotate toward/away from the ceiling while keeping the pivot and radius. */
export function tiltedOffset(
  position: Vector3,
  target: Vector3,
  delta: number,
  polarLimits: readonly [number, number],
) {
  const orbit = new Spherical().setFromVector3(position.clone().sub(target));
  orbit.phi = MathUtils.clamp(
    orbit.phi + delta,
    polarLimits[0],
    polarLimits[1],
  );
  return new Vector3().setFromSpherical(orbit);
}

/** Returning to Guided must constrain both axes of an existing Free view. */
export function guidedOffset(
  position: Vector3,
  target: Vector3,
  azimuthLimits: readonly [number, number],
  elevationLimitsDegrees: readonly [number, number],
) {
  const orbit = new Spherical().setFromVector3(position.clone().sub(target));
  orbit.theta = nearestGuidedAzimuth(orbit.theta, azimuthLimits);
  orbit.phi = MathUtils.clamp(
    orbit.phi,
    MathUtils.degToRad(90 - elevationLimitsDegrees[1]),
    MathUtils.degToRad(90 - elevationLimitsDegrees[0]),
  );
  return new Vector3().setFromSpherical(orbit);
}

type Bounds = RoomBinding['bounds'];

/** Maximum zoom that still contains every corner around a fixed focus point. */
export function zoomForBoundsAroundFocus(
  bounds: Bounds,
  focus: Vector3,
  right: Vector3,
  up: Vector3,
  viewport: { width: number; height: number },
  padding: number,
) {
  let maxX = 0,
    maxY = 0;
  for (const x of [bounds.min[0], bounds.max[0]])
    for (const y of [bounds.min[1], bounds.max[1]])
      for (const z of [bounds.min[2], bounds.max[2]]) {
        const delta = new Vector3(...toScenePosition([x, y, z])).sub(focus);
        maxX = Math.max(maxX, Math.abs(delta.dot(right)));
        maxY = Math.max(maxY, Math.abs(delta.dot(up)));
      }
  return Math.min(
    viewport.width / Math.max(2 * maxX * padding, 1),
    viewport.height / Math.max(2 * maxY * padding, 1),
  );
}

export function focusZoomForBinding(
  bounds: Bounds,
  focus: Vector3,
  right: Vector3,
  up: Vector3,
  viewport: { width: number; height: number },
  padding: number,
  roomFitZoom: number,
  zoomLimits: readonly [number, number],
) {
  return MathUtils.clamp(
    Math.min(
      roomFitZoom * 1.6,
      zoomForBoundsAroundFocus(bounds, focus, right, up, viewport, padding),
    ),
    roomFitZoom * zoomLimits[0],
    roomFitZoom * zoomLimits[1],
  );
}

/** Project all eight corners into the current orthographic camera plane. */
export function frameBounds(
  bounds: Bounds[],
  target: Vector3,
  right: Vector3,
  up: Vector3,
  viewport: { width: number; height: number },
  padding: number,
) {
  let minX = Infinity,
    maxX = -Infinity,
    minY = Infinity,
    maxY = -Infinity;
  for (const box of bounds)
    for (const x of [box.min[0], box.max[0]])
      for (const y of [box.min[1], box.max[1]])
        for (const z of [box.min[2], box.max[2]]) {
          const delta = new Vector3(...toScenePosition([x, y, z])).sub(target);
          const px = delta.dot(right),
            py = delta.dot(up);
          minX = Math.min(minX, px);
          maxX = Math.max(maxX, px);
          minY = Math.min(minY, py);
          maxY = Math.max(maxY, py);
        }
  const nextTarget = target
    .clone()
    .addScaledVector(right, (minX + maxX) / 2)
    .addScaledVector(up, (minY + maxY) / 2);
  return {
    target: nextTarget,
    zoom:
      Math.min(
        viewport.width / Math.max(maxX - minX, 1),
        viewport.height / Math.max(maxY - minY, 1),
      ) / padding,
  };
}
