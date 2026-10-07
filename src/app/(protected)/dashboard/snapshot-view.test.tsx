import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { expect, it, vi, beforeEach } from 'vitest';
const mocks = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock('./refresh.actions', () => ({ refreshDashboard: mocks.refresh }));
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
