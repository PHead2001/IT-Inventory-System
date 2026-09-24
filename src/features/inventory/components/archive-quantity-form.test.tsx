import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, it, vi } from 'vitest';
import { ArchiveQuantityForm } from './archive-quantity-form';

const mocks = vi.hoisted(() => ({
  submit: vi.fn(),
  refresh: vi.fn(),
}));
vi.mock('../actions', () => ({ submitInventory: mocks.submit }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: mocks.refresh }),
}));

const itemId = 'a1000000-0000-4000-8000-000000000001';
const firstId = 'a1000000-0000-4000-8000-000000000002';
const secondId = 'a1000000-0000-4000-8000-000000000003';
const review = {
  item_id: itemId,
  version: '2',
  archived: false,
  removed_total: '12',
  locations: [
    {
      location_id: firstId,
      code: 'ITC-S1A',
      breadcrumb: 'IT Closet / Left Storage / 1A',
      active: true,
      quantity: 8,
    },
    {
      location_id: secondId,
      code: 'ITC-S1B',
      breadcrumb: 'IT Closet / Left Storage / 1B',
      active: false,
      quantity: 4,
    },
  ],
};

beforeEach(() => {
  vi.resetAllMocks();
  mocks.submit.mockResolvedValue({
    ok: true,
    entityId: itemId,
    version: '3',
    changed: true,
  });
});

it('requires reviewed location counts, a reason and explicit stock-clear acknowledgement', async () => {
  const user = userEvent.setup();
  render(<ArchiveQuantityForm latestReview={review} />);
  expect(screen.getByText('12 units to remove')).toBeVisible();
  expect(screen.getByText(/1A.*8 → 0 units/)).toBeVisible();
  expect(screen.getByText(/1B.*inactive location.*4 → 0 units/)).toBeVisible();
  await user.type(screen.getByLabelText('Reason (required)'), 'Obsolete');
  await user.click(
    screen.getByRole('button', { name: 'Review archive and clear stock' }),
  );
  expect(
    screen.queryByRole('region', { name: 'Review changes' }),
  ).not.toBeInTheDocument();
  await user.click(screen.getByRole('checkbox', { name: /I understand/ }));
  await user.click(
    screen.getByRole('button', { name: 'Review archive and clear stock' }),
  );
  expect(
    screen.getByRole('region', { name: 'Review changes' }),
  ).toHaveTextContent('12 units from 2 locations');
  await user.click(
    screen.getByRole('button', { name: 'Confirm archive and clear stock' }),
  );
  expect(mocks.submit).toHaveBeenCalledWith({
    operation: 'quantity_archive_and_clear',
    requestId: expect.any(String),
    payload: {
      item_id: itemId,
      expected_version: '2',
      confirm_clear_stock: true,
      reason: 'Obsolete',
    },
  });
  expect(mocks.refresh).toHaveBeenCalled();
});

it('keeps the reviewed version and counts until the user explicitly accepts a concurrent update', async () => {
  const user = userEvent.setup();
  const view = render(<ArchiveQuantityForm latestReview={review} />);
  await user.type(screen.getByLabelText('Reason (required)'), 'Obsolete stock');
  await user.click(screen.getByRole('checkbox', { name: /I understand/ }));
  await user.click(
    screen.getByRole('button', { name: 'Review archive and clear stock' }),
  );
  const updated = {
    ...review,
    version: '3',
    removed_total: '13',
    locations: [{ ...review.locations[0], quantity: 9 }, review.locations[1]],
  };
  view.rerender(<ArchiveQuantityForm latestReview={updated} />);
  expect(
    screen.getByRole('button', { name: 'Confirm archive and clear stock' }),
  ).toBeDisabled();
  expect(screen.getByText('12 units to remove')).toBeVisible();
  await user.click(screen.getByRole('button', { name: 'Review latest stock' }));
  expect(screen.getByText('13 units to remove')).toBeVisible();
  expect(screen.getByLabelText('Reason (required)')).toHaveValue(
    'Obsolete stock',
  );
  expect(
    screen.getByRole('checkbox', { name: /I understand/ }),
  ).not.toBeChecked();
  await user.click(screen.getByRole('checkbox', { name: /I understand/ }));
  await user.click(
    screen.getByRole('button', { name: 'Review archive and clear stock' }),
  );
  await user.click(
    screen.getByRole('button', { name: 'Confirm archive and clear stock' }),
  );
  expect(mocks.submit).toHaveBeenCalledWith(
    expect.objectContaining({
      payload: expect.objectContaining({ expected_version: '3' }),
    }),
  );
});

it('reuses the same request after an uncertain outcome and invalidates review after a stale response', async () => {
  const user = userEvent.setup();
  mocks.submit.mockResolvedValueOnce({
    ok: false,
    kind: 'unexpected',
    code: 'unexpected',
    message: 'Result unknown',
  });
  mocks.submit.mockResolvedValueOnce({
    ok: false,
    kind: 'domain',
    code: 'stale_version',
    message: 'Record changed',
  });
  render(<ArchiveQuantityForm latestReview={review} />);
  await user.type(
    screen.getByLabelText('Reason (required)'),
    'No longer stocked',
  );
  await user.click(screen.getByRole('checkbox', { name: /I understand/ }));
  await user.click(
    screen.getByRole('button', { name: 'Review archive and clear stock' }),
  );
  await user.click(
    screen.getByRole('button', { name: 'Confirm archive and clear stock' }),
  );
  expect(await screen.findByText('Result unknown')).toBeVisible();
  await user.click(
    screen.getByRole('button', { name: 'Confirm archive and clear stock' }),
  );
  expect(mocks.submit).toHaveBeenCalledTimes(2);
  expect(mocks.submit.mock.calls[0][0].requestId).toBe(
    mocks.submit.mock.calls[1][0].requestId,
  );
  expect(await screen.findByText('Record changed')).toBeVisible();
  expect(
    screen.getByRole('checkbox', { name: /I understand/ }),
  ).not.toBeChecked();
  expect(
    screen.getByRole('button', { name: 'Review archive and clear stock' }),
  ).toBeInTheDocument();
  await act(async () => {
    await user.click(
      screen.getByRole('button', { name: 'Refresh latest stock review' }),
    );
  });
  expect(mocks.refresh).toHaveBeenCalled();
});
