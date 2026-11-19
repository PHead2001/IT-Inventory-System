import {
  act,
  fireEvent,
  render as renderWithDefaults,
  screen,
  within,
} from '@testing-library/react';
import type { ReactNode } from 'react';
import { PrivacyReadinessContext } from '@/components/auth/privacy-readiness';
import {
  assignmentEpoch,
  readPrivacyRevocationRevision,
} from '@/features/scan/assign-batch';
import { beforeEach, expect, it, vi } from 'vitest';
import { parseOverviewProjection, type OverviewSnapshot } from './contracts';
import { overviewFixture } from './test-fixtures';
import type { OverviewResult } from './refresh-contract';
import { stockPaths } from './charts';
const mocks = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock('./refresh.actions', () => ({ refreshOverview: mocks.refresh }));
import { OverviewView } from './overview-view';

// Match the protected caller's verified grant; ordinary SSR values remain exact.
function VerifiedCaller({ children }: { children: ReactNode }) {
  return (
    <PrivacyReadinessContext.Provider
      value={{
        ready: true,
        visible: true,
        generation: 'overview-test',
        revocationRevision: readPrivacyRevocationRevision(),
        verifiedEpoch: assignmentEpoch(),
      }}
    >
      {children}
    </PrivacyReadinessContext.Provider>
  );
}
const render = (ui: ReactNode) =>
  renderWithDefaults(ui, { wrapper: VerifiedCaller });

const snapshot = (): OverviewSnapshot => ({
  ...parseOverviewProjection(overviewFixture()),
  fetchedAt: '2026-10-14T12:01:00Z',
});
beforeEach(() => vi.resetAllMocks());

it('keeps exact values, threshold equality and stock subset meaning without adding unlike units', () => {
  const data = snapshot();
  data.stock.attention[0] = {
    ...data.stock.attention[0]!,
    available: '9007199254740993',
    threshold: '9007199254740993',
    shortfall: '0',
  };
  render(
    <OverviewView
      serverRevision="initial"
      initialSnapshot={data}
      initialMayEdit
    />,
  );
  const attention = screen.getByRole('region', {
    name: 'Items needing attention',
  });
  expect(within(attention).getAllByText('9007199254740993')).toHaveLength(2);
  expect(within(attention).getByText('At threshold')).toBeVisible();
  expect(within(attention).getByRole('listitem')).toHaveTextContent(
    'Threshold 9007199254740993 · At threshold',
  );
  expect(attention).not.toHaveTextContent('0 below threshold');
  expect(screen.getByText('Included in needs attention')).toBeVisible();
  expect(
    screen.getByRole('link', { name: 'Download low-stock CSV' }),
  ).toHaveAttribute('href', expect.stringContaining('export=low_stock'));
});

it('retains data and both real timestamps through pending/transient failure, then clears all private sections on authorization loss', async () => {
  const data = snapshot();
  let finish!: (value: OverviewResult) => void;
  mocks.refresh.mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  const { container } = render(
    <OverviewView
      serverRevision="initial"
      initialSnapshot={data}
      initialMayEdit
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Refresh overview' }));
  expect(screen.getByRole('button', { name: 'Refreshing…' })).toBeDisabled();
  expect(
    container.querySelector(`time[datetime="${data.fetchedAt}"]`),
  ).toBeInTheDocument();
  await act(async () =>
    finish({ ok: false, code: 'unexpected', clearSnapshot: false }),
  );
  expect(screen.getByRole('alert')).toHaveTextContent('Showing stale data');
  expect(
    container.querySelector(`time[datetime="${data.asOf}"]`),
  ).toBeInTheDocument();
  expect(screen.getAllByText('Cable').length).toBeGreaterThan(0);
  mocks.refresh.mockResolvedValue({
    ok: false,
    code: 'forbidden',
    clearSnapshot: true,
  });
  fireEvent.click(screen.getByRole('button', { name: 'Refresh overview' }));
  await screen.findByText(/Private Overview data has been cleared/);
  expect(screen.queryByText('Cable')).not.toBeInTheDocument();
  expect(container.querySelector('time')).toBeNull();
  expect(screen.queryByText('Add item')).not.toBeInTheDocument();
});

it('replaces timestamps/data and permissions only after successful refresh and retries initial failure', async () => {
  const data = snapshot();
  mocks.refresh.mockResolvedValue({ ok: true, snapshot: data, mayEdit: false });
  render(
    <OverviewView
      serverRevision="initial"
      initialSnapshot={null}
      initialMayEdit={false}
    />,
  );
  expect(screen.getByRole('alert')).toHaveTextContent('could not be loaded');
  fireEvent.click(screen.getByRole('button', { name: 'Refresh overview' }));
  await screen.findByText('Overview refreshed.');
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(screen.queryByText('Add item')).not.toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Scan' })).toHaveAttribute(
    'href',
    '/scan',
  );
  expect(screen.getByRole('link', { name: 'Print labels' })).toHaveAttribute(
    'href',
    '/labels',
  );
});

