import { beforeEach, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
const mocks = vi.hoisted(() => ({ photos: vi.fn() }));
vi.mock('@/features/files/list.server', () => ({
  readFileListSummaries: mocks.photos,
}));
import { readPeek } from './read.server';
import type { requireMember } from '@/lib/auth/session.server';
type Context = Awaited<ReturnType<typeof requireMember>>;
const id = '00000000-0000-4000-8000-000000000001';
const id2 = '00000000-0000-4000-8000-000000000002';
const ref = {
  id,
  code: 'ITC-S1A',
  name: 'Shelf 1A',
  breadcrumb: 'IT Closet / Shelf 1 / 1A',
  active: true,
  can_hold_inventory: true,
};
const signal = new AbortController().signal;
function client(
  rows: Record<
    string,
    | { data: unknown; error?: unknown }
    | Array<{ data: unknown; error?: unknown }>
  >,
) {
  const resultFor = (table: string) => {
    const entry = rows[table];
    const result = {
      error: null,
      ...(Array.isArray(entry)
        ? entry.length > 1
          ? entry.shift()
          : entry[0]
        : entry),
    };
    if (
      (table === 'quantity_items' || table === 'serialized_assets') &&
      result.data &&
      typeof result.data === 'object'
    )
      result.data = { version: '1', ...result.data };
    if (table === 'inventory_locations' && result.data) {
      const canonical = (row: Record<string, unknown>) => ({
        ancestor_codes: ['ITC', row.code],
        ...row,
      });
      result.data = Array.isArray(result.data)
        ? result.data.map(canonical)
        : canonical(result.data as Record<string, unknown>);
    }
    return result;
  };
  const calls: { table: string; operations: unknown[][] }[] = [];
  const context = {
    member: { user_id: id },
    supabase: {
      from: (table: string) => {
        const call = { table, operations: [] as unknown[][] };
        calls.push(call);
        const builder: Record<string, unknown> = {};
        for (const name of [
          'select',
          'eq',
          'in',
          'limit',
          'order',
          'gt',
          'abortSignal',
        ])
          builder[name] = (...args: unknown[]) => {
            call.operations.push([name, ...args]);
            return builder;
          };
        builder.maybeSingle = () => Promise.resolve(resultFor(table));
        builder.then = (
          resolve: (value: unknown) => unknown,
          reject: (error: unknown) => unknown,
        ) => Promise.resolve(resultFor(table)).then(resolve, reject);
        return builder;
      },
    },
  } as unknown as Context;
  return { context, calls };
}
beforeEach(() => {
  mocks.photos.mockReset();
  mocks.photos.mockResolvedValue([]);
});
it('reads one inactive location without inventing stock or loading contents', async () => {
  const { context, calls } = client({
    inventory_locations: { data: { ...ref, active: false } },
  });
  expect(
    await readPeek(context, { kind: 'location', code: ref.code }, signal),
  ).toMatchObject({
    name: ref.name,
    status: 'inactive',
    stock: null,
    locations: [{ active: false }],
  });
  expect(calls.map((call) => call.table)).toEqual(['inventory_locations']);
  expect(mocks.photos).not.toHaveBeenCalled();
  expect(calls[0].operations).toContainEqual(['limit', 1]);
  expect(calls[0].operations).toContainEqual(['abortSignal', signal]);
});
it('requires readable parent before any thumbnail lookup', async () => {
  const { context, calls } = client({ quantity_items: { data: null } });
  expect(await readPeek(context, { kind: 'quantity', id }, signal)).toBeNull();
  expect(calls).toHaveLength(1);
  expect(mocks.photos).not.toHaveBeenCalled();
});
it('preserves permission errors rather than turning denial into absence', async () => {
  const error = { code: '42501' };
  const { context } = client({ serialized_assets: { data: null, error } });
  await expect(readPeek(context, { kind: 'asset', id }, signal)).rejects.toBe(
    error,
  );
  expect(mocks.photos).not.toHaveBeenCalled();
});
it('reads assigned-only quantity totals without rounding or showing out-of-stock zero', async () => {
  const { context, calls } = client({
    quantity_items: { data: { id, name: 'Adapters', archived: false } },
    inventory_quantity_totals: {
      data: {
        available_quantity: '0',
        assigned_quantity: '9007199254740993',
        recorded_quantity: '9007199254740993',
      },
    },
    stock_balances: { data: [] },
  });
  const result = await readPeek(context, { kind: 'quantity', id }, signal);
  expect(result?.stock).toEqual({
    available: '0',
    assigned: '9007199254740993',
    recorded: '9007199254740993',
  });
  expect(result?.locations).toEqual([]);
  expect(calls).toHaveLength(4);
  expect(mocks.photos).toHaveBeenCalledWith(
    context,
    [{ kind: 'quantity', id }],
    signal,
  );
});
it('bounds multi-location archived quantity to first four balances and three reference rows', async () => {
  const ids = [
    id,
    id2,
    '00000000-0000-4000-8000-000000000003',
    '00000000-0000-4000-8000-000000000004',
  ];
  const { context, calls } = client({
    quantity_items: { data: { id, name: 'Adapters', archived: true } },
    inventory_quantity_totals: {
      data: {
        available_quantity: '4',
        assigned_quantity: '0',
        recorded_quantity: '4',
      },
    },
    stock_balances: {
      data: ids.map((location_id) => ({ location_id, quantity: 1 })),
    },
    inventory_locations: {
      data: ids.slice(0, 3).map((locationId, index) => ({
        ...ref,
        id: locationId,
        code: 'ITC-D' + index,
      })),
    },
  });
  const result = await readPeek(context, { kind: 'quantity', id }, signal);
  expect(result).toMatchObject({ status: 'archived', moreLocations: true });
  expect(result?.locations).toHaveLength(3);
  expect(
    calls.find((call) => call.table === 'stock_balances')?.operations,
  ).toContainEqual(['limit', 4]);
  expect(
    calls.find((call) => call.table === 'inventory_locations')?.operations,
  ).toContainEqual(['in', 'id', ids.slice(0, 3)]);
});
it('treats a missing totals read as unavailable rather than zero', async () => {
  const { context } = client({
    quantity_items: { data: { id, name: 'Adapters', archived: false } },
    inventory_quantity_totals: { data: null },
    stock_balances: { data: [] },
  });
  await expect(
    readPeek(context, { kind: 'quantity', id }, signal),
  ).rejects.toThrow('Stock summary unavailable');
});
it('shows retired asset site custody truthfully and uses only matching recognition photo', async () => {
  mocks.photos.mockResolvedValue([
    { kind: 'asset', id, thumbnail_path: 't/photo.jpg', photo_name: 'Laptop' },
  ]);
  const { context, calls } = client({
    serialized_assets: {
      data: {
        id,
        name: 'Laptop',
        status: 'retired',
        asset_tag: 'TAG-001',
        site_id: id2,
        location_id: null,
      },
    },
    sites: { data: { name: 'Central office' } },
  });
  expect(await readPeek(context, { kind: 'asset', id }, signal)).toMatchObject({
    status: 'retired',
    siteName: 'Central office',
    locations: [],
    assetTag: 'TAG-001',
    photo: { path: 't/photo.jpg' },
  });
  expect(calls.map((call) => call.table)).toEqual([
    'serialized_assets',
    'sites',
    'serialized_assets',
  ]);
});

const stock = {
  available_quantity: '4',
  assigned_quantity: '0',
  recorded_quantity: '4',
};
it('retries the whole bounded inventory read once after a precision-safe version race', async () => {
  const first = {
    id,
    name: 'Before',
    archived: false,
    version: '9007199254740992',
  };
  const second = { ...first, name: 'After', version: '9007199254740993' };
  const { context, calls } = client({
    quantity_items: [
      { data: first },
      { data: second },
      { data: second },
      { data: second },
    ],
    inventory_quantity_totals: [
      { data: stock },
      { data: { ...stock, available_quantity: '5', recorded_quantity: '5' } },
    ],
    stock_balances: { data: [] },
  });
  const result = await readPeek(context, { kind: 'quantity', id }, signal);
  expect(result).toMatchObject({
    name: 'After',
    stock: { available: '5', recorded: '5' },
  });
  expect(mocks.photos).toHaveBeenCalledTimes(2);
  expect(
    calls
      .filter((c) => c.table === 'quantity_items')
      .map((c) => c.operations.find((o) => o[0] === 'select')?.[1]),
  ).toEqual([
    'id,name,archived,version::text',
    'version::text',
    'id,name,archived,version::text',
    'version::text',
  ]);
  expect(
    calls.every((c) =>
      c.operations.some((o) => o[0] === 'abortSignal' && o[1] === signal),
    ),
  ).toBe(true);
});
it('returns actionable unavailability after a second race rather than a mixed snapshot', async () => {
  const parent = { id, name: 'Cable', archived: false };
  const { context, calls } = client({
    quantity_items: [1, 2, 2, 3].map((n) => ({
      data: { ...parent, version: String(n) },
    })),
    inventory_quantity_totals: { data: stock },
    stock_balances: { data: [] },
  });
  await expect(
    readPeek(context, { kind: 'quantity', id }, signal),
  ).rejects.toThrow('Open the record or try again');
  expect(calls.filter((c) => c.table === 'quantity_items')).toHaveLength(4);
});
it.each([9007199254740992, '0', '-1', '1.5'])(
  'rejects unsafe or malformed parent version %s',
  async (version) => {
    const { context } = client({
      quantity_items: { data: { id, name: 'Cable', archived: false, version } },
    });
    await expect(
      readPeek(context, { kind: 'quantity', id }, signal),
    ).rejects.toThrow();
    expect(mocks.photos).not.toHaveBeenCalled();
  },
);
it.each(['42501', 'P1001', 'PGRST301'])(
  'propagates real thumbnail authorization denial %s',
  async (code) => {
    const error = { code };
    mocks.photos.mockRejectedValue(error);
    const { context } = client({
      serialized_assets: {
        data: {
          id,
          name: 'Laptop',
          status: 'active',
          asset_tag: null,
          location_id: null,
          site_id: null,
        },
      },
    });
    await expect(readPeek(context, { kind: 'asset', id }, signal)).rejects.toBe(
      error,
    );
  },
);
it('keeps the record summary when an optional photo is unavailable', async () => {
  mocks.photos.mockRejectedValue(new Error('Photo missing'));
  const { context } = client({
    serialized_assets: {
      data: {
        id,
        name: 'Laptop',
        status: 'active',
        asset_tag: null,
        location_id: null,
        site_id: null,
      },
    },
  });
  expect(await readPeek(context, { kind: 'asset', id }, signal)).toMatchObject({
    name: 'Laptop',
    photo: null,
  });
});
it('stops a racing read at the original cancellation deadline without retrying', async () => {
  const controller = new AbortController();
  mocks.photos.mockImplementation(async () => {
    controller.abort();
    return [];
  });
  const { context, calls } = client({
    quantity_items: { data: { id, name: 'Cable', archived: false } },
    inventory_quantity_totals: { data: stock },
    stock_balances: { data: [] },
  });
  await expect(
    readPeek(context, { kind: 'quantity', id }, controller.signal),
  ).rejects.toThrow('deadline expired');
  expect(calls.filter((c) => c.table === 'quantity_items')).toHaveLength(1);
});

it.each([
  ['ITO', ['ITO'], 'ITO'],
  ['ITO-GENERAL', ['ITO', 'ITO-GENERAL'], 'ITO'],
  ['STAGING', ['ITO', 'STAGING'], 'ITO'],
  ['ITC-UNMODELED', ['ITC', 'ITC-UNMODELED'], 'ITC'],
  ['ITO-SPOOF', ['OTHER', 'ITO-SPOOF'], null],
] as const)(
  'preserves canonical space ancestry for %s in the existing bounded caller read',
  async (code, ancestors, spaceRootCode) => {
    const { context, calls } = client({
      inventory_locations: {
        data: { ...ref, code, ancestor_codes: ancestors },
      },
    });
    const result = await readPeek(context, { kind: 'location', code }, signal);
    expect(result?.locations).toEqual([
      expect.objectContaining({ code, spaceRootCode }),
    ]);
    expect(calls).toHaveLength(1);
    expect(calls[0].operations).toContainEqual(['limit', 1]);
    expect(calls[0].operations).toContainEqual(['abortSignal', signal]);
    expect(
      String(
        calls[0].operations.find((operation) => operation[0] === 'select')?.[1],
      ),
    ).toContain('ancestor_codes');
  },
);

it.each(
  [
    [],
    ['ITO'],
    ['ITO', 'STAGING', 'STAGING'],
    ['ITO', 'bad code', 'STAGING'],
    ['ITO', 'X'.repeat(101), 'STAGING'],
  ].map((ancestor_codes) => ({ ancestor_codes })),
)(
  'rejects malformed canonical ancestry instead of guessing a space root: %j',
  async ({ ancestor_codes }) => {
    const { context } = client({
      inventory_locations: {
        data: { ...ref, code: 'STAGING', ancestor_codes },
      },
    });
    await expect(
      readPeek(context, { kind: 'location', code: 'STAGING' }, signal),
    ).rejects.toThrow();
  },
);
it('accepts deeper canonical inventory ancestry without imposing a room geometry depth cap', async () => {
  const ancestor_codes = [
    'ITO',
    ...Array.from({ length: 80 }, (_, index) => 'NODE-' + index),
    'STAGING',
  ];
  const { context } = client({
    inventory_locations: { data: { ...ref, code: 'STAGING', ancestor_codes } },
  });
  await expect(
    readPeek(context, { kind: 'location', code: 'STAGING' }, signal),
  ).resolves.toMatchObject({
    locations: [{ code: 'STAGING', spaceRootCode: 'ITO' }],
  });
});
