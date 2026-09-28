import { beforeEach, expect, it, vi } from 'vitest';
const db = vi.hoisted(() => ({
  location: vi.fn(),
  asset: vi.fn(),
  quantity: vi.fn(),
  itemCode: vi.fn(),
  origin: vi.fn(),
}));
vi.mock('server-only', () => ({}));
vi.mock('@/features/labels/origin.server', () => ({
  getLabelOrigin: db.origin,
}));
vi.mock('@/lib/auth/session.server', () => ({
  requireMember: async () => ({
    supabase: {
      rpc: (_name: string, args: { p_code: string }) =>
        db.itemCode(args.p_code),
      from: (table: string) => ({
        select: () => ({
          eq: (_field: string, value: string) => ({
            maybeSingle: () =>
              table === 'inventory_locations'
                ? db.location(value)
                : table === 'quantity_items'
                  ? db.quantity(value)
                  : db.asset(value),
          }),
        }),
      }),
    },
  }),
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
});
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
