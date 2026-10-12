import type { RoomDefinition } from '../schema';
import type { OrbitMode } from './camera-math';

export type CameraView = {
  position: [number, number, number];
  target: [number, number, number];
  zoom: number;
  mode: OrbitMode;
};

/** Exact geometry/configuration match; snapshots never outlive the protected layout instance. */
export function cameraViewKey(
  userId: string,
  environment: string,
  spaceId: string,
  room: RoomDefinition,
) {
  return JSON.stringify([
    userId,
    environment,
    spaceId,
    room.schemaVersion,
    room.roomId,
    room,
  ]);
}

export function validCameraView(
  view: CameraView | null | undefined,
): view is CameraView {
  if (
    !view ||
    (view.mode !== 'guided' && view.mode !== 'free') ||
    !Number.isFinite(view.zoom) ||
    view.zoom <= 0
  )
    return false;
  if (
    view.position.length !== 3 ||
    view.target.length !== 3 ||
    ![...view.position, ...view.target].every(Number.isFinite)
  )
    return false;
  return view.position.some(
    (value, index) => Math.abs(value - view.target[index]) > 1e-6,
  );
}
