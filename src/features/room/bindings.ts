import type { RoomDefinition, RoomNode } from './schema';

type Point = [number, number, number];
type Bounds = { min: Point; max: Point };
type Transform = { origin: Point; rotation: number };

export type RoomBinding = {
  code: string;
  nodeId: string;
  label: string;
  primary: boolean;
  focusPoint: Point;
  bounds: Bounds;
};

// Room-space transforms only: coordinates.ts owns room-to-renderer axes.
function transformPoint(point: Point, transform: Transform): Point {
  const angle = ((transform.rotation % 360) * Math.PI) / 180;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return [
    transform.origin[0] + point[0] * cos - point[1] * sin,
    transform.origin[1] + point[0] * sin + point[1] * cos,
    transform.origin[2] + point[2],
  ];
}

function boxBounds(center: Point, size: Point, transform: Transform): Bounds {
  const corners: Point[] = [];
  for (const x of [-1, 1])
    for (const y of [-1, 1])
      for (const z of [-1, 1])
        corners.push(
          transformPoint(
            [
              center[0] + (x * size[0]) / 2,
              center[1] + (y * size[1]) / 2,
              center[2] + (z * size[2]) / 2,
            ],
            transform,
          ),
        );
  return {
    min: [0, 1, 2].map((axis) =>
      Math.min(...corners.map((p) => p[axis])),
    ) as Point,
    max: [0, 1, 2].map((axis) =>
      Math.max(...corners.map((p) => p[axis])),
    ) as Point,
  };
}

function combineBounds(bounds: Bounds[]): Bounds {
  return {
    min: [0, 1, 2].map((axis) =>
      Math.min(...bounds.map((b) => b.min[axis])),
    ) as Point,
    max: [0, 1, 2].map((axis) =>
      Math.max(...bounds.map((b) => b.max[axis])),
    ) as Point,
  };
}

function center(bounds: Bounds): Point {
  return [0, 1, 2].map(
    (axis) => (bounds.min[axis] + bounds.max[axis]) / 2,
  ) as Point;
}

/** Bind validated geometry in world room XYZ inches, without inventory state. */
export function buildRoomBindings(room: RoomDefinition): RoomBinding[] {
  const bindings: RoomBinding[] = [];
  function visit(node: RoomNode, parent: Transform): Bounds {
    const world: Transform = {
      origin: transformPoint(node.position, parent),
      rotation: parent.rotation + node.rotationZDegrees,
    };
    const pieces: Bounds[] = [];
    if (node.size) pieces.push(boxBounds([0, 0, 0], node.size, world));
    if (node.interaction?.hitBox)
      pieces.push(
        boxBounds(
          node.interaction.hitBox.center,
          node.interaction.hitBox.size,
          world,
        ),
      );
    for (const child of node.children ?? []) pieces.push(visit(child, world));
    const bounds = pieces.length
      ? combineBounds(pieces)
      : { min: [...world.origin] as Point, max: [...world.origin] as Point };
    if (node.locationCode)
      bindings.push({
        code: node.locationCode,
        nodeId: node.id,
        label: node.interaction?.label ?? node.locationCode,
        primary: node.interaction?.primaryBinding ?? false,
        // focusPoint is parent-local; applying this node's transform is incorrect.
        focusPoint: node.interaction
          ? transformPoint(node.interaction.focusPoint, parent)
          : center(bounds),
        bounds,
      });
    return bounds;
  }
  for (const node of room.nodes)
    visit(node, { origin: [0, 0, 0], rotation: 0 });
  return [
    {
      code: room.locationCode,
      nodeId: room.roomId,
      label: room.locationCode,
      primary: false,
      focusPoint: [...room.camera.target],
      bounds: { min: [0, 0, 0], max: [...room.dimensions] },
    },
    ...bindings,
  ];
}

/** Resolve camera focus without relying on visual traversal order. */
export function findFocusBinding(
  bindings: RoomBinding[],
  code: string | null,
): RoomBinding | undefined {
  return (
    bindings.find((binding) => binding.code === code && binding.primary) ??
    bindings.find((binding) => binding.code === code)
  );
}
