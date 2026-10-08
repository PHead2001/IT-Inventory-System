import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  maybeSingle: vi.fn(),
  from: vi.fn(),
  requestCache: null as Map<string, Promise<unknown>> | null,
  returnPath: '/locations/ITC',
}));
vi.mock('server-only', () => ({}));
vi.mock('react', () => ({
  cache: (read: () => Promise<unknown>) => () => {
    if (!mocks.requestCache) return read();
    let result = mocks.requestCache.get('member');
    if (!result) {
      result = read();
      mocks.requestCache.set('member', result);
    }
    return result;
  },
}));
vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: async () => ({
    auth: { getUser: mocks.getUser },
    from: mocks.from,
  }),
}));
vi.mock('next/navigation', () => ({
  redirect: (path: string) => {
    throw new Error('REDIRECT:' + path);
  },
}));
vi.mock('next/headers', () => ({
  headers: async () => new Headers({ 'x-inventory-return': mocks.returnPath }),
}));
import { requireMember } from './session.server';
beforeEach(() => {
  vi.resetAllMocks();
  mocks.requestCache = null;
  mocks.returnPath = '/locations/ITC';
  mocks.getUser.mockResolvedValue({
    data: { user: { id: 'current-user' } },
    error: null,
  });
  mocks.from.mockReturnValue({
    select: () => ({ eq: () => ({ maybeSingle: mocks.maybeSingle }) }),
  });
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});
it('logs the protected request decision without changing the fresh getUser and membership denial', async () => {
  vi.stubEnv('AUTH_DIAGNOSTICS', '1');
  vi.stubEnv('VERCEL_ENV', 'preview');
  const info = vi.spyOn(console, 'info').mockImplementation(() => {});
  mocks.maybeSingle.mockResolvedValue({ data: null, error: null });
  await expect(requireMember()).rejects.toThrow('REDIRECT:/access-denied');
  expect(mocks.getUser).toHaveBeenCalledTimes(1);
  expect(mocks.maybeSingle).toHaveBeenCalledTimes(1);
  const events = info.mock.calls.map(([line]) =>
    JSON.parse(String(line).slice('AUTH_DIAGNOSTIC '.length)),
  );
  expect(events.map((event) => event.stage)).toEqual([
    'member.client',
    'member.getUser',
    'member.membership',
    'member.total',
  ]);
  expect(new Set(events.map((event) => event.correlation)).size).toBe(1);
});
it('rejects anonymous/invalid sessions before querying membership', async () => {
  mocks.getUser.mockResolvedValue({
    data: { user: null },
    error: { message: 'invalid' },
  });
  await expect(requireMember()).rejects.toThrow(
    'REDIRECT:/login?next=%2Flocations%2FITC',
  );
  expect(mocks.from).not.toHaveBeenCalled();
});
it.each([
  ['/dashboard', '/login?next=%2Fdashboard'],
  ['/dashboard?next=https://evil.test', '/login'],
  ['//evil.test/dashboard', '/login'],
])(
  'keeps only the canonical Overview destination through anonymous authentication: %s',
  async (path, expected) => {
    mocks.returnPath = path;
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: null });
    await expect(requireMember()).rejects.toThrow('REDIRECT:' + expected);
    expect(mocks.from).not.toHaveBeenCalled();
  },
);
it.each([
  null,
  {
    user_id: 'current-user',
    display_name: 'Test',
    role: 'staff',
    active: false,
  },
])('denies missing or inactive membership', async (member) => {
  mocks.maybeSingle.mockResolvedValue({ data: member, error: null });
  await expect(requireMember()).rejects.toThrow('REDIRECT:/access-denied');
});
it('fails closed on a membership database error', async () => {
  mocks.maybeSingle.mockResolvedValue({
    data: null,
    error: { message: 'unavailable' },
  });
  await expect(requireMember()).rejects.toThrow('REDIRECT:/access-denied');
});
it.each(['viewer', 'staff'])(
  'accepts current active %s membership',
  async (role) => {
    mocks.maybeSingle.mockResolvedValue({
      data: {
        user_id: 'current-user',
        display_name: 'Test',
        role,
        active: true,
      },
      error: null,
    });
    expect((await requireMember()).member.role).toBe(role);
  },
);
it('shares identity only within one render request and rechecks the next request', async () => {
  mocks.maybeSingle.mockResolvedValueOnce({
    data: {
      user_id: 'current-user',
      display_name: 'Test',
      role: 'staff',
      active: true,
    },
    error: null,
  });
  mocks.requestCache = new Map();
  const [first, second] = await Promise.all([requireMember(), requireMember()]);
  expect(first).toBe(second);
  expect(mocks.getUser).toHaveBeenCalledTimes(1);
  expect(mocks.maybeSingle).toHaveBeenCalledTimes(1);

  mocks.requestCache = new Map();
  mocks.maybeSingle.mockResolvedValueOnce({
    data: {
      user_id: 'current-user',
      display_name: 'Test',
      role: 'staff',
      active: false,
    },
    error: null,
  });
  await expect(requireMember()).rejects.toThrow('REDIRECT:/access-denied');
  expect(mocks.getUser).toHaveBeenCalledTimes(2);
  expect(mocks.maybeSingle).toHaveBeenCalledTimes(2);
});
