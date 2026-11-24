import { afterEach, beforeEach, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/config', () => ({
  supabaseConfig: () => ({
    url: 'https://configured-backend.test/ignored',
    key: 'public-test-key',
  }),
}));
import type { requireMember } from '@/lib/auth/session.server';
import {
  withInventoryViewReader,
  ViewReadDeadlineError,
  type ViewReadClient,
} from './view-reader.server';
const actor = '00000000-0000-4000-8000-000000000001';
const session = vi.fn(),
  user = vi.fn(),
  fetcher = vi.fn();
const context = () =>
  ({
    member: { user_id: actor },
    supabase: { auth: { getSession: session, getUser: user } },
  }) as unknown as Awaited<ReturnType<typeof requireMember>>;
beforeEach(() => {
  session.mockReset().mockResolvedValue({
    data: { session: { access_token: 'fixture-token', user: { id: actor } } },
    error: null,
  });
  user
    .mockReset()
    .mockResolvedValue({ data: { user: { id: actor } }, error: null });
  fetcher
    .mockReset()
    .mockImplementation(async () => Response.json({ rows: [] }));
  vi.stubGlobal('fetch', fetcher);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
it('verifies the same token with Auth before fixed-origin no-store nonredirecting caller reads', async () => {
  const result = await withInventoryViewReader(context(), (client) =>
    Promise.resolve(client.rpc('inventory_grouped_page', { p_query: 'Cable' })),
  );
  expect(result).toEqual({ data: { rows: [] }, error: null });
  expect(fetcher.mock.calls[0][1].signal.aborted).toBe(true);
  expect(user).toHaveBeenCalledExactlyOnceWith('fixture-token');
  expect(fetcher).toHaveBeenCalledExactlyOnceWith(
    new URL(
      'https://configured-backend.test/rest/v1/rpc/inventory_grouped_page',
    ),
    expect.objectContaining({
      method: 'POST',
      redirect: 'error',
      cache: 'no-store',
      headers: expect.objectContaining({
        Authorization: 'Bearer fixture-token',
        apikey: 'public-test-key',
      }),
      body: JSON.stringify({ p_query: 'Cable' }),
      signal: expect.any(AbortSignal),
    }),
  );
});
it.each([
  'forged session user',
  'changed token actor',
  'Auth error',
  'missing token',
])('does not trust %s or start a private data request', async (kind) => {
  if (kind === 'missing token')
    session.mockResolvedValue({ data: { session: null }, error: null });
  else
    user.mockResolvedValue({
      data: { user: { id: 'other-actor' } },
      error: kind === 'Auth error' ? { message: 'denied' } : null,
    });
  if (kind === 'changed token actor')
    session.mockResolvedValue({
      data: {
        session: { access_token: 'changed-fixture-token', user: { id: actor } },
      },
      error: null,
    });
  await expect(
    withInventoryViewReader(context(), (client) =>
      Promise.resolve(client.rpc('inventory_grouped_page', {})),
    ),
  ).rejects.toThrow('authentication could not be verified');
  expect(fetcher).not.toHaveBeenCalled();
  if (kind === 'changed token actor')
    expect(user).toHaveBeenCalledWith('changed-fixture-token');
});
it('keeps the read RPC set closed before issuing fetch', async () => {
  await expect(
    withInventoryViewReader(context(), (client) =>
      Promise.resolve(client.rpc('inventory_mutation' as never, {})),
    ),
  ).rejects.toThrow('Unsupported inventory read');
  expect(fetcher).not.toHaveBeenCalled();
});
it.each([401, 403])(
  'preserves HTTP %s denial even if its error body claims an overflow',
  async (status) => {
    fetcher.mockImplementation(async () =>
      Response.json({ code: 'P1025' }, { status }),
    );
    const result = await withInventoryViewReader(context(), (client) =>
      Promise.resolve(client.rpc('inventory_grouped_page', {})),
    );
    expect(result).toEqual({
      data: null,
      error: { code: 'access_denied', status },
    });
  },
);
it('propagates a current RLS denial and retains an actual database timeout code', async () => {
  for (const code of ['P1001', '57014']) {
    fetcher.mockImplementation(async () =>
      Response.json({ code }, { status: 400 }),
    );
    expect(
      await withInventoryViewReader(context(), (client) =>
        Promise.resolve(client.rpc('inventory_grouped_page', {})),
      ),
    ).toEqual({ data: null, error: { code, status: 400 } });
  }
});

it.each(['headers', 'body'] as const)(
  'retires a pending sibling after early success with %s pending and closes the retained client',
  async (pendingStage) => {
    let started!: () => void,
      cancelled!: () => void,
      signal!: AbortSignal,
      retained!: ViewReadClient,
      pending!: Promise<unknown>;
    const ready = new Promise<void>((resolve) => {
      started = resolve;
    });
    const bodyCancelled = new Promise<void>((resolve) => {
      cancelled = resolve;
    });
    const cancel = vi.fn(() => cancelled());
    fetcher.mockImplementation((_input: URL, init: RequestInit) => {
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
    const result = { complete: true };
    await expect(
      withInventoryViewReader(context(), async (client) => {
        retained = client;
        pending = Promise.resolve(
          client.rpc('inventory_grouped_page', {}),
        ).catch((error: unknown) => error);
        await ready;
        return result;
      }),
    ).resolves.toBe(result);
    expect(signal.aborted).toBe(true);
    if (pendingStage === 'headers')
      await expect(pending).resolves.toMatchObject({ name: 'AbortError' });
    else await expect(pending).resolves.toBeInstanceOf(ViewReadDeadlineError);
    if (pendingStage === 'body') {
      await bodyCancelled;
      expect(cancel).toHaveBeenCalledOnce();
    }
    await expect(
      retained.rpc('inventory_grouped_page', {}),
    ).rejects.toBeInstanceOf(ViewReadDeadlineError);
    expect(fetcher).toHaveBeenCalledOnce();
  },
);
it.each(['success', 'failure'] as const)(
  'contains cancellation failure for a response arriving after callback %s without replacing the settled result',
  async (outcome) => {
    let started!: () => void,
      deliver!: (response: Response) => void,
      pending!: Promise<unknown>;
    const ready = new Promise<void>((resolve) => {
      started = resolve;
    });
    fetcher.mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          deliver = resolve;
          started();
        }),
    );
    const result = { complete: true },
      failure = new Error('aggregate failed'),
      cancel = vi.fn().mockRejectedValue(new Error('body cleanup failed'));
    const task = withInventoryViewReader(context(), async (client) => {
      pending = Promise.resolve(client.rpc('inventory_grouped_page', {})).catch(
        (error: unknown) => error,
      );
      await ready;
      if (outcome === 'failure') throw failure;
      return result;
    });
    if (outcome === 'failure') await expect(task).rejects.toBe(failure);
    else await expect(task).resolves.toBe(result);
    expect(fetcher.mock.calls[0][1].signal.aborted).toBe(true);
    deliver(new Response(new ReadableStream({ cancel })));
    await expect(pending).resolves.toBeInstanceOf(ViewReadDeadlineError);
    expect(cancel).toHaveBeenCalledOnce();
    if (outcome === 'failure') await expect(task).rejects.toBe(failure);
    else await expect(task).resolves.toBe(result);
  },
);
const encoded = (padding: number) =>
  new TextEncoder().encode(
    JSON.stringify({
      rows: [
        { metadata: '😀"\n', count: '9007199254740993' },
        { metadata: 'second' },
      ],
      padding: 'x'.repeat(padding),
    }),
  );
it.each([-1, 0, 1])(
  'enforces the complete UTF8 preview wire limit at boundary %+i including metadata and separators',
  async (delta) => {
    const limit = 131072,
      body = encoded(limit - encoded(0).byteLength + delta),
      cancel = vi.fn();
    fetcher.mockImplementation(
      async () =>
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(body.subarray(0, 31));
              controller.enqueue(body.subarray(31));
              if (delta <= 0) controller.close();
            },
            cancel,
          }),
        ),
    );
    const result = await withInventoryViewReader(context(), (client) =>
      Promise.resolve(client.rpc('metadata_selected_preview', {})),
    );
    expect(body.byteLength).toBe(limit + delta);
    if (delta > 0) {
      expect(result).toMatchObject({ data: null, error: { code: 'P1025' } });
      expect(cancel).toHaveBeenCalled();
    } else
      expect(result).toMatchObject({
        data: {
          rows: [
            { metadata: '😀"\n', count: '9007199254740993' },
            { metadata: 'second' },
          ],
        },
        error: null,
      });
  },
);
it('stops an oversized error response at 64KiB without parsing it as success', async () => {
  const cancel = vi.fn();
  fetcher.mockImplementation(
    async () =>
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new Uint8Array(65537).fill(65));
          },
          cancel,
        }),
        { status: 500 },
      ),
  );
  const result = await withInventoryViewReader(context(), (client) =>
    Promise.resolve(client.rpc('metadata_inventory_columns', {})),
  );
  expect(result).toEqual({
    data: null,
    error: { code: 'read_failed', status: 500 },
  });
  expect(cancel).toHaveBeenCalled();
});
it('withdraws an already-denied response before its invalid or delayed body can become an unavailable result', async () => {
  const cancel = vi.fn();
  fetcher.mockImplementation(
    async () =>
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new Uint8Array([255]));
          },
          cancel,
        }),
        { status: 403 },
      ),
  );
  expect(
    await withInventoryViewReader(context(), (client) =>
      Promise.resolve(client.rpc('inventory_grouped_page', {})),
    ),
  ).toEqual({ data: null, error: { code: 'access_denied', status: 403 } });
  expect(cancel).toHaveBeenCalled();
});
it('rejects invalid UTF8 without producing parsed inventory', async () => {
  fetcher.mockImplementation(
    async () =>
      new Response(new Uint8Array([123, 34, 120, 34, 58, 34, 255, 34, 125])),
  );
  await expect(
    withInventoryViewReader(context(), (client) =>
      Promise.resolve(client.rpc('inventory_grouped_page', {})),
    ),
  ).rejects.toThrow();
});
it.each([
  ['inventory_grouped_page', 2097152],
  ['inventory_search_v3', 2097152],
  ['metadata_inventory_columns', 524288],
] as const)(
  'uses the declared raw cap for %s below, at and above the complete response',
  async (name, limit) => {
    for (const delta of [-1, 0, 1]) {
      const body = encoded(limit - encoded(0).byteLength + delta),
        cancel = vi.fn();
      fetcher.mockImplementation(
        async () =>
          new Response(
            new ReadableStream<Uint8Array>({
              start(controller) {
                controller.enqueue(body);
                if (delta <= 0) controller.close();
              },
              cancel,
            }),
          ),
      );
      const result = await withInventoryViewReader(context(), (client) =>
        Promise.resolve(client.rpc(name, {})),
      );
      expect(body.byteLength).toBe(limit + delta);
      if (delta > 0) {
        expect(result).toMatchObject({ data: null, error: { code: 'P1025' } });
        expect(cancel).toHaveBeenCalled();
      } else expect(result.error).toBeNull();
    }
  },
);
it('aborts a delayed raw body at the client deadline and cancels its locked stream', async () => {
  vi.useFakeTimers();
  const cancel = vi.fn();
  let started!: () => void;
  const ready = new Promise<void>((resolve) => {
    started = resolve;
  });
  fetcher.mockImplementation(async () => {
    started();
    return new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('{"rows":'));
        },
        cancel,
      }),
    );
  });
  const task = withInventoryViewReader(context(), (client) =>
    Promise.resolve(client.rpc('inventory_grouped_page', {})),
  );
  const assertion = expect(task).rejects.toBeInstanceOf(ViewReadDeadlineError);
  await ready;
  await vi.advanceTimersByTimeAsync(5001);
  await assertion;
  expect(cancel).toHaveBeenCalled();
  expect(fetcher.mock.calls[0][1].signal.aborted).toBe(true);
});
it('retires delayed Auth verification without issuing a request when its late result arrives', async () => {
  vi.useFakeTimers();
  let finish!: (value: unknown) => void;
  user.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const task = withInventoryViewReader(context(), (client) =>
    Promise.resolve(client.rpc('inventory_grouped_page', {})),
  );
  const assertion = expect(task).rejects.toBeInstanceOf(ViewReadDeadlineError);
  await vi.advanceTimersByTimeAsync(5001);
  await assertion;
  finish({ data: { user: { id: actor } }, error: null });
  await Promise.resolve();
  expect(fetcher).not.toHaveBeenCalled();
});
