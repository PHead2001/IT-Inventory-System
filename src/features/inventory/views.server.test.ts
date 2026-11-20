import { afterEach, beforeEach, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/config', () => ({
  supabaseConfig: () => ({
    url: 'https://configured-backend.test/ignored',
    key: 'public-test-key',
  }),
}));
const mocks = vi.hoisted(() => ({
  member: vi.fn(),
  locations: vi.fn(),
  rpc: vi.fn(),
  useActualReader: false,
}));
vi.mock('@/lib/auth/session.server', () => ({ requireMember: mocks.member }));
vi.mock('./queries.server', () => ({ getLocations: mocks.locations }));
vi.mock('./view-reader.server', async () => {
  const actual = await vi.importActual<typeof import('./view-reader.server')>(
    './view-reader.server',
  );
  return {
    ...actual,
    withInventoryViewReader: (
      context: Parameters<typeof actual.withInventoryViewReader>[0],
      read: Parameters<typeof actual.withInventoryViewReader>[1],
    ) =>
      mocks.useActualReader
        ? actual.withInventoryViewReader(context, read)
        : read({ rpc: mocks.rpc } as never),
  };
});
import {
  getInventoryColumns,
  getInventoryView,
  readSelectedPreview,
} from './views.server';
const id = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const row = {
  kind: 'quantity',
  entity_id: id(1),
  name: 'Cable',
  category_name: 'Cables',
  status: 'active',
  location_id: null,
  quantity: 0,
  asset_tag: null,
  serial_number: null,
  recorded_total: null,
  reorder_threshold: null,
  stock_state: 'disabled',
  available_quantity: '9007199254740993',
  assigned_quantity: '3',
  recorded_quantity: '9007199254740996',
};
beforeEach(() => {
  vi.resetAllMocks();
  mocks.useActualReader = false;
  mocks.member.mockResolvedValue({ supabase: { rpc: mocks.rpc } });
  mocks.locations.mockResolvedValue([]);
});
afterEach(() => vi.unstubAllGlobals());

