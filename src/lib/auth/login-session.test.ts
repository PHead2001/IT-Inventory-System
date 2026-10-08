import { beforeEach, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  member: vi.fn(),
  eq: vi.fn(),
}));
vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: async () => ({
    auth: { getUser: mocks.getUser },
    from: () => ({ select: () => ({ eq: mocks.eq }) }),
  }),
}));
import { readLoginSession } from './login-session.server';
beforeEach(() => {
  vi.resetAllMocks();
  mocks.getUser.mockResolvedValue({
    data: { user: { id: 'current' } },
    error: null,
  });
  mocks.member.mockResolvedValue({
    data: { user_id: 'current', role: 'staff', active: true },
    error: null,
  });
  mocks.eq.mockReturnValue({ maybeSingle: mocks.member });
});
it('reads active membership for the currently verified identity', async () => {
  expect(await readLoginSession()).toBe('member');
  expect(mocks.eq).toHaveBeenCalledWith('user_id', 'current');
});
it.each([null, { user_id: 'current', role: 'staff', active: false }])(
  'denies absent/inactive membership',
  async (data) => {
    mocks.member.mockResolvedValue({ data, error: null });
    expect(await readLoginSession()).toBe('denied');
  },
);
it.each([{ status: 503 }, { name: 'AuthRetryableFetchError' }])(
  'retains recoverable provider failure %j',
  async (error) => {
    mocks.getUser.mockResolvedValue({ data: { user: null }, error });
    expect(await readLoginSession()).toBe('unavailable');
    expect(mocks.member).not.toHaveBeenCalled();
  },
);
it('does not mistake membership transport failure for denied access', async () => {
  mocks.member.mockResolvedValue({ data: null, error: {} });
  expect(await readLoginSession()).toBe('unavailable');
});
it('permits a new sign-in with no session', async () => {
  mocks.getUser.mockResolvedValue({
    data: { user: null },
    error: { name: 'AuthSessionMissingError' },
  });
  expect(await readLoginSession()).toBe('anonymous');
});