it('distinguishes absent monitoring from healthy monitored zero and provides staff setup links', () => {
  const data = snapshot();
  data.stock = {
    monitoredItems: '0',
    needsAttention: '0',
    zeroAvailable: '0',
    unmonitoredItems: '1',
    attention: [],
    unmonitored: [
      { itemId: data.stockTrends[0]!.itemId, name: 'Adapter', available: '0' },
    ],
  };
  const { rerender } = render(
    <OverviewView
      serverRevision="initial"
      initialSnapshot={data}
      initialMayEdit
    />,
  );
  expect(screen.getAllByText('Not configured')).toHaveLength(2);
  expect(
    screen.getByRole('link', { name: 'Set threshold for Adapter' }),
  ).toHaveAttribute(
    'href',
    '/inventory/quantity/' + data.stockTrends[0]!.itemId,
  );
  const healthy = snapshot();
  healthy.stock.needsAttention = '0';
  healthy.stock.attention = [];
  rerender(
    <OverviewView
      key="healthy"
      serverRevision="healthy"
      initialSnapshot={healthy}
      initialMayEdit={false}
    />,
  );
  expect(screen.queryByText('Not configured')).not.toBeInTheDocument();
  expect(screen.getByText(/Monitored items are above/)).toBeVisible();
});

it('links real base events once and shows separate site equipment counts and real names', () => {
  const data = snapshot();
  data.recentEvents = [
    {
      eventId: '00000000-0000-4000-8000-000000000020',
      entityId: data.stockTrends[0]!.itemId,
      recordKind: 'quantity',
      kind: 'metadata_updated',
      name: 'Cable',
      actorName: 'Casey',
      at: data.asOf,
    },
  ];
  data.atSites = {
    assets: '2',
    quantityDefinitions: '1',
    occupiedSites: '1',
    rows: [
      {
        siteId: '00000000-0000-4000-8000-000000000030',
        siteName: 'Library',
        siteActive: false,
        entityId: data.stockTrends[0]!.itemId,
        name: 'Cable',
        kind: 'quantity',
        quantity: '12345678901234567890',
      },
    ],
  };
  const { container } = render(
    <OverviewView
      serverRevision="initial"
      initialSnapshot={data}
      initialMayEdit={false}
    />,
  );
  expect(
    screen.getByRole('link', { name: 'Details updated · Cable' }),
  ).toHaveAttribute(
    'href',
    '/history/events/quantity/00000000-0000-4000-8000-000000000020',
  );
  expect(
    screen.getByText(/Library \(inactive\) · 12345678901234567890 units/),
  ).toBeVisible();
  expect(container.textContent).not.toMatch(
    /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/,
  );
});

it('breaks stock paths at gaps and exposes exact tables and unavailable coverage instead of zero', () => {
  const data = snapshot();
  const trend = data.stockTrends[0]!;
  trend.coverage = 'partial';
  trend.points[0] = {
    ...trend.points[0]!,
    value: null,
    state: 'not_yet_recorded',
  };
  data.activity.coverage = 'unavailable';
  data.activity.reason = 'activity_budget';
  data.activity.points.forEach((point) => {
    point.value = null;
  });
  render(
    <OverviewView
      serverRevision="initial"
      initialSnapshot={data}
      initialMayEdit={false}
    />,
  );
  fireEvent.click(screen.getByText('View daily stock table for Cable'));
  const stockTable = screen.getByRole('table', {
    name: 'Cable · available in storage',
  });
  expect(within(stockTable).getByText('Not yet recorded')).toBeVisible();
  expect(within(stockTable).getByText('Not available')).toBeVisible();
  expect(within(stockTable).getAllByRole('row')).toHaveLength(15);
  fireEvent.click(screen.getByText('View daily activity table'));
  expect(
    within(
      screen.getByRole('table', { name: /Recorded inventory events/ }),
    ).getAllByText('Not available'),
  ).toHaveLength(14);
  expect(
    stockPaths([
      { date: '1', value: '1' },
      { date: '2', value: null },
      { date: '3', value: '2' },
    ]),
  ).toHaveLength(2);
});

