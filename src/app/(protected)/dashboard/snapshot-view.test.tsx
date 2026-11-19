import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { expect, it, vi, beforeEach, afterEach } from 'vitest';
import { PrivacyReadinessContext } from '@/components/auth/privacy-readiness';
import { PeekProvider } from '@/features/peek/peek-provider';
import {
  assignmentEpoch,
  readPrivacyRevocationRevision,
} from '@/features/scan/assign-batch';
import type { DashboardSnapshot } from './snapshot.server';
const mocks = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock('./refresh.actions', () => ({ refreshDashboard: mocks.refresh }));
vi.mock('next/navigation', () => ({
  usePathname: () => '/dashboard',
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('@/components/experience/motion-preference', () => ({
  useEffectiveReducedMotion: () => true,
}));
vi.mock('@/lib/supabase/browser', () => ({
  createSupabaseBrowserClient: () => ({
    auth: {
      onAuthStateChange: () => ({
        data: { subscription: { unsubscribe() {} } },
      }),
    },
  }),
}));
import { DashboardSnapshotView } from './snapshot-view';
const initial = {
  fetchedAt: '2026-10-07T10:00:00Z',
  result: {
    configuredCount: 2,
    needsRestockingCount: 0,
    outOfStockCount: 0,
    rows: [],
    total: 0,
    page: 1,
    pageSize: 25,
  },
};
beforeEach(() => vi.resetAllMocks());
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
it('retains the actual snapshot and timestamp while pending and failed, and replaces both only on successful completion', async () => {
  let finish!: (value: { ok: false }) => void;
  mocks.refresh.mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  const { container } = render(
    <DashboardSnapshotView initialSnapshot={initial} params={{}} />,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Refresh overview' }));
  expect(screen.getByRole('button', { name: 'Refreshing…' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Refreshing…' })).toHaveAttribute(
    'aria-busy',
    'true',
  );
  expect(container.querySelector('time')).toHaveAttribute(
    'datetime',
    initial.fetchedAt,
  );
  await act(async () => {
    finish({ ok: false });
  });
  expect(screen.getByRole('alert')).toHaveTextContent('Showing stale data');
  expect(container.querySelector('time')).toHaveAttribute(
    'datetime',
    initial.fetchedAt,
  );
  expect(
    screen.getAllByText(/2 monitored active quantity items/)[0],
  ).toBeVisible();
  mocks.refresh.mockResolvedValue({
    ok: true,
    snapshot: {
      ...initial,
      fetchedAt: '2026-10-07T11:00:00Z',
      result: { ...initial.result, configuredCount: 3 },
    },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Refresh overview' }));
  await waitFor(() =>
    expect(screen.getByRole('status')).toHaveTextContent(
      'Overview refreshed successfully.',
    ),
  );
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(container.querySelector('time')).toHaveAttribute(
    'datetime',
    '2026-10-07T11:00:00Z',
  );
  expect(
    screen.getAllByText(/3 monitored active quantity items/)[0],
  ).toBeVisible();
  expect(mocks.refresh).toHaveBeenNthCalledWith(1, 1);
});
it('also keeps useful data if the transport rejects, allowing a later retry', async () => {
  mocks.refresh.mockRejectedValue(new Error('offline'));
  render(<DashboardSnapshotView initialSnapshot={initial} params={{}} />);
  fireEvent.click(screen.getByRole('button', { name: 'Refresh overview' }));
  await screen.findByRole('alert');
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'Refresh overview' }),
    ).toBeEnabled(),
  );
});

it.each(['Adapters', 'View item and locations'])(
  'opens a lazy current record peek from Overview %s while preserving aggregate navigation',
  async (label) => {
    const actor = '00000000-0000-4000-8000-000000000001';
    const item = '00000000-0000-4000-8000-000000000002';
    const backend = 'https://dashboard-peek.test';
    const snapshot: DashboardSnapshot = {
      ...initial,
      result: {
        ...initial.result,
        needsRestockingCount: 1,
        total: 1,
        rows: [
          {
            id: item,
            name: 'Adapters',
            categoryName: 'Adapters',
            recordedTotal: 3,
            availableQuantity: '2',
            assignedQuantity: '1',
            ownedQuantity: '3',
            reorderThreshold: 5,
            stockState: 'needs_restocking',
          },
        ],
      },
    };
    vi.spyOn(HTMLElement.prototype, 'getClientRects').mockReturnValue([
      new DOMRect(10, 20, 200, 30),
    ] as unknown as DOMRectList);
    const fetcher = vi.fn().mockResolvedValue(
      Response.json({
        actor,
        backend,
        payload: {
          target: { kind: 'quantity', id: item },
          name: 'Current adapters',
          status: 'active',
          assetTag: null,
          stock: { available: '2', assigned: '1', recorded: '3' },
          locations: [],
          moreLocations: false,
          siteName: null,
          photo: null,
        },
      }),
    );
    vi.stubGlobal('fetch', fetcher);
    render(
      <PrivacyReadinessContext
        value={{
          ready: true,
          visible: true,
          generation: 'dashboard-peek',
          verifiedEpoch: assignmentEpoch(),
          revocationRevision: readPrivacyRevocationRevision(),
        }}
      >
        <PeekProvider actor={actor} backend={backend}>
          <DashboardSnapshotView initialSnapshot={snapshot} params={{}} />
        </PeekProvider>
      </PrivacyReadinessContext>,
    );
    const link = screen.getByRole('link', { name: label });
    expect(fetcher).not.toHaveBeenCalled();
    act(() => link.focus());
    expect(await screen.findByText('Current adapters')).toBeInTheDocument();
    expect(screen.getByRole('dialog')).toHaveTextContent('Current adapters');
    expect(fetcher).toHaveBeenCalledWith(
      '/api/peek?kind=quantity&id=' + item,
      expect.objectContaining({ cache: 'no-store' }),
    );
    expect(link).toHaveAttribute('href', '/inventory/quantity/' + item);
    for (const name of [
      'Browse quantity items and thresholds',
      'View filtered inventory',
      'Download low-stock CSV',
    ]) {
      expect(screen.getByRole('link', { name })).not.toHaveAttribute(
        'aria-haspopup',
      );
    }
    expect(mocks.refresh).not.toHaveBeenCalled();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
  },
);

it('retains each stat term and its exact accessible definition inside a stationary current Overview tile', () => {
  const view = render(
    <DashboardSnapshotView initialSnapshot={initial} params={{}} />,
  );
  const group = screen.getByRole('group', { name: 'Storage health counts' });
  expect(
    within(group)
      .getAllByRole('term')
      .map((node) => node.textContent),
  ).toEqual([
    'Needs restocking',
    'Out of stock (subset)',
    'Monitored active items',
  ]);
  expect(within(group).getAllByRole('definition')).toHaveLength(3);
  expect(
    [...group.querySelectorAll('[data-count-final]')].map(
      (node) => node.textContent,
    ),
  ).toEqual(['0', '0', '2']);
  expect(view.container.querySelectorAll('.experience-tilt')).toHaveLength(3);
  expect(
    screen
      .getByRole('button', { name: 'Refresh overview' })
      .closest('.experience-tilt'),
  ).toBeNull();
});

it('keeps an explicit detailed-stock refresh on the legacy report path', async () => {
  mocks.refresh.mockResolvedValue({ ok: true, snapshot: initial });
  render(
    <DashboardSnapshotView
      initialSnapshot={initial}
      params={{ view: 'low-stock' }}
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Refresh overview' }));
  await waitFor(() =>
    expect(mocks.refresh).toHaveBeenCalledWith(1, 'low-stock'),
  );
});

it.each([
  ['2', 4, '2 below threshold'],
  ['4', 4, 'At threshold'],
  ['0', 0, 'At threshold'],
] as const)(
  'shows snapshot storage shortfall for available %s threshold %s',
  (availableQuantity, reorderThreshold, expected) => {
    render(
      <DashboardSnapshotView
        initialSnapshot={{
          ...initial,
          result: {
            ...initial.result,
            needsRestockingCount: 1,
            total: 1,
            rows: [
              {
                id: 'item',
                name: 'Cable',
                categoryName: 'Cables',
                recordedTotal: Number(availableQuantity),
                availableQuantity,
                assignedQuantity: '100',
                ownedQuantity: (BigInt(availableQuantity) + 100n).toString(),
                reorderThreshold,
                stockState:
                  availableQuantity === '0'
                    ? 'out_of_stock'
                    : 'needs_restocking',
              },
            ],
          },
        }}
        params={{ view: 'low-stock' }}
      />,
    );
    const detail = screen.getByRole('link', {
      name: 'View item and locations',
    });
    expect(detail.closest('li')).toHaveTextContent(expected);
    expect(detail).toHaveAttribute('href', '/inventory/quantity/item');
  },
);
