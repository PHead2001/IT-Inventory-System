import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  maybeSingle: vi.fn(),
  from: vi.fn(),
}));
vi.mock('server-only', () => ({}));
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
  headers: async () => new Headers({ 'x-inventory-return': '/locations/ITC' }),
}));
import { requireMember } from './session.server';
beforeEach(() => {
  vi.resetAllMocks();
  mocks.getUser.mockResolvedValue({
    data: { user: { id: 'current-user' } },
    error: null,
  });
  mocks.from.mockReturnValue({
    select: () => ({ eq: () => ({ maybeSingle: mocks.maybeSingle }) }),
  });
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
