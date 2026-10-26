// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
vi.mock('server-only', () => ({}));
const mocks = vi.hoisted(() => ({
  sdk: vi.fn(),
  user: vi.fn(),
  member: vi.fn(),
  from: vi.fn(),
  get: vi.fn(),
  getAll: vi.fn(),
  set: vi.fn(),
  cookies: vi.fn(),
}));
vi.mock('@supabase/ssr', () => ({ createServerClient: mocks.sdk }));
vi.mock('next/headers', () => ({ cookies: mocks.cookies }));
vi.mock('@/lib/supabase/config', () => ({
  supabaseConfig: () => ({
    url: 'https://backend.example',
    key: 'public-test-key',
  }),
}));
import * as route from './route';

const origin = 'https://actual-preview.example';
const generation = '00000000-0000-4000-8000-000000000001';
const expected = {
  actorId: generation,
  backend: 'https://backend.example',
  role: 'staff',
  canManageConfiguration: true,
};
const read = { operation: 'read-generation' };
const verify = { operation: 'verify-identity', expected };
function request(
  body: unknown = read,
  headers: Record<string, string | null> = {},
  raw?: string | ReadableStream<Uint8Array>,
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
  return new NextRequest(`${origin}/api/auth/privacy-read`, {
    method: 'POST',
    headers: configured,
    body: raw ?? JSON.stringify(body),
  });
}
function privateResponse(response: Response) {
  expect(response.headers.get('cache-control')).toBe('private, no-store');
  expect(response.headers.has('access-control-allow-origin')).toBe(false);
  expect(response.headers.has('set-cookie')).toBe(false);
}
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv('APP_ORIGIN', 'http://localhost:3000');
  vi.stubEnv('VERCEL_ENV', 'development');
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', expected.backend);
  mocks.cookies.mockResolvedValue({
    get: mocks.get,
    getAll: mocks.getAll,
    set: mocks.set,
  });
  mocks.getAll.mockReturnValue([
    { name: 'caller-session', value: 'synthetic caller cookie' },
  ]);
  mocks.user.mockResolvedValue({
    data: { user: { id: expected.actorId } },
    error: null,
  });
  mocks.member.mockResolvedValue({
    data: {
      user_id: expected.actorId,
      display_name: 'Private member name',
      role: 'staff',
      active: true,
      can_manage_configuration: true,
    },
    error: null,
  });
  mocks.from.mockReturnValue({
    select: () => ({ eq: () => ({ maybeSingle: mocks.member }) }),
  });
  mocks.sdk.mockImplementation((_url, _key, options) => ({
    auth: {
      getUser: async () => {
        options.cookies.getAll();
        // Exercise the real SDK bridge: even an attempted refresh must not emit cookies.
        options.cookies.setAll([
          {
            name: 'caller-session',
            value: 'synthetic refreshed cookie',
            options: {},
          },
        ]);
        return mocks.user();
      },
    },
    from: mocks.from,
  }));
});
afterEach(() => vi.unstubAllEnvs());

