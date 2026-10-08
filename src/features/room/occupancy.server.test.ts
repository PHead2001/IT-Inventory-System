import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ member: vi.fn(), rpc: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/auth/session.server', () => ({ requireMember: mocks.member }));
import { getLocationEntryCounts } from './occupancy.server';

beforeEach(() => {
  vi.resetAllMocks();
  mocks.member.mockResolvedValue({ supabase: { rpc: mocks.rpc } });
});
it('uses one caller read and preserves precision, known zero and unknown codes', async () => {
  mocks.rpc.mockResolvedValue({
    data: [
      { location_code: 'ITC-D01', entry_count: '9007199254740993' },
      { location_code: 'ITC-D02', entry_count: '0' },
    ],
    error: null,
  });
  expect(
    await getLocationEntryCounts(['ITC-D01', 'ITC-D02', 'UNKNOWN']),
  ).toEqual({
    'ITC-D01': '9007199254740993',
    'ITC-D02': '0',
  });
  expect(mocks.member).toHaveBeenCalledOnce();
  expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith(
    'inventory_location_entry_counts',
    {
      p_location_codes: ['ITC-D01', 'ITC-D02', 'UNKNOWN'],
    },
  );
});
it('rejects duplicate and oversized scopes before making a request', async () => {
  await expect(getLocationEntryCounts(['ITC', 'ITC'])).rejects.toThrow();
  await expect(
    getLocationEntryCounts(Array.from({ length: 101 }, (_, i) => `L${i}`)),
  ).rejects.toThrow();
  expect(mocks.rpc).not.toHaveBeenCalled();
});
it('keeps backend failure unknown and rejects mismatched response identity', async () => {
  mocks.rpc.mockResolvedValueOnce({ data: null, error: { code: 'P1001' } });
  await expect(getLocationEntryCounts(['ITC-D01'])).rejects.toThrow(
    'could not be loaded',
  );
  mocks.rpc.mockResolvedValueOnce({
    data: [{ location_code: 'ITC-D02', entry_count: '3' }],
    error: null,
  });
  await expect(getLocationEntryCounts(['ITC-D01'])).rejects.toThrow(
    'did not match',
  );
});
