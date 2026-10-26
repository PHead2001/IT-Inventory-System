// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
vi.mock('server-only', () => ({}));
const mocks = vi.hoisted(() => ({
  client: vi.fn(),
  signOut: vi.fn(),
  cookies: vi.fn(),
  get: vi.fn(),
  set: vi.fn(),
}));
vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: mocks.client,
}));
vi.mock('next/headers', () => ({ cookies: mocks.cookies }));
import * as logout from './route';
import * as compare from '../privacy-confirm/route';
import {
  logoutFailureMessage,
  logoutUnknownMessage,
} from '@/lib/auth/logout-contract';

const origin = 'https://commit-preview.example:8443';
const generation = '00000000-0000-4000-8000-000000000001';
const later = '00000000-0000-4000-8000-000000000002';
const endpoints = [
  { path: 'logout', route: logout, body: {} },
  { path: 'privacy-confirm', route: compare, body: { generation } },
] as const;
function request(
  path: string,
  body: string | ReadableStream<Uint8Array>,
  headers: Record<string, string | null> = {},
  method = 'POST',
) {
  const configured = new Headers({
    origin,
    'content-type': 'application/json',
    'sec-fetch-site': 'same-origin',
  });
  for (const [key, value] of Object.entries(headers)) {
    if (value === null) configured.delete(key);
    else configured.set(key, value);
  }
  return new NextRequest(`${origin}/api/auth/${path}`, {
    method,
    headers: configured,
    ...(method === 'POST' ? { body, duplex: 'half' } : {}),
  });
}
function expectPrivate(response: Response) {
  expect(response.headers.get('cache-control')).toBe('private, no-store');
  expect(response.headers.has('access-control-allow-origin')).toBe(false);
}
beforeEach(() => {
  vi.resetAllMocks();
  // Canonical branch origin does not authorize/reject the actual preview alias.
  vi.stubEnv('APP_ORIGIN', 'https://branch-preview.example');
  mocks.client.mockResolvedValue({ auth: { signOut: mocks.signOut } });
  mocks.signOut.mockResolvedValue({ error: null });
  mocks.cookies.mockResolvedValue({ get: mocks.get, set: mocks.set });
  mocks.get.mockReturnValue({ value: `v1:${generation}` });
});
afterEach(() => vi.unstubAllEnvs());

