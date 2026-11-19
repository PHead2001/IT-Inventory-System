import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('server-only', () => ({}));
const mocks = vi.hoisted(() => ({
  dashboard: vi.fn(),
  redirect: vi.fn(),
  member: vi.fn(),
  overview: vi.fn(),
}));
vi.mock('@/lib/auth/session.server', () => ({ requireMember: mocks.member }));
vi.mock('@/features/overview/queries.server', () => ({
  getOverviewSnapshot: mocks.overview,
}));
vi.mock('@/features/inventory/queries.server', () => ({
  getLowStockDashboard: mocks.dashboard,
}));
vi.mock('next/navigation', () => ({
  redirect: mocks.redirect,
  unstable_rethrow: vi.fn(),
  useRouter: () => ({ refresh: vi.fn() }),
}));
import DashboardPage from './page';
import { ProtectedPrivacyContent } from '@/components/auth/privacy-content';
import { PrivacyReadinessContext } from '@/components/auth/privacy-readiness';
import {
  parseOverviewProjection,
  OverviewReadError,
} from '@/features/overview/contracts';
import { overviewFixture } from '@/features/overview/test-fixtures';

beforeEach(() => {
  vi.resetAllMocks();
  mocks.member.mockResolvedValue({
    member: { user_id: 'route-test-actor', role: 'staff', active: true },
  });
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
      await DashboardPage({
        searchParams: Promise.resolve({ view: 'low-stock' }),
      }),
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
    rerender(
      await DashboardPage({
        searchParams: Promise.resolve({ view: 'low-stock' }),
      }),
    );
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

it('loads the new Overview in explicit UTC with viewer-safe actions and one scoped read', async () => {
  mocks.member.mockResolvedValue({
    member: { user_id: 'route-test-actor', role: 'viewer', active: true },
  });
  mocks.overview.mockResolvedValue({
    ...parseOverviewProjection(overviewFixture()),
    fetchedAt: '2026-10-14T12:01:00Z',
  });
  render(await DashboardPage({ searchParams: Promise.resolve({}) }));
  expect(screen.getByRole('heading', { name: 'Overview' })).toBeVisible();
  expect(screen.queryByText('Add item')).not.toBeInTheDocument();
  expect(mocks.overview).toHaveBeenCalledExactlyOnceWith('UTC');
  expect(mocks.dashboard).not.toHaveBeenCalled();
});

it('gives repeated unavailable server results distinct auth-bound revisions, including denial after failure', async () => {
  mocks.member.mockResolvedValue({
    member: {
      user_id: '00000000-0000-4000-8000-000000000099',
      role: 'staff',
      active: true,
    },
  });
  mocks.overview
    .mockRejectedValueOnce(new OverviewReadError('unexpected'))
    .mockRejectedValueOnce(new OverviewReadError('forbidden'));
  const failed = await DashboardPage({ searchParams: Promise.resolve({}) });
  const denied = await DashboardPage({ searchParams: Promise.resolve({}) });
  expect(failed.props.children.props.children.props.serverRevision).toContain(
    '00000000-0000-4000-8000-000000000099',
  );
  expect(denied.props.children.props.children.props.serverRevision).not.toBe(
    failed.props.children.props.children.props.serverRevision,
  );
  expect(denied.props.children.props.children.props.initialForbidden).toBe(
    true,
  );
  expect(denied.props.children.props.children.props.initialMayEdit).toBe(false);
});

it('renders a retryable region without an invented initial snapshot', async () => {
  mocks.member.mockResolvedValue({
    member: { user_id: 'route-test-actor', role: 'staff', active: true },
  });
  mocks.overview.mockRejectedValue(new OverviewReadError('unexpected'));
  render(await DashboardPage({ searchParams: Promise.resolve({}) }));
  expect(screen.getByRole('alert')).toHaveTextContent(
    'Overview could not be loaded',
  );
  expect(screen.queryByText('Cable')).not.toBeInTheDocument();
});

it('keeps the explicit legacy view when recovering an obsolete page', async () => {
  mocks.dashboard.mockResolvedValue({ page: 2, total: 1, pageSize: 25 });
  await expect(
    DashboardPage({
      searchParams: Promise.resolve({ view: 'low-stock', page: '2' }),
    }),
  ).rejects.toThrow('NEXT_REDIRECT');
  expect(mocks.redirect).toHaveBeenCalledWith(
    '/dashboard?view=low-stock&page=1',
  );
});

it('keeps Overview inside the existing privacy gate and registers readiness for its actual caller/query', async () => {
  mocks.overview.mockResolvedValue({
    ...parseOverviewProjection(overviewFixture()),
    fetchedAt: '2026-10-14T12:01:00Z',
  });
  const page = await DashboardPage({
    searchParams: Promise.resolve({ view: 'overview' }),
  });
  expect(page.type).toBe(ProtectedPrivacyContent);
  expect(page.props.children.props).toMatchObject({
    actorId: 'route-test-actor',
    routeKey: '/dashboard?view=overview',
    contentIdentity: '/dashboard',
  });
  const screenFor = (ready: boolean) => (
    <PrivacyReadinessContext.Provider
      value={{ ready, visible: ready, generation: 'test-caller' }}
    >
      {page}
    </PrivacyReadinessContext.Provider>
  );
  const view = render(screenFor(false));
  expect(screen.queryByText('Cable')).not.toBeInTheDocument();
  view.rerender(screenFor(true));
  expect(screen.getByRole('heading', { name: 'Overview' })).toBeVisible();
  expect(screen.getAllByText('Cable').length).toBeGreaterThan(0);
  view.rerender(screenFor(false));
  expect(
    screen.getByText('What needs attention and what changed.'),
  ).not.toBeVisible();
});
