import { describe, expect, it } from 'vitest';
import { expectedLocations } from '../../../tests/fixtures/reference';
import {
  buildRoomBindings,
  findFocusBinding,
  type RoomBinding,
} from './bindings';
import { loadItCloset } from './load';
import { roomSchema, type RoomNode } from './schema';

const assertPoint = (actual: number[], expected: number[]) => {
  expected.forEach((value, axis) => expect(actual[axis]).toBeCloseTo(value, 8));
};

describe('world-space room bindings', () => {
  it('resolves all 35 canonical codes with 28 primary destinations and the room camera target', () => {
    const room = loadItCloset();
    const bindings = buildRoomBindings(room);
    expect(bindings.map((binding) => binding.code).sort()).toEqual(
      expectedLocations.map(([code]) => code).sort(),
    );
    expect(bindings.filter((binding) => binding.primary)).toHaveLength(28);
    expect(bindings.find((binding) => binding.code === 'ITC')).toMatchObject({
      nodeId: room.roomId,
      primary: false,
      focusPoint: room.camera.target,
      bounds: { min: [0, 0, 0], max: room.dimensions },
    });
    expect(
      bindings.find((binding) => binding.code === 'ITC-S1A'),
    ).toMatchObject({
      label: '1A',
      primary: true,
      focusPoint: [8, 18, 80.5],
    });
  });

  it('preserves physical left/front and right/back label orientation and measured rack bounds', () => {
    const bindings = buildRoomBindings(loadItCloset());
    const binding = (code: string) =>
      bindings.find((row) => row.code === code)!;
    expect(binding('ITC-S1A').focusPoint[1]).toBeLessThan(
      binding('ITC-S1C').focusPoint[1],
    );
    expect(binding('ITC-S3A').focusPoint[1]).toBeGreaterThan(
      binding('ITC-S3C').focusPoint[1],
    );
    expect(binding('ITC-D01').focusPoint[1]).toBeLessThan(
      binding('ITC-D03').focusPoint[1],
    );
    expect(binding('ITC-D07').focusPoint[1]).toBeGreaterThan(
      binding('ITC-D09').focusPoint[1],
    );
    expect(binding('ITC-RACK').bounds).toEqual({
      min: [19, 84, 0],
      max: [41, 108, 81],
    });
    expect(binding('ITC-S1').focusPoint).toEqual([8, 42, 80.5]);
  });

  it('applies ancestor translations and rotations while keeping focus parent-local and hitboxes node-local', () => {
    const node: RoomNode = {
      id: 'outer',
      kind: 'group',
      locationCode: 'TEST-OUTER',
      position: [10, 20, 5],
      rotationZDegrees: 90,
      children: [
        {
          id: 'inner',
          kind: 'group',
          locationCode: 'TEST-INNER',
          position: [2, 0, 3],
          rotationZDegrees: 90,
          children: [
            {
              id: 'leaf',
              kind: 'box',
              locationCode: 'TEST-LEAF',
              position: [3, 4, 2],
              rotationZDegrees: 90,
              size: [2, 2, 2],
              interaction: {
                selectable: true,
                primaryBinding: true,
                label: 'Leaf',
                focusPoint: [4, 5, 6],
                hitBox: { center: [1, 2, 0], size: [4, 2, 6] },
              },
            },
          ],
        },
      ],
    };
    const room = roomSchema.parse({ ...loadItCloset(), nodes: [node] });
    const rows = buildRoomBindings(room);
    const leaf = rows.find((row) => row.code === 'TEST-LEAF')!;
    assertPoint(leaf.focusPoint, [6, 17, 14]);
    assertPoint(leaf.bounds.min, [6, 15, 7]);
    assertPoint(leaf.bounds.max, [10, 19, 13]);
    for (const code of ['TEST-INNER', 'TEST-OUTER']) {
      const group = rows.find((row) => row.code === code)!;
      assertPoint(group.focusPoint, [8, 17, 10]);
      assertPoint(group.bounds.min, leaf.bounds.min);
      assertPoint(group.bounds.max, leaf.bounds.max);
      expect(group.primary).toBe(false);
    }
  });

  it('bounds arbitrary rotated geometry and includes unbound decoration without inventing a binding', () => {
    const room = roomSchema.parse({
      ...loadItCloset(),
      nodes: [
        {
          id: 'group',
          kind: 'group',
          locationCode: 'TEST-GROUP',
          position: [10, 10, 0],
          rotationZDegrees: 45,
          children: [
            {
              id: 'decoration',
              kind: 'box',
              position: [0, 0, 1],
              rotationZDegrees: 0,
              size: [2, 2, 2],
            },
          ],
        },
      ],
    });
    const bindings = buildRoomBindings(room);
    expect(bindings.map((row) => row.code)).toEqual(['ITC', 'TEST-GROUP']);
    assertPoint(bindings[1].bounds.min, [10 - Math.SQRT2, 10 - Math.SQRT2, 0]);
    assertPoint(bindings[1].bounds.max, [10 + Math.SQRT2, 10 + Math.SQRT2, 2]);
    assertPoint(bindings[1].focusPoint, [10, 10, 1]);
  });

  it('does not mutate validated room data during binding resolution', () => {
    const room = loadItCloset();
    const before = structuredClone(room);
    const bindings = buildRoomBindings(room);
    bindings[0].focusPoint[0] += 100;
    bindings[0].bounds.max[0] += 100;
    expect(room).toEqual(before);
  });
});

describe('focus binding preference', () => {
  const primary: RoomBinding = {
    code: 'ITC-S1A',
    nodeId: 'primary',
    label: '1A',
    primary: true,
    focusPoint: [8, 18, 80.5],
    bounds: { min: [0, 6, 80], max: [16, 30, 81] },
  };
  const secondary: RoomBinding = {
    ...primary,
    nodeId: 'secondary-decoration',
    primary: false,
    focusPoint: [1, 2, 3],
  };
  it.each([
    [secondary, primary],
    [primary, secondary],
  ])('prefers the primary regardless of traversal order %#', (...bindings) => {
    expect(findFocusBinding(bindings, 'ITC-S1A')).toBe(primary);
  });
  it('falls back to aggregate and room bindings that have no primary', () => {
    const bindings = buildRoomBindings(loadItCloset());
    for (const code of ['ITC', 'ITC-L', 'ITC-S1']) {
      const expected = bindings.find((binding) => binding.code === code)!;
      expect(expected.primary).toBe(false);
      expect(findFocusBinding(bindings, code)).toBe(expected);
    }
  });
  it('keeps a secondary-only binding usable and does not match unrelated primary locations', () => {
    expect(
      findFocusBinding([{ ...primary, code: 'ITC-S1B' }, secondary], 'ITC-S1A'),
    ).toBe(secondary);
  });
  it('returns undefined for cleared, missing, and empty bindings', () => {
    expect(findFocusBinding([primary], null)).toBeUndefined();
    expect(findFocusBinding([primary], 'UNKNOWN')).toBeUndefined();
    expect(findFocusBinding([], 'ITC-S1A')).toBeUndefined();
  });
});
