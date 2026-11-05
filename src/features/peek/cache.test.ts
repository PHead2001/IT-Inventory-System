import { afterEach, expect, it, vi } from 'vitest';
import { PeekCache, PeekUnavailable } from './cache';
import { PeekNetwork } from './network';
import type { PeekPayload, PeekTarget } from './contracts';
const actor = '00000000-0000-4000-8000-000000000001';
const backend = 'https://inventory.supabase.test';
const target = (n: number): PeekTarget => ({
  kind: 'quantity',
  id: '00000000-0000-4000-8000-' + String(n).padStart(12, '0'),
});
function payload(t: PeekTarget): PeekPayload {
  return {
    target: t,
    name: 'Adapters',
    status: 'active',
    assetTag: null,
    stock: {
      available: '0',
      assigned: '9007199254740993',
      recorded: '9007199254740993',
    },
    locations: [],
    moreLocations: false,
    siteName: null,
    photo: null,
  };
}
function response(t: PeekTarget, scope = actor, environment = backend) {
  return Response.json({
    actor: scope,
    backend: environment,
    payload: payload(t),
  });
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function isolatedCache(
  scope: string,
  environment: string,
  lost: () => void,
  request?: typeof fetch,
  now?: () => number,
) {
  return new PeekCache(
    scope,
    environment,
    lost,
    request,
    now,
    new PeekNetwork(),
  );
}
afterEach(() => vi.useRealTimers());

it('deduplicates the same entity only within the exact pending presentation owner', async () => {
  const pending = deferred<Response>();
  const fetcher = vi.fn<typeof fetch>().mockReturnValue(pending.promise);
  const cache = isolatedCache(actor, backend, vi.fn(), fetcher);
  const ownerCurrent = () => true;
  const deadline = Date.now() + 5000;
  const first = cache.revalidate(target(1), deadline, ownerCurrent);
  const duplicate = cache.revalidate(target(1), deadline, ownerCurrent);
  await Promise.resolve();
  expect(fetcher).toHaveBeenCalledOnce();
  pending.resolve(response(target(1)));
  await expect(Promise.all([first, duplicate])).resolves.toHaveLength(2);
});

it.each(['success', 'forbidden'] as const)(
  'starts a successor same-entity read under its own owner and ignores retired %s',
  async (late) => {
    const previous = deferred<Response>();
    const successor = deferred<Response>();
    const lost = vi.fn();
    const fetcher = vi
      .fn<typeof fetch>()
      .mockReturnValueOnce(previous.promise)
      .mockReturnValueOnce(successor.promise);
    const cache = isolatedCache(actor, backend, lost, fetcher);
    let firstCurrent = true;
    const oldRead = cache
      .revalidate(target(1), Date.now() + 5000, () => firstCurrent)
      .catch((error) => error);
    await Promise.resolve();
    const nextRead = cache.revalidate(target(1), Date.now() + 5000, () => true);
    try {
      firstCurrent = false;
      await Promise.resolve();
      expect(fetcher).toHaveBeenCalledTimes(2);
      expect(fetcher.mock.calls[0][1]?.signal?.aborted).toBe(true);
      expect(fetcher.mock.calls[1][1]?.signal?.aborted).toBe(false);
      successor.resolve(
        Response.json({
          actor,
          backend,
          payload: { ...payload(target(1)), name: 'Successor record' },
        }),
      );
      await expect(nextRead).resolves.toMatchObject({
        name: 'Successor record',
      });
      previous.resolve(
        late === 'forbidden'
          ? new Response('', { status: 403 })
          : Response.json({
              actor,
              backend,
              payload: { ...payload(target(1)), name: 'Retired record' },
            }),
      );
      await oldRead;
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      expect(cache.get(target(1))?.name).toBe('Successor record');
      expect(lost).not.toHaveBeenCalled();
    } finally {
      previous.resolve(response(target(1)));
      successor.resolve(response(target(1)));
      await Promise.allSettled([oldRead, nextRead]);
      cache.dispose();
    }
  },
);

it('deduplicates pending reads, revalidates every open and expires successes without extending on failure', async () => {
  let now = 0;
  const pending = deferred<Response>();
  const fetcher = vi
    .fn<typeof fetch>()
    .mockReturnValueOnce(pending.promise)
    .mockResolvedValueOnce(new Response('', { status: 503 }))
    .mockResolvedValueOnce(response(target(1)));
  const cache = isolatedCache(actor, backend, vi.fn(), fetcher, () => now);
  const first = cache.revalidate(target(1));
  const duplicate = cache.revalidate(target(1));
  await Promise.resolve();
  expect(fetcher).toHaveBeenCalledOnce();
  pending.resolve(response(target(1)));
  await Promise.all([first, duplicate]);
  now = 29999;
  expect(cache.get(target(1))?.stock?.assigned).toBe('9007199254740993');
  await expect(cache.revalidate(target(1))).rejects.toThrow();
  now = 30000;
  expect(cache.get(target(1))).toBeNull();
  await cache.revalidate(target(1));
  expect(fetcher).toHaveBeenCalledTimes(3);
});
it('retains only 50 LRU successes', async () => {
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async (url) =>
    response({
      kind: 'quantity',
      id: new URL(String(url), 'https://app.test').searchParams.get('id')!,
    }),
  );
  const cache = isolatedCache(actor, backend, vi.fn(), fetcher);
  for (let n = 1; n <= 50; n++) await cache.revalidate(target(n));
  cache.get(target(1));
  await cache.revalidate(target(51));
  expect(cache.get(target(1))).not.toBeNull();
  expect(cache.get(target(2))).toBeNull();
});
it.each(['actor', 'backend'])(
  'clears all cached records on server-validated %s mismatch',
  async (mismatch) => {
    const lost = vi.fn();
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response(target(1)))
      .mockResolvedValueOnce(
        response(
          target(2),
          mismatch === 'actor' ? '00000000-0000-4000-8000-000000000003' : actor,
          mismatch === 'backend' ? 'https://other.test' : backend,
        ),
      );
    const cache = isolatedCache(actor, backend, lost, fetcher);
    await cache.revalidate(target(1));
    await expect(cache.revalidate(target(2))).rejects.toThrow();
    expect(lost).toHaveBeenCalledOnce();
    expect(cache.get(target(1))).toBeNull();
  },
);
it('ignores late success and forbidden callbacks from retired requests after invalidation', async () => {
  const old = deferred<Response>();
  const lost = vi.fn();
  const fetcher = vi
    .fn<typeof fetch>()
    .mockReturnValueOnce(old.promise)
    .mockResolvedValueOnce(response(target(2)));
  const cache = isolatedCache(actor, backend, lost, fetcher);
  const stale = cache.revalidate(target(1)).catch(() => null);
  await Promise.resolve();
  cache.clear();
  await cache.revalidate(target(2));
  old.resolve(new Response('', { status: 403 }));
  await stale;
  await Promise.resolve();
  await Promise.resolve();
  expect(cache.get(target(2))?.target).toEqual(target(2));
  expect(lost).not.toHaveBeenCalled();
});
it('does not repopulate cache with a successful response after invalidation', async () => {
  const old = deferred<Response>();
  const cache = isolatedCache(
    actor,
    backend,
    vi.fn(),
    vi.fn<typeof fetch>().mockReturnValue(old.promise),
  );
  const read = cache.revalidate(target(1)).catch(() => null);
  await Promise.resolve();
  cache.clear();
  old.resolve(response(target(1)));
  await read;
  await Promise.resolve();
  await Promise.resolve();
  expect(cache.get(target(1))).toBeNull();
});
it('counts uncooperative API and photo operations until physical settlement and drops stale queued work', async () => {
  const network = new PeekNetwork();
  const api = deferred<string>();
  const photo = deferred<string>();
  const queued = vi.fn(async () => 'visible');
  const expired = vi.fn(async () => 'stale');
  const deadline = Date.now() + 5000;
  const a = new AbortController();
  const b = new AbortController();
  const c = new AbortController();
  const first = network
    .run(() => api.promise, deadline, a.signal)
    .catch(() => null);
  const second = network
    .run(() => photo.promise, deadline, b.signal)
    .catch(() => null);
  await Promise.resolve();
  a.abort();
  b.abort();
  const stale = network.run(expired, deadline, c.signal).catch(() => null);
  c.abort();
  const latest = network.run(queued, deadline);
  await Promise.resolve();
  expect(queued).not.toHaveBeenCalled();
  expect(expired).not.toHaveBeenCalled();
  api.resolve('old');
  await latest;
  expect(queued).toHaveBeenCalledOnce();
  expect(expired).not.toHaveBeenCalled();
  photo.resolve('old');
  await Promise.all([first, second, stale]);
});
it('applies one five-second deadline to fetch plus response JSON consumption', async () => {
  vi.useFakeTimers();
  const body = deferred<unknown>();
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue({
    ok: true,
    status: 200,
    redirected: false,
    json: () => body.promise,
  } as Response);
  const cache = isolatedCache(actor, backend, vi.fn(), fetcher);
  const outcome = cache.revalidate(target(1)).catch((error) => error);
  await vi.advanceTimersByTimeAsync(5000);
  expect(await outcome).toBeInstanceOf(PeekUnavailable);
  body.resolve({ actor, backend, payload: payload(target(1)) });
  await Promise.resolve();
  await Promise.resolve();
  expect(cache.get(target(1))).toBeNull();
});
it('never affects a successor provider after disposal', async () => {
  const old = deferred<Response>();
  const lost = vi.fn();
  const cache = isolatedCache(
    actor,
    backend,
    lost,
    vi.fn<typeof fetch>().mockReturnValue(old.promise),
  );
  const read = cache.revalidate(target(1)).catch(() => null);
  await Promise.resolve();
  cache.dispose();
  old.resolve(new Response('', { status: 403 }));
  await read;
  await Promise.resolve();
  await Promise.resolve();
  expect(lost).not.toHaveBeenCalled();
});
it('retains shared physical slots across disposed actor scopes and cancels only the disposing owner', async () => {
  const scheduler = new PeekNetwork();
  const oldApi = deferred<Response>();
  const oldPhoto = deferred<Blob>();
  const nextApi = deferred<Response>();
  const oldLost = vi.fn();
  const nextLost = vi.fn();
  const previous = new PeekCache(
    actor,
    backend,
    oldLost,
    vi.fn<typeof fetch>().mockReturnValue(oldApi.promise),
    Date.now,
    scheduler,
  );
  const oldRead = previous.revalidate(target(1)).catch(() => null);
  const oldDownload = previous.network
    .run(() => oldPhoto.promise, Date.now() + 5000)
    .catch(() => null);
  await Promise.resolve();
  previous.dispose();
  const nextActor = '00000000-0000-4000-8000-000000000002';
  const nextFetch = vi.fn<typeof fetch>().mockReturnValue(nextApi.promise);
  const successor = new PeekCache(
    nextActor,
    backend,
    nextLost,
    nextFetch,
    Date.now,
    scheduler,
  );
  const nextRead = successor.revalidate(target(2));
  await Promise.resolve();
  expect(nextFetch).not.toHaveBeenCalled();
  oldApi.resolve(new Response('', { status: 403 }));
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  expect(nextFetch).toHaveBeenCalledOnce();
  const successorSignal = nextFetch.mock.calls[0][1]?.signal;
  previous.dispose();
  previous.accessLost();
  expect(successorSignal?.aborted).toBe(false);
  nextApi.resolve(response(target(2), nextActor));
  await nextRead;
  oldPhoto.resolve(new Blob(['old bytes']));
  await Promise.all([oldRead, oldDownload]);
  expect(successor.get(target(2))?.name).toBe('Adapters');
  expect(oldLost).not.toHaveBeenCalled();
  expect(nextLost).not.toHaveBeenCalled();
});

