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
  getClaims: vi.fn(),
  updateUser: vi.fn(),
  member: vi.fn(),
  from: vi.fn(),
  eq: vi.fn(),
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
  mocks.signInWithPassword.mockResolvedValue({
    data: {
      user: { id: 'user' },
      session: { access_token: 'test-access', refresh_token: 'test-refresh' },
    },
    error: null,
  });
  mocks.signOut.mockResolvedValue({ error: null });
  mocks.verifyOtp.mockResolvedValue({ error: null });
  mocks.updateUser.mockResolvedValue({ error: null });
  mocks.getUser.mockResolvedValue({
    data: { user: { id: 'user' } },
    error: null,
  });
  mocks.getClaims.mockResolvedValue({
    data: {
      claims: {
        sub: 'user',
        session_id: 'b81d6f4b-692a-4d6c-a958-732e26d4c9d8',
        exp: Math.floor(Date.now() / 1000) + 3600,
        iat: Math.floor(Date.now() / 1000),
        amr: [{ method: 'otp', timestamp: Math.floor(Date.now() / 1000) }],
      },
    },
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
  mocks.eq.mockReturnValue({ maybeSingle: mocks.member });
  mocks.from.mockReturnValue({ select: () => ({ eq: mocks.eq }) });
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
    expect(mocks.getUser).not.toHaveBeenCalled();
    expect(mocks.eq).toHaveBeenCalledWith('user_id', 'user');
  });
  it('opens Overview after login only after checking active membership', async () => {
    await expect(
      login(
        {},
        form({
          email: 'staff@example.test',
          password: 'Password123456',
          next: '/dashboard',
        }),
      ),
    ).rejects.toThrow('REDIRECT:/dashboard');
    expect(mocks.eq).toHaveBeenCalledWith('user_id', 'user');
    mocks.member.mockResolvedValue({ data: null, error: null });
    await expect(
      login(
        {},
        form({
          email: 'staff@example.test',
          password: 'Password123456',
          next: '/dashboard',
        }),
      ),
    ).rejects.toThrow('REDIRECT:/access-denied');
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
  it.each([
    ['missing data', undefined],
    ['missing user', { session: { access_token: 'a', refresh_token: 'r' } }],
    [
      'missing user ID',
      { user: {}, session: { access_token: 'a', refresh_token: 'r' } },
    ],
    ['missing session', { user: { id: 'user' } }],
    [
      'missing access token',
      { user: { id: 'user' }, session: { refresh_token: 'r' } },
    ],
    [
      'missing refresh token',
      { user: { id: 'user' }, session: { access_token: 'a' } },
    ],
  ])(
    'rejects a %s sign-in response before membership',
    async (_label, data) => {
      mocks.signInWithPassword.mockResolvedValue({ data, error: null });
      expect(
        await login(
          {},
          form({ email: 'staff@example.test', password: 'Password123456' }),
        ),
      ).toEqual({ error: 'Unable to verify this account. Please try again.' });
      expect(mocks.from).not.toHaveBeenCalled();
      expect(mocks.getUser).not.toHaveBeenCalled();
    },
  );
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
    ).rejects.toThrow('REDIRECT:/login?password=updated');
    expect(mocks.updateUser).toHaveBeenCalledWith({
      password: 'Password123456',
    });
    expect(mocks.signOut).toHaveBeenCalledWith({ scope: 'local' });
  });
  it('requires current credentials for ordinary sessions and never trusts form flags', async () => {
    const claims = (await mocks.getClaims()).data.claims;
    mocks.getClaims.mockResolvedValue({
      data: {
        claims: {
          ...claims,
          amr: [
            { method: 'password', timestamp: Math.floor(Date.now() / 1000) },
          ],
        },
      },
      error: null,
    });
    const values = {
      password: 'NewPassword123456',
      confirmation: 'NewPassword123456',
      recovery: 'true',
      emailedCompletion: 'true',
    };
    expect(await setPassword({}, form(values))).toHaveProperty('error');
    expect(mocks.updateUser).not.toHaveBeenCalled();
    await expect(
      setPassword(
        {},
        form({ ...values, current_password: 'CurrentPassword123456' }),
      ),
    ).rejects.toThrow('REDIRECT:/login?password=updated');
    expect(mocks.updateUser).toHaveBeenCalledWith({
      password: values.password,
      current_password: 'CurrentPassword123456',
    });
  });
  it('rechecks email proof when the form is submitted after its window', async () => {
    const claims = (await mocks.getClaims()).data.claims;
    mocks.getClaims.mockResolvedValue({
      data: {
        claims: {
          ...claims,
          amr: [
            { method: 'otp', timestamp: Math.floor(Date.now() / 1000) - 601 },
          ],
        },
      },
      error: null,
    });
    expect(
      await setPassword(
        {},
        form({
          password: 'NewPassword123456',
          confirmation: 'NewPassword123456',
        }),
      ),
    ).toHaveProperty('error');
    expect(mocks.updateUser).not.toHaveBeenCalled();
  });
  it.each(['stale', 'future', 'malformed', 'mixed password'])(
    'rejects %s email AMR even when a nonempty current password is supplied',
    async (proof) => {
      const claims = (await mocks.getClaims()).data.claims;
      const now = Math.floor(Date.now() / 1000);
      mocks.getClaims.mockResolvedValue({
        data: {
          claims: {
            ...claims,
            amr: [
              {
                method: 'otp',
                timestamp:
                  proof === 'future'
                    ? now + 1
                    : proof === 'malformed'
                      ? String(now)
                      : now - 601,
              },
              ...(proof === 'mixed password'
                ? [{ method: 'password', timestamp: now }]
                : []),
            ],
          },
        },
        error: null,
      });
      expect(
        await setPassword(
          {},
          form({
            password: 'NewPassword123456',
            confirmation: 'NewPassword123456',
            current_password: 'WrongButNonempty123456',
          }),
        ),
      ).toHaveProperty('error');
      expect(mocks.updateUser).not.toHaveBeenCalled();
      expect(mocks.signOut).not.toHaveBeenCalled();
    },
  );
  it.each([
    'claims error',
    'identity mismatch',
    'missing session',
    'expired token',
  ])('rejects %s before password mutation', async (failure) => {
    const claims = (await mocks.getClaims()).data.claims;
    mocks.getClaims.mockResolvedValue(
      failure === 'claims error'
        ? { data: null, error: {} }
        : {
            data: {
              claims: {
                ...claims,
                ...(failure === 'identity mismatch'
                  ? { sub: 'other' }
                  : failure === 'missing session'
                    ? { session_id: null }
                    : { exp: 1 }),
              },
            },
            error: null,
          },
    );
    expect(
      await setPassword(
        {},
        form({
          password: 'NewPassword123456',
          confirmation: 'NewPassword123456',
          current_password: 'CurrentPassword123456',
        }),
      ),
    ).toHaveProperty('error');
    expect(mocks.updateUser).not.toHaveBeenCalled();
  });
  it('does not claim completion or redirect when provider rejects current credentials', async () => {
    mocks.updateUser.mockResolvedValue({
      error: { code: 'invalid_credentials' },
    });
    expect(
      await setPassword(
        {},
        form({
          password: 'NewPassword123456',
          confirmation: 'NewPassword123456',
        }),
      ),
    ).toHaveProperty('error');
    expect(mocks.signOut).not.toHaveBeenCalled();
  });
  it('reports a committed change honestly if local sign-out fails', async () => {
    mocks.signOut.mockResolvedValue({ error: {} });
    expect(
      await setPassword(
        {},
        form({
          password: 'NewPassword123456',
          confirmation: 'NewPassword123456',
        }),
      ),
    ).toEqual({
      error:
        'Your password was updated, but sign-out failed. Sign out before continuing.',
      passwordUpdated: true,
    });
  });
  it('also retains the committed result when sign-out transport throws', async () => {
    mocks.signOut.mockRejectedValue(new Error('transport'));
    expect(
      await setPassword(
        {},
        form({
          password: 'NewPassword123456',
          confirmation: 'NewPassword123456',
        }),
      ),
    ).toMatchObject({ passwordUpdated: true });
    expect(mocks.updateUser).toHaveBeenCalledTimes(1);
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
