import { expect, it, vi } from 'vitest';
import { historyExportCsv } from './history-export';
import { ExportTooLargeError } from './export';
const id = '00000000-0000-4000-8000-000000000001';
const location = '00000000-0000-4000-8000-000000000002';
const at = '2026-10-03T05:23:06.123456Z';
export const exportEvent = {
  row_type: 'event',
  event_id: id,
  entity_id: id,
  kind: 'quantity',
  event_type: 'moved',
  created_at: at,
  actor_id: id,
  actor_name: '=Alex 😀',
  name_current: 'Current "name"\nline',
  name_before: 'Old',
  name_after: null,
  item_code_current: '-SKU',
  item_code_before: null,
  item_code_after: null,
  asset_tag_current: null,
  asset_tag_before: null,
  asset_tag_after: null,
  serial_number_current: null,
  serial_number_before: null,
  serial_number_after: null,
  reason: ' @SUM(1)',
  reference: null,
  event_quantity: null,
  from_location_id: null,
  from_location_code: null,
  from_label: null,
  to_location_id: null,
  to_location_code: null,
  to_label: null,
  from_site_id: null,
  from_site_code: null,
  to_site_id: null,
  to_site_code: null,
  endpoint_label_provenance: 'current reference labels',
};
export const exportLine = {
  row_type: 'quantity_line',
  event_id: id,
  entity_id: id,
  kind: 'quantity',
  location_id: location,
  location_code: 'ITC-RED',
  location_label: 'Red',
  site_id: null,
  site_code: null,
  site_label: null,
  before_quantity: 7,
  delta: -3,
  after_quantity: 4,
  line_label_provenance: 'current reference labels',
};
it.each([
  ['quantity', 'site_corrected', 'Site count corrected'],
  ['asset', 'site_corrected', 'Site custody corrected'],
  ['quantity', 'site_written_off', 'Quantity written off at site'],
  ['asset', 'site_written_off', 'Asset written off at site'],
  ['asset', 'site_retired', 'Asset retired at site'],
] as const)(
  'exports kind-aware custody labels without changing %s %s machine identity',
  (kind, event_type, label) => {
    const { csv } = historyExportCsv(
      {
        rows: [{ ...exportEvent, kind, event_type }],
        event_count: 1,
        row_count: 1,
        exported_at: at,
      },
      'Preview',
      'UTC',
    );
    expect(csv).toContain(`,"${label}",`);
    expect(csv).toContain(`"${event_type}"`);
  },
);
it('exports exact UTC snapshots, original actor, safe text, quoted Unicode and numeric signed deltas', () => {
  const result = historyExportCsv(
    {
      rows: [
        {
          ...exportEvent,
          custom_values: { secret: 'do not export' },
          url: 'private-file',
        },
        exportLine,
      ],
      event_count: 1,
      row_count: 2,
      exported_at: at,
    },
    'Preview',
    'America/Chicago',
  );
  expect(result.csv.startsWith('\uFEFF')).toBe(true);
  expect(result.csv).toContain('\r\n');
  expect(result.csv).toContain('"\'=Alex 😀"');
  expect(result.csv).toContain('"Current ""name""\nline"');
  expect(result.csv).toContain('"\'-SKU"');
  expect(result.csv).toContain(',7,-3,4,');
  expect(result.csv).toContain(at);
  expect(result.csv).toContain('America/Chicago');
  expect(result.csv).not.toContain('do not export');
  expect(result.csv).not.toContain('private-file');
  expect(result.eventCount).toBe(1);
  expect(result.rowCount).toBe(2);
});
it.each([
  { rows: [exportLine], event_count: 0, row_count: 1 },
  { rows: [exportEvent, exportEvent], event_count: 2, row_count: 2 },
  { rows: [exportEvent, exportLine, exportLine], event_count: 1, row_count: 3 },
  { rows: [exportEvent], event_count: 2, row_count: 1 },
  { rows: [exportEvent], event_count: 1, row_count: 2 },
  {
    rows: [exportEvent, { ...exportLine, delta: -2 }],
    event_count: 1,
    row_count: 2,
  },
])('rejects inconsistent event/line identities or counts', (input) =>
  expect(() =>
    historyExportCsv({ ...input, exported_at: at }, 'Preview', 'UTC'),
  ).toThrow(),
);
it('refuses row overflow and quote expansion before returning a partial CSV', () => {
  expect(() =>
    historyExportCsv(
      {
        rows: Array(10001).fill(exportEvent),
        event_count: 10001,
        row_count: 10001,
        exported_at: at,
      },
      'Preview',
      'UTC',
    ),
  ).toThrow();
  expect(() =>
    historyExportCsv(
      {
        rows: [{ ...exportEvent, actor_name: '"'.repeat(1600000) }],
        event_count: 1,
        row_count: 1,
        exported_at: at,
      },
      'Preview',
      'UTC',
    ),
  ).toThrow(ExportTooLargeError);
});
it('checks deadlines during validation and encoding', () => {
  const check = vi.fn(() => {
    if (check.mock.calls.length > 5) throw new Error('deadline');
  });
  expect(() =>
    historyExportCsv(
      {
        rows: [exportEvent, exportLine],
        event_count: 1,
        row_count: 2,
        exported_at: at,
      },
      'Preview',
      'UTC',
      check,
    ),
  ).toThrow('deadline');
});
it('keeps storage and site ledger identities distinct even when their UUIDs coincide', () => {
  const siteLine = {
    ...exportLine,
    location_id: null,
    location_code: null,
    location_label: null,
    site_id: location,
    site_code: 'SITE',
    site_label: 'Recorded site',
    before_quantity: 0,
    delta: 3,
    after_quantity: 3,
  };
  expect(
    historyExportCsv(
      {
        rows: [exportEvent, exportLine, siteLine],
        event_count: 1,
        row_count: 3,
        exported_at: at,
      },
      'Preview',
      'UTC',
    ).rowCount,
  ).toBe(3);
});
