import { expect, it } from 'vitest';
import raw from '../../../data/rooms/it-closet.json';
import { roomSchema, type RoomNode } from './schema';
import { buildRoomBindings } from './bindings';
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

it.each([
  { selectable: true, primaryBinding: false },
  { selectable: true, primaryBinding: true },
])(
  'rejects directly selectable groups regardless of primary binding: %j',
  (flags) => {
    const group = roomSchema
      .parse(raw)
      .nodes.find((node) => node.kind === 'group')!;
    const result = roomSchema.safeParse({
      ...raw,
      nodes: [
        {
          ...group,
          interaction: {
            ...flags,
            label: 'Aggregate interaction',
            focusPoint: [10, 10, 10],
            hitBox: { center: [0, 0, 0], size: [20, 20, 20] },
          },
        },
      ],
    });
    expect(result.success).toBe(false);
    if (result.success) throw new Error('Expected group interaction rejection');
    expect(
      result.error.issues.some(
        (issue) =>
          issue.message ===
          'Groups cannot be directly selectable; select aggregate locations through the location picker',
      ),
    ).toBe(true);
  },
);
it('preserves canonical group location bindings without interaction metadata', () => {
  const parsed = roomSchema.parse(raw);
  const groups: RoomNode[] = [];
  const visit = (nodes: RoomNode[]) => {
    for (const node of nodes) {
      if (node.kind === 'group') groups.push(node);
      if (node.children) visit(node.children);
    }
  };
  visit(parsed.nodes);
  expect(groups.map((group) => group.locationCode).sort()).toEqual([
    'ITC-L',
    'ITC-R',
    'ITC-S1',
    'ITC-S2',
    'ITC-S3',
    'ITC-S4',
  ]);
  expect(groups.every((group) => group.interaction === undefined)).toBe(true);
  expect(roomSchema.safeParse(parsed).success).toBe(true);
});

it('preserves parent-local focus metadata on a nonselectable aggregate group', () => {
  const group = roomSchema
    .parse(raw)
    .nodes.find((node) => node.kind === 'group')!;
  const parsed = roomSchema.parse({
    ...raw,
    nodes: [
      {
        id: 'focus-parent',
        kind: 'group',
        position: [10, 20, 2],
        rotationZDegrees: 90,
        children: [
          {
            ...group,
            position: [5, 3, 1],
            rotationZDegrees: 180,
            interaction: {
              selectable: false,
              primaryBinding: false,
              label: 'Aggregate focus',
              focusPoint: [4, 6, 7],
            },
          },
        ],
      },
    ],
  });
  const binding = buildRoomBindings(parsed).find(
    (row) => row.code === group.locationCode,
  )!;
  expect(binding.primary).toBe(false);
  expect(binding.label).toBe('Aggregate focus');
  // Apply only the parent translation/yaw: this group's own transform does not affect focus metadata.
  [4, 24, 9].forEach((value, axis) =>
    expect(binding.focusPoint[axis]).toBeCloseTo(value, 8),
  );
});