for (const endpoint of endpoints) {
  it.each(['127.0.0.1', '[::1]'])(
    `${endpoint.path} restores exact literal %s origin after real NextURL normalization`,
    async (literal) => {
      for (const protocol of ['http:', 'https:']) {
        const actualOrigin = `${protocol}//${literal}:3000`;
        const input = new NextRequest(
          `${actualOrigin}/api/auth/${endpoint.path}`,
          {
            method: 'POST',
            headers: {
              origin: actualOrigin,
              host: `${literal}:3000`,
              'content-type': 'application/json',
            },
            body: JSON.stringify(endpoint.body),
          },
        );
        expect(input.nextUrl.hostname).toBe('localhost');
        expect(input.nextUrl.origin).toBe(`${protocol}//localhost:3000`);
        const response = await endpoint.route.POST(input);
        expect(response.status).toBe(200);
        expectPrivate(response);
      }
    },
  );
  it.each([
    { host: null, origin: 'http://127.0.0.1:3000' },
    { host: '127.0.0.1:3000', origin: 'http://localhost:3000' },
    { host: '[::1]:3000', origin: 'http://localhost:3000' },
    { host: 'localhost:3000', origin: 'http://127.0.0.1:3000' },
    { host: '127.0.0.1:3001', origin: 'http://127.0.0.1:3001' },
    { host: '127.0.0.1', origin: 'http://127.0.0.1' },
    { host: '127.0.0.1:3000', origin: 'https://127.0.0.1:3000' },
    { host: '127.0.0.2:3000', origin: 'http://127.0.0.2:3000' },
    { host: '[0:0:0:0:0:0:0:1]:3000', origin: 'http://[::1]:3000' },
    { host: 'user@127.0.0.1:3000', origin: 'http://localhost:3000' },
    { host: '127.0.0.1:3000/path', origin: 'http://localhost:3000' },
    { host: '127.0.0.1:3000?query=1', origin: 'http://localhost:3000' },
    { host: '127.0.0.1:3000#fragment', origin: 'http://localhost:3000' },
    { host: '127.0.0.1:3000, localhost:3000', origin: 'http://localhost:3000' },
    { host: '127.0.0.1:03000', origin: 'http://localhost:3000' },
    { host: '127.0.0.1:65536', origin: 'http://localhost:3000' },
    { host: '127.0.0.1.evil.example:3000', origin: 'http://localhost:3000' },
    { host: 'evil.example:3000', origin: 'http://localhost:3000' },
  ])(
    `${endpoint.path} rejects loopback authority mismatch $host / $origin`,
    async ({ host, origin: submitted }) => {
      const headers = new Headers({
        origin: submitted,
        'content-type': 'application/json',
        'x-forwarded-host': '127.0.0.1:3000',
      });
      if (host !== null) headers.set('host', host);
      const input = new NextRequest(
        `http://127.0.0.1:3000/api/auth/${endpoint.path}`,
        { method: 'POST', headers, body: JSON.stringify(endpoint.body) },
      );
      const response = await endpoint.route.POST(input);
      expect(response.status).toBe(403);
      expectPrivate(response);
      expect(mocks.client).not.toHaveBeenCalled();
      expect(mocks.cookies).not.toHaveBeenCalled();
    },
  );
  it.each([
    null,
    'null',
    'not a URL',
    'https://evil.example',
    'http://commit-preview.example:8443',
    'https://commit-preview.example',
    `${origin}/`,
    `${origin}/path`,
    `${origin}?query=1`,
    `${origin}#fragment`,
    `https://user@commit-preview.example:8443`,
    `${origin}, ${origin}`,
  ])(
    `${endpoint.path} rejects origin %s before cookie access`,
    async (header) => {
      const response = await endpoint.route.POST(
        request(endpoint.path, JSON.stringify(endpoint.body), {
          origin: header,
        }),
      );
      expect(response.status).toBe(403);
      expectPrivate(response);
      expect(mocks.client).not.toHaveBeenCalled();
      expect(mocks.cookies).not.toHaveBeenCalled();
    },
  );
  it.each(['cross-site', 'same-site', 'none', '', 'same-origin, same-origin'])(
    `${endpoint.path} rejects Sec-Fetch-Site %s`,
    async (site) => {
      const response = await endpoint.route.POST(
        request(endpoint.path, JSON.stringify(endpoint.body), {
          'sec-fetch-site': site,
        }),
      );
      expect(response.status).toBe(403);
      expectPrivate(response);
      expect(mocks.cookies).not.toHaveBeenCalled();
      expect(mocks.client).not.toHaveBeenCalled();
    },
  );
  it(`${endpoint.path} does not trust forged forwarding headers`, async () => {
    const response = await endpoint.route.POST(
      request(endpoint.path, '{}', {
        origin: 'https://evil.example',
        'x-forwarded-host': 'evil.example',
        'x-forwarded-proto': 'https',
        host: 'evil.example',
      }),
    );
    expect(response.status).toBe(403);
    expect(mocks.cookies).not.toHaveBeenCalled();
    expect(mocks.client).not.toHaveBeenCalled();
  });
  it.each(['text/plain', 'application/x-www-form-urlencoded', null])(
    `${endpoint.path} requires JSON (%s)`,
    async (type) => {
      const response = await endpoint.route.POST(
        request(endpoint.path, JSON.stringify(endpoint.body), {
          'content-type': type,
        }),
      );
      expect(response.status).toBe(400);
      expectPrivate(response);
      expect(mocks.cookies).not.toHaveBeenCalled();
      expect(mocks.client).not.toHaveBeenCalled();
    },
  );
  it.each(['null', '[]', '"string"', '{', '{"unexpected":true}'])(
    `${endpoint.path} rejects invalid body %s`,
    async (body) => {
      const response = await endpoint.route.POST(request(endpoint.path, body));
      expect(response.status).toBe(400);
      expectPrivate(response);
      expect(mocks.cookies).not.toHaveBeenCalled();
      expect(mocks.client).not.toHaveBeenCalled();
    },
  );
  it(`${endpoint.path} counts chunked UTF-8 bytes despite forged Content-Length`, async () => {
    const cancel = vi.fn();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{"x":"'));
        controller.enqueue(new TextEncoder().encode('é'.repeat(126)));
        // 258 bytes already exceeds the bound before a third chunk is read.
      },
      cancel,
    });
    const response = await endpoint.route.POST(
      request(endpoint.path, stream, { 'content-length': '2' }),
    );
    expect(response.status).toBe(400);
    expect(cancel).toHaveBeenCalledOnce();
    expect(mocks.cookies).not.toHaveBeenCalled();
    expect(mocks.client).not.toHaveBeenCalled();
  });
  it(`${endpoint.path} accepts exactly 256 bytes and absent fetch metadata`, async () => {
    const raw = JSON.stringify(endpoint.body);
    const response = await endpoint.route.POST(
      request(endpoint.path, raw.padEnd(256), {
        'sec-fetch-site': null,
      }),
    );
    expect(response.status).toBe(200);
    expectPrivate(response);
  });
  it(`${endpoint.path} rejects 257 actual bytes`, async () => {
    const response = await endpoint.route.POST(
      request(endpoint.path, JSON.stringify(endpoint.body).padEnd(257)),
    );
    expect(response.status).toBe(400);
    expect(mocks.cookies).not.toHaveBeenCalled();
    expect(mocks.client).not.toHaveBeenCalled();
  });
  it(`${endpoint.path} rejects malformed UTF-8`, async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([0xff]));
        controller.close();
      },
    });
    expect(
      (await endpoint.route.POST(request(endpoint.path, stream))).status,
    ).toBe(400);
    expect(mocks.cookies).not.toHaveBeenCalled();
  });
  it(`${endpoint.path} never mutates on GET or another method`, async () => {
    for (const method of [
      'GET',
      'HEAD',
      'OPTIONS',
      'PUT',
      'PATCH',
      'DELETE',
    ] as const) {
      const response = endpoint.route[method]();
      expect(response.status).toBe(405);
      expect(response.headers.get('allow')).toBe('POST');
      expectPrivate(response);
    }
    expect(
      (await endpoint.route.POST(request(endpoint.path, '', {}, 'GET'))).status,
    ).toBe(405);
    expect(mocks.cookies).not.toHaveBeenCalled();
    expect(mocks.client).not.toHaveBeenCalled();
  });
}

