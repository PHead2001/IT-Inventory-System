import { describe, expect, it } from 'vitest';
import { expectedLocations } from '../../../tests/fixtures/reference';
import type { LocationRef } from '../inventory/contracts-ui';
import { inventoryDescendantCodes } from './hierarchy';

const locations: LocationRef[] = expectedLocations.map(
  ([code, name, parentCode, , capable]) => ({
    id: 'db-' + code,
    code,
    name,
    breadcrumb: name,
    active: true,
    can_hold_inventory: capable,
    parentId: parentCode ? 'db-' + parentCode : null,
  }),
);

describe('logical inventory descendants', () => {
  it('resolves room and aggregate selections from database parent IDs', () => {
    expect(inventoryDescendantCodes(locations, 'ITC')).toHaveLength(28);
    expect(inventoryDescendantCodes(locations, 'ITC-S1')).toEqual([
      'ITC-S1A',
      'ITC-S1B',
      'ITC-S1C',
    ]);
    const left = inventoryDescendantCodes(locations, 'ITC-L');
    expect(left).toHaveLength(12);
    expect(left).toContain('ITC-D06');
    expect(left).not.toContain('ITC-L');
    expect(left).not.toContain('ITC-S1');
    // The red container is visually beneath shelving but logically belongs to the room.
    expect(left).not.toContain('ITC-RED');
  });

  it('includes a selected inventory location itself and keeps inactive holdings discoverable', () => {
    expect(inventoryDescendantCodes(locations, 'ITC-D01')).toEqual(['ITC-D01']);
    const inactive = locations.map((row) =>
      row.code === 'ITC-D01' ? { ...row, active: false } : row,
    );
    expect(inventoryDescendantCodes(inactive, 'ITC-L')).toContain('ITC-D01');
  });

  it('uses explicit capability, independent of having children or semantic code shape', () => {
    const changed = locations.map((row) =>
      row.code === 'ITC-S1'
        ? { ...row, can_hold_inventory: true }
        : row.code === 'ITC-S1A'
          ? { ...row, can_hold_inventory: false }
          : row,
    );
    expect(inventoryDescendantCodes(changed, 'ITC-S1')).toEqual([
      'ITC-S1',
      'ITC-S1B',
      'ITC-S1C',
    ]);
  });

  it('returns an empty highlight set for cleared, unknown, or absent locations', () => {
    expect(inventoryDescendantCodes(locations, null)).toEqual([]);
    expect(inventoryDescendantCodes(locations, 'OTHER-ROOM')).toEqual([]);
    expect(inventoryDescendantCodes([], 'ITC')).toEqual([]);
  });

  it('does not infer descendants from code prefixes or include orphaned rows', () => {
    const changed = locations.map((row) =>
      row.code === 'ITC-D01' ? { ...row, parentId: 'missing-parent' } : row,
    );
    expect(inventoryDescendantCodes(changed, 'ITC')).not.toContain('ITC-D01');
  });

  it('terminates on malformed cyclic input and returns each location once', () => {
    const cyclic: LocationRef[] = [
      {
        ...locations[0],
        id: 'a',
        code: 'A',
        parentId: 'b',
        can_hold_inventory: true,
      },
      {
        ...locations[0],
        id: 'b',
        code: 'B',
        parentId: 'a',
        can_hold_inventory: true,
      },
    ];
    expect(inventoryDescendantCodes(cyclic, 'A')).toEqual(['A', 'B']);
  });
});
