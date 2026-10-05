import { describe, expect, it } from 'vitest';
import { csvText, exportCsv, ExportTooLargeError } from './export';
import {
  formatOperationalTimestamp,
  resolveDisplayTimeZone,
} from '@/lib/operational-time';

const id = '00000000-0000-4000-8000-000000000001';
const at = '2026-09-24T15:18:37+00:00';
const legacyInventoryHeaders = [
  'Record ID',
  'Type',
  'Name',
  'Category',
  'Manufacturer',
  'Model',
  'Asset Tag',
  'Serial Number',
  'Status',
  'Quantity at Location',
  'Location Name',
  'Location Code',
  'Location Breadcrumb',
  'Exported At (UTC)',
  'Environment',
];
const legacyLowStockHeaders = [
  'Record ID',
  'Type',
  'Name',
  'Category',
  'Manufacturer',
  'Model',
  'Status',
  'Recorded Total',
  'Reorder Threshold',
  'Stock State',
  'All Current Holdings and Locations',
  'Exported At (UTC)',
  'Environment',
];
describe('inventory CSV', () => {
  it.each(['inventory', 'low_stock'] as const)(
    'appends display metadata after all existing %s fields, preserving UTC source and custom opt-in',
    (type) => {
      for (const custom of [false, true]) {
        const row = {
          entity_id: id,
          kind: 'quantity',
          name: '=Formula item',
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
          recorded_total: '0',
          reorder_threshold: 1,
          stock_state: 'out_of_stock',
          holding_context: 'Unlocated',
          item_code: '0001-A',
          custom_fields: {
            date: '2024-02-29',
            datetime: '2026-10-03T05:23:06.123456Z',
          },
        };
        const input = { rows: [row], total: '1', exported_at: at };
        const before = structuredClone(input);
        const result = exportCsv(
          type,
          input,
          'Preview',
          custom,
          undefined,
          undefined,
          'America/Los_Angeles',
        );
        const headers = result.csv
          .slice(1)
          .split('\r\n')[0]
          .split(',')
          .map((value) => JSON.parse(value));
        const original =
          type === 'inventory'
            ? [
                ...legacyInventoryHeaders,
                ...(custom ? ['Custom Fields JSON'] : []),
                'Location ID',
                'Custody',
                'Site ID',
                'Site Code',
                'Site Name',
                'Available in Storage (Item-wide)',
                'Assigned to Sites (Item-wide)',
                'Total Recorded (Item-wide)',
                'Item Code (SKU)',
              ]
            : [
                ...legacyLowStockHeaders,
                ...(custom ? ['Custom Fields JSON'] : []),
                'Available in Storage',
                'Assigned to Sites',
                'Item Code (SKU)',
              ];
        expect(headers).toEqual([
          ...original,
          'Display timezone',
          'Exported at (display zone)',
        ]);
        expect(result.exportedAt).toBe(at);
        expect(result.csv).toContain(csvText(at) + ',"Preview"');
        expect(result.csv).toContain(csvText(row.name));
        expect(result.csv).toContain(
          '"0001-A","America/Los_Angeles",' +
            csvText(
              formatOperationalTimestamp(
                at,
                resolveDisplayTimeZone('America/Los_Angeles'),
              )!.text,
            ),
        );
        expect(
          result.csv.includes(csvText(JSON.stringify(row.custom_fields))),
        ).toBe(custom);
        expect(input).toEqual(before);
      }
    },
  );
  it('uses explicit bounded UTC fallback for an invalid supplied display zone', () => {
    const row = {
      entity_id: id,
      kind: 'quantity',
      name: 'Cable',
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
    const csv = exportCsv(
      'inventory',
      { rows: [row], total: '1', exported_at: at },
      'Preview',
      false,
      undefined,
      undefined,
      '=CMD()',
    ).csv;
    expect(csv).toContain('"UTC (UTC fallback)"');
    expect(csv).toContain('UTC (UTC fallback)');
    expect(csv).not.toContain('=CMD()');
  });
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
    expect(
      result.csv.slice(1).split('\r\n')[0].split(',').slice(0, 15),
    ).toEqual(legacyInventoryHeaders.map(csvText));
  });
  it('appends Item Code after the existing CSV columns and neutralizes formula text', () => {
    const row = {
      entity_id: id,
      kind: 'quantity',
      name: 'Cable',
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
      item_code: '=SKU-0001',
    };
    const csv = exportCsv(
      'inventory',
      { rows: [row], total: 1, exported_at: at },
      'Preview',
    ).csv;
    const [header, body] = csv.slice(1).split('\r\n');
    expect(header.split(',').slice(0, 15)).toEqual(
      legacyInventoryHeaders.map(csvText),
    );
    expect(header.split(',').slice(-3)).toEqual(
      ['Item Code (SKU)', 'Display timezone', 'Exported at (display zone)'].map(
        csvText,
      ),
    );
    expect(
      body.endsWith(
        ['=SKU-0001', 'UTC', '24 Sept 2026, 15:18:37 UTC']
          .map(csvText)
          .join(','),
      ),
    ).toBe(true);
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
      '"Recorded Total","Reorder Threshold","Stock State","All Current Holdings and Locations","Exported At (UTC)","Environment","Available in Storage","Assigned to Sites"',
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
  it('keeps each physical holding while leaving repeated item-wide total cells blank', () => {
    const base = {
      entity_id: id,
      kind: 'quantity',
      name: 'Adapters',
      category_name: 'Parts',
      manufacturer: null,
      model: null,
      status: 'active',
      asset_tag: null,
      serial_number: null,
      location_name: 'Storage',
      breadcrumb: 'Office / Storage',
      custody_kind: 'storage',
    };
    const csv = exportCsv(
      'inventory',
      {
        rows: [
          {
            ...base,
            quantity: 2,
            location_code: 'ITO-A',
            available_quantity: '7',
            assigned_quantity: '3',
            recorded_quantity: '10',
          },
          {
            ...base,
            quantity: 5,
            location_code: 'ITO-B',
            available_quantity: null,
            assigned_quantity: null,
            recorded_quantity: null,
          },
        ],
        total: 2,
        exported_at: at,
      },
      'Preview',
    ).csv;
    const [header, first, second] = csv.slice(1).split('\r\n');
    const columns = header.split(',');
    const firstCells = first.split(',');
    const secondCells = second.split(',');
    expect(firstCells[columns.indexOf('"Quantity at Location"')]).toBe('2');
    expect(secondCells[columns.indexOf('"Quantity at Location"')]).toBe('5');
    for (const [name, value] of [
      ['"Available in Storage (Item-wide)"', '7'],
      ['"Assigned to Sites (Item-wide)"', '3'],
      ['"Total Recorded (Item-wide)"', '10'],
    ]) {
      const index = columns.indexOf(name);
      expect(firstCells[index]).toBe(value);
      expect(secondCells[index]).toBe('');
    }
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
    const plainLines = plain.slice(1).split('\r\n');
    const customLines = withCustom.slice(1).split('\r\n');
    expect(plainLines[0].split(',').slice(0, 15)).toEqual(
      legacyInventoryHeaders.map(csvText),
    );
    expect(customLines[0].split(',').slice(0, 16)).toEqual(
      [...legacyInventoryHeaders, 'Custom Fields JSON'].map(csvText),
    );
    expect(customLines[0]).toContain('"Custom Fields JSON"');
    expect(customLines[0].split(',')[16]).toBe('"Location ID"');
    const legacyRowPrefix = [
      csvText(id),
      csvText('Serialized asset'),
      csvText('Laptop'),
      csvText('Computers'),
      csvText(null),
      csvText(null),
      csvText(null),
      csvText(null),
      csvText('active'),
      '',
      csvText('1A'),
      csvText('ITC-S1A'),
      csvText('Closet / 1A'),
      csvText(at),
      csvText('Preview'),
    ];
    expect(plainLines[1].split(',').slice(0, 15)).toEqual(legacyRowPrefix);
    expect(customLines[1].split(',').slice(0, 15)).toEqual(legacyRowPrefix);
    expect(plainLines[1].split(',')[15]).toBe(csvText(null));
    expect(withCustom).toContain(id);
    expect(withCustom).toContain(csvText(JSON.stringify(custom)));
    expect(withCustom).toContain('=Child');
    const lowStockRow = {
      entity_id: id,
      name: 'Adapters',
      category_name: 'Parts',
      manufacturer: null,
      model: null,
      status: 'active',
      recorded_total: '3',
      reorder_threshold: 4,
      stock_state: 'needs_restocking',
      holding_context: '1A: 3',
      available_quantity: '3',
      assigned_quantity: '0',
      custom_fields: custom,
    };
    const lowPlain = exportCsv(
      'low_stock',
      { rows: [lowStockRow], total: '1', exported_at: at },
      'Preview',
    ).csv;
    const lowCustom = exportCsv(
      'low_stock',
      { rows: [lowStockRow], total: '1', exported_at: at },
      'Preview',
      true,
    ).csv;
    const lowPlainLines = lowPlain.slice(1).split('\r\n');
    const lowCustomLines = lowCustom.slice(1).split('\r\n');
    expect(lowPlainLines[0].split(',').slice(0, 13)).toEqual(
      legacyLowStockHeaders.map(csvText),
    );
    expect(lowCustomLines[0].split(',').slice(0, 14)).toEqual(
      [...legacyLowStockHeaders, 'Custom Fields JSON'].map(csvText),
    );
    expect(lowCustomLines[0].split(',')[14]).toBe('"Available in Storage"');
    expect(lowPlainLines[1].split(',').slice(0, 13)).toEqual(
      lowCustomLines[1].split(',').slice(0, 13),
    );
    expect(lowPlainLines[1].split(',')[11]).toBe(csvText(at));
    expect(lowPlainLines[1].split(',')[12]).toBe(csvText('Preview'));
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
    // A longer display context must fit the same exact budget, not an extra allowance.
    expect(() =>
      exportCsv(
        'inventory',
        input(boundaryName),
        'Preview',
        false,
        undefined,
        undefined,
        'America/Los_Angeles',
      ),
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
