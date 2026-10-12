import { beforeEach, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
const mocks = vi.hoisted(() => ({
  member: vi.fn(),
  config: vi.fn(),
  single: vi.fn(),
  from: vi.fn(),
  select: vi.fn(),
}));
vi.mock('@/lib/auth/session.server', () => ({ requireMember: mocks.member }));
vi.mock('@/lib/supabase/config', () => ({ supabaseConfig: mocks.config }));
import { getLabelSettings } from './queries.server';
const actorId = 'b1000000-0000-4000-8000-000000000001';
beforeEach(() => {
  vi.resetAllMocks();
  mocks.from.mockReturnValue({ select: mocks.select });
  mocks.select.mockReturnValue({ single: mocks.single });
  mocks.single.mockResolvedValue({
    data: {
      size: '90x50',
      page: 'letter',
      format: 'qr',
      version: '1',
      layout: null,
    },
    error: null,
  });
  mocks.member.mockResolvedValue({
    supabase: { from: mocks.from },
    member: { user_id: actorId, role: 'staff', can_manage_configuration: true },
  });
  mocks.config.mockReturnValue({
    url: 'https://isolated.supabase.co/',
    key: 'public-test-key',
  });
});
it('loads label values with the authorized actor and configured backend origin', async () => {
  expect(await getLabelSettings()).toMatchObject({
    labelDefaults: { version: '1', layout: null },
    canManage: true,
    labelBinding: { actorId, backend: 'https://isolated.supabase.co' },
  });
  expect(mocks.member).toHaveBeenCalledOnce();
});
it('does not return caller binding or defaults when the authorized read fails', async () => {
  mocks.single.mockResolvedValue({
    data: null,
    error: { message: 'private database response' },
  });
  await expect(getLabelSettings()).rejects.toThrow(
    'Shared label defaults could not be loaded.',
  );
});
