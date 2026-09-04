import { beforeEach, describe, expect, it, vi } from 'vitest';
import { confirmationSchema, passwordSchema } from './schemas';
import { isActiveMember, mayMutateInventory } from './membership';
const mocks = vi.hoisted(() => ({
  signInWithPassword: vi.fn(),
  signOut: vi.fn(),
  resetPasswordForEmail: vi.fn(),
  verifyOtp: vi.fn(),
  getUser: vi.fn(),
  updateUser: vi.fn(),
}));
vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: vi.fn(async () => ({ auth: mocks })),
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
  process.env.APP_ORIGIN = 'http://localhost:3000';
  mocks.signInWithPassword.mockResolvedValue({ error: null });
  mocks.signOut.mockResolvedValue({ error: null });
  mocks.verifyOtp.mockResolvedValue({ error: null });
  mocks.updateUser.mockResolvedValue({ error: null });
  mocks.getUser.mockResolvedValue({
    data: { user: { id: 'user' } },
    error: null,
  });
  mocks.resetPasswordForEmail.mockResolvedValue({ error: null });
});
describe('auth boundaries', () => {
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
