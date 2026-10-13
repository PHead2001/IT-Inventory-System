import { beforeEach, expect, it, vi } from 'vitest';
const db = vi.hoisted(() => ({
  location: vi.fn(),
  asset: vi.fn(),
  quantity: vi.fn(),
  itemCode: vi.fn(),
  origin: vi.fn(),
  predicate: vi.fn(),
  tagLookup: vi.fn(),
  serial: vi.fn(),
  denied: false,
}));
vi.mock('server-only', () => ({}));
vi.mock('@/features/labels/origin.server', () => ({
  getLabelOrigin: db.origin,
}));
vi.mock('@/lib/auth/session.server', () => ({
  requireMember: async () => {
    if (db.denied) throw new Error('Active member required.');
    return {
      supabase: {
        rpc: (
          name: string,
          args: { p_code?: string; p_tag?: string; p_serial?: string },
        ) => {
          if (name === 'inventory_serial_lookup_v1')
            return db.serial(args.p_serial);
          if (name === 'inventory_asset_tag_lookup') {
            db.tagLookup(args.p_tag);
            return db.asset(args.p_tag);
          }
          return db.itemCode(args.p_code);
        },
        from: (table: string) => ({
          select: () => ({
            eq: (field: string, value: string) => {
              db.predicate(table, field, value);
              return {
                maybeSingle: () =>
                  table === 'inventory_locations'
                    ? db.location(value)
                    : table === 'quantity_items'
                      ? db.quantity(value)
                      : db.asset(value),
              };
            },
          }),
        }),
      },
    };
  },
}));
import { resolveItemCode, resolveScan, resolveSerial } from './resolve.server';
beforeEach(() => {
  db.location.mockReset().mockResolvedValue({ data: null, error: null });
  db.asset.mockReset().mockResolvedValue({ data: null, error: null });
  db.quantity.mockReset().mockResolvedValue({ data: null, error: null });
  db.itemCode.mockReset().mockResolvedValue({ data: null, error: null });
  db.origin.mockReset().mockReturnValue({
    origin: 'https://inventory.example.test',
    preview: false,
  });
  db.predicate.mockReset();
  db.tagLookup.mockReset();
  db.serial.mockReset().mockResolvedValue({ data: [], error: null });
  db.denied = false;
});

const serialId = (index: number) =>
  `70000000-0000-4000-8000-${String(index).padStart(12, '0')}`;