it.each(['headers', 'body'] as const)(
  'retires the in-flight grouped RPC when locations fail with its %s pending',
  async (pendingStage) => {
    mocks.useActualReader = true;
    const actor = id(90),
      failure = new Error('location lookup failed');
    mocks.member.mockResolvedValue({
      member: { user_id: actor },
      supabase: {
        auth: {
          getSession: async () => ({
            data: { session: { access_token: 'fixture-token' } },
            error: null,
          }),
          getUser: async () => ({ data: { user: { id: actor } }, error: null }),
        },
      },
    });
    let fetchReady!: () => void, bodyReady!: () => void, signal!: AbortSignal;
    const fetchStarted = new Promise<void>((resolve) => {
      fetchReady = resolve;
    });
    const bodyStarted = new Promise<void>((resolve) => {
      bodyReady = resolve;
    });
    const cancel = vi.fn();
    const fetcher = vi.fn((_input: URL, init: RequestInit) => {
      signal = init.signal as AbortSignal;
      fetchReady();
      if (pendingStage === 'headers')
        return new Promise<Response>((_resolve, reject) => {
          signal.addEventListener(
            'abort',
            () => reject(new DOMException('Request retired', 'AbortError')),
            { once: true },
          );
        });
      let sent = false;
      const body = new ReadableStream<Uint8Array>(
        {
          pull(controller) {
            if (!sent) {
              sent = true;
              bodyReady();
              controller.enqueue(new TextEncoder().encode('{"rows":'));
            }
          },
          cancel,
        },
        { highWaterMark: 0 },
      );
      return Promise.resolve(new Response(body));
    });
    vi.stubGlobal('fetch', fetcher);
    mocks.locations.mockImplementation(async () => {
      await (pendingStage === 'headers' ? fetchStarted : bodyStarted);
      throw failure;
    });

    await expect(getInventoryView({})).rejects.toBe(failure);
    expect(fetcher).toHaveBeenCalledOnce();
    expect(signal.aborted).toBe(true);
    if (pendingStage === 'body')
      await vi.waitFor(() => expect(cancel).toHaveBeenCalled());
  },
);
it('requests grouping before pagination with every filter and preserves decimal overall totals', async () => {
  mocks.rpc.mockResolvedValue({
    data: {
      rows: [
        {
          row,
          holdings: [row],
          scoped_storage: '0',
          scoped_site: '0',
          holding_count: 0,
        },
      ],
      total: 26,
      holding_rows: 1,
    },
    error: null,
  });
  const result = await getInventoryView({
    q: '%_ literal',
    type: 'quantity',
    status: 'all',
    category: id(2),
    location: 'ITC',
    site: id(3),
    lowStock: 'true',
    page: '2',
  });
  expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith('inventory_grouped_page', {
    p_query: '%_ literal',
    p_type: 'quantity',
    p_status: 'all',
    p_category_id: id(2),
    p_location_code: 'ITC',
    p_site_id: id(3),
    p_page: 2,
    p_low_stock: true,
  });
  expect(result.total).toBe(26);
  expect(result.rows[0].row.availableQuantity).toBe('9007199254740993');
  expect(result.rows[0].holdingCount).toBe(0);
});
it('keeps Holdings on the existing search API and validates complete grouped identity/counts', async () => {
  mocks.rpc.mockResolvedValueOnce({
    data: { rows: [row], total: 99 },
    error: null,
  });
  expect((await getInventoryView({ view: 'holdings' })).unit).toBe(
    'holding row',
  );
  expect(mocks.rpc.mock.calls[0][0]).toBe('inventory_search_v3');
  mocks.rpc.mockResolvedValue({
    data: {
      rows: [
        {
          row,
          holdings: [{ ...row, entity_id: id(8) }],
          scoped_storage: '0',
          scoped_site: '0',
          holding_count: 0,
        },
      ],
      total: 1,
      holding_rows: 1,
    },
    error: null,
  });
  await expect(getInventoryView({})).rejects.toThrow(/did not match/);
});
it.each(['P1025', '57014'])(
  'returns an actionable shell error without partial results on RPC %s',
  async (code) => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code } });
    const result = await getInventoryView({});
    expect(result.error).toBeTruthy();
    expect(result.rows).toEqual([]);
  },
);
it('never converts authorization rejection to an overflow or empty results shell', async () => {
  mocks.rpc.mockResolvedValue({ data: null, error: { code: 'P1001' } });
  await expect(getInventoryView({})).rejects.toThrow();
});
it('suppresses reads for invalid display URLs and never turns membership failure into empty inventory', async () => {
  expect((await getInventoryView({ columns: 'bad' })).rows).toEqual([]);
  await getInventoryColumns({ density: 'bad' });
  expect(mocks.rpc).not.toHaveBeenCalled();
  expect(mocks.member).not.toHaveBeenCalled();
  mocks.member.mockRejectedValue(new Error('Access denied'));
  await expect(getInventoryView({})).rejects.toThrow('Access denied');
});
it('selected previews retain false/zero, missing and legacy flags, with exact field order and no extra identities', async () => {
  const keys = [{ kind: 'quantity' as const, id: id(1) }];
  const fields = [id(2), id(3)];
  const answers = [
    {
      fieldId: id(2),
      label: 'Enabled',
      type: 'boolean',
      displayValue: 'No',
      truncated: false,
      present: true,
      absence: null,
      legacy: true,
    },
    {
      fieldId: id(3),
      label: 'Count',
      type: 'integer',
      displayValue: '0',
      truncated: false,
      present: true,
      absence: null,
      legacy: false,
    },
  ];
  mocks.rpc.mockResolvedValue({
    data: { [`quantity:${id(1)}`]: { answers, truncated: false } },
    error: null,
  });
  expect(
    (await readSelectedPreview({ rpc: mocks.rpc }, keys, fields))[
      `quantity:${id(1)}`
    ].answers,
  ).toEqual(answers);
  mocks.rpc.mockResolvedValue({
    data: {
      [`quantity:${id(1)}`]: {
        answers: [...answers].reverse(),
        truncated: false,
      },
    },
    error: null,
  });
  await expect(
    readSelectedPreview({ rpc: mocks.rpc }, keys, fields),
  ).rejects.toThrow(/fields/);
  await expect(
    readSelectedPreview(
      { rpc: mocks.rpc },
      keys,
      Array.from({ length: 7 }, (_, n) => id(n)),
    ),
  ).rejects.toThrow(/Invalid/);
});

