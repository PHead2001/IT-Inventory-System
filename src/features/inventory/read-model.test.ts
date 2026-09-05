import { describe, it, expect } from 'vitest';
import {
  readFilters,
  mapLocation,
  mapSearch,
  mapHistory,
  searchRow,
  historyRow,
} from './read-model';
const id = '00000000-0000-4000-8000-000000000001';
const other = '00000000-0000-4000-8000-000000000002';
const location = mapLocation({
  id,
  code: 'ITC-S4B',
  name: '4B',
  breadcrumb: 'IT Closet / Right Storage / Shelf 4 / 4B',
  active: true,
  can_hold_inventory: true,
  parent_id: other,
});
describe('inventory read contracts', () => {
  it('retains stable codes, database UUIDs and human breadcrumbs separately', () => {
    expect(location).toMatchObject({
      id,
      code: 'ITC-S4B',
      parentId: other,
      can_hold_inventory: true,
    });
  });
  it('preserves literal wildcard query text and bounds pagination', () => {
    expect(
      readFilters({
        q: '  100%_\\\\  ',
        page: '9999999',
        status: 'historical',
      }),
    ).toMatchObject({ query: '100%_\\\\', page: 100000, status: 'historical' });
    for (const page of ['-2', 'NaN', '1.5'])
      expect(readFilters({ page }).page).toBe(1);
    expect(
      readFilters({ type: 'hacked', status: 'retired', category: 'invalid' }),
    ).toMatchObject({ type: 'all', status: 'active', category: undefined });
  });
  it('supports unlocated zero definitions and multiple located rows of the same item', () => {
    const base = {
      kind: 'quantity',
      entity_id: other,
      name: 'Patch cables',
      category_name: 'Cables',
      status: 'active',
      location_id: null,
      quantity: null,
      asset_tag: null,
      serial_number: null,
    };
    expect(mapSearch(searchRow.parse(base), [location])).toMatchObject({
      id: other,
      quantity: null,
      location: null,
    });
    const located = mapSearch(
      searchRow.parse({ ...base, location_id: id, quantity: 7 }),
      [location],
    );
    expect(located.location?.code).toBe('ITC-S4B');
    expect(located.quantity).toBe(7);
    expect(() =>
      mapSearch(searchRow.parse({ ...base, location_id: other, quantity: 7 }), [
        location,
      ]),
    ).toThrow('location could not be resolved');
  });
  it('renders corrections, quantities, actors and metadata as structured human values', () => {
    const row = historyRow.parse({
      id,
      kind: 'quantity',
      entity_id: other,
      entity_name: 'Cables',
      event_type: 'adjusted',
      created_at: '2026-09-05T00:00:00Z',
      actor_name: 'IT Staff',
      reason: 'Physical count',
      before_metadata: { category_id: other, name: 'Old' },
      after_metadata: { category_id: id, name: 'New', version: 999 },
      from_location_id: null,
      to_location_id: null,
      lines: [
        { location_id: id, delta: -3, before_quantity: 8, after_quantity: 5 },
      ],
    });
    const result = mapHistory(
      row,
      [location],
      [
        { id: other, name: 'Other', active: true },
        { id, name: 'Cables', active: true },
      ],
    );
    expect(result).toMatchObject({
      eventType: 'adjusted',
      actorName: 'IT Staff',
      reason: 'Physical count',
    });
    expect(result.lines[0]).toMatchObject({
      before: 8,
      after: 5,
      delta: -3,
      location: { code: 'ITC-S4B' },
    });
    expect(result.metadataChanges).toEqual([
      { field: 'Name', before: 'Old', after: 'New' },
      { field: 'Category', before: 'Other', after: 'Cables' },
    ]);
  });
  it('keeps retired asset location history and serial punctuation intact', () => {
    const row = searchRow.parse({
      kind: 'asset',
      entity_id: other,
      name: 'Switch',
      category_name: 'Networking',
      status: 'retired',
      location_id: id,
      quantity: null,
      asset_tag: 'tag-1',
      serial_number: '0001-A/02',
    });
    expect(mapSearch(row, [location])).toMatchObject({
      status: 'retired',
      serialNumber: '0001-A/02',
      location: { code: 'ITC-S4B' },
    });
  });
});
