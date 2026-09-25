import { describe, expect, it } from 'vitest';
import { csvText, exportCsv, ExportTooLargeError } from './export';

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
    expect(low).toContain(
      '"Total Recorded","Available in Storage","Assigned to Sites","Reorder Threshold"',
    );
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
  it('exports site custody and item-wide decimal-string totals without formula execution', () => {
    const csv = exportCsv(
      'inventory',
      {
        rows: [
          {
            entity_id: id,
            kind: 'quantity',
            name: 'Adapters',
            category_name: 'Parts',
            manufacturer: null,
            model: null,
            status: 'active',
            asset_tag: null,
            serial_number: null,
            quantity: 3,
            location_name: null,
            location_code: null,
            breadcrumb: null,
            custody_kind: 'site',
            site_id: id,
            site_code: 'PROPERTY-A',
            site_name: '=Unsafe',
            available_quantity: '7',
            assigned_quantity: '3',
            recorded_quantity: '10',
          },
        ],
        total: 1,
        exported_at: at,
      },
      'Preview',
    ).csv;
    expect(csv).toContain(
      '"site","00000000-0000-4000-8000-000000000001","PROPERTY-A","\'=Unsafe",7,3,10',
    );
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
  it('adds one opt-in UUID-keyed custom JSON column while preserving the base column order', () => {
    const custom = {
      [id]: {
        category_id: id,
        validated_revision_id: id,
        label: 'Formula, "value"',
        option_paths: [['Root', '=Child']],
        value: '=1+1',
      },
    };
    const row = {
      entity_id: id,
      kind: 'asset',
      name: 'Laptop',
      category_name: 'Computers',
      manufacturer: null,
      model: null,
      status: 'active',
      asset_tag: null,
      serial_number: null,
      quantity: null,
      location_name: '1A',
      location_code: 'ITC-S1A',
      breadcrumb: 'Closet / 1A',
      custom_fields: custom,
    };
    const plain = exportCsv(
      'inventory',
      { rows: [row], total: '1', exported_at: at },
      'Preview',
    ).csv;
    const withCustom = exportCsv(
      'inventory',
      { rows: [row], total: '1', exported_at: at },
      'Preview',
      true,
    ).csv;
    expect(plain).not.toContain('Custom Fields JSON');
    expect(withCustom).toContain('"Environment","Custom Fields JSON"');
    expect(withCustom).toContain(id);
    expect(withCustom).toContain(csvText(JSON.stringify(custom)));
    expect(withCustom).toContain('=Child');
  });
  it('measures UTF-8 CSV bytes including BOM and neutralized formula text before completing a file', () => {
    const row = {
      entity_id: id,
      kind: 'quantity',
      name: '=😀"'.repeat(50000),
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
    };
    expect(() =>
      exportCsv(
        'inventory',
        {
          rows: Array.from({ length: 10 }, () => row),
          total: '10',
          exported_at: at,
        },
        'Preview',
      ),
    ).toThrow(ExportTooLargeError);
  });
  it('accepts the exact 3 MiB CSV boundary and rejects the next byte', () => {
    const row = {
      entity_id: id,
      kind: 'quantity' as const,
      name: '',
      category_name: 'Parts',
      manufacturer: null,
      model: null,
      status: 'active',
      asset_tag: null,
      serial_number: null,
      quantity: 0,
      location_name: null,
      location_code: null,
      breadcrumb: null,
    };
    const input = (name: string) => ({
      rows: [{ ...row, name }],
      total: '1',
      exported_at: at,
    });
    const encoder = new TextEncoder();
    const baseBytes = encoder.encode(
      exportCsv('inventory', input(''), 'Preview').csv,
    ).byteLength;
    const remaining = 3 * 1024 * 1024 - baseBytes;
    const boundaryName =
      '"'.repeat(Math.floor(remaining / 2)) + (remaining % 2 ? 'A' : '');
    expect(
      encoder.encode(exportCsv('inventory', input(boundaryName), 'Preview').csv)
        .byteLength,
    ).toBe(3 * 1024 * 1024);
    expect(() =>
      exportCsv('inventory', input(boundaryName + 'A'), 'Preview'),
    ).toThrow(ExportTooLargeError);
  });
  it('samples cumulative UTF-8 bytes for each appended CSV line without changing the file', () => {
    const row = {
      entity_id: id,
      kind: 'quantity' as const,
      name: '😀',
      category_name: 'Parts',
      manufacturer: null,
      model: null,
      status: 'active',
      asset_tag: null,
      serial_number: null,
      quantity: 0,
      location_name: null,
      location_code: null,
      breadcrumb: null,
    };
    const bytes: number[] = [];
    const input = { rows: [row, row], total: '2', exported_at: at };
    const plain = exportCsv('inventory', input, 'Preview').csv;
    const sampled = exportCsv(
      'inventory',
      input,
      'Preview',
      false,
      () => {},
      (count) => bytes.push(count),
    ).csv;
    expect(sampled).toBe(plain);
    expect(bytes).toHaveLength(3);
    expect(bytes[0]).toBeLessThan(bytes[1]);
    expect(bytes[1]).toBeLessThan(bytes[2]);
    expect(bytes[2]).toBe(new TextEncoder().encode(sampled).byteLength);
  });
  it('stops synchronous CSV encoding when the monotonic deadline is crossed', () => {
    let checks = 0;
    expect(() =>
      exportCsv(
        'inventory',
        { rows: [], total: '0', exported_at: at },
        'Preview',
        false,
        () => {
          if (++checks === 5) throw new Error('deadline');
        },
      ),
    ).toThrow('deadline');
    expect(checks).toBe(5);
  });
});
