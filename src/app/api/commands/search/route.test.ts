import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
const mocks = vi.hoisted(() => ({
  client: vi.fn(),
  user: vi.fn(),
  member: vi.fn(),
  rpc: vi.fn(),
  abort: vi.fn(),
}));
vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: mocks.client,
}));
import { POST } from './route';
const result = { version: 1, rows: [], hasMore: false };
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://backend.example');
  mocks.user.mockResolvedValue({
    data: { user: { id: 'actor' } },
    error: null,
  });
  mocks.member.mockResolvedValue({
    data: {
      user_id: 'actor',
      display_name: 'Staff',
      active: true,
      role: 'staff',
    },
    error: null,
  });
  mocks.abort.mockResolvedValue({ data: result, error: null });
  mocks.rpc.mockReturnValue({ abortSignal: mocks.abort });
  mocks.client.mockResolvedValue({
    auth: { getUser: mocks.user },
    from: () => ({
      select: () => ({
        eq: () => ({
          abortSignal: (signal: AbortSignal) => ({
            maybeSingle: () => mocks.member(signal),
          }),
        }),
      }),
    }),
    rpc: mocks.rpc,
  });
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
  vi.restoreAllMocks();
});
function request(
  body: unknown = { query: 'laptop' },
  origin = 'https://inventory.example',
  signal?: AbortSignal,
) {
  return new NextRequest('https://inventory.example/api/commands/search', {
    method: 'POST',
    headers: { origin, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });
}
it('uses caller SDK and bounded parsed arguments and returns private no-store identity', async () => {
  const response = await POST(request({ query: ' Camera ', scope: 'all' }));
  expect(response.status).toBe(200);
  expect(response.headers.get('cache-control')).toBe('private, no-store');
  expect(mocks.rpc).toHaveBeenCalledWith('command_palette_search_v1', {
    p_query: 'Camera',
    p_scope: 'all',
    p_purpose: 'all',
  });
  expect(mocks.abort).toHaveBeenCalledWith(expect.any(AbortSignal));
  expect((await response.json()).identity.actorId).toBe('actor');
});
it.each([401, 403])(
  'rejects missing session or inactive membership (%s) before search',
  async (status) => {
    if (status === 401)
      mocks.user.mockResolvedValue({ data: { user: null }, error: null });
    else
      mocks.member.mockResolvedValue({
        data: { user_id: 'actor', active: false, role: 'staff' },
        error: null,
      });
    expect((await POST(request())).status).toBe(status);
    expect(mocks.rpc).not.toHaveBeenCalled();
  },
);
it('preserves viewer access, distinguishes failed membership reads, and rejects foreign origin', async () => {
  mocks.member.mockResolvedValue({
    data: { user_id: 'actor', active: true, role: 'viewer' },
    error: null,
  });
  expect((await POST(request())).status).toBe(200);
  mocks.member.mockResolvedValue({ data: null, error: { message: 'offline' } });
  expect((await POST(request())).status).toBe(503);
  expect((await POST(request({}, 'https://foreign.example'))).status).toBe(403);
});
it.each([
  ['P1001', 403],
  ['P1012', 400],
  ['57014', 504],
  ['read_error', 503],
  ['PGRST301', 401],
  ['PGRST302', 401],
  ['PGRST303', 401],
  ['42501', 403],
])('shows %s as an error, never no matches', async (code, status) => {
  mocks.abort.mockResolvedValue({ data: null, error: { code } });
  const response = await POST(request());
  expect(response.status).toBe(status);
  expect(await response.json()).toHaveProperty('error');
});

it.each([
  [{ status: 401 }, 401],
  [{ status: 403 }, 403],
  [{ name: 'AuthSessionMissingError' }, 401],
  [{ status: 503, name: 'AuthRetryableFetchError' }, 503],
  [{ message: 'Network unavailable' }, 503],
])(
  'classifies Auth prerequisite %j as %s without searching',
  async (error, status) => {
    mocks.user.mockResolvedValue({ data: { user: null }, error });
    const response = await POST(request());
    expect(response.status).toBe(status);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(mocks.member).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  },
);
it.each([
  ['PGRST301', 401],
  ['PGRST302', 401],
  ['PGRST303', 401],
  ['42501', 403],
  ['P1001', 403],
  ['offline', 503],
])('preserves membership denial %s as %s', async (code, status) => {
  mocks.member.mockResolvedValue({ data: null, error: { code } });
  expect((await POST(request())).status).toBe(status);
  expect(mocks.rpc).not.toHaveBeenCalled();
});
it.each(['member', 'rpc'] as const)(
  'preserves HTTP-only 401/403 denial from %s',
  async (stage) => {
    const target = stage === 'member' ? mocks.member : mocks.abort;
    for (const status of [401, 403]) {
      target.mockResolvedValue({
        data: null,
        error: { message: 'Denied' },
        status,
      });
      expect((await POST(request())).status).toBe(status);
    }
  },
);
it.each(['client', 'user', 'member', 'rpc'] as const)(
  'the shared deadline bounds stalled %s and retires late results',
  async (stage) => {
    vi.useFakeTimers();
    const target =
      stage === 'client'
        ? mocks.client
        : stage === 'user'
          ? mocks.user
          : stage === 'member'
            ? mocks.member
            : mocks.abort;
    const ordinary = await target();
    target.mockClear();
    let finish!: (value: typeof ordinary) => void;
    target.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const timers = vi.spyOn(globalThis, 'setTimeout');
    const pending = POST(request());
    await vi.waitFor(() => expect(target).toHaveBeenCalledOnce());
    const signal = mocks.client.mock.calls[0][2] as AbortSignal;
    expect(timers).toHaveBeenCalledWith(expect.any(Function), 8000);
    expect(signal.aborted).toBe(false);
    await vi.advanceTimersToNextTimerAsync();
    const response = await pending;
    expect(response.status).toBe(504);
    expect(signal.aborted).toBe(true);
    finish(ordinary);
    await Promise.resolve();
    if (stage === 'client' || stage === 'user')
      expect(mocks.member).not.toHaveBeenCalled();
    if (stage !== 'rpc') expect(mocks.rpc).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  },
);
it.each(['user', 'member', 'rpc'] as const)(
  'request cancellation fences stalled %s and its downstream work',
  async (stage) => {
    const target =
      stage === 'user'
        ? mocks.user
        : stage === 'member'
          ? mocks.member
          : mocks.abort;
    target.mockReturnValue(new Promise(() => {}));
    const controller = new AbortController();
    const pending = POST(
      request({ query: 'laptop' }, undefined, controller.signal),
    );
    await vi.waitFor(() => expect(target).toHaveBeenCalledOnce());
    controller.abort();
    const response = await pending;
    expect(response.status).toBe(499);
    expect((mocks.client.mock.calls[0][2] as AbortSignal).aborted).toBe(true);
    if (stage === 'user') expect(mocks.member).not.toHaveBeenCalled();
    if (stage !== 'rpc') expect(mocks.rpc).not.toHaveBeenCalled();
  },
);
it('shares the original deadline across Auth and membership instead of restarting it', async () => {
  vi.useFakeTimers();
  const timers = vi.spyOn(globalThis, 'setTimeout');
  let finishAuth!: () => void;
  mocks.user.mockReturnValue(
    new Promise((resolve) => {
      finishAuth = () =>
        resolve({ data: { user: { id: 'actor' } }, error: null });
    }),
  );
  mocks.member.mockReturnValue(new Promise(() => {}));
  const pending = POST(request());
  await vi.waitFor(() => expect(mocks.user).toHaveBeenCalledOnce());
  await vi.advanceTimersByTimeAsync(6000);
  finishAuth();
  await vi.waitFor(() => expect(mocks.member).toHaveBeenCalledOnce());
  expect(timers.mock.calls.filter(([, delay]) => delay === 8000)).toHaveLength(
    1,
  );
  expect(mocks.member.mock.calls[0][0]).toBe(mocks.client.mock.calls[0][2]);
  await vi.advanceTimersToNextTimerAsync();
  expect((await pending).status).toBe(504);
  expect(mocks.rpc).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
});
it('does not start caller SDK work for an already cancelled request', async () => {
  const controller = new AbortController();
  controller.abort();
  expect(
    (await POST(request({ query: 'laptop' }, undefined, controller.signal)))
      .status,
  ).toBe(499);
  expect(mocks.client).not.toHaveBeenCalled();
});
it('rejects malformed, oversized, and invalid search without dispatch', async () => {
  for (const body of [
    { query: 'a'.repeat(5000) },
    { query: 'a\n' },
    { query: 'x', scope: 'other' },
    { query: 'x', purpose: 'hidden' },
  ])
    expect((await POST(request(body))).status).toBe(400);
  const raw = new NextRequest('https://inventory.example/api/commands/search', {
    method: 'POST',
    headers: { origin: 'https://inventory.example' },
    body: '{bad',
  });
  expect((await POST(raw)).status).toBe(400);
  expect(mocks.rpc).not.toHaveBeenCalled();
});
it.each(['move', 'print'])(
  'forwards the validated %s purpose before database ranking',
  async (purpose) => {
    expect((await POST(request({ query: 'crowd', purpose }))).status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith('command_palette_search_v1', {
      p_query: 'crowd',
      p_scope: 'active',
      p_purpose: purpose,
    });
  },
);
it('rejects invalid result shape and thrown transport errors', async () => {
  mocks.abort.mockResolvedValue({ data: { rows: [] }, error: null });
  expect((await POST(request())).status).toBe(503);
  mocks.abort.mockRejectedValue(new Error('offline'));
  expect((await POST(request())).status).toBe(503);
});

it.each(['https://BACKEND.example:443/', 'https://backend.example/path/'])(
  'returns canonical backend origin for equivalent configured URL %s',
  async (configured) => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', configured);
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect((await response.json()).identity).toEqual({
      actorId: 'actor',
      backend: 'https://backend.example',
    });
  },
);
it.each(['', 'not a URL', 'mailto:backend@example.com'])(
  'fails closed for invalid backend configuration %s',
  async (configured) => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', configured);
    expect((await POST(request())).status).toBe(503);
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.user).not.toHaveBeenCalled();
  },
);
