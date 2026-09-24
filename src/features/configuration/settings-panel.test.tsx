import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { SettingsPanel } from './settings-panel';
import type { ConfigurationCategory, LabelDefaults } from './queries.server';

const mocks = vi.hoisted(() => ({
  review: vi.fn(),
  submit: vi.fn(),
  refresh: vi.fn(),
}));
vi.mock('./actions', () => ({
  reviewCategoryRemoval: mocks.review,
  submitConfiguration: mocks.submit,
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: mocks.refresh }),
}));

const source: ConfigurationCategory = {
  id: '00000000-0000-4000-8000-000000000001',
  code: 'SOURCE',
  name: 'Source',
  active: true,
  sort_order: 1,
  version: '1',
  removed_at: null,
};
const target: ConfigurationCategory = {
  ...source,
  id: '00000000-0000-4000-8000-000000000002',
  code: 'TARGET',
  name: 'Target',
  sort_order: 2,
};
const defaults: LabelDefaults = {
  size: '90x50',
  page: 'letter',
  format: 'qr',
  version: '1',
};
const token = '00000000-0000-4000-8000-000000000003';
function impact(
  replacementId: string | null,
  historicalCount: string,
  currentCount = '0',
) {
  return {
    ok: true as const,
    review: {
      token,
      source_id: source.id,
      source_name: source.name,
      source_version: '1',
      target_id: replacementId,
      target_name: replacementId ? target.name : null,
      target_version: replacementId ? '1' : null,
      quantity_count: currentCount,
      asset_count: '0',
      historical_quantity_count: historicalCount,
      historical_asset_count: '0',
      expires_at: new Date(Date.now() + 60_000).toISOString(),
    },
  };
}

beforeEach(() => {
  mocks.review.mockReset();
  mocks.submit.mockReset();
  mocks.refresh.mockReset();
});

it('requires a replacement for history-only references and explains tombstone retention', async () => {
  mocks.review.mockImplementation(
    async (_source: string, replacement: string | null) =>
      impact(replacement, '1'),
  );
  render(
    <SettingsPanel
      categories={[source, target]}
      labelDefaults={defaults}
      canManage
    />,
  );
  const row = screen.getByText('Source').closest('li')!;
  fireEvent.click(within(row).getByRole('button', { name: 'Remove' }));
  fireEvent.click(within(row).getByRole('button', { name: 'Review impact' }));
  const review = await within(row).findByRole('region', {
    name: 'Removal impact review',
  });
  expect(review).toHaveTextContent('1 historical quantity definitions');
  expect(review).toHaveTextContent('retained for readable history');
  expect(within(review).getByRole('alert')).toHaveTextContent(
    'Choose a replacement',
  );
  expect(
    within(review).queryByRole('button', { name: 'Confirm removal' }),
  ).toBeNull();
  fireEvent.change(within(row).getByLabelText('Replacement category'), {
    target: { value: target.id },
  });
  fireEvent.click(within(row).getByRole('button', { name: 'Review impact' }));
  await waitFor(() =>
    expect(
      within(row).getByRole('button', { name: 'Confirm removal' }),
    ).toBeInTheDocument(),
  );
  expect(mocks.review).toHaveBeenLastCalledWith(source.id, target.id);
});

it('does not call a currently referenced category unreferenced when no replacement was chosen', async () => {
  mocks.review.mockResolvedValue(impact(null, '0', '2'));
  render(
    <SettingsPanel
      categories={[source, target]}
      labelDefaults={defaults}
      canManage
    />,
  );
  const row = screen.getByText('Source').closest('li')!;
  fireEvent.click(within(row).getByRole('button', { name: 'Remove' }));
  fireEvent.click(within(row).getByRole('button', { name: 'Review impact' }));
  const review = await within(row).findByRole('region', {
    name: 'Removal impact review',
  });
  expect(review).toHaveTextContent('2 current quantity definitions');
  expect(review).toHaveTextContent('retained for readable history');
  expect(review).not.toHaveTextContent('unreferenced category will be deleted');
  expect(within(review).getByRole('alert')).toHaveTextContent(
    'Choose a replacement',
  );
});

it('allows an unreferenced last category to be deleted and shows the empty state', async () => {
  let finishReview!: (value: ReturnType<typeof impact>) => void;
  mocks.review.mockReturnValue(
    new Promise((resolve) => {
      finishReview = resolve;
    }),
  );
  mocks.submit.mockResolvedValue({
    ok: true,
    result: {
      changed: true,
      version: null,
      event_id: token,
      tombstoned: false,
    },
  });
  const view = render(
    <SettingsPanel categories={[source]} labelDefaults={defaults} canManage />,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
  fireEvent.click(screen.getByRole('button', { name: 'Review impact' }));
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'Review impact' }),
    ).toBeDisabled(),
  );
  await act(async () => finishReview(impact(null, '0')));
  const review = await screen.findByRole('region', {
    name: 'Removal impact review',
  });
  expect(review).toHaveTextContent(
    'truly unreferenced category will be deleted',
  );
  const confirm = within(review).getByRole('button', {
    name: 'Confirm removal',
  });
  await waitFor(() => expect(confirm).toBeEnabled());
  fireEvent.click(confirm);
  await waitFor(() => expect(mocks.submit).toHaveBeenCalledTimes(1));
  view.rerender(
    <SettingsPanel categories={[]} labelDefaults={defaults} canManage />,
  );
  expect(screen.getByText(/No active categories/)).toBeInTheDocument();
});