it('supersedes client recovery from an unavailable server result with a forbidden revision and ignores its old in-flight request', async () => {
  const data = snapshot();
  const { rerender, container } = render(
    <OverviewView
      serverRevision="staff:unavailable:1"
      initialSnapshot={null}
      initialMayEdit
    />,
  );
  mocks.refresh.mockResolvedValueOnce({
    ok: true,
    snapshot: data,
    mayEdit: true,
  });
  fireEvent.click(screen.getByRole('button', { name: 'Refresh overview' }));
  await screen.findByText('Overview refreshed.');
  let finish!: (result: OverviewResult) => void;
  mocks.refresh.mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Refresh overview' }));
  rerender(
    <OverviewView
      serverRevision="staff:forbidden:2"
      initialSnapshot={null}
      initialMayEdit={false}
      initialForbidden
    />,
  );
  expect(screen.queryByText('Cable')).not.toBeInTheDocument();
  expect(container.querySelector('time')).toBeNull();
  expect(screen.queryByText('Add item')).not.toBeInTheDocument();
  await act(async () => finish({ ok: true, snapshot: data, mayEdit: true }));
  expect(screen.getByRole('alert')).toHaveTextContent(
    'Private Overview data has been cleared',
  );
  expect(screen.queryByText('Cable')).not.toBeInTheDocument();
  expect(container.querySelector('time')).toBeNull();
  expect(screen.queryByText('Add item')).not.toBeInTheDocument();
});

it('applies a newly verified viewer permission on transient failure while preserving the exact stale snapshot', async () => {
  const data = snapshot();
  data.stock.unmonitoredItems = '1';
  data.stock.unmonitored = [
    { itemId: data.stockTrends[0]!.itemId, name: 'Adapter', available: '7' },
  ];
  const { container } = render(
    <OverviewView
      serverRevision="staff:1"
      initialSnapshot={data}
      initialMayEdit
    />,
  );
  expect(
    screen.getByRole('link', { name: 'Set threshold for Adapter' }),
  ).toBeVisible();
  mocks.refresh.mockResolvedValue({
    ok: false,
    code: 'unexpected',
    clearSnapshot: false,
    mayEdit: false,
  });
  fireEvent.click(screen.getByRole('button', { name: 'Refresh overview' }));
  await screen.findByRole('alert');
  expect(screen.getByRole('alert')).toHaveTextContent('Showing stale data');
  expect(screen.queryByText('Add item')).not.toBeInTheDocument();
  expect(
    screen.queryByRole('link', { name: 'Set threshold for Adapter' }),
  ).not.toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'View Adapter' })).toBeVisible();
  expect(
    container.querySelector(`time[datetime="${data.fetchedAt}"]`),
  ).toBeInTheDocument();
  expect(
    container.querySelector(`time[datetime="${data.asOf}"]`),
  ).toBeInTheDocument();
});

