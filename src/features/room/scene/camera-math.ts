import { MathUtils, Spherical, Vector3 } from 'three';
/** Compute before mutating the camera: rotation must preserve distance and elevation. */
export function rotatedOffset(
  position: Vector3,
  target: Vector3,
  delta: number,
  limits: readonly [number, number],
) {
  const orbit = new Spherical().setFromVector3(position.clone().sub(target));
  orbit.theta = MathUtils.clamp(orbit.theta + delta, limits[0], limits[1]);
  return new Vector3().setFromSpherical(orbit);
}
