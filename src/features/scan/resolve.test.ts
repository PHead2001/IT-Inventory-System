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
  hydrate: vi.fn(),
  denied: false,
}));
vi.mock('server-only', () => ({}));
vi.mock('@/features/labels/origin.server', () => ({
  getLabelOrigin: db.origin,
}));
vi.mock('@/features/labels/queue.server', () => ({
  getQueueRecords: db.hydrate,
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
          if (name === 'inventory_serial_matches')
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
import { resolveItemCode, resolveScan } from './resolve.server';
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
  db.hydrate.mockReset().mockResolvedValue([]);
  db.denied = false;
});

const serialId = (index: number) =>
  `70000000-0000-4000-8000-${String(index).padStart(12, '0')}`;
const serialRow = (index: number, status = 'active') => ({
  id: serialId(index),
  name: `Equipment ${index}`,
  asset_tag: `Tag-${index}`,
  status,
});
const serialContext = (index: number) => ({
  kind: 'asset',
  key: serialId(index),
  manufacturer: `Maker ${index}`,
  holdingContext:
    index === 2 ? 'Depot [DEPOT] · assigned site' : 'IT Closet / Red Container',
});
it('resolves trimmed serials with PostgreSQL spelling and shows duplicate manufacturer/location/lifecycle context', async () => {
  db.serial.mockResolvedValue({
    data: [serialRow(1), serialRow(2, 'retired')],
    error: null,
  });
  db.hydrate.mockResolvedValue([serialContext(1), serialContext(2)]);
  const result = await resolveScan('  Serial-Mixed  ');
  expect(db.serial).toHaveBeenCalledExactlyOnceWith('Serial-Mixed');
  expect(db.hydrate).toHaveBeenCalledExactlyOnceWith([
    { kind: 'asset', key: serialId(1) },
    { kind: 'asset', key: serialId(2) },
  ]);
  expect(result).toMatchObject({
    status: 'ambiguous',
    matches: [
      {
        label: 'Equipment 1 (Tag-1)',
        state: 'active',
        context: 'Manufacturer: Maker 1 · IT Closet / Red Container',
      },
      {
        label: 'Equipment 2 (Tag-2)',
        state: 'retired',
        context: 'Manufacturer: Maker 2 · Depot [DEPOT] · assigned site',
      },
    ],
  });
});
it('deduplicates one asset matched by tag and serial while adding its context', async () => {
  db.asset.mockResolvedValue({ data: serialRow(1), error: null });
  db.serial.mockResolvedValue({ data: [serialRow(1)], error: null });
  db.hydrate.mockResolvedValue([serialContext(1)]);
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
  db.hydrate.mockResolvedValue([
    serialContext(2),
    serialContext(9),
    { ...serialContext(2), kind: 'quantity' },
  ]);
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
it('drops unavailable serial candidates without loading individual details', async () => {
  db.serial.mockResolvedValue({
    data: [serialRow(1), serialRow(2)],
    error: null,
  });
  db.hydrate.mockResolvedValue([serialContext(2)]);
  expect(await resolveScan('Serial')).toMatchObject({
    status: 'found',
    matches: [{ path: '/inventory/assets/' + serialId(2) }],
  });
  db.hydrate.mockResolvedValue([]);
  expect(await resolveScan('Serial')).toEqual({
    status: 'unknown',
    matches: [],
  });
});
it('keeps a saturated serial result bounded and ambiguous even when only one candidate is still accessible', async () => {
  db.serial.mockResolvedValue({
    data: Array.from({ length: 20 }, (_, index) => serialRow(index)),
    error: null,
  });
  db.hydrate.mockResolvedValue([serialContext(1)]);
  expect(await resolveScan('Serial')).toMatchObject({
    status: 'ambiguous',
    truncated: true,
    matches: [{ path: '/inventory/assets/' + serialId(1) }],
  });
  expect(db.hydrate.mock.calls[0][0]).toHaveLength(20);
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
  db.hydrate.mockResolvedValue(
    Array.from({ length: 19 }, (_, index) => serialContext(index)),
  );
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
  db.hydrate.mockResolvedValue([serialContext(1)]);
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
  expect(db.hydrate).not.toHaveBeenCalled();
});
it('serial read/hydration errors fail closed and direct private lookup requires a member', async () => {
  db.serial.mockResolvedValue({ data: null, error: { message: 'private' } });
  await expect(resolveScan('Serial')).rejects.toThrow('Serial lookup failed');
  db.serial.mockResolvedValue({ data: [serialRow(1)], error: null });
  db.hydrate.mockRejectedValue(new Error('Context unavailable'));
  await expect(resolveScan('Serial')).rejects.toThrow('Context unavailable');
  db.denied = true;
  db.serial.mockClear();
  await expect(resolveScan('Serial')).rejects.toThrow('Active member required');
  expect(db.serial).not.toHaveBeenCalled();
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
