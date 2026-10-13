import { Mesh, type Intersection, type Object3D } from 'three';
import type { RoomNode } from '../schema';
import { revealOffset } from './spatial-reveal';
import { visibleRoomHit, type VisibleRoomTarget } from './visible-hover';

export function createRoomSelectionGesture() {
  let owner: {
    code: string | null;
    pointerId: number;
    released: boolean;
  } | null = null;
  return {
    down(code: string | null, pointerId: number) {
      owner = { code, pointerId, released: false };
    },
    up(code: string | null, pointerId: number) {
      if (!owner || owner.pointerId !== pointerId || owner.code !== code)
        owner = null;
      else owner.released = true;
    },
    cancel() {
      owner = null;
    },
    click(code: string | null, delta: number, allowed: boolean) {
      const accepted =
        !!code &&
        !!owner?.released &&
        owner.code === code &&
        delta <= 5 &&
        allowed;
      owner = null;
      return accepted;
    },
  };
}

/** Resting parent-local selection volume; never a hover/visibility surface. */
export function roomSelectionBox(node: RoomNode) {
  if (
    !node.locationCode ||
    !node.interaction?.selectable ||
    node.kind !== 'box'
  )
    return null;
  if (node.interaction.hitBox) return node.interaction.hitBox;
  return node.size && revealOffset(node).some((value) => value !== 0)
    ? { center: [0, 0, 0] as [number, number, number], size: node.size }
    : null;
}

function proxyTarget(object: Object3D): VisibleRoomTarget | null {
  if (!(object instanceof Mesh) || !object.userData.roomSelectionTarget)
    return null;
  for (let current: Object3D | null = object; current; current = current.parent)
    if (!current.visible) return null;
  return object.userData.roomSelectionTarget as VisibleRoomTarget;
}

/** Select resting proxies or moved surfaces, stopping at visible opaque furniture.
 * At equal depth an actual surface wins, including an unbound blocker. */
export function roomSelectionTarget(
  intersections: Intersection<Object3D>[],
  eligible: (code: string) => boolean = () => true,
): VisibleRoomTarget | null {
  const ordered = intersections
    .map((hit, ordinal) => ({
      hit,
      ordinal,
      surface: visibleRoomHit([hit]),
      proxy: proxyTarget(hit.object),
    }))
    .filter((entry) => entry.surface || entry.proxy)
    .sort((a, b) =>
      Math.abs(a.hit.distance - b.hit.distance) <= 0.000001
        ? Number(Boolean(b.surface)) - Number(Boolean(a.surface)) ||
          a.ordinal - b.ordinal
        : a.hit.distance - b.hit.distance,
    );
  for (const entry of ordered) {
    if (entry.surface)
      return entry.surface.target && eligible(entry.surface.target.code)
        ? entry.surface.target
        : null;
    if (entry.proxy && eligible(entry.proxy.code)) return entry.proxy;
  }
  return null;
}
