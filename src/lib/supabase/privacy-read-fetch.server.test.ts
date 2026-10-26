// @vitest-environment node
import { expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { createPrivacyReadFetch } from './privacy-read-fetch.server';

const backend = 'https://backend.example';
it.each([
  ['GET', '/auth/v1/user'],
  ['GET', '/rest/v1/app_members?select=user_id&user_id=eq.original'],
])(
  'allows only configured read endpoint %s %s and refuses redirect following',
  async (method, path) => {
    const outbound = vi.fn<typeof fetch>().mockResolvedValue(Response.json({}));
    const guard = createPrivacyReadFetch(backend, outbound);
    const headers = { Authorization: 'Bearer synthetic' };
    await guard.fetch(backend + path, { method, headers });
    expect(outbound).toHaveBeenCalledExactlyOnceWith(backend + path, {
      method,
      headers,
      redirect: 'error',
    });
    expect(guard.blocked()).toBe(false);
  },
);
it.each([
  ['POST', backend + '/auth/v1/token?grant_type=refresh_token'],
  ['GET', backend + '/auth/v1/token'],
  ['POST', backend + '/auth/v1/user'],
  ['PATCH', backend + '/rest/v1/app_members'],
  ['DELETE', backend + '/rest/v1/app_members'],
  ['GET', backend + '/rest/v1/app_members/'],
  ['GET', backend + '/rest/v1/rpc/anything'],
  ['GET', backend + '/auth/v1/%75ser'],
  ['GET', 'https://other.example/auth/v1/user'],
  ['GET', 'http://backend.example/auth/v1/user'],
  ['GET', 'https://user:password@backend.example/auth/v1/user'],
  ['GET', '/auth/v1/user'],
])(
  'blocks %s %s before the network with a nonretryable local result',
  async (method, url) => {
    const outbound = vi.fn<typeof fetch>();
    const guard = createPrivacyReadFetch(backend, outbound);
    const response = await guard.fetch(url, { method });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      code: 'privacy_read_only',
      message: 'Privacy verification requires a current session.',
    });
    expect(outbound).not.toHaveBeenCalled();
    expect(guard.blocked()).toBe(true);
  },
);
it('checks Request methods and retains blocked evidence only within this client request', async () => {
  const outbound = vi.fn<typeof fetch>().mockResolvedValue(Response.json({}));
  const first = createPrivacyReadFetch(backend, outbound);
  await first.fetch(new Request(backend + '/auth/v1/user', { method: 'POST' }));
  await first.fetch(backend + '/auth/v1/user');
  expect(first.blocked()).toBe(true);
  const second = createPrivacyReadFetch(backend, outbound);
  expect(second.blocked()).toBe(false);
  expect(outbound).toHaveBeenCalledOnce();
});