it('logout delegates writable caller cookies, local signout and retained receipt generation', async () => {
  const response = await logout.POST(request('logout', '{}'));
  const result = await response.json();
  expect(result).toEqual({ ok: true, logoutGeneration: expect.any(String) });
  expect(mocks.client).toHaveBeenCalledWith(true);
  expect(mocks.signOut).toHaveBeenCalledWith({ scope: 'local' });
  expect(mocks.set).toHaveBeenCalledWith(
    '__Host-inventory-logout-v1',
    `v1:${result.logoutGeneration}`,
    {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      secure: true,
      maxAge: 31536000,
    },
  );
  expectPrivate(response);
});
it.each(['provider', 'transport'] as const)(
  'logout sanitizes %s failure and never creates a receipt',
  async (failure) => {
    if (failure === 'provider')
      mocks.signOut.mockResolvedValue({ error: { message: 'SECRET' } });
    else mocks.signOut.mockRejectedValue(new Error('SECRET'));
    const response = await logout.POST(request('logout', '{}'));
    expect(await response.json()).toEqual({
      ok: false,
      message:
        failure === 'provider' ? logoutFailureMessage : logoutUnknownMessage,
    });
    expect(mocks.cookies).not.toHaveBeenCalled();
    expect(mocks.set).not.toHaveBeenCalled();
    expectPrivate(response);
  },
);
it('confirmed logout retains success when reminder writing fails', async () => {
  mocks.set.mockImplementation(() => {
    throw new Error('SECRET');
  });
  expect(await (await logout.POST(request('logout', '{}'))).json()).toEqual({
    ok: true,
    cleanupReminderUnavailable: true,
  });
});
it.each([generation, later])(
  'comparison reads the existing cookie without consuming or replacing %s',
  async (value) => {
    mocks.get.mockReturnValue({ value: `v1:${value}` });
    const response = await compare.POST(
      request('privacy-confirm', JSON.stringify({ generation })),
    );
    expect(await response.json()).toEqual(
      value === generation
        ? { status: 'match' }
        : { status: 'changed', generation: value },
    );
    expect(mocks.set).not.toHaveBeenCalled();
    expect(mocks.client).not.toHaveBeenCalled();
  },
);
it.each([{}, { generation: 'not-uuid' }, { generation, extra: true }])(
  'comparison rejects invalid generation payload %s',
  async (body) => {
    expect(
      (await compare.POST(request('privacy-confirm', JSON.stringify(body))))
        .status,
    ).toBe(400);
    expect(mocks.cookies).not.toHaveBeenCalled();
  },
);
it('comparison reports cookie uncertainty without provider access or cookie writes', async () => {
  mocks.cookies.mockRejectedValue(new Error('SECRET'));
  expect(
    await (
      await compare.POST(
        request('privacy-confirm', JSON.stringify({ generation })),
      )
    ).json(),
  ).toEqual({ status: 'unavailable' });
  expect(mocks.client).not.toHaveBeenCalled();
  expect(mocks.set).not.toHaveBeenCalled();
});