const serialRow = (index: number, status = 'active') => ({
  id: serialId(index),
  name: `Equipment ${index}`,
  asset_tag: `Tag-${index}`,
  status,
  serial_number: 'Serial-Mixed',
  manufacturer: `Maker ${index}`,
  location_name: 'Red Container',
  location_code: 'ITC-RED',
  site_name: null,
  site_code: null,
});
it.each([
  'SN:12345',
  'LOC:ITC-RED',
  'AST:tag-001',
  '/locations/ITC-RED',
  'https://evil.test/locations/ITC',
  'javascript:alert(1)',
])(
  'explicit serial mode treats %s as authorized identity data only',
  async (serial) => {
    db.serial.mockResolvedValue({
      data: [{ ...serialRow(1), serial_number: serial }],
      error: null,
    });
    expect(await resolveSerial(' \t' + serial + '\n ')).toMatchObject({
      status: 'found',
      matches: [
        { path: '/inventory/assets/' + serialId(1), serialNumber: serial },
      ],
    });
    expect(db.serial).toHaveBeenCalledExactlyOnceWith(serial);
    expect(db.predicate).not.toHaveBeenCalled();
    expect(db.itemCode).not.toHaveBeenCalled();
    expect(db.tagLookup).not.toHaveBeenCalled();
    expect(db.origin).not.toHaveBeenCalled();
  },
);
it('serial-only mode retains duplicate context, overflow, unknowns and failure boundaries', async () => {
  expect(await resolveSerial('SN:missing')).toEqual({
    status: 'unknown',
    matches: [],
  });
  db.serial.mockResolvedValue({
    data: [serialRow(1), serialRow(2, 'retired')],
    error: null,
  });
  expect(await resolveSerial('SN:12345')).toMatchObject({
    status: 'ambiguous',
    matches: [
      { state: 'active', context: expect.stringContaining('Maker 1') },
      { state: 'retired' },
    ],
  });
  db.serial.mockResolvedValue({
    data: Array.from({ length: 21 }, (_, index) => serialRow(index)),
    error: null,
  });
  const overflow = await resolveSerial('SN:12345');
  expect(overflow).toMatchObject({ status: 'ambiguous', truncated: true });
  expect(overflow.matches).toHaveLength(20);
  db.serial.mockResolvedValue({ data: null, error: { message: 'private' } });
  await expect(resolveSerial('SN:12345')).rejects.toThrow(
    'Serial lookup failed.',
  );
  db.serial.mockClear();
  db.denied = true;
  await expect(resolveSerial('SN:12345')).rejects.toThrow(
    'Active member required.',
  );
  expect(db.serial).not.toHaveBeenCalled();
});
it('explicit serial bounds count Unicode characters and reject controls before reads', async () => {
  expect((await resolveSerial('😀'.repeat(200))).status).toBe('unknown');
  expect(db.serial).toHaveBeenCalledExactlyOnceWith('😀'.repeat(200));
  db.serial.mockClear();
  for (const value of [
    '',
    ' ',
    '😀'.repeat(201),
    'SN:\n123',
    'SN:\u0085123',
    'x'.repeat(1025),
  ])
    expect(await resolveSerial(value)).toEqual({
      status: 'invalid',
      matches: [],
    });
  expect(db.serial).not.toHaveBeenCalled();
  expect(await resolveScan('SN:12345')).toEqual({
    status: 'invalid',
    matches: [],
  });
});
it('resolves trimmed serials with PostgreSQL spelling and shows duplicate manufacturer/location/lifecycle context', async () => {
  db.serial.mockResolvedValue({
    data: [serialRow(1), serialRow(2, 'retired')],
    error: null,
  });
  const result = await resolveScan('  Serial-Mixed  ');
  expect(db.serial).toHaveBeenCalledExactlyOnceWith('Serial-Mixed');
  expect(result).toMatchObject({
    status: 'ambiguous',
    matches: [
      {
        label: 'Equipment 1 (Tag-1)',
        state: 'active',
        context: 'Manufacturer: Maker 1 · At Red Container (ITC-RED)',
      },
      {
        label: 'Equipment 2 (Tag-2)',
        state: 'retired',
        context:
          'Manufacturer: Maker 2 · Last recorded storage Red Container (ITC-RED)',
      },
    ],
  });
});
it('deduplicates one asset matched by tag and serial while adding its context', async () => {
  db.asset.mockResolvedValue({ data: serialRow(1), error: null });
  db.serial.mockResolvedValue({ data: [serialRow(1)], error: null });
  const result = await resolveScan('Tag-1');
  expect(result.status).toBe('found');
  expect(result.matches).toHaveLength(1);
  expect(result.matches[0].context).toContain('Maker 1');
});
it('keeps tag/SKU/location/serial collisions explicit and never uses hydration as a new identity candidate', async () => {
  db.location.mockResolvedValue({
    data: { code: 'ITC', name: 'Closet', active: true },
    error: null,
  });
  db.asset.mockResolvedValue({ data: serialRow(1), error: null });
  db.itemCode.mockResolvedValue({
    data: { id: serialId(3), name: 'Cable', item_code: 'ITC', archived: false },
    error: null,
  });
  db.serial.mockResolvedValue({ data: [serialRow(2)], error: null });
  expect(await resolveScan('ITC')).toMatchObject({
    status: 'ambiguous',
    matches: [
      { kind: 'location' },
      { path: '/inventory/assets/' + serialId(1) },
      { kind: 'quantity' },
      { path: '/inventory/assets/' + serialId(2) },
    ],
  });
});
it('returns exactly twenty matches without falsely marking overflow', async () => {
  db.serial.mockResolvedValue({
    data: Array.from({ length: 20 }, (_, index) => serialRow(index)),
    error: null,
  });
  const result = await resolveScan('Serial');
  expect(result.status).toBe('ambiguous');
  expect(result.matches).toHaveLength(20);
  expect(result.truncated).toBeUndefined();
});
it('marks the twenty-first serial hit as overflow and never returns it as a candidate', async () => {
  db.serial.mockResolvedValue({
    data: Array.from({ length: 21 }, (_, index) => serialRow(index)),
    error: null,
  });
  const result = await resolveScan('Serial');
  expect(result).toMatchObject({ status: 'ambiguous', truncated: true });
  expect(result.matches).toHaveLength(20);
  expect(result.matches.at(-1)?.path).toBe('/inventory/assets/' + serialId(19));
});
it('caps combined namespaces at twenty without hiding truncation', async () => {
  db.location.mockResolvedValue({
    data: { code: 'ITC', name: 'Closet', active: true },
    error: null,
  });
  db.asset.mockResolvedValue({ data: serialRow(25), error: null });
  db.itemCode.mockResolvedValue({
    data: {
      id: serialId(26),
      name: 'Cable',
      item_code: 'ITC',
      archived: false,
    },
    error: null,
  });
  db.serial.mockResolvedValue({
    data: Array.from({ length: 19 }, (_, index) => serialRow(index)),
    error: null,
  });
  const result = await resolveScan('ITC');
  expect(result).toMatchObject({ status: 'ambiguous', truncated: true });
  expect(result.matches).toHaveLength(20);
  expect(result.matches.slice(0, 3).map((row) => row.kind)).toEqual([
    'location',
    'asset',
    'quantity',
  ]);
});
it('a valid long bare serial can miss the shorter tag namespace while typed AST remains invalid', async () => {
  const serial = 'S'.repeat(200);
  db.asset.mockResolvedValue({ data: null, error: { code: 'P1012' } });
  db.serial.mockResolvedValue({ data: [serialRow(1)], error: null });
  expect(await resolveScan(serial)).toMatchObject({ status: 'found' });
  expect(await resolveScan('AST:' + serial)).toEqual({
    status: 'invalid',
    matches: [],
  });
  expect(db.serial).toHaveBeenCalledExactlyOnceWith(serial);
});
it('explicit prefixes and UUID labels never add serial candidates', async () => {
  for (const value of [
    'AST:tag',
    'LOC:ITC',
    '/inventory/assets/' + serialId(1),
    '/inventory/quantity/' + serialId(1),
  ])
    await resolveScan(value);
  expect(db.serial).not.toHaveBeenCalled();
});
it('serial read errors fail closed and direct private lookup requires a member', async () => {
  db.serial.mockResolvedValue({ data: null, error: { message: 'private' } });
  await expect(resolveScan('Serial')).rejects.toThrow('Serial lookup failed');
  db.denied = true;
  db.serial.mockClear();
  await expect(resolveScan('Serial')).rejects.toThrow('Active member required');
  expect(db.serial).not.toHaveBeenCalled();
});
it('uses the serial snapshot name, tag and lifecycle when earlier tag lookup is stale', async () => {
  db.asset.mockResolvedValue({ data: serialRow(1), error: null });
  db.serial.mockResolvedValue({
    data: [
      {
        ...serialRow(1, 'retired'),
        name: 'Renamed',
        asset_tag: 'NewTag',
        serial_number: 'TAG-1',
        location_name: null,
        location_code: null,
      },
    ],
    error: null,
  });
  expect(await resolveScan('Tag-1')).toMatchObject({
    status: 'found',
    matches: [
      {
        name: 'Renamed',
        identifier: 'NewTag',
        state: 'retired',
        serialNumber: 'TAG-1',
        context: 'Manufacturer: Maker 1 · Location unavailable',
      },
    ],
  });
});
it('looks up differently cased tags by the generated unique key and preserves display spelling', async () => {
  db.asset.mockResolvedValue({
    data: {
      id: '7b84a7cf-197b-45b1-8016-87482d124cb4',
      name: 'Laptop',
      asset_tag: '000Ab/C.02',
      status: 'active',
    },
    error: null,
  });
  const result = await resolveScan('000aB/c.02');
  expect(db.tagLookup).toHaveBeenCalledExactlyOnceWith('000aB/c.02');
  expect(result.matches[0].label).toContain('000Ab/C.02');
});
it.each(['İΣ-Ab', '00%_\\Ab'])(
  'passes the exact parsed AST spelling %s to the authoritative lookup',
  async (tag) => {
    await resolveScan('AST:' + tag);
    expect(db.tagLookup).toHaveBeenCalledExactlyOnceWith(tag);
  },
);
it('keeps stable URL resolution tied to live records after rename and move', async () => {
  db.location.mockResolvedValue({
    data: { code: 'ITC', name: 'Renamed storage room', active: true },
    error: null,
  });
  const location = await resolveScan(
    'https://inventory.example.test/locations/ITC',
  );
  expect(location).toEqual({
    status: 'found',
    matches: [
      {
        kind: 'location',
        path: '/locations/ITC',
        label: 'Renamed storage room (ITC)',
        name: 'Renamed storage room',
        identifier: 'ITC',
        state: 'active',
      },
    ],
  });
  db.asset.mockResolvedValue({
    data: {
      id: '7b84a7cf-197b-45b1-8016-87482d124cb4',
      name: 'Moved laptop',
      asset_tag: null,
      status: 'active',
    },
    error: null,
  });
  const asset = await resolveScan(
    'https://inventory.example.test/inventory/assets/7b84a7cf-197b-45b1-8016-87482d124cb4',
  );
  expect(asset.matches[0]).toMatchObject({
    path: '/inventory/assets/7b84a7cf-197b-45b1-8016-87482d124cb4',
    label: 'Moved laptop',
  });
});
it('resolves a known padded production-shaped quantity label exactly like its unpadded form', async () => {
  const id = '7b84a7cf-197b-45b1-8016-87482d124cb4';
  db.quantity.mockResolvedValue({
    data: {
      id,
      name: 'Known quantity',
      archived: false,
      item_code: '0007-A/B',
    },
    error: null,
  });
  const value = 'https://inventory.example.test/inventory/quantity/' + id;
  expect(await resolveScan(' \r\n' + value + '\t ')).toEqual(
    await resolveScan(value),
  );
  expect(await resolveScan(value.slice(0, -1) + '\n4')).toEqual({
    status: 'invalid',
    matches: [],
  });
});
it('does not guess when a bare code exists in both namespaces', async () => {
  db.location.mockResolvedValue({
    data: { code: 'ITC', name: 'Room', active: false },
    error: null,
  });
  db.asset.mockResolvedValue({
    data: {
      id: '7b84a7cf-197b-45b1-8016-87482d124cb4',
      name: 'Old asset',
      asset_tag: 'itc',
      status: 'retired',
    },
    error: null,
  });
  expect(await resolveScan('ITC')).toMatchObject({
    status: 'ambiguous',
    matches: [{ state: 'inactive' }, { state: 'retired' }],
  });
});
it('treats bare item codes as exact identities and keeps namespace collisions ambiguous', async () => {
  const id = '7b84a7cf-197b-45b1-8016-87482d124cb4';
  db.itemCode.mockResolvedValue({
    data: { id, name: 'Adapter', item_code: '0007-A/B', archived: true },
    error: null,
  });
  expect(await resolveScan('0007-A/B')).toEqual({
    status: 'found',
    matches: [
      {
        kind: 'quantity',
        path: '/inventory/quantity/' + id,
        label: 'Adapter (0007-A/B)',
        name: 'Adapter',
        identifier: '0007-A/B',
        state: 'archived',
      },
    ],
  });
  db.location.mockResolvedValue({
    data: { code: 'ITC', name: 'Room', active: true },
    error: null,
  });
  db.asset.mockResolvedValue({
    data: {
      id: '6b84a7cf-197b-45b1-8016-87482d124cb4',
      name: 'Laptop',
      asset_tag: 'itc',
      status: 'active',
    },
    error: null,
  });
  expect(await resolveScan('ITC')).toMatchObject({
    status: 'ambiguous',
    matches: [{ kind: 'location' }, { kind: 'asset' }, { kind: 'quantity' }],
  });
  db.itemCode.mockResolvedValue({
    data: null,
    error: { message: 'lookup denied' },
  });
  await expect(resolveScan('ITC')).rejects.toThrow('Item code lookup failed');
});
it('keeps reserved-looking and supplementary Item codes as data only in explicit mode', async () => {
  const id = '7b84a7cf-197b-45b1-8016-87482d124cb4';
  db.itemCode.mockImplementation(async (value: string) => ({
    data: { id, name: 'Adapter', item_code: value, archived: false },
    error: null,
  }));
  for (const value of [
    '/SKU',
    'ABC:001',
    'AST:001',
    '😀'.repeat(100),
    'https://evil.test/sku',
  ]) {
    expect(await resolveItemCode(value)).toMatchObject({
      status: 'found',
      matches: [{ kind: 'quantity', path: '/inventory/quantity/' + id }],
    });
    expect(db.itemCode).toHaveBeenLastCalledWith(value);
  }
  expect((await resolveScan('/SKU')).status).toBe('invalid');
  expect((await resolveScan('ABC:001')).status).toBe('invalid');
  expect((await resolveScan('https://evil.test/sku')).status).toBe('invalid');
  expect((await resolveItemCode('ABC\u0085D')).status).toBe('invalid');
  expect((await resolveItemCode('😀'.repeat(101))).status).toBe('invalid');
});
it('keeps AST in asset-tag mode and accepts supplementary bare identifiers', async () => {
  const id = '7b84a7cf-197b-45b1-8016-87482d124cb4';
  db.asset.mockResolvedValue({
    data: { id, name: 'Laptop', asset_tag: '001', status: 'active' },
    error: null,
  });
  expect(await resolveScan('AST:001')).toMatchObject({
    status: 'found',
    matches: [{ kind: 'asset' }],
  });
  expect(db.itemCode).not.toHaveBeenCalled();
  db.asset.mockResolvedValue({ data: null, error: null });
  db.itemCode.mockResolvedValue({
    data: { id, name: 'Cable', item_code: '😀'.repeat(100), archived: false },
    error: null,
  });
  expect(await resolveScan('😀'.repeat(100))).toMatchObject({
    status: 'found',
    matches: [{ kind: 'quantity' }],
  });
});
it('fails closed on malformed input and read errors', async () => {
  expect((await resolveScan('https://other.test/locations/ITC')).status).toBe(
    'invalid',
  );
  expect(db.location).not.toHaveBeenCalled();
  db.location.mockResolvedValue({
    data: null,
    error: { message: 'RLS error' },
  });
  await expect(resolveScan('LOC:ITC')).rejects.toThrow(
    'Location lookup failed',
  );
});
it('resolves bare asset UUIDs and de-duplicates a matching tag record', async () => {
  const id = '7b84a7cf-197b-45b1-8016-87482d124cb4';
  db.asset.mockResolvedValue({
    data: { id, name: 'Laptop', asset_tag: id, status: 'active' },
    error: null,
  });
  expect(await resolveScan(id)).toMatchObject({
    status: 'found',
    matches: [{ path: '/inventory/assets/' + id }],
  });
  expect(db.asset).toHaveBeenCalledWith(id);
});
it('resolves quantity QR URLs and keeps archived records identifiable', async () => {
  const id = '7b84a7cf-197b-45b1-8016-87482d124cb4';
  db.quantity.mockResolvedValue({
    data: { id, name: 'Retired adapter definition', archived: true },
    error: null,
  });
  expect(
    await resolveScan(
      'https://inventory.example.test/inventory/quantity/' + id,
    ),
  ).toEqual({
    status: 'found',
    matches: [
      {
        kind: 'quantity',
        path: '/inventory/quantity/' + id,
        label: 'Retired adapter definition',
        name: 'Retired adapter definition',
        identifier: undefined,
        state: 'archived',
      },
    ],
  });
  expect(await resolveScan(id)).toMatchObject({ status: 'found' });
});
it('keeps manual lookup usable without a configured label origin', async () => {
  db.origin.mockImplementation(() => {
    throw new Error('APP_ORIGIN missing');
  });
  db.location.mockResolvedValue({
    data: { code: 'ITC', name: 'Room', active: true },
    error: null,
  });
  expect((await resolveScan('LOC:ITC')).status).toBe('found');
  expect(
    (await resolveScan('https://inventory.example.test/locations/ITC')).status,
  ).toBe('invalid');
});

