// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  readLogoutPrivacyGeneration,
  readProtectedPrivacyIdentity,
} from './privacy-read-transport';
import { authTransportTimeoutMs } from './auth-post';
const fetchMock = vi.fn();
const generation = '00000000-0000-4000-8000-000000000001';
const expected = {
  actorId: generation,
  backend: 'https://backend.example',
  role: 'staff',
  canManageConfiguration: true,
};
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
it.each([
  { status: 'absent' },
  { status: 'invalid' },
  { status: 'unavailable' },
  { status: 'valid', generation },
])(
  'returns only generation result %s through independent POST',
  async (body) => {
    fetchMock.mockResolvedValue(Response.json(body));
    expect(await readLogoutPrivacyGeneration()).toEqual(body);
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/auth/privacy-read',
      expect.objectContaining({
        method: 'POST',
        credentials: 'same-origin',
        cache: 'no-store',
        redirect: 'error',
        body: JSON.stringify({ operation: 'read-generation' }),
        signal: expect.any(AbortSignal),
      }),
    );
  },
);
it('posts an expected binding and returns only server identity outcome', async () => {
  const result = {
    status: 'match',
    generation: { status: 'valid', generation },
  };
  fetchMock.mockResolvedValue(Response.json(result));
  expect(await readProtectedPrivacyIdentity(expected)).toEqual(result);
  expect(fetchMock.mock.calls[0][1].body).toBe(
    JSON.stringify({ operation: 'verify-identity', expected }),
  );
});
it.each([{ status: 'denied' }, { status: 'unavailable' }])(
  'preserves identity status %s',
  async (result) => {
    fetchMock.mockResolvedValue(Response.json(result));
    expect(await readProtectedPrivacyIdentity(expected)).toEqual(result);
  },
);
it.each([
  { ...expected, actorId: 'invalid' },
  { ...expected, backend: expected.backend + '/' },
  { ...expected, role: 'admin' },
])('rejects invalid expected binding %s before HTTP', async (binding) => {
  expect(await readProtectedPrivacyIdentity(binding)).toEqual({
    status: 'unavailable',
  });
  expect(fetchMock).not.toHaveBeenCalled();
});
it.each([
  { status: 'valid', generation: 'invalid' },
  { status: 'absent', token: 'SECRET' },
  { status: 'match', generation: { status: 'absent' } },
])('rejects unsafe generation result %s', async (result) => {
  fetchMock.mockResolvedValue(Response.json(result));
  expect(await readLogoutPrivacyGeneration()).toEqual({
    status: 'unavailable',
  });
});
it.each([
  { status: 'match', generation: { status: 'valid', generation: 'invalid' } },
  { status: 'match', generation: { status: 'absent' }, inventory: [] },
  { status: 'denied', credentials: 'SECRET' },
])('rejects unsafe identity result %s', async (result) => {
  fetchMock.mockResolvedValue(Response.json(result));
  expect(await readProtectedPrivacyIdentity(expected)).toEqual({
    status: 'unavailable',
  });
});
it.each(['http', 'oversize', 'type', 'throw'] as const)(
  'sanitizes %s failure for privacy reads',
  async (kind) => {
    if (kind === 'throw') fetchMock.mockRejectedValue(new Error('SECRET'));
    else if (kind === 'http')
      fetchMock.mockResolvedValue(
        Response.json({ status: 'absent' }, { status: 403 }),
      );
    else
      fetchMock.mockImplementation(
        () =>
          new Response(
            kind === 'oversize' ? '{"status":"absent"}'.padEnd(1025) : 'SECRET',
            {
              headers: {
                'content-type':
                  kind === 'type' ? 'text/html' : 'application/json',
              },
            },
          ),
      );
    expect(await readLogoutPrivacyGeneration()).toEqual({
      status: 'unavailable',
    });
    expect(await readProtectedPrivacyIdentity(expected)).toEqual({
      status: 'unavailable',
    });
  },
);
it('cancels a superseded read without waiting for a stalled fetch or granting admission', async () => {
  const controller = new AbortController();
  fetchMock.mockReturnValue(new Promise(() => {}));
  const pending = readProtectedPrivacyIdentity(expected, controller.signal);
  controller.abort();
  expect(await pending).toEqual({ status: 'unavailable' });
  expect(fetchMock.mock.calls[0][1].signal.aborted).toBe(true);
});
it('never dispatches an already cancelled privacy read', async () => {
  const signal = AbortSignal.abort();
  expect(await readLogoutPrivacyGeneration(signal)).toEqual({
    status: 'unavailable',
  });
  expect(fetchMock).not.toHaveBeenCalled();
});
it.each(['fetch', 'body'] as const)(
  'bounds a stalled %s to ten seconds',
  async (stage) => {
    vi.useFakeTimers();
    if (stage === 'fetch') fetchMock.mockReturnValue(new Promise(() => {}));
    else
      fetchMock.mockResolvedValue(
        new Response(new ReadableStream(), {
          headers: { 'content-type': 'application/json' },
        }),
      );
    const pending = readLogoutPrivacyGeneration();
    await vi.advanceTimersByTimeAsync(authTransportTimeoutMs);
    expect(await pending).toEqual({ status: 'unavailable' });
  },
);