it.each([undefined, 'v1:' + generation, 'v1:garbage'])(
  'read-generation returns only canonical cookie status for %s',
  async (value) => {
    mocks.get.mockReturnValue(value === undefined ? undefined : { value });
    const response = await route.POST(request());
    expect(await response.json()).toEqual(
      value === undefined
        ? { status: 'absent' }
        : value === 'v1:' + generation
          ? { status: 'valid', generation }
          : { status: 'invalid' },
    );
    privateResponse(response);
    expect(mocks.sdk).not.toHaveBeenCalled();
    expect(mocks.set).not.toHaveBeenCalled();
  },
);
it('read-generation sanitizes unavailable cookie access', async () => {
  mocks.cookies.mockRejectedValue(new Error('SECRET'));
  expect(await (await route.POST(request())).json()).toEqual({
    status: 'unavailable',
  });
  expect(mocks.sdk).not.toHaveBeenCalled();
});
it('identity uses caller cookies and actual membership without writable refresh or private data output', async () => {
  const response = await route.POST(request(verify));
  expect(await response.json()).toEqual({
    status: 'match',
    generation: { status: 'absent' },
  });
  expect(mocks.getAll).toHaveBeenCalledOnce();
  expect(mocks.user).toHaveBeenCalledOnce();
  expect(mocks.from).toHaveBeenCalledWith('app_members');
  expect(mocks.set).not.toHaveBeenCalled();
  privateResponse(response);
});
it('does not trust a supplied backend instead of the server environment', async () => {
  expect(
    await (
      await route.POST(
        request({
          ...verify,
          expected: { ...expected, backend: 'https://other.example' },
        }),
      )
    ).json(),
  ).toEqual({ status: 'denied' });
  expect(mocks.sdk).not.toHaveBeenCalled();
  expect(mocks.cookies).not.toHaveBeenCalled();
});
it.each([
  { actorId: '00000000-0000-4000-8000-000000000002' },
  { role: 'viewer' },
  { canManageConfiguration: false },
])('client expected binding %s cannot grant authority', async (change) => {
  expect(
    await (
      await route.POST(
        request({ ...verify, expected: { ...expected, ...change } }),
      )
    ).json(),
  ).toEqual({ status: 'denied' });
  expect(mocks.get).not.toHaveBeenCalled();
  expect(mocks.set).not.toHaveBeenCalled();
});
it('denies a revoked member without exposing member data', async () => {
  mocks.member.mockResolvedValue({
    data: {
      user_id: expected.actorId,
      role: 'staff',
      active: false,
      display_name: 'SECRET',
    },
    error: null,
  });
  expect(await (await route.POST(request(verify))).json()).toEqual({
    status: 'denied',
  });
  expect(mocks.get).not.toHaveBeenCalled();
});
it('sanitizes provider failure and never authorizes readmission', async () => {
  mocks.user.mockRejectedValue(new Error('SECRET'));
  const response = await route.POST(request(verify));
  expect(await response.json()).toEqual({ status: 'unavailable' });
  privateResponse(response);
  expect(mocks.set).not.toHaveBeenCalled();
});
it.each([
  null,
  'null',
  'https://evil.example',
  origin + '/',
  origin + ', ' + origin,
])('rejects origin %s before every cookie/provider read', async (header) => {
  const response = await route.POST(request(verify, { origin: header }));
  expect(response.status).toBe(403);
  privateResponse(response);
  expect(mocks.cookies).not.toHaveBeenCalled();
  expect(mocks.sdk).not.toHaveBeenCalled();
});
it('rejects forged forwarding and cross-site metadata before provider access', async () => {
  expect(
    (
      await route.POST(
        request(verify, {
          origin: 'https://evil.example',
          'x-forwarded-host': 'evil.example',
        }),
      )
    ).status,
  ).toBe(403);
  expect(
    (await route.POST(request(verify, { 'sec-fetch-site': 'same-site' })))
      .status,
  ).toBe(403);
  expect(mocks.cookies).not.toHaveBeenCalled();
  expect(mocks.sdk).not.toHaveBeenCalled();
});
it.each([
  null,
  [],
  {},
  { operation: 'unknown' },
  { ...read, expected },
  { ...verify, extra: true },
  { ...verify, expected: { ...expected, extra: true } },
  { ...verify, expected: { ...expected, actorId: 'not-uuid' } },
  { ...verify, expected: { ...expected, role: 'admin' } },
  { ...verify, expected: { ...expected, canManageConfiguration: 'true' } },
  ...[
    'https://backend.example/',
    'https://backend.example/path',
    'https://user@backend.example',
    'https://backend.example?x=1',
    'https://backend.example#fragment',
    'https://BACKEND.example',
    'file:///private',
  ].map((backend) => ({ ...verify, expected: { ...expected, backend } })),
])('rejects strict request shape %s before provider access', async (body) => {
  const response = await route.POST(request(body));
  expect(response.status).toBe(400);
  privateResponse(response);
  expect(mocks.cookies).not.toHaveBeenCalled();
  expect(mocks.sdk).not.toHaveBeenCalled();
});
it('requires JSON and never mutates for non-POST methods', async () => {
  expect(
    (await route.POST(request(read, { 'content-type': 'text/plain' }))).status,
  ).toBe(400);
  for (const method of [
    'GET',
    'HEAD',
    'OPTIONS',
    'PUT',
    'PATCH',
    'DELETE',
  ] as const) {
    const response = route[method]();
    expect(response.status).toBe(405);
    privateResponse(response);
  }
  expect(mocks.cookies).not.toHaveBeenCalled();
  expect(mocks.sdk).not.toHaveBeenCalled();
});
it('accepts an exact 256-character canonical backend within its 512-byte body budget', async () => {
  const backend = `https://${'a'.repeat(62)}.${'b'.repeat(60)}.${'c'.repeat(60)}.${'d'.repeat(63)}`;
  expect(backend.length).toBe(256);
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', backend);
  expect(
    (
      await route.POST(
        request({ ...verify, expected: { ...expected, backend } }),
      )
    ).status,
  ).toBe(200);
});
it.each([512, 513])(
  'enforces actual body boundary at %s bytes',
  async (bytes) => {
    const response = await route.POST(
      request(read, {}, JSON.stringify(read).padEnd(bytes)),
    );
    expect(response.status).toBe(bytes === 512 ? 200 : 400);
    if (bytes === 513) expect(mocks.cookies).not.toHaveBeenCalled();
    privateResponse(response);
  },
);
it('counts chunked UTF-8 bytes despite a forged small Content-Length', async () => {
  const cancel = vi.fn();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(
        new TextEncoder().encode('{"operation":"read-generation","x":"'),
      );
      controller.enqueue(new TextEncoder().encode('é'.repeat(256)));
    },
    cancel,
  });
  expect(
    (await route.POST(request(read, { 'content-length': '2' }, stream))).status,
  ).toBe(400);
  expect(cancel).toHaveBeenCalledOnce();
  expect(mocks.cookies).not.toHaveBeenCalled();
  expect(mocks.sdk).not.toHaveBeenCalled();
});
it('retains the hardened actual-loopback origin contract for privacy reads', async () => {
  const input = new NextRequest('http://127.0.0.1:3000/api/auth/privacy-read', {
    method: 'POST',
    headers: {
      origin: 'http://127.0.0.1:3000',
      host: '127.0.0.1:3000',
      'content-type': 'application/json',
    },
    body: JSON.stringify(read),
  });
  expect(input.nextUrl.origin).toBe('http://localhost:3000');
  expect((await route.POST(input)).status).toBe(200);
});
