import { describe, it, expect } from 'vitest';
import { historySummary } from './history-summary';
import {
  readFilters,
  mapLocation,
  mapSearch,
  mapHistory,
  searchRow,
  historyRow,
  mapQuantityStockSummary,
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
it('maps quantity history view rows with null endpoints into ledger-based move and receipt summaries', () => {
  const destination = {
    ...location,
    id: other,
    breadcrumb: 'IT Closet / Drawer 3',
  };
  const base = {
    id,
    kind: 'quantity',
    entity_id: other,
    entity_name: 'Cable',
    event_type: 'moved',
    created_at: '2026-10-07T12:00:00Z',
    actor_name: 'Recorded staff',
    reason: 'Recorded move',
    before_metadata: null,
    after_metadata: null,
    custom_present: false,
    custom_changed: false,
    assignment_event_id: null,
    assignment_kind: null,
    assignment_from_location_id: null,
    assignment_to_location_id: null,
    assignment_from_site_id: null,
    assignment_to_site_id: null,
    assignment_from_label: null,
    assignment_to_label: null,
    assignment_quantity: null,
    assignment_reference: null,
    from_location_id: null,
    to_location_id: null,
    // The view sorts by location ID, which need not put the source first.
    lines: [
      { location_id: other, delta: 1, before_quantity: 30, after_quantity: 31 },
      { location_id: id, delta: -1, before_quantity: 5, after_quantity: 4 },
    ],
  };
  const move = mapHistory(historyRow.parse(base), [location, destination], []);
  expect(move.fromLocation).toBeNull();
  expect(move.toLocation).toBeNull();
  expect(historySummary(move)).toBe(
    `1 unit · ${location.breadcrumb} → IT Closet / Drawer 3`,
  );
  const receipt = mapHistory(
    historyRow.parse({
      ...base,
      event_type: 'received',
      lines: [base.lines[0]],
    }),
    [location, destination],
    [],
  );
  expect(historySummary(receipt)).toBe(
    '1 unit received · IT Closet / Drawer 3',
  );
  expect(
    move.lines.map(({ before, after, delta }) => ({ before, after, delta })),
  ).toEqual([
    { before: 30, after: 31, delta: 1 },
    { before: 5, after: 4, delta: -1 },
  ]);
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
    expect(readFilters({ lowStock: 'true' }).lowStock).toBe(true);
    expect(readFilters({ lowStock: 'false' }).lowStock).toBe(false);
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
      item_code: '0001-A/B',
      serial_number: null,
      recorded_total: 0,
      reorder_threshold: null,
      stock_state: 'disabled',
    };
    expect(mapSearch(searchRow.parse(base), [location])).toMatchObject({
      id: other,
      quantity: null,
      location: null,
      itemCode: '0001-A/B',
    });
    const located = mapSearch(
      searchRow.parse({ ...base, location_id: id, quantity: 7 }),
      [location],
    );
    expect(located.location?.code).toBe('ITC-S4B');
    expect(located.quantity).toBe(7);
    const needing = mapSearch(
      searchRow.parse({
        ...base,
        location_id: id,
        quantity: 7,
        recorded_total: 7,
        reorder_threshold: 8,
        stock_state: 'needs_restocking',
      }),
      [location],
    );
    expect(needing).toMatchObject({
      quantity: 7,
      recordedTotal: 7,
      reorderThreshold: 8,
      stockState: 'needs_restocking',
    });
    expect(() =>
      mapSearch(searchRow.parse({ ...base, location_id: other, quantity: 7 }), [
        location,
      ]),
    ).toThrow('location could not be resolved');
  });
  it('keeps a site holding separate from storage availability and room location', () => {
    const site = mapSearch(
      searchRow.parse({
        kind: 'quantity',
        entity_id: other,
        name: 'Cable',
        category_name: 'Cables',
        status: 'active',
        location_id: null,
        site_id: id,
        site_code: 'PROPERTY-A',
        site_name: 'Example Property',
        custody_kind: 'site',
        quantity: 3,
        available_quantity: '7',
        assigned_quantity: '3',
        recorded_quantity: '10',
        asset_tag: null,
        serial_number: null,
        recorded_total: 7,
        reorder_threshold: 7,
        stock_state: 'needs_restocking',
      }),
      [location],
    );
    expect(site).toMatchObject({
      location: null,
      site: { code: 'PROPERTY-A' },
      quantity: 3,
      availableQuantity: '7',
      assignedQuantity: '3',
      ownedQuantity: '10',
    });
  });
  it('maps the authoritative item-wide stock projection independently of form metadata', () => {
    expect(
      mapQuantityStockSummary({
        available_quantity: '2',
        assigned_quantity: '3',
        recorded_quantity: '5',
        stock_state: 'needs_restocking',
      }),
    ).toEqual({
      availableQuantity: '2',
      assignedQuantity: '3',
      ownedQuantity: '5',
      stockState: 'needs_restocking',
    });
    expect(() =>
      mapQuantityStockSummary({
        available_quantity: '2',
        assigned_quantity: '3',
        recorded_quantity: '5',
        stock_state: 'guessed',
      }),
    ).toThrow();
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
      custom_present: false,
      custom_changed: false,
      assignment_event_id: null,
      assignment_kind: null,
      assignment_from_location_id: null,
      assignment_to_location_id: null,
      assignment_from_site_id: null,
      assignment_to_site_id: null,
      assignment_from_label: null,
      assignment_to_label: null,
      assignment_quantity: null,
      assignment_reference: null,
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
      {
        field: 'Category',
        before: 'Category at event time not recorded (current name: Other)',
        after: 'Category at event time not recorded (current name: Cables)',
      },
    ]);
    const captured = mapHistory(
      {
        ...row,
        before_metadata: { category_id: other, category_name: 'Former Other' },
        after_metadata: { category_id: id, category_name: 'Original Cables' },
      },
      [location],
      [
        { id: other, name: 'Renamed Other', active: false },
        { id, name: 'Renamed Cables', active: true },
      ],
    );
    expect(captured.metadataChanges).toEqual([
      { field: 'Category', before: 'Former Other', after: 'Original Cables' },
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
      recorded_total: null,
      reorder_threshold: null,
      stock_state: null,
    });
    expect(mapSearch(row, [location])).toMatchObject({
      status: 'retired',
      serialNumber: '0001-A/02',
      location: { code: 'ITC-S4B' },
    });
  });
  it('shows threshold metadata changes including zero and monitoring disabled', () => {
    const row = historyRow.parse({
      id,
      kind: 'quantity',
      entity_id: other,
      entity_name: 'Cables',
      event_type: 'metadata_updated',
      created_at: '2026-09-05T00:00:00Z',
      actor_name: 'IT Staff',
      reason: null,
      before_metadata: { reorder_threshold: null },
      after_metadata: { reorder_threshold: 0 },
      custom_present: false,
      custom_changed: false,
      assignment_event_id: null,
      assignment_kind: null,
      assignment_from_location_id: null,
      assignment_to_location_id: null,
      assignment_from_site_id: null,
      assignment_to_site_id: null,
      assignment_from_label: null,
      assignment_to_label: null,
      assignment_quantity: null,
      assignment_reference: null,
      from_location_id: null,
      to_location_id: null,
      lines: [],
    });
    expect(mapHistory(row, [], [])).toMatchObject({
      metadataChanges: [
        { field: 'Reorder threshold', before: null, after: '0' },
      ],
    });
  });
  it('keeps persisted site custody endpoints and quantity on an ordinary history row', () => {
    const row = historyRow.parse({
      id,
      kind: 'quantity',
      entity_id: other,
      entity_name: 'Cable',
      event_type: 'site_issued',
      created_at: '2026-09-05T00:00:00Z',
      actor_name: 'IT Staff',
      reason: null,
      before_metadata: null,
      after_metadata: null,
      custom_present: false,
      custom_changed: false,
      from_location_id: null,
      to_location_id: null,
      lines: [],
      assignment_event_id: other,
      assignment_kind: 'issued',
      assignment_from_location_id: id,
      assignment_to_location_id: null,
      assignment_from_site_id: null,
      assignment_to_site_id: other,
      assignment_from_label: 'Original storage name',
      assignment_to_label: 'Original site name',
      assignment_quantity: 3,
      assignment_reference: 'Ticket 001',
    });
    expect(mapHistory(row, [], [])).toMatchObject({
      assignment: {
        eventId: other,
        kind: 'issued',
        from: { locationId: id, label: 'Original storage name' },
        to: { siteId: other, label: 'Original site name' },
        quantity: 3,
        reference: 'Ticket 001',
      },
    });
  });
});
