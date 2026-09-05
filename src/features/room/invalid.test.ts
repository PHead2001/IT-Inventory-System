import { expect, it } from 'vitest';
import raw from '../../../data/rooms/it-closet.json';
import { roomSchema, type RoomNode } from './schema';
const baseBox = roomSchema.parse(raw).nodes.find((n) => n.kind === 'box')!;
it.each([
  { ...baseBox, size: undefined },
  { ...baseBox, children: [baseBox] },
  { ...baseBox, locationCode: undefined },
  { ...baseBox, locationCode: '123e4567-e89b-12d3-a456-426614174000' },
  { ...baseBox, interaction: { ...baseBox.interaction, selectable: false } },
  {
    id: 'empty-group',
    kind: 'group',
    position: [0, 0, 0],
    rotationZDegrees: 0,
    children: [],
  },
  {
    id: 'sized-group',
    kind: 'group',
    position: [0, 0, 0],
    rotationZDegrees: 0,
    size: [1, 1, 1],
    children: [baseBox],
  },
])('rejects malformed node shapes/bindings', (node) => {
  expect(roomSchema.safeParse({ ...raw, nodes: [node] }).success).toBe(false);
});
it('rejects duplicate primary bindings even with different node IDs', () => {
  expect(
    roomSchema.safeParse({
      ...raw,
      nodes: [baseBox, { ...baseBox, id: 'another-rack' }],
    }).success,
  ).toBe(false);
});
it('rejects nested duplicate node IDs', () => {
  expect(
    roomSchema.safeParse({
      ...raw,
      nodes: [
        {
          id: baseBox.id,
          kind: 'group',
          position: [0, 0, 0],
          rotationZDegrees: 0,
          children: [baseBox],
        },
      ],
    }).success,
  ).toBe(false);
});
it('rejects excessive hierarchy depth', () => {
  let node: RoomNode = baseBox;
  for (let n = 0; n < 18; n++)
    node = {
      id: 'group-' + n,
      kind: 'group',
      position: [0, 0, 0],
      rotationZDegrees: 0,
      children: [node],
    };
  expect(roomSchema.safeParse({ ...raw, nodes: [node] }).success).toBe(false);
});
it.each([
  { ...raw.camera, azimuthLimitsDegrees: [45, -45] },
  { ...raw.camera, azimuthDegrees: 90 },
  { ...raw.camera, elevationDegrees: 0 },
  { ...raw.camera, zoomLimits: [0, 3] },
])('rejects invalid camera controls', (camera) => {
  expect(roomSchema.safeParse({ ...raw, camera }).success).toBe(false);
});