it('accepts SQL code-point label limits and resolves selected fields outside the searched catalog', async () => {
  const field = {
    id: id(2),
    label: '\u{1f600}'.repeat(101),
    category: '\u{1f601}'.repeat(200),
    type: 'boolean',
    legacy: true,
    ordinal: null,
  };
  mocks.rpc.mockResolvedValue({
    data: { fields: [field], truncated: true },
    error: null,
  });
  expect(
    await getInventoryColumns({ columnSearch: 'no match', columns: id(2) }),
  ).toEqual({ fields: [field], truncated: true });
  expect(mocks.rpc).toHaveBeenCalledWith('metadata_inventory_columns', {
    p_query: 'no match',
    p_selected: [id(2)],
  });
  mocks.rpc.mockResolvedValue({
    data: {
      fields: [{ ...field, label: '\u{1f600}'.repeat(201) }],
      truncated: false,
    },
    error: null,
  });
  await expect(getInventoryColumns({})).rejects.toThrow();
});
it.each([
  'unanswered',
  'not_applicable',
  'historical_unavailable',
  'field_unavailable',
])('retains explicit missing-answer state %s', async (absence) => {
  const answer = {
    fieldId: id(2),
    label: 'Enabled',
    type: 'boolean',
    displayValue: 'Unanswered',
    truncated: false,
    present: false,
    legacy: absence === 'historical_unavailable',
    absence,
  };
  mocks.rpc.mockResolvedValue({
    data: { [`quantity:${id(1)}`]: { answers: [answer], truncated: false } },
    error: null,
  });
  expect(
    (
      await readSelectedPreview(
        { rpc: mocks.rpc },
        [{ kind: 'quantity', id: id(1) }],
        [id(2)],
      )
    )[`quantity:${id(1)}`].answers[0],
  ).toEqual(answer);
  mocks.rpc.mockResolvedValue({
    data: {
      [`quantity:${id(1)}`]: {
        answers: [{ ...answer, present: true }],
        truncated: false,
      },
    },
    error: null,
  });
  await expect(
    readSelectedPreview(
      { rpc: mocks.rpc },
      [{ kind: 'quantity', id: id(1) }],
      [id(2)],
    ),
  ).rejects.toThrow();
});

it.each(['group', 'holding'])(
  'rejects duplicate %s identities instead of rendering or adding them twice',
  async (duplicate) => {
    const group = {
      row,
      holdings: duplicate === 'holding' ? [row, row] : [row],
      scoped_storage: '0',
      scoped_site: '0',
      holding_count: 0,
    };
    mocks.rpc.mockResolvedValue({
      data: {
        rows: duplicate === 'group' ? [group, group] : [group],
        total: 1,
        holding_rows: 2,
      },
      error: null,
    });
    await expect(getInventoryView({})).rejects.toThrow(/did not match/);
  },
);

it('rejects oversized complete UTF-8 bodies without rendering partial groups or previews', async () => {
  mocks.rpc.mockResolvedValue({
    data: { unexpected: '😀'.repeat(524289) },
    error: null,
  });
  const result = await getInventoryView({ page: '3' });
  expect(result.rows).toEqual([]);
  expect(result.page).toBe(3);
  expect(result.error).toMatch(/response limit/);
  mocks.rpc.mockResolvedValue({
    data: { unexpected: '😀'.repeat(32769) },
    error: null,
  });
  await expect(
    readSelectedPreview(
      { rpc: mocks.rpc },
      [{ kind: 'quantity', id: id(1) }],
      [id(2)],
    ),
  ).rejects.toThrow(/preview limit/);
});
it('keeps the column picker actionable on catalog overflow while authorization denial still propagates', async () => {
  mocks.rpc.mockResolvedValue({ data: null, error: { code: 'P1025' } });
  expect(await getInventoryColumns({ columnSearch: 'Field' })).toEqual({
    fields: [],
    truncated: false,
    error: expect.stringMatching(/Refine the field/),
  });
  mocks.rpc.mockResolvedValue({ data: null, error: { code: 'P1001' } });
  await expect(getInventoryColumns({})).rejects.toThrow();
});
it('bounds selected previews before requesting more than 25 distinct identities or six fields', async () => {
  const keys = Array.from({ length: 26 }, (_, n) => ({
    kind: 'quantity' as const,
    id: id(n),
  }));
  await expect(
    readSelectedPreview({ rpc: mocks.rpc }, keys, [id(1)]),
  ).rejects.toThrow();
  await expect(
    readSelectedPreview(
      { rpc: mocks.rpc },
      keys.slice(0, 1),
      Array.from({ length: 7 }, (_, n) => id(n)),
    ),
  ).rejects.toThrow();
  expect(mocks.rpc).not.toHaveBeenCalled();
});
