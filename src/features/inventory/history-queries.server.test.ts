import { afterEach, beforeEach, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/config', () => ({
  supabaseConfig: () => ({
    url: 'https://configured-backend.test/ignored',
    key: 'public-test-key',
  }),
}));
const m = vi.hoisted(() => ({
  rpc: vi.fn(),
  member: vi.fn(),
  locations: vi.fn(),
  categories: vi.fn(),
  useActualReader: false,
}));
vi.mock('@/lib/auth/session.server', () => ({ requireMember: m.member }));
vi.mock('./history-reader.server', async () => {
  const actual = await vi.importActual<
    typeof import('./history-reader.server')
  >('./history-reader.server');
  return {
    ...actual,
    withHistoryReader: (
      context: Parameters<typeof actual.withHistoryReader>[0],
      read: Parameters<typeof actual.withHistoryReader>[1],
    ) =>
      m.useActualReader
        ? actual.withHistoryReader(context, read)
        : read({ rpc: m.rpc } as never),
  };
});
vi.mock('./queries.server', () => ({
  getLocations: m.locations,
  getCategories: m.categories,
}));
import {
  getFilteredHistory,
  getHistoryActors,
  HistoryAccessDeniedError,
} from './history-queries.server';
beforeEach(() => {
  vi.resetAllMocks();
  m.useActualReader = false;
  m.member.mockResolvedValue({ supabase: { rpc: m.rpc } });
  m.rpc.mockResolvedValue({ data: { rows: [], total: 0 }, error: null });
  m.locations.mockResolvedValue([]);
  m.categories.mockResolvedValue([]);
});
afterEach(() => vi.unstubAllGlobals());