it('checks the exact presentation owner before dispatch and again before cache commit', async () => {
  const hold = deferred<Response>();
  const fetcher = vi.fn<typeof fetch>().mockReturnValue(hold.promise);
  const cache = isolatedCache(actor, backend, vi.fn(), fetcher);
  let allowed = false;
  await expect(
    cache.revalidate(target(1), Date.now() + 5000, () => allowed),
  ).rejects.toThrow();
  expect(fetcher).not.toHaveBeenCalled();
  allowed = true;
  const pending = cache.revalidate(target(1), Date.now() + 5000, () => allowed);
  await Promise.resolve();
  allowed = false;
  hold.resolve(response(target(1)));
  await expect(pending).rejects.toThrow();
  expect(cache.get(target(1))).toBeNull();
});

it.each(['401', '403', '404', 'actor', 'backend', 'late-body'] as const)(
  'ignores deadline-retired %s side effects and accepts a subsequent valid read',
  async (mode) => {
    vi.useFakeTimers();
    const pending = deferred<Response>(),
      body = deferred<unknown>(),
      lost = vi.fn();
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response(target(1)))
      .mockImplementationOnce(() =>
        mode === 'late-body'
          ? Promise.resolve({
              ok: true,
              status: 200,
              redirected: false,
              json: () => body.promise,
            } as Response)
          : pending.promise,
      )
      .mockResolvedValueOnce(response(target(1)));
    const cache = isolatedCache(actor, backend, lost, fetcher);
    await cache.revalidate(target(1));
    const attempt = cache
      .revalidate(target(1), Date.now() + 5000)
      .catch((error) => error);
    await vi.advanceTimersByTimeAsync(5000);
    expect(await attempt).toBeInstanceOf(PeekUnavailable);
    if (mode === 'late-body')
      body.resolve({
        actor: '00000000-0000-4000-8000-000000000002',
        backend,
        payload: payload(target(1)),
      });
    else
      pending.resolve(
        mode === 'actor'
          ? response(target(1), '00000000-0000-4000-8000-000000000002')
          : mode === 'backend'
            ? response(target(1), actor, 'https://changed.test')
            : new Response('', { status: Number(mode) }),
      );
    await vi.advanceTimersByTimeAsync(0);
    expect(lost).not.toHaveBeenCalled();
    expect(cache.get(target(1))?.name).toBe('Adapters');
    await expect(cache.revalidate(target(1))).resolves.toMatchObject({
      name: 'Adapters',
    });
  },
);
