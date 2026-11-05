import { beforeEach, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
const mocks = vi.hoisted(() => ({ member: vi.fn(), rpc: vi.fn() }));
vi.mock('@/lib/auth/session.server', () => ({ requireMember: mocks.member }));
import { getFileListSummaries, readFileListSummaries } from './list.server';
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

it('reuses the exact caller and abort signal while preserving a thumbnail authorization denial', async () => {
  const denial = { code: '42501' },
    signal = new AbortController().signal;
  const abortSignal = vi.fn().mockResolvedValue({ data: null, error: denial });
  const supabase = { rpc: vi.fn().mockReturnValue({ abortSignal }) };
  const context = { supabase } as unknown as Parameters<
    typeof readFileListSummaries
  >[0];
  await expect(
    readFileListSummaries(
      context,
      [{ kind: 'asset', id: '00000000-0000-4000-8000-000000000001' }],
      signal,
    ),
  ).rejects.toBe(denial);
  expect(mocks.member).not.toHaveBeenCalled();
  expect(abortSignal).toHaveBeenCalledWith(signal);
  expect(supabase.rpc.mock.contexts[0]).toBe(supabase);
});
it('retains the ordinary list caller generic RPC error contract', async () => {
  mocks.rpc.mockResolvedValue({ data: null, error: { code: '42501' } });
  mocks.member.mockResolvedValue({ supabase: { rpc: mocks.rpc } });
  await expect(
    getFileListSummaries([
      { kind: 'asset', id: '00000000-0000-4000-8000-000000000001' },
    ] as Parameters<typeof getFileListSummaries>[0]),
  ).rejects.toThrow('Inventory file summaries could not be loaded.');
});