it.each(
  ['locations', 'categories'].flatMap((lookup) =>
    [401, 403, 42501].map((denial) => ({ lookup, denial })),
  ),
)(
  'surfaces known $denial while $lookup is pending, retiring the actual reader before late references settle',
  async ({ lookup, denial }) => {
    vi.useFakeTimers();
    m.useActualReader = true;
    const actor = '00000000-0000-4000-8000-000000000001';
    m.member.mockResolvedValue({
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
    let finish!: (value: unknown[]) => void;
    m[lookup as 'locations' | 'categories'].mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    let signal!: AbortSignal;
    const fetcher = vi.fn((_url: URL, init: RequestInit) => {
      signal = init.signal as AbortSignal;
      return Promise.resolve(
        Response.json(
          { code: denial === 42501 ? '42501' : 'P1025' },
          { status: denial === 42501 ? 400 : denial },
        ),
      );
    });
    vi.stubGlobal('fetch', fetcher);
    const publish = vi.fn();
    let failure: unknown;
    const task = getFilteredHistory().then(publish, (error) => {
      failure = error;
    });
    try {
      // No five-second timer advance and no reference resolution may be needed
      // to surface the explicit denial already received from the real reader.
      await vi.advanceTimersByTimeAsync(0);
      expect(failure).toBeInstanceOf(HistoryAccessDeniedError);
      expect(signal.aborted).toBe(true);
      expect(vi.getTimerCount()).toBe(0);
      expect(publish).not.toHaveBeenCalled();
      const original = failure;
      finish([]);
      await task;
      await Promise.resolve();
      expect(failure).toBe(original);
      expect(publish).not.toHaveBeenCalled();
    } finally {
      finish?.([]);
      await task;
      vi.useRealTimers();
    }
  },
);

it.each([
  ['locations', 'headers'],
  ['locations', 'body'],
  ['categories', 'headers'],
  ['categories', 'body'],
] as const)(
  'retires the actual history RPC when %s fail with %s pending',
  async (lookup, pendingStage) => {
    m.useActualReader = true;
    const actor = '00000000-0000-4000-8000-000000000001',
      failure = new Error(`${lookup} lookup failed`);
    m.member.mockResolvedValue({
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
    let started!: () => void, cancelled!: () => void, signal!: AbortSignal;
    const ready = new Promise<void>((resolve) => {
      started = resolve;
    });
    const bodyCancelled = new Promise<void>((resolve) => {
      cancelled = resolve;
    });
    const cancel = vi.fn(() => cancelled());
    const fetcher = vi.fn((_input: URL, init: RequestInit) => {
      signal = init.signal as AbortSignal;
      if (pendingStage === 'headers') {
        started();
        return new Promise<Response>((_resolve, reject) => {
          signal.addEventListener(
            'abort',
            () => reject(new DOMException('Request retired', 'AbortError')),
            { once: true },
          );
        });
      }
      let sent = false;
      return Promise.resolve(
        new Response(
          new ReadableStream<Uint8Array>(
            {
              pull(controller) {
                if (!sent) {
                  sent = true;
                  controller.enqueue(new TextEncoder().encode('{"rows":'));
                  started();
                }
              },
              cancel,
            },
            { highWaterMark: 0 },
          ),
        ),
      );
    });
    vi.stubGlobal('fetch', fetcher);
    m[lookup].mockImplementation(async () => {
      await ready;
      throw failure;
    });

    await expect(getFilteredHistory()).rejects.toBe(failure);
    expect(fetcher).toHaveBeenCalledOnce();
    expect(fetcher.mock.calls[0][0]).toEqual(
      new URL(
        'https://configured-backend.test/rest/v1/rpc/inventory_history_v2',
      ),
    );
    expect(signal.aborted).toBe(true);
    if (pendingStage === 'body') {
      await bodyCancelled;
      expect(cancel).toHaveBeenCalledOnce();
    }
    expect(m.locations).toHaveBeenCalledOnce();
    expect(m.categories).toHaveBeenCalledOnce();
  },
);
it('queries the filtered page with all normalized filters and fixed event page size', async () => {
  expect(
    await getFilteredHistory({
      q: 'literal%_',
      eventType: 'movements',
      page: '2',
    }),
  ).toEqual({ rows: [], total: 0, page: 2, pageSize: 25 });
  expect(m.rpc).toHaveBeenCalledExactlyOnceWith('inventory_history_v2', {
    p_type: 'all',
    p_entity_id: null,
    p_location_code: null,
    p_query: 'literal%_',
    p_actor_id: null,
    p_event_type: 'movements',
    p_from: null,
    p_until: null,
    p_page: 2,
    p_page_size: 25,
  });
});
it('does not send invalid dates or identities as omitted filters', async () => {
  await expect(getFilteredHistory({ actor: 'bad' })).rejects.toThrow(
    'History filters are invalid.',
  );
  expect(m.rpc).not.toHaveBeenCalled();
});
it('resolves selected historical actor outside a capped/search page without reading a directory', async () => {
  const selected = '00000000-0000-4000-8000-000000000001';
  await getHistoryActors('Alex', selected, 3);
  expect(m.rpc).toHaveBeenCalledWith('inventory_history_actors', {
    p_query: 'Alex',
    p_selected_id: selected,
    p_page: 3,
  });
});
it('keeps query failures distinct from zero results', async () => {
  m.rpc.mockResolvedValue({ data: null, error: { code: '57014' } });
  await expect(getFilteredHistory()).rejects.toThrow(
    'History could not be loaded.',
  );
  await expect(getHistoryActors()).rejects.toThrow(
    'People in history could not be loaded.',
  );
});

it.each([{ code: '42501' }, { status: 401 }, { status: 403 }])(
  'propagates owned access denial without an empty fallback %#',
  async (error) => {
    m.rpc.mockResolvedValue({ data: null, error });
    await expect(getHistoryActors()).rejects.toThrow('History access denied.');
    await expect(getFilteredHistory()).rejects.toThrow(
      'History access denied.',
    );
  },
);
it.each(['P1025', 'P1013'])(
  'offers actionable narrowing on %s without partial data',
  async (code) => {
    m.rpc.mockResolvedValue({ data: null, error: { code } });
    await expect(getFilteredHistory()).rejects.toThrow('Narrow the filters');
  },
);
