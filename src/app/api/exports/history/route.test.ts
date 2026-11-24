import { beforeEach, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
const m = vi.hoisted(() => ({
  client: vi.fn(),
  user: vi.fn(),
  session: vi.fn(),
  member: vi.fn(),
  snapshot: vi.fn(),
  record: vi.fn(),
}));
vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: m.client,
}));
vi.mock('@/lib/supabase/config', () => ({
  supabaseConfig: () => ({
    url: 'https://backend.test',
    key: 'public-test-key',
  }),
}));
vi.mock('@/features/inventory/queries.server', () => ({
  getHistoryRecord: m.record,
}));
vi.mock('@/features/inventory/history-reader.server', () => ({
  HistoryReadDeadlineError: class extends Error {},
  HistoryReadActorChangedError: class extends Error {},
  withHistoryReader: async (
    context: {
      supabase: {
        auth: { getUser: typeof m.user; getSession: typeof m.session };
      };
      member: { user_id: string };
    },
    read: (client: {
      rpc: (rpc: string, payload: unknown) => Promise<unknown>;
    }) => Promise<unknown>,
    signal: AbortSignal,
  ) => {
    const session = await context.supabase.auth.getSession();
    const verified = await context.supabase.auth.getUser(
      session.data.session?.access_token,
    );
    if (verified.error || verified.data.user?.id !== context.member.user_id)
      throw new Error('not verified');
    return read({
      rpc: (rpc, payload) =>
        m.snapshot({
          rpc,
          payload,
          accessToken: session.data.session?.access_token,
          signal,
        }),
    });
  },
}));
import { GET } from './route';
const id = '00000000-0000-4000-8000-000000000001';
const request = (search = '') =>
  new Request('https://app.test/api/exports/history' + search);
