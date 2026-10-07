import { expect, it, vi, beforeEach } from 'vitest';
vi.mock('server-only', () => ({}));
const m = vi.hoisted(() => ({
  read: vi.fn(),
  redirect: vi.fn(),
  rethrow: vi.fn(),
}));
vi.mock('@/features/inventory/queries.server', () => ({
  getLowStockDashboard: m.read,
}));
vi.mock('next/navigation', () => ({
  redirect: m.redirect,
  unstable_rethrow: m.rethrow,
}));
import { loadDashboardSnapshot } from './snapshot.server';
import { refreshDashboard } from './refresh.actions';
beforeEach(() => vi.resetAllMocks());
it('timestamps only completion of the single caller-scoped dashboard read', async () => {
  vi.useFakeTimers();
  try {
    let finish!: (value: {
      page: number;
      total: number;
      pageSize: number;
    }) => void;
    m.read.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    vi.setSystemTime(new Date('2026-10-07T10:00:00Z'));
    const read = loadDashboardSnapshot(2);
    vi.setSystemTime(new Date('2026-10-07T10:01:00Z'));
    const result = { page: 2, total: 30, pageSize: 25 };
    finish(result);
    expect(await read).toEqual({
      result,
      fetchedAt: '2026-10-07T10:01:00.000Z',
    });
    expect(m.read).toHaveBeenCalledExactlyOnceWith(2);
  } finally {
    vi.useRealTimers();
  }
});
it('returns a recoverable failure without any invented snapshot, preserving framework auth redirects', async () => {
  const error = new Error('read failed');
  m.read.mockRejectedValue(error);
  expect(await refreshDashboard(1)).toEqual({ ok: false });
  expect(m.rethrow).toHaveBeenCalledWith(error);
  m.rethrow.mockImplementation(() => {
    throw new Error('NEXT_REDIRECT');
  });
  await expect(refreshDashboard(1)).rejects.toThrow('NEXT_REDIRECT');
});
it('recovers an obsolete later page via the ordinary route', async () => {
  m.read.mockResolvedValue({ page: 3, pageSize: 25, total: 2 });
  m.redirect.mockImplementation(() => {
    throw new Error('NEXT_REDIRECT');
  });
  await expect(refreshDashboard(3)).rejects.toThrow('NEXT_REDIRECT');
  expect(m.redirect).toHaveBeenCalledWith('/dashboard?page=1');
});
