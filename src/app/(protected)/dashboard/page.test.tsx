import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

const mocks = vi.hoisted(() => ({ dashboard: vi.fn(), redirect: vi.fn() }));
vi.mock('@/features/inventory/queries.server', () => ({
  getLowStockDashboard: mocks.dashboard,
}));
vi.mock('next/navigation', () => ({
  redirect: mocks.redirect,
  useRouter: () => ({ refresh: vi.fn() }),
}));
import DashboardPage from './page';

beforeEach(() => {
  vi.resetAllMocks();
  mocks.redirect.mockImplementation(() => {
    throw new Error('NEXT_REDIRECT');
  });
});

describe('dashboard pagination after stock changes', () => {
  it('distinguishes absent monitoring from healthy monitored stock beside the summary', async () => {
    mocks.dashboard.mockResolvedValue({
      configuredCount: 0,
      needsRestockingCount: 0,
      outOfStockCount: 0,
      rows: [],
      total: 0,
      page: 1,
      pageSize: 25,
    });
    const { rerender } = render(
      await DashboardPage({ searchParams: Promise.resolve({}) }),
    );
    expect(screen.getAllByText('Not configured')).toHaveLength(2);
    expect(screen.getByText(/0 monitored active quantity items/)).toBeVisible();
    mocks.dashboard.mockResolvedValue({
      configuredCount: 1,
      needsRestockingCount: 0,
      outOfStockCount: 0,
      rows: [],
      total: 0,
      page: 1,
      pageSize: 25,
    });
    rerender(await DashboardPage({ searchParams: Promise.resolve({}) }));
    expect(screen.queryByText('Not configured')).not.toBeInTheDocument();
    expect(
      screen.getAllByText(/1 monitored active quantity item/)[0],
    ).toBeVisible();
  });
  it('redirects a formerly valid later page when attention shrinks', async () => {
    mocks.dashboard.mockResolvedValue({
      configuredCount: 4,
      needsRestockingCount: 2,
      outOfStockCount: 1,
      rows: [],
      total: 2,
      page: 2,
      pageSize: 25,
    });
    await expect(
      DashboardPage({ searchParams: Promise.resolve({ page: '2' }) }),
    ).rejects.toThrow('NEXT_REDIRECT');
    expect(mocks.dashboard).toHaveBeenCalledWith(2);
    expect(mocks.redirect).toHaveBeenCalledWith('/dashboard?page=1');
  });

  it('normalizes a huge page even when all attention has cleared', async () => {
    mocks.dashboard.mockResolvedValue({
      configuredCount: 4,
      needsRestockingCount: 0,
      outOfStockCount: 0,
      rows: [],
      total: 0,
      page: 100000,
      pageSize: 25,
    });
    await expect(
      DashboardPage({ searchParams: Promise.resolve({ page: '100000' }) }),
    ).rejects.toThrow('NEXT_REDIRECT');
    expect(mocks.redirect).toHaveBeenCalledWith('/dashboard?page=1');
  });

  it('renders a valid page using its single dashboard result', async () => {
    mocks.dashboard.mockResolvedValue({
      configuredCount: 1,
      needsRestockingCount: 0,
      outOfStockCount: 0,
      rows: [],
      total: 0,
      page: 1,
      pageSize: 25,
    });
    await DashboardPage({ searchParams: Promise.resolve({ page: '1' }) });
    expect(mocks.dashboard).toHaveBeenCalledOnce();
    expect(mocks.redirect).not.toHaveBeenCalled();
  });
});
