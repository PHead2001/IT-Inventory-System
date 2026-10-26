// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
vi.mock('server-only', () => ({}));
const jar = vi.hoisted(() => ({
  values: new Map<string, string>(),
  writes: vi.fn(),
}));
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) =>
      jar.values.has(name) ? { value: jar.values.get(name) } : undefined,
    getAll: () => [...jar.values].map(([name, value]) => ({ name, value })),
    set: (name: string, value: string, options: { maxAge?: number } = {}) => {
      jar.writes(name, value, options);
      if (!value || options.maxAge === 0) jar.values.delete(name);
      else jar.values.set(name, value);
    },
  }),
}));
// The installed SSR, Supabase, Auth and PostgREST SDKs remain real.
import {
  createSupabaseServerClient,
  createSupabasePrivacyReadClient,
} from '@/lib/supabase/server';
import { recordConfirmedLogout } from './privacy-barrier.server';
import { POST } from '@/app/api/auth/privacy-read/route';

const backend = 'https://backend.example';
const actor = '00000000-0000-4000-8000-000000000001';
const other = '00000000-0000-4000-8000-000000000002';
const expected = {
  actorId: actor,
  backend,
  role: 'staff',
  canManageConfiguration: true,
};
const member = {
  user_id: actor,
  display_name: 'Synthetic member',
  role: 'staff',
  active: true,
  can_manage_configuration: true,
};
const user = {
  id: actor,
  aud: 'authenticated',
  role: 'authenticated',
  email: 'synthetic@example.test',
  app_metadata: {},
  user_metadata: {},
  created_at: '2026-10-11T00:00:00Z',
};
const outbound = vi.fn<typeof fetch>();
let access: string;
function jwt(exp: number) {
  const encode = (value: unknown) =>
    Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ sub: actor, exp, iat: Math.floor(Date.now() / 1000), aud: 'authenticated', role: 'authenticated', session_id: actor })}.synthetic-signature`;
}
function json(value: unknown, status = 200) {
  return Response.json(value, { status });
}
function path(input: Parameters<typeof fetch>[0]) {
  return new URL(input instanceof Request ? input.url : String(input)).pathname;
}
function authorization(init?: RequestInit) {
  return new Headers(init?.headers).get('authorization');
}
function request() {
  return new NextRequest('https://app.example/api/auth/privacy-read', {
    method: 'POST',
    headers: {
      origin: 'https://app.example',
      'sec-fetch-site': 'same-origin',
      'content-type': 'application/json',
    },
    body: JSON.stringify({ operation: 'verify-identity', expected }),
  });
}
async function verify() {
  const response = await POST(request());
  expect(response.headers.has('set-cookie')).toBe(false);
  expect(response.headers.get('cache-control')).toBe('private, no-store');
  return response.json();
}
async function seed() {
  access = jwt(Math.floor(Date.now() / 1000) + 600);
  const client = await createSupabaseServerClient(true);
  const result = await client.auth.setSession({
    access_token: access,
    refresh_token: 'synthetic-original-refresh',
  });
  expect(result.error).toBeNull();
  expect(jar.values.size).toBeGreaterThan(0);
  jar.writes.mockClear();
  outbound.mockClear();
}
function advance(seconds: number) {
  vi.setSystemTime(Date.now() + seconds * 1000);
}
function refreshCalls() {
  return outbound.mock.calls.filter(
    ([input]) => path(input) === '/auth/v1/token',
  );
}
beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-11T12:00:00Z'));
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', backend);
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', 'synthetic-public-key');
  vi.stubEnv('APP_ORIGIN', 'http://localhost:3000');
  vi.stubEnv('VERCEL_ENV', 'development');
  jar.values.clear();
  jar.writes.mockClear();
  outbound.mockReset();
  outbound.mockImplementation(async (input) => {
    switch (path(input)) {
      case '/auth/v1/user':
        return json(user);
      case '/rest/v1/app_members':
        return json([member]);
      case '/auth/v1/token':
        return json({
          access_token: jwt(Math.floor(Date.now() / 1000) + 3600),
          refresh_token: 'synthetic-rotated-refresh',
          token_type: 'bearer',
          expires_in: 3600,
          user,
        });
      case '/auth/v1/logout':
        return json({});
      default:
        throw new Error('Unexpected SDK request');
    }
  });
  vi.stubGlobal('fetch', outbound);
  await seed();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

it.each([601, 599])(
  'refuses installed SDK refresh at age %s without any outbound token request or cookie write',
  async (age) => {
    advance(age);
    const original = [...jar.values];
    expect(await verify()).toEqual({ status: 'unavailable' });
    expect(refreshCalls()).toHaveLength(0);
    expect(jar.writes).not.toHaveBeenCalled();
    expect([...jar.values]).toEqual(original);
    if (age === 599) {
      // This SDK preserves the still-valid access token after a nonretryable
      // proactive refresh failure and can produce an otherwise valid user.
      expect(
        outbound.mock.calls.some(([input]) => path(input) === '/auth/v1/user'),
      ).toBe(true);
    }
    expect(
      outbound.mock.calls.every(([input]) => path(input) === '/auth/v1/user'),
    ).toBe(true);
  },
);
it('allows the original bearer and active matching membership through the installed SDK', async () => {
  expect(await verify()).toEqual({
    status: 'match',
    generation: { status: 'absent' },
  });
  expect(outbound.mock.calls.map(([input]) => path(input))).toEqual([
    '/auth/v1/user',
    '/rest/v1/app_members',
  ]);
  expect(
    outbound.mock.calls.every(
      ([, init]) => authorization(init) === 'Bearer ' + access,
    ),
  ).toBe(true);
  expect(
    outbound.mock.calls.every(([, init]) => init?.redirect === 'error'),
  ).toBe(true);
  expect(jar.writes).not.toHaveBeenCalled();
});
it('also blocks PostgREST getAccessToken refresh after explicit-JWT getUser bypasses session loading', async () => {
  advance(599);
  const readOnly = await createSupabasePrivacyReadClient();
  const identity = await readOnly.client.auth.getUser(access);
  expect(identity.data.user?.id).toBe(actor);
  expect(readOnly.blocked()).toBe(false);
  const result = await readOnly.client
    .from('app_members')
    .select('user_id,role,active,can_manage_configuration')
    .eq('user_id', actor)
    .setHeader('Authorization', 'Bearer ' + access)
    .maybeSingle();
  expect(result.data?.user_id).toBe(actor);
  expect(readOnly.blocked()).toBe(true);
  expect(refreshCalls()).toHaveLength(0);
  expect(jar.writes).not.toHaveBeenCalled();
});
it.each([
  'revoked-auth',
  'other-actor',
  'inactive-member',
  'changed-role',
  'changed-configuration',
] as const)(
  'denies %s through caller-scoped actual SDK reads',
  async (change) => {
    outbound.mockImplementation(async (input) => {
      if (path(input) === '/auth/v1/user') {
        if (change === 'revoked-auth')
          return json({ code: 'bad_jwt', message: 'Session revoked' }, 401);
        return json({ ...user, id: change === 'other-actor' ? other : actor });
      }
      if (path(input) === '/rest/v1/app_members')
        return json([
          {
            ...member,
            active: change !== 'inactive-member',
            role: change === 'changed-role' ? 'viewer' : 'staff',
            can_manage_configuration: change !== 'changed-configuration',
          },
        ]);
      throw new Error('Unexpected SDK request');
    });
    expect(await verify()).toEqual({ status: 'denied' });
    expect(refreshCalls()).toHaveLength(0);
    expect(jar.writes).not.toHaveBeenCalled();
  },
);
it('leaves ordinary writable refresh intact and privacy retry recovers from its new cookie session', async () => {
  advance(599);
  expect(await verify()).toEqual({ status: 'unavailable' });
  const writable = await createSupabaseServerClient(true);
  const result = await writable.auth.getUser();
  expect(result.data.user?.id).toBe(actor);
  expect(refreshCalls()).toHaveLength(1);
  expect(jar.writes).toHaveBeenCalled();
  outbound.mockClear();
  jar.writes.mockClear();
  expect(await verify()).toEqual({
    status: 'match',
    generation: { status: 'absent' },
  });
  expect(refreshCalls()).toHaveLength(0);
  expect(jar.writes).not.toHaveBeenCalled();
});
it('cannot restore cookies when a held identity read finishes after caller logout', async () => {
  let release!: (value: Response) => void;
  let started!: () => void;
  const observed = new Promise<void>((resolve) => {
    started = resolve;
  });
  const held = new Promise<Response>((resolve) => {
    release = resolve;
  });
  let hold = true;
  const ordinary = outbound.getMockImplementation()!;
  outbound.mockImplementation(async (input, init) => {
    if (hold && path(input) === '/auth/v1/user') {
      hold = false;
      started();
      return held;
    }
    return ordinary(input, init);
  });
  const reading = verify();
  await observed;
  const writable = await createSupabaseServerClient(true);
  expect((await writable.auth.signOut({ scope: 'local' })).error).toBeNull();
  await recordConfirmedLogout();
  const loggedOut = [...jar.values];
  expect(
    loggedOut.every(([name]) => name === 'inventory-logout-local-v1'),
  ).toBe(true);
  jar.writes.mockClear();
  release(json(user));
  await reading;
  expect([...jar.values]).toEqual(loggedOut);
  expect(jar.writes).not.toHaveBeenCalled();
  expect(refreshCalls()).toHaveLength(0);
});