beforeEach(() => {
  const query = { select: () => query, eq: () => query, maybeSingle: m.member };
  m.client.mockResolvedValue({
    auth: { getUser: m.user, getSession: m.session },
    from: () => query,
  });
  m.user.mockResolvedValue({ data: { user: { id } }, error: null });
  m.session.mockResolvedValue({
    data: { session: { access_token: 'test-token' } },
    error: null,
  });
  m.member.mockResolvedValue({
    data: { user_id: id, display_name: 'Viewer', role: 'viewer', active: true },
    error: null,
  });
  m.snapshot.mockResolvedValue({
    data: {
      rows: [],
      event_count: 0,
      row_count: 0,
      exported_at: '2026-10-10T12:00:00.123456Z',
    },
  });
  m.record.mockResolvedValue({ id, kind: 'quantity', name: 'Adapters' });
});
it('exports applied filters with caller token, bounded snapshot API, private caching and independent counts', async () => {
  const response = await GET(
    request(
      '?actor=' +
        id +
        '&eventType=movements&from=2026-10-01T00:00:00.123456Z&until=2026-10-02T00:00:00Z&q=%25_%5C&zone=America%2FChicago&page=2',
    ),
  );
  expect(response.status).toBe(200);
  expect(response.headers.get('Cache-Control')).toContain('no-store');
  expect(response.headers.get('Content-Disposition')).toContain('history-');
  expect(response.headers.get('X-History-Snapshot-At')).toBe(
    '2026-10-10T12:00:00.123456Z',
  );
  expect(response.headers.get('X-History-Event-Count')).toBe('0');
  expect(response.headers.get('X-History-Data-Row-Count')).toBe('0');
  const input = m.snapshot.mock.calls[0][0];
  expect(input.rpc).toBe('inventory_history_export_snapshot');
  expect(input.accessToken).toBe('test-token');
  expect(input.payload).toEqual({
    p_type: 'all',
    p_entity_id: null,
    p_actor_id: id,
    p_location_code: null,
    p_query: '%_\\',
    p_event_type: 'movements',
    p_from: '2026-10-01T00:00:00.123456Z',
    p_until: '2026-10-02T00:00:00.000Z',
  });
});
it.each([
  '?from=invalid',
  '?actor=bad',
  '?entityId=',
  '?type=quantity&eventType=retired',
  '?type=asset&eventType=received',
  '?from=2026-10-01T00:00:00.1234567Z',
  '?from=2026-10-02T00:00:00Z&until=2026-10-01T00:00:00Z',
])(
  'rejects invalid filters without requesting a broadened snapshot',
  async (search) => {
    const result = await GET(request(search));
    expect(result.status).toBe(400);
    expect(m.snapshot).not.toHaveBeenCalled();
  },
);
it.each([
  ['quantity', 'asset', 'retired'],
  ['asset', 'quantity', 'received'],
])(
  'rejects event incompatibility after reconciling the actual %s record kind',
  async (kind, requestedType, eventType) => {
    m.record.mockResolvedValue({ id, kind, name: 'Record' });
    const response = await GET(
      request(`?entityId=${id}&type=${requestedType}&eventType=${eventType}`),
    );
    expect(response.status).toBe(400);
    expect(response.headers.get('X-Inventory-Export-Error')).toBe(
      'invalid_history_filters',
    );
    expect(m.snapshot).not.toHaveBeenCalled();
  },
);
it.each([
  ['quantity', 'asset', 'received'],
  ['asset', 'quantity', 'retired'],
])(
  'accepts an event supported by the actual %s record after reconciliation',
  async (kind, requestedType, eventType) => {
    m.record.mockResolvedValue({ id, kind, name: 'Record' });
    expect(
      (
        await GET(
          request(
            `?entityId=${id}&type=${requestedType}&eventType=${eventType}`,
          ),
        )
      ).status,
    ).toBe(200);
    expect(m.snapshot.mock.calls[0][0].payload).toMatchObject({
      p_type: kind,
      p_event_type: eventType,
      p_entity_id: id,
    });
  },
);
it('preserves unrelated invalid input after record reconciliation', async () => {
  expect(
    (
      await GET(
        request(`?entityId=${id}&type=asset&eventType=received&from=invalid`),
      )
    ).status,
  ).toBe(400);
  expect(m.snapshot).not.toHaveBeenCalled();
});
it('keeps unavailable record scope and reconciles a known record kind', async () => {
  m.record.mockResolvedValueOnce(null);
  expect((await GET(request('?entityId=' + id))).status).toBe(404);
  expect(m.snapshot).not.toHaveBeenCalled();
  expect((await GET(request('?entityId=' + id + '&type=asset'))).status).toBe(
    200,
  );
  expect(m.snapshot.mock.calls[0][0].payload).toMatchObject({
    p_type: 'quantity',
    p_entity_id: id,
  });
});
it.each([
  ['P1013', 413, 'export_row_limit'],
  ['P1025', 413, 'export_too_large'],
  ['57014', 503, 'export_timeout'],
  ['55P03', 503, 'export_timeout'],
])(
  'returns bounded %s failures with no CSV attachment',
  async (code, status, label) => {
    m.snapshot.mockResolvedValue({ data: null, error: { code } });
    const result = await GET(request());
    expect(result.status).toBe(status);
    expect(result.headers.get('X-Inventory-Export-Error')).toBe(label);
    expect(result.headers.has('Content-Disposition')).toBe(false);
  },
);
it.each(['staff', 'viewer'])('permits active %s exports', async (role) => {
  m.member.mockResolvedValue({
    data: { user_id: id, display_name: 'Person', role, active: true },
    error: null,
  });
  expect((await GET(request())).status).toBe(200);
});
it.each([
  null,
  { user_id: id, display_name: 'Person', role: 'staff', active: false },
])('denies inactive or nonmember callers', async (data) => {
  m.member.mockResolvedValue({ data, error: null });
  expect((await GET(request())).status).toBe(403);
  expect(m.snapshot).not.toHaveBeenCalled();
});
it('denies anonymous callers before reading membership or snapshot', async () => {
  m.user.mockResolvedValue({ data: { user: null }, error: null });
  expect((await GET(request())).status).toBe(401);
  expect(m.member).not.toHaveBeenCalled();
  expect(m.snapshot).not.toHaveBeenCalled();
});
it('enforces the application deadline even if an upstream request never settles', async () => {
  vi.useFakeTimers();
  const timer = vi.spyOn(AbortSignal, 'timeout').mockImplementation((ms) => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), ms);
    return controller.signal;
  });
  try {
    m.snapshot.mockImplementation(() => new Promise(() => {}));
    const result = GET(request());
    await vi.advanceTimersByTimeAsync(10001);
    const response = await result;
    expect(response.status).toBe(503);
    expect(response.headers.has('Content-Disposition')).toBe(false);
  } finally {
    timer.mockRestore();
    vi.useRealTimers();
  }
});
it('abort after snapshot response cannot return a late attachment', async () => {
  const controller = new AbortController();
  m.snapshot.mockImplementation(async () => {
    controller.abort();
    return {
      data: {
        rows: [],
        event_count: 0,
        row_count: 0,
        exported_at: '2026-10-10T12:00:00Z',
      },
    };
  });
  const response = await GET(
    new Request('https://app.test/api/exports/history', {
      signal: controller.signal,
    }),
  );
  expect(response.status).toBe(503);
  expect(response.headers.has('Content-Disposition')).toBe(false);
});

it.each([{ code: '42501' }, { status: 401 }, { status: 403 }])(
  'keeps current database/HTTP denial distinct from empty history %#',
  async (error) => {
    m.snapshot.mockResolvedValue({ data: null, error });
    const response = await GET(request());
    expect(response.status).toBe(403);
    expect(response.headers.get('X-Inventory-Export-Error')).toBe(
      'access_denied',
    );
    expect(response.headers.has('Content-Disposition')).toBe(false);
  },
);
