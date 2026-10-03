import { beforeEach, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
const mocks = vi.hoisted(() => ({ member: vi.fn(), rpc: vi.fn() }));
vi.mock('@/lib/auth/session.server', () => ({ requireMember: mocks.member }));
import { getFileListSummaries } from './list.server';
beforeEach(() => vi.resetAllMocks());
it('keeps the membership gate and avoids an empty file summary RPC', async () => {
  mocks.member.mockResolvedValue({ supabase: { rpc: mocks.rpc } });
  await expect(getFileListSummaries([])).resolves.toEqual([]);
  expect(mocks.member).toHaveBeenCalledOnce();
  expect(mocks.rpc).not.toHaveBeenCalled();
});
it('retains authorization rejection even for an empty inventory result', async () => {
  mocks.member.mockRejectedValue(new Error('membership revoked'));
  await expect(getFileListSummaries([])).rejects.toThrow('membership revoked');
  expect(mocks.rpc).not.toHaveBeenCalled();
});
