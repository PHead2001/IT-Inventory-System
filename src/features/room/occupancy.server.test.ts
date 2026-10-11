import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ member: vi.fn(), rpc: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/auth/session.server', () => ({ requireMember: mocks.member }));
import {
  getLocationEntryCounts,
  getLocationOccupancy,
} from './occupancy.server';

beforeEach(() => {
  vi.resetAllMocks();
  mocks.member.mockResolvedValue({
    supabase: {
      rpc: (...args: unknown[]) => {
        const result = mocks.rpc(...args);
        return Object.assign(result, {
          abortSignal: vi.fn().mockReturnValue(result),
        });
      },
    },
  });
});

it('reads additive products/units/assets with caller credentials and exact decimal values', async () => {
  const counts = {
    quantity_product_count: '1',
    quantity_unit_count: '9007199254740993',
    asset_count: '2',
  };
  mocks.rpc.mockResolvedValue({
    data: [
      { location_code: 'ITC-D01', ...counts },
      {
        location_code: 'ITC-D02',
        quantity_product_count: '0',
        quantity_unit_count: '0',
        asset_count: '0',
      },
    ],
    error: null,
  });
  expect(await getLocationOccupancy(['ITC-D01', 'ITC-D02', 'UNKNOWN'])).toEqual(
    {
      'ITC-D01': counts,
      'ITC-D02': {
        quantity_product_count: '0',
        quantity_unit_count: '0',
        asset_count: '0',
      },
    },
  );
  expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith(
    'inventory_location_occupancy',
    { p_location_codes: ['ITC-D01', 'ITC-D02', 'UNKNOWN'] },
  );
});
it('rejects malformed, duplicate and unexpected additive count rows, and bounds the request before auth', async () => {
  await expect(getLocationOccupancy(['X', 'X'])).rejects.toThrow();
  await expect(
    getLocationOccupancy(
      Array.from({ length: 100 }, (_, i) => `${i}${'界'.repeat(97)}`),
    ),
  ).rejects.toThrow();
  expect(mocks.member).not.toHaveBeenCalled();
  const row = {
    location_code: 'X',
    quantity_product_count: '1',
    quantity_unit_count: '31',
    asset_count: '0',
  };
  for (const rows of [
    [row, row],
    [{ ...row, location_code: 'OTHER' }],
    [{ ...row, quantity_unit_count: 31 }],
    [{ ...row, quantity_unit_count: '01' }],
  ]) {
    mocks.rpc.mockResolvedValueOnce({ data: rows, error: null });
    await expect(getLocationOccupancy(['X'])).rejects.toThrow();
  }
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
  expect(mocks.member).not.toHaveBeenCalled();
});
it('retains standalone membership authorization and blocks counts after denial', async () => {
  mocks.member.mockRejectedValue(new Error('membership revoked'));
  await expect(getLocationEntryCounts(['ITC-D01'])).rejects.toThrow(
    'membership revoked',
  );
  expect(mocks.member).toHaveBeenCalledOnce();
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

afterEach(() => vi.useRealTimers());
it('aborts and rejects a stalled occupancy RPC at five seconds without inventing zero', async () => {
  vi.useFakeTimers();
  mocks.rpc.mockReturnValue(new Promise(() => {}));
  const pending = getLocationOccupancy(['X']);
  const assertion = expect(pending).rejects.toThrow('timed out');
  await vi.advanceTimersByTimeAsync(5000);
  await assertion;
});