it.each(['İΣ-Ab', '00%_\\Ab', '😀'.repeat(200)])(
  'passes exact Unicode serial input to PostgreSQL and preserves returned display spelling',
  async (serial) => {
    db.serial.mockResolvedValue({
      data: [{ ...serialRow(1), serial_number: serial }],
      error: null,
    });
    const result = await resolveScan(' \t' + serial + '\n ');
    expect(db.serial).toHaveBeenCalledExactlyOnceWith(serial);
    expect(result.matches[0].serialNumber).toBe(serial);
    if ([...serial].length > 100) {
      expect(db.tagLookup).not.toHaveBeenCalled();
      expect(db.itemCode).not.toHaveBeenCalled();
    }
  },
);
it('adds distinct serial candidates to bare UUID matches while deduplicating the same UUID asset', async () => {
  db.asset.mockResolvedValue({ data: serialRow(1), error: null });
  db.quantity.mockResolvedValue({
    data: { id: serialId(1), name: 'Cable', item_code: null, archived: false },
    error: null,
  });
  db.serial.mockResolvedValue({
    data: [serialRow(1), serialRow(2)],
    error: null,
  });
  const result = await resolveScan(serialId(1));
  expect(result.status).toBe('ambiguous');
  expect(result.matches).toHaveLength(3);
  expect(
    result.matches.filter(
      (row) => row.path === '/inventory/assets/' + serialId(1),
    ),
  ).toHaveLength(1);
});
it('shows site assignment without inventing storage and unknown serials remain read-only', async () => {
  db.serial.mockResolvedValue({
    data: [
      {
        ...serialRow(1),
        location_name: null,
        location_code: null,
        site_name: 'Depot',
        site_code: 'DEPOT',
      },
    ],
    error: null,
  });
  expect(await resolveScan('Serial')).toMatchObject({
    matches: [{ context: 'Manufacturer: Maker 1 · Assigned to Depot (DEPOT)' }],
  });
  db.serial.mockResolvedValue({ data: [], error: null });
  expect(await resolveScan('Unknown-Serial')).toEqual({
    status: 'unknown',
    matches: [],
  });
});
