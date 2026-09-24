import { describe, expect, it } from 'vitest';
import { csvText, exportCsv } from './export';

const id = '00000000-0000-4000-8000-000000000001';
const at = '2026-09-24T15:18:37+00:00';
describe('inventory CSV', () => {
  it('quotes comma, quotes and newlines while neutralizing formula prefixes', () => {
    expect(csvText('a,"b"\nc')).toBe('"a,""b""\nc"');
    for (const value of [
      '=1+1',
      ' +SUM(A1:A2)',
      '\t@cmd',
      '\u0000\n-2',
      '\u200b=1',
    ])
      expect(csvText(value)).toBe('"\'' + value.replaceAll('"', '""') + '"');
    expect(csvText('0001-A')).toBe('"0001-A"');
  });
  it('keeps an empty export usable with headers and a timestamped snapshot', () => {
    const result = exportCsv(
      'inventory',
      { rows: [], total: 0, exported_at: at },
      'Preview',
    );
    expect(result.exportedAt).toBe(at);
    expect(result.csv).toMatch(/^\uFEFF"Record ID","Type"/);
    expect(result.csv).toContain('"Exported At (UTC)","Environment"\r\n');
  });
  it('exports one low-stock row per definition and no global total in holding rows', () => {
    const low = exportCsv(
      'low_stock',
      {
        rows: [
          {
            entity_id: id,
            name: '=Danger',
            category_name: 'Parts',
            manufacturer: null,
            model: null,
            status: 'active',
            recorded_total: 3,
            reorder_threshold: 4,
            stock_state: 'needs_restocking',
            holding_context: '1A [ITC-S1A]: 1; 1B [ITC-S1B]: 2',
          },
        ],
        total: 1,
        exported_at: at,
      },
      'Production',
    ).csv;
    expect(low).toContain('"Recorded Total","Reorder Threshold"');
    expect(low).toContain('"\'=Danger"');
    expect(low).toContain('"1A [ITC-S1A]: 1; 1B [ITC-S1B]: 2"');
    const inventory = exportCsv(
      'inventory',
      {
        rows: [
          {
            entity_id: id,
            kind: 'quantity',
            name: 'Cable',
            category_name: 'Parts',
            manufacturer: null,
            model: null,
            status: 'active',
            asset_tag: null,
            serial_number: null,
            quantity: 1,
            location_name: '1A',
            location_code: 'ITC-S1A',
            breadcrumb: 'Closet / 1A',
          },
        ],
        total: 1,
        exported_at: at,
      },
      'Preview',
    ).csv;
    expect(inventory).toContain('"Quantity at Location"');
    expect(inventory).not.toContain('"Recorded Total"');
    expect(inventory).toContain('"Preview"');
    expect(low).toContain('"Production"');
    expect(low).toContain('"All Current Holdings and Locations"');
  });
  it('rejects malformed or oversized snapshots instead of publishing partial data', () => {
    expect(() =>
      exportCsv(
        'inventory',
        { rows: [], total: 10001, exported_at: at },
        'Preview',
      ),
    ).toThrow();
    expect(() =>
      exportCsv(
        'inventory',
        {
          rows: [{ entity_id: id }],
          total: 1,
          exported_at: at,
        },
        'Preview',
      ),
    ).toThrow();
  });
});
