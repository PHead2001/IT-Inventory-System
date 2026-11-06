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
  it.each([false, true])(
    'distinguishes retired custody from missing assignments with custom fields %s',
    (includeCustom) => {
      const rows = ['retired', 'site', 'storage', null, undefined].map(
        (custody_kind) => ({
          entity_id: id,
          kind: 'asset',
          name: 'Switch',
          category_name: 'Networking',
          manufacturer: null,
          model: null,
          status: custody_kind === 'retired' ? 'retired' : 'active',
          asset_tag: 'SW-1',
          serial_number: null,
          quantity: null,
          location_name: null,
          location_code: null,
          breadcrumb: null,
          custody_kind,
        }),
      );
      const csv = exportCsv(
        'inventory',
        { rows, total: rows.length, exported_at: at },
        'Preview',
        includeCustom,
      ).csv;
      const [header, ...body] = csv.slice(1).trimEnd().split('\r\n');
      const headers = header.split(',').map((value) => JSON.parse(value));
      const machineIndex = headers.indexOf('Custody');
      const labelIndex = headers.indexOf('Custody label');
      expect(
        body.map((line) => JSON.parse(line.split(',')[machineIndex])),
      ).toEqual(['retired', 'site', 'storage', '', '']);
      expect(labelIndex).toBe(headers.length - 1);
      expect(
        body.map((line) => JSON.parse(line.slice(line.lastIndexOf(',') + 1))),
      ).toEqual([
        'Retired',
        'Assigned to site',
        'In storage',
        'No recorded assignment',
        'No recorded assignment',
      ]);
    },
  );
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
          ...(type === 'inventory'
            ? ['Type label', 'Status label', 'Custody label']
            : ['Type label', 'Status label', 'Shortfall']),
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
    expect(header.split(',').slice(-6, -3)).toEqual(
      ['Item Code (SKU)', 'Display timezone', 'Exported at (display zone)'].map(
        csvText,
      ),
    );
    expect(
      body.includes(
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

it('retains machine identities while appending readable labels', () => {
  const row = {
    kind: 'asset',
    entity_id: id,
    name: 'Laptop',
    category_name: 'Computers',
    manufacturer: null,
    model: null,
    asset_tag: 'LAP-01',
    serial_number: null,
    status: 'retired',
    quantity: null,
    location_name: null,
    location_code: null,
    breadcrumb: null,
    custody_kind: 'site',
  };
  const [header, line] = exportCsv(
    'inventory',
    { rows: [row], total: 1, exported_at: at },
    'Preview',
  )
    .csv.slice(1)
    .split('\r\n');
  const headers = header.split(',');
  const values = line.split(',');
  expect(values[headers.indexOf(csvText('Status'))]).toBe(csvText('retired'));
  expect(values[headers.indexOf(csvText('Custody'))]).toBe(csvText('site'));
  expect(values.slice(-3)).toEqual(
    ['Individual asset', 'Retired', 'Assigned to site'].map(csvText),
  );
});

it.each(['active', 'archived'])(
  'appends readable low-stock labels while preserving machine columns for %s',
  (status) => {
    for (const custom of [false, true]) {
      const row = {
        entity_id: id,
        name: 'Cable',
        category_name: 'Cables',
        manufacturer: null,
        model: null,
        status,
        recorded_total: '0',
        reorder_threshold: 1,
        stock_state: 'out_of_stock',
        holding_context: 'No stock',
        item_code: 'SKU-001',
        custom_fields: {},
      };
      const [header, line] = exportCsv(
        'low_stock',
        { rows: [row], total: 1, exported_at: at },
        'Preview',
        custom,
      )
        .csv.slice(1)
        .split('\r\n');
      const headers = header.split(',');
      const values = line.split(',');
      expect(headers.slice(0, legacyLowStockHeaders.length)).toEqual(
        legacyLowStockHeaders.map(csvText),
      );
      expect(values[headers.indexOf(csvText('Type'))]).toBe(
        csvText('Quantity'),
      );
      expect(values[headers.indexOf(csvText('Status'))]).toBe(csvText(status));
      expect(headers.slice(-3, -1)).toEqual(
        ['Type label', 'Status label'].map(csvText),
      );
      expect(values.slice(-3, -1)).toEqual(
        ['Quantity item', status === 'active' ? 'Active' : 'Archived'].map(
          csvText,
        ),
      );
    }
  },
);

const shortfallExportRow = (patch: Record<string, unknown> = {}) => ({
  entity_id: id,
  name: 'Cable',
  category_name: 'Cables',
  manufacturer: null,
  model: null,
  status: 'active',
  recorded_total: '25',
  available_quantity: '25',
  assigned_quantity: '0',
  reorder_threshold: 30,
  stock_state: 'needs_restocking',
  holding_context: 'Current storage and site holdings',
  custom_fields: {},
  ...patch,
});
const shortfallSnapshot = (row = shortfallExportRow()) => ({
  rows: [row],
  total: 1,
  exported_at: at,
});

it.each([false, true])(
  'appends only the exact low-stock shortfall after all existing columns (custom %s)',
  (custom) => {
    for (const [available, threshold, expected] of [
      ['25', 30, '5'],
      ['30', 30, '0'],
      ['31', 30, '0'],
      ['0', 0, '0'],
      ['0', 2147483647, '2147483647'],
      ['9223372036854775807', 2147483647, '0'],
      [undefined, 30, ''],
      [null, 30, ''],
    ] as const) {
      const recorded = available ?? '100';
      const snapshot = shortfallSnapshot(
        shortfallExportRow({
          available_quantity: available,
          recorded_total: recorded,
          reorder_threshold: threshold,
        }),
      );
      const before = structuredClone(snapshot);
      const [header, line] = exportCsv('low_stock', snapshot, 'Preview', custom)
        .csv.slice(1)
        .split('\r\n');
      const headers = header.split(','),
        values = line.split(',');
      expect(headers.at(-1)).toBe(csvText('Shortfall'));
      expect(values.at(-1)).toBe(expected);
      expect(values[headers.indexOf(csvText('Available in Storage'))]).toBe(
        available ?? '',
      );
      expect(values[headers.indexOf(csvText('Assigned to Sites'))]).toBe('0');
      expect(values[headers.indexOf(csvText('Recorded Total'))]).toBe(recorded);
      expect(headers.slice(0, legacyLowStockHeaders.length)).toEqual(
        legacyLowStockHeaders.map(csvText),
      );
      expect(snapshot).toEqual(before);
    }
  },
);
it('keeps unconfigured thresholds outside low-stock snapshots rather than exporting a zero shortage', () => {
  expect(() =>
    exportCsv(
      'low_stock',
      shortfallSnapshot(shortfallExportRow({ reorder_threshold: null })),
      'Preview',
    ),
  ).toThrow();
});
it.each([false, true])(
  'retains low-stock CSV escaping and formula protection with the appended shortfall (custom %s)',
  (custom) => {
    const name = '\t=SUM("1,2")\r\nSnow 雪';
    const holding = '\u0001@holdings, "quoted"\r\nsecond line';
    const fields = { value: '=PRIVATE, "quoted"\nnext' };
    const csv = exportCsv(
      'low_stock',
      shortfallSnapshot(
        shortfallExportRow({
          name,
          holding_context: holding,
          custom_fields: fields,
        }),
      ),
      'Preview',
      custom,
    ).csv;
    expect(csv.startsWith('\uFEFF')).toBe(true);
    expect(csv).toContain(csvText(name));
    expect(csv).toContain(csvText(holding));
    expect(csv.includes(csvText(JSON.stringify(fields)))).toBe(custom);
    expect(csv.endsWith(',5\r\n')).toBe(true);
  },
);
it('includes the new low-stock header and cell in the exact existing 3 MiB UTF8 ceiling', () => {
  const input = (name: string) =>
    shortfallSnapshot(
      shortfallExportRow({
        name,
        available_quantity: '0',
        recorded_total: '0',
        reorder_threshold: 2147483647,
      }),
    );
  const encoder = new TextEncoder();
  const base = encoder.encode(
    exportCsv('low_stock', input(''), 'Preview').csv,
  ).byteLength;
  const remaining = 3 * 1024 * 1024 - base;
  const name =
    '"'.repeat(Math.floor(remaining / 2)) + (remaining % 2 ? 'A' : '');
  const below =
    '"'.repeat(Math.floor((remaining - 1) / 2)) +
    ((remaining - 1) % 2 ? 'A' : '');
  expect(
    encoder.encode(exportCsv('low_stock', input(below), 'Preview').csv)
      .byteLength,
  ).toBe(3 * 1024 * 1024 - 1);
  const bytes: number[] = [];
  const csv = exportCsv(
    'low_stock',
    input(name),
    'Preview',
    false,
    undefined,
    (value) => bytes.push(value),
  ).csv;
  expect(encoder.encode(csv).byteLength).toBe(3 * 1024 * 1024);
  expect(bytes.at(-1)).toBe(3 * 1024 * 1024);
  expect(csv.endsWith(',2147483647\r\n')).toBe(true);
  expect(() => exportCsv('low_stock', input(name + 'A'), 'Preview')).toThrow(
    ExportTooLargeError,
  );
});
it('preserves deadline checks after a shortfall row and never returns a partially completed file', () => {
  let appended = 0,
    expired = false;
  const check = () => {
    if (expired) throw new Error('deadline');
  };
  expect(() =>
    exportCsv('low_stock', shortfallSnapshot(), 'Preview', false, check, () => {
      if (++appended === 2) expired = true;
    }),
  ).toThrow('deadline');
  expect(appended).toBe(2);
});
