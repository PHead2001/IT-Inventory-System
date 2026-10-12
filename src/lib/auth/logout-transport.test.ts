// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  signOutSession,
  acknowledgeLogoutPrivacyGeneration,
  logoutTransportTimeoutMs,
} from './logout-transport';
import { logoutUnknownMessage } from './logout-contract';
const generation = '00000000-0000-4000-8000-000000000001';
const fetchMock = vi.fn();
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
it('sends cookie-scoped independent JSON fetches with no redirects or cache', async () => {
  fetchMock.mockResolvedValueOnce(
    Response.json({ ok: true, logoutGeneration: generation }),
  );
  expect(await signOutSession()).toEqual({
    ok: true,
    logoutGeneration: generation,
  });
  expect(fetchMock).toHaveBeenCalledWith(
    '/api/auth/logout',
    expect.objectContaining({
      method: 'POST',
      credentials: 'same-origin',
      cache: 'no-store',
      redirect: 'error',
      body: '{}',
      headers: { 'Content-Type': 'application/json' },
      signal: expect.any(AbortSignal),
    }),
  );
  fetchMock.mockResolvedValueOnce(Response.json({ status: 'match' }));
  expect(await acknowledgeLogoutPrivacyGeneration(generation)).toEqual({
    status: 'match',
  });
  expect(fetchMock).toHaveBeenLastCalledWith(
    '/api/auth/privacy-confirm',
    expect.objectContaining({ body: JSON.stringify({ generation }) }),
  );
});
it.each([
  { ok: true },
  { ok: true, logoutGeneration: 'invalid' },
  { ok: true, logoutGeneration: generation, token: 'SECRET' },
  { ok: true, logoutGeneration: generation, cleanupReminderUnavailable: true },
  { ok: false, message: 'SECRET' },
  { status: 'match' },
])('never interprets malformed logout receipt %s as success', async (body) => {
  fetchMock.mockResolvedValue(Response.json(body));
  expect(await signOutSession()).toEqual({
    ok: false,
    message: logoutUnknownMessage,
  });
});
it('preserves explicit reminder-unavailable success', async () => {
  fetchMock.mockResolvedValue(
    Response.json({ ok: true, cleanupReminderUnavailable: true }),
  );
  expect(await signOutSession()).toEqual({
    ok: true,
    cleanupReminderUnavailable: true,
  });
});
it.each(['throw', 'http', 'redirect', 'oversize', 'wrong-type'] as const)(
  'treats %s response as UNKNOWN',
  async (kind) => {
    if (kind === 'throw' || kind === 'redirect')
      fetchMock.mockRejectedValue(new Error('SECRET'));
    else if (kind === 'http')
      fetchMock.mockResolvedValue(
        Response.json(
          { ok: true, logoutGeneration: generation },
          { status: 403 },
        ),
      );
    else if (kind === 'wrong-type')
      fetchMock.mockResolvedValue(
        new Response('{}', { headers: { 'content-type': 'text/html' } }),
      );
    else
      fetchMock.mockResolvedValue(
        new Response(
          JSON.stringify({ ok: true, logoutGeneration: generation }).padEnd(
            1025,
          ),
          { headers: { 'content-type': 'application/json' } },
        ),
      );
    expect(await signOutSession()).toEqual({
      ok: false,
      message: logoutUnknownMessage,
    });
  },
);
it.each(['fetch', 'body'] as const)(
  'bounds stalled %s without claiming cancellation proof',
  async (stage) => {
    vi.useFakeTimers();
    if (stage === 'fetch') fetchMock.mockReturnValue(new Promise(() => {}));
    else
      fetchMock.mockResolvedValue(
        new Response(new ReadableStream(), {
          headers: { 'content-type': 'application/json' },
        }),
      );
    const pending = signOutSession();
    await vi.advanceTimersByTimeAsync(logoutTransportTimeoutMs);
    expect(await pending).toEqual({ ok: false, message: logoutUnknownMessage });
    expect(fetchMock.mock.calls[0][1].signal.aborted).toBe(true);
  },
);
it('fails closed without fetching invalid generation input', async () => {
  expect(await acknowledgeLogoutPrivacyGeneration('bad')).toEqual({
    status: 'invalid',
  });
  expect(fetchMock).not.toHaveBeenCalled();
});
it.each([
  { status: 'match', token: 'SECRET' },
  { status: 'changed', generation: 'bad' },
  { status: 'absent' },
])('rejects invalid comparison %s', async (body) => {
  fetchMock.mockResolvedValue(Response.json(body));
  expect(await acknowledgeLogoutPrivacyGeneration(generation)).toEqual({
    status: 'unavailable',
  });
});
it('returns a changed generation for bounded cleanup restart', async () => {
  const later = '00000000-0000-4000-8000-000000000002';
  fetchMock.mockResolvedValue(
    Response.json({ status: 'changed', generation: later }),
  );
  expect(await acknowledgeLogoutPrivacyGeneration(generation)).toEqual({
    status: 'changed',
    generation: later,
  });
});
