import { Mesh, type Intersection, type Object3D } from 'three';

export type VisibleRoomTarget = { code: string; label: string };

/** Keep a measured screen-space label entirely inside its canvas. */
export function placeHoverTooltip(
  pointer: { x: number; y: number },
  canvas: { width: number; height: number },
  label: { width: number; height: number },
) {
  const proposedX =
    pointer.x <= canvas.width / 2
      ? pointer.x + 12
      : pointer.x - 12 - label.width;
  const proposedY =
    pointer.y <= canvas.height / 2
      ? pointer.y + 12
      : pointer.y - 12 - label.height;
  return {
    left: Math.max(8, Math.min(proposedX, canvas.width - 8 - label.width)),
    top: Math.max(8, Math.min(proposedY, canvas.height - 8 - label.height)),
  };
}

function interactiveAncestor(object: Object3D): VisibleRoomTarget | null {
  for (
    let current: Object3D | null = object;
    current;
    current = current.parent
  ) {
    const target = current.userData.roomHoverTarget as
      VisibleRoomTarget | undefined;
    if (target) return target;
  }
  return null;
}

/** Use the first visible surface, including unbound furniture as an occluder. */
export function visibleRoomTarget(
  intersections: Intersection<Object3D>[],
): VisibleRoomTarget | null {
  return visibleRoomHit(intersections)?.target ?? null;
}

/** Eligibility and logical ownership shared by rays and triangle traversal.
 * Material-array eligibility alone does not prove a particular face visible. */
export function visibleRoomMeshTarget(object: Object3D) {
  if (!(object instanceof Mesh) || object.userData.hoverPassThrough)
    return null;
  if (!object.visible || !object.material) return null;
  for (let parent = object.parent; parent; parent = parent.parent)
    if (!parent.visible) return null;
  const materials = Array.isArray(object.material)
    ? object.material
    : [object.material];
  if (materials.every((material) => !material.visible || material.opacity <= 0))
    return null;
  return { object, target: interactiveAncestor(object) };
}

/** Retain the actual first visible intersection for camera-side anchors. */
export function visibleRoomHit(intersections: Intersection<Object3D>[]) {
  for (const hit of intersections) {
    const surface = visibleRoomMeshTarget(hit.object);
    if (!surface) continue;
    const material = Array.isArray(surface.object.material)
      ? surface.object.material[hit.face?.materialIndex ?? 0]
      : surface.object.material;
    if (!material || !material.visible || material.opacity <= 0) continue;
    return { hit, target: surface.target };
  }
  return null;
}
