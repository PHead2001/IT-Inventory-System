import { afterEach, beforeEach, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
const mocks = vi.hoisted(() => ({
  user: vi.fn(),
  member: vi.fn(),
  from: vi.fn(),
  generation: vi.fn(),
}));
vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: async () => ({
    auth: { getUser: mocks.user },
    from: mocks.from,
  }),
}));
vi.mock('./privacy-barrier.server', () => ({
  readLogoutGeneration: mocks.generation,
}));
import { verifyProtectedPrivacyBinding } from './protected-binding.server';
const binding = {
  actorId: 'original',
  backend: 'https://isolated.supabase.co',
  role: 'staff',
  canManageConfiguration: true,
};
const member = {
  user_id: binding.actorId,
  display_name: 'Original',
  active: true,
  role: 'staff',
  can_manage_configuration: true,
};
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', binding.backend + '/');
  mocks.user.mockResolvedValue({
    data: { user: { id: binding.actorId } },
    error: null,
  });
  mocks.member.mockResolvedValue({ data: member, error: null });
  mocks.from.mockReturnValue({
    select: () => ({ eq: () => ({ maybeSingle: mocks.member }) }),
  });
  mocks.generation.mockResolvedValue({ status: 'absent' });
});
afterEach(() => vi.unstubAllEnvs());
it('verifies the original actor and privileges before returning the current logout generation', async () => {
  expect(await verifyProtectedPrivacyBinding(binding)).toEqual({
    status: 'match',
    generation: { status: 'absent' },
  });
  expect(mocks.user).toHaveBeenCalledOnce();
  expect(mocks.from).toHaveBeenCalledWith('app_members');
  expect(mocks.member).toHaveBeenCalledOnce();
  expect(mocks.generation).toHaveBeenCalledOnce();
});
it('rejects another authenticated actor before reading membership or generation', async () => {
  mocks.user.mockResolvedValue({
    data: { user: { id: 'other' } },
    error: null,
  });
  expect(await verifyProtectedPrivacyBinding(binding)).toEqual({
    status: 'denied',
  });
  expect(mocks.from).not.toHaveBeenCalled();
  expect(mocks.generation).not.toHaveBeenCalled();
});
it('does not trust a caller-supplied backend or privilege binding', async () => {
  expect(
    await verifyProtectedPrivacyBinding({
      ...binding,
      backend: 'https://other.supabase.co',
    }),
  ).toEqual({ status: 'denied' });
  expect(mocks.user).not.toHaveBeenCalled();
  expect(
    await verifyProtectedPrivacyBinding({
      ...binding,
      canManageConfiguration: false,
    }),
  ).toEqual({ status: 'denied' });
});
it.each([
  { active: false },
  { role: 'viewer' },
  { can_manage_configuration: false },
  { user_id: 'other' },
])(
  'denies changed membership %j without treating generation as identity proof',
  async (change) => {
    mocks.member.mockResolvedValue({
      data: { ...member, ...change },
      error: null,
    });
    expect(await verifyProtectedPrivacyBinding(binding)).toEqual({
      status: 'denied',
    });
    expect(mocks.generation).not.toHaveBeenCalled();
  },
);
it('keeps an interrupted membership read retryable without authorizing readmission', async () => {
  mocks.member.mockResolvedValue({ data: null, error: { message: 'network' } });
  expect(await verifyProtectedPrivacyBinding(binding)).toEqual({
    status: 'unavailable',
  });
  expect(mocks.generation).not.toHaveBeenCalled();
});
