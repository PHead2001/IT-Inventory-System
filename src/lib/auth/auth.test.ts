import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { confirmationSchema, passwordSchema } from './schemas';
import { isActiveMember, mayMutateInventory } from './membership';
const mocks = vi.hoisted(() => ({
  signInWithPassword: vi.fn(),
  signOut: vi.fn(),
  resetPasswordForEmail: vi.fn(),
  verifyOtp: vi.fn(),
  getUser: vi.fn(),
  updateUser: vi.fn(),
  member: vi.fn(),
  from: vi.fn(),
}));
vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: vi.fn(async () => ({
    auth: mocks,
    from: mocks.from,
  })),
}));
vi.mock('next/navigation', () => ({
  redirect: vi.fn((url: string) => {
    throw new Error('REDIRECT:' + url);
  }),
}));
import { login, recover, confirmAuth, setPassword, logout } from './actions';
const form = (data: Record<string, string>) => {
  const result = new FormData();
  for (const [key, value] of Object.entries(data)) result.set(key, value);
  return result;
};
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv('APP_ORIGIN', 'http://localhost:3000');
  vi.stubEnv('VERCEL_BRANCH_URL', undefined);
  vi.stubEnv('VERCEL_URL', undefined);
  mocks.signInWithPassword.mockResolvedValue({ error: null });
  mocks.signOut.mockResolvedValue({ error: null });
  mocks.verifyOtp.mockResolvedValue({ error: null });
  mocks.updateUser.mockResolvedValue({ error: null });
  mocks.getUser.mockResolvedValue({
    data: { user: { id: 'user' } },
    error: null,
  });
  mocks.resetPasswordForEmail.mockResolvedValue({ error: null });
  mocks.member.mockResolvedValue({
    data: {
      user_id: 'user',
      display_name: 'Test',
      role: 'staff',
      active: true,
    },
    error: null,
  });
  mocks.from.mockReturnValue({
    select: () => ({ eq: () => ({ maybeSingle: mocks.member }) }),
  });
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});
describe('auth boundaries', () => {
  it.each([
    [
      'explicit override',
      'https://inventory.example.com/',
      'inventory-git-feature-team.vercel.app',
      'https://inventory.example.com',
    ],
    [
      'branch hostname',
      undefined,
      'inventory-git-feature-team.vercel.app',
      'https://inventory-git-feature-team.vercel.app',
    ],
    [
      'branch HTTPS and trailing slash',
      undefined,
      'https://inventory-git-feature-team.vercel.app/',
      'https://inventory-git-feature-team.vercel.app',
    ],
    [
      'branch forced HTTPS',
      undefined,
      'http://inventory-git-feature-team.vercel.app/',
      'https://inventory-git-feature-team.vercel.app',
    ],
    ['localhost fallback', undefined, undefined, 'http://localhost:3000'],
    [
      'explicit local port',
      'http://localhost:4000/',
      undefined,
      'http://localhost:4000',
    ],
  ])(
    'uses %s for the recovery callback',
    async (_name, override, branch, expected) => {
      vi.stubEnv('APP_ORIGIN', override);
      vi.stubEnv('VERCEL_BRANCH_URL', branch);
      vi.stubEnv('VERCEL_URL', 'inventory-commit123-team.vercel.app');
      await recover({}, form({ email: 'staff@example.test' }));
      expect(mocks.resetPasswordForEmail).toHaveBeenCalledWith(
        'staff@example.test',
        {
          redirectTo: expected + '/auth/confirm',
        },
      );
    },
  );
  it('rejects an invalid explicit origin rather than falling back', async () => {
    vi.stubEnv('APP_ORIGIN', 'not-a-url');
    vi.stubEnv('VERCEL_BRANCH_URL', 'inventory-git-feature-team.vercel.app');
    await expect(
      recover({}, form({ email: 'staff@example.test' })),
    ).rejects.toThrow();
    expect(mocks.resetPasswordForEmail).not.toHaveBeenCalled();
  });
  it('limits member access to active approved roles', () => {
    const base = {
      user_id: 'u',
      display_name: 'Test',
      role: 'staff',
      active: true,
    };
    expect(isActiveMember(null)).toBe(false);
    expect(isActiveMember({ ...base, active: false })).toBe(false);
    expect(isActiveMember({ ...base, role: 'admin' })).toBe(false);
    expect(isActiveMember({ ...base, role: 'viewer' })).toBe(true);
    expect(mayMutateInventory({ ...base, role: 'viewer' })).toBe(false);
    expect(mayMutateInventory(base)).toBe(true);
  });
  it('validates login before contacting Auth', async () => {
    expect(
      await login({}, form({ email: 'bad', password: '' })),
    ).toHaveProperty('error');
    expect(mocks.signInWithPassword).not.toHaveBeenCalled();
  });
  it('uses a fixed login destination', async () => {
    await expect(
      login(
        {},
        form({
          email: 'staff@example.test',
          password: 'Password123456',
          next: 'https://evil.example',
        }),
      ),
    ).rejects.toThrow('REDIRECT:/inventory');
  });
  it('emits only fixed login spans and preserves the authorized redirect when enabled', async () => {
    vi.stubEnv('AUTH_DIAGNOSTICS', '1');
    vi.stubEnv('VERCEL_ENV', 'preview');
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    await expect(
      login(
        {},
        form({ email: 'staff@example.test', password: 'Password123456' }),
      ),
    ).rejects.toThrow('REDIRECT:/inventory');
    const events = info.mock.calls.map(([line]) =>
      JSON.parse(String(line).slice('AUTH_DIAGNOSTIC '.length)),
    );
    expect(events.map((event) => event.stage)).toEqual([
      'login.client',
      'login.credentials',
      'login.getUser',
      'login.membership',
      'login.total',
    ]);
    expect(new Set(events.map((event) => event.correlation)).size).toBe(1);
    expect(info.mock.calls.flat().join(' ')).not.toContain(
      'staff@example.test',
    );
  });
  it('does not let a diagnostic logging failure change denial or credential errors', async () => {
    vi.stubEnv('AUTH_DIAGNOSTICS', '1');
    vi.stubEnv('VERCEL_ENV', 'preview');
    vi.spyOn(console, 'info').mockImplementation(() => {
      throw new Error('observer failed');
    });
    mocks.member.mockResolvedValue({ data: null, error: null });
    await expect(
      login(
        {},
        form({ email: 'staff@example.test', password: 'Password123456' }),
      ),
    ).rejects.toThrow('REDIRECT:/access-denied');
    mocks.signInWithPassword.mockResolvedValue({
      error: { message: 'secret internal detail' },
    });
    expect(
      await login(
        {},
        form({ email: 'staff@example.test', password: 'Password123456' }),
      ),
    ).toEqual({ error: 'Unable to sign in. Check your email and password.' });
  });
  it('returns to a validated label only after checking current membership', async () => {
    await expect(
      login(
        {},
        form({
          email: 'staff@example.test',
          password: 'Password123456',
          next: '/locations/ITC',
        }),
      ),
    ).rejects.toThrow('REDIRECT:/locations/ITC');
    expect(mocks.from).toHaveBeenCalledWith('app_members');
    mocks.member.mockResolvedValue({
      data: {
        user_id: 'user',
        display_name: 'Test',
        role: 'staff',
        active: false,
      },
      error: null,
    });
    await expect(
      login(
        {},
        form({
          email: 'staff@example.test',
          password: 'Password123456',
          next: '/locations/ITC',
        }),
      ),
    ).rejects.toThrow('REDIRECT:/access-denied');
  });
  it('returns safe invalid-credential errors', async () => {
    mocks.signInWithPassword.mockResolvedValue({
      error: { message: 'internal details' },
    });
    expect(
      await login(
        {},
        form({ email: 'staff@example.test', password: 'Password123456' }),
      ),
    ).toEqual({ error: 'Unable to sign in. Check your email and password.' });
  });
  it('does not expose account existence during recovery', async () => {
    const a = await recover({}, form({ email: 'known@example.test' }));
    mocks.resetPasswordForEmail.mockResolvedValue({
      error: { message: 'User not found' },
    });
    const b = await recover({}, form({ email: 'unknown@example.test' }));
    expect(a).toEqual(b);
  });
  it('rejects unsupported, missing and oversized email tokens', async () => {
    for (const data of [
      { token_hash: 'abc', type: 'signup' },
      { token_hash: '', type: 'invite' },
      { token_hash: 'a'.repeat(2049), type: 'recovery' },
    ])
      expect(await confirmAuth({}, form(data))).toHaveProperty('error');
    expect(mocks.verifyOtp).not.toHaveBeenCalled();
  });
  it('exchanges only the allowed token fields and ignores redirects', async () => {
    await expect(
      confirmAuth(
        {},
        form({
          token_hash: 'abc123',
          type: 'invite',
          redirect_to: 'https://evil.example',
        }),
      ),
    ).rejects.toThrow('REDIRECT:/set-password');
    expect(mocks.verifyOtp).toHaveBeenCalledWith({
      token_hash: 'abc123',
      type: 'invite',
    });
  });
  it('handles expired or replayed email tokens safely', async () => {
    mocks.verifyOtp.mockResolvedValue({ error: { message: 'sensitive' } });
    expect(
      await confirmAuth({}, form({ token_hash: 'abc123', type: 'recovery' })),
    ).toEqual({
      error:
        'This link has expired or has already been used. Request a new email.',
    });
  });
  it('requires verified identity to update a password', async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: null });
    expect(
      await setPassword(
        {},
        form({ password: 'Password123456', confirmation: 'Password123456' }),
      ),
    ).toHaveProperty('error');
    expect(mocks.updateUser).not.toHaveBeenCalled();
  });
  it('updates only password and permits authenticated nonmembers to finish onboarding', async () => {
    await expect(
      setPassword(
        {},
        form({
          password: 'Password123456',
          confirmation: 'Password123456',
          role: 'staff',
        }),
      ),
    ).rejects.toThrow('REDIRECT:/inventory');
    expect(mocks.updateUser).toHaveBeenCalledWith({
      password: 'Password123456',
    });
  });
  it('signs out only the current session', async () => {
    await expect(logout()).rejects.toThrow('REDIRECT:/login');
    expect(mocks.signOut).toHaveBeenCalledWith({ scope: 'local' });
  });
  it('enforces password confirmation and length', () => {
    expect(
      passwordSchema.safeParse({ password: 'short', confirmation: 'short' })
        .success,
    ).toBe(false);
    expect(
      passwordSchema.safeParse({
        password: 'Password123456',
        confirmation: 'different',
      }).success,
    ).toBe(false);
    expect(
      confirmationSchema.safeParse({ token_hash: 'ab12', type: 'invite' })
        .success,
    ).toBe(true);
  });
});