it('isolates concurrent requests across server revisions and ignores a deferred completion after unmount', async () => {
  const data = snapshot();
  let finishOld!: (result: OverviewResult) => void;
  let finishNew!: (result: OverviewResult) => void;
  mocks.refresh
    .mockReturnValueOnce(
      new Promise((resolve) => {
        finishOld = resolve;
      }),
    )
    .mockReturnValueOnce(
      new Promise((resolve) => {
        finishNew = resolve;
      }),
    );
  const { rerender, unmount } = render(
    <OverviewView
      serverRevision="account-one:1"
      initialSnapshot={data}
      initialMayEdit
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Refresh overview' }));
  rerender(
    <OverviewView
      serverRevision="account-two:2"
      initialSnapshot={null}
      initialMayEdit={false}
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Refresh overview' }));
  expect(mocks.refresh).toHaveBeenCalledTimes(2);
  const newer = snapshot();
  newer.stock.attention[0]!.name = 'New account item';
  newer.stockTrends = [];
  await act(async () =>
    finishNew({ ok: true, snapshot: newer, mayEdit: false }),
  );
  expect(screen.getByRole('link', { name: 'New account item' })).toBeVisible();
  await act(async () => finishOld({ ok: true, snapshot: data, mayEdit: true }));
  expect(screen.queryByText('Cable')).not.toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'New account item' })).toBeVisible();
  let finishUnmounted!: (result: OverviewResult) => void;
  mocks.refresh.mockReturnValueOnce(
    new Promise((resolve) => {
      finishUnmounted = resolve;
    }),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Refresh overview' }));
  unmount();
  render(
    <OverviewView
      serverRevision="account-two:3"
      initialSnapshot={null}
      initialMayEdit={false}
      initialForbidden
    />,
  );
  await act(async () =>
    finishUnmounted({ ok: true, snapshot: data, mayEdit: true }),
  );
  expect(screen.queryByText('Cable')).not.toBeInTheDocument();
  expect(screen.getByRole('alert')).toHaveTextContent(
    'Private Overview data has been cleared',
  );
});

it.each([
  ['quantity', 'site_issued', 'Issued to site'],
  ['asset', 'site_issued', 'Assigned to site'],
  ['quantity', 'site_corrected', 'Site count corrected'],
  ['asset', 'site_corrected', 'Site custody corrected'],
  ['quantity', 'site_written_off', 'Quantity written off at site'],
  ['asset', 'site_written_off', 'Asset written off at site'],
  ['quantity', 'internal_unknown_event', 'Inventory updated'],
] as const)(
  'uses canonical history labels for %s %s without showing internal names',
  (recordKind, kind, label) => {
    const data = snapshot();
    data.recentEvents = [
      {
        eventId: '00000000-0000-4000-8000-000000000020',
        entityId: data.stockTrends[0]!.itemId,
        recordKind,
        kind,
        name: 'Cable',
        actorName: 'Casey',
        at: data.asOf,
      },
    ];
    render(
      <OverviewView
        serverRevision="initial"
        initialSnapshot={data}
        initialMayEdit={false}
      />,
    );
    const region = screen.getByRole('region', {
      name: 'Last ten inventory events',
    });
    expect(
      within(region).getByRole('link', { name: label + ' · Cable' }),
    ).toHaveAttribute(
      'href',
      '/history/events/' + recordKind + '/00000000-0000-4000-8000-000000000020',
    );
    expect(region).not.toHaveTextContent(kind);
  },
);

it('joins current W10 visual layers only to approved actions and hero/stat visuals', () => {
  const { container } = render(
    <OverviewView
      serverRevision="w10"
      initialSnapshot={snapshot()}
      initialMayEdit
    />,
  );
  const actions = [...container.querySelectorAll('.experience-magnetic')];
  expect(
    actions.map((action) => action.getAttribute('data-overview-action')),
  ).toEqual(['add', 'print']);
  for (const action of actions) {
    expect(action.querySelectorAll('.experience-magnetic-face')).toHaveLength(
      1,
    );
    expect(action.querySelectorAll('.experience-magnetic-visual')).toHaveLength(
      1,
    );
  }
  expect(screen.getByRole('link', { name: 'Scan' })).not.toHaveClass(
    'experience-magnetic',
  );
  expect(
    screen.getByRole('button', { name: 'Refresh overview' }),
  ).not.toHaveClass('experience-magnetic');
  expect(container.querySelectorAll('.experience-tilt')).toHaveLength(5);
  expect(
    container.querySelectorAll(
      '[data-overview-tile="stat"] > .experience-tilt-visual',
    ),
  ).toHaveLength(4);
  expect(
    container.querySelectorAll(
      '[data-overview-visual="hero"] > .experience-tilt-visual',
    ),
  ).toHaveLength(1);
  expect(container.querySelector('li.experience-tilt')).toBeNull();
});
