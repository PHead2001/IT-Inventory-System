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
import userEvent from '@testing-library/user-event';
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
      authored_revision_count: '0',
      retained_value_count: '0',
      quantity_needs_metadata_count: '0',
      asset_needs_metadata_count: '0',
      will_tombstone: historicalCount !== '0' || currentCount !== '0',
      expires_at: new Date(Date.now() + 60_000).toISOString(),
    },
  };
}

beforeEach(() => {
  mocks.review.mockReset();
  mocks.submit.mockReset();
  mocks.refresh.mockReset();
});
it('reports the committed category outcome instead of generic settings success', async () => {
  mocks.submit.mockResolvedValue({ ok: true, result: { changed: true } });
  render(<SettingsPanel mode="categories" categories={[source]} canManage />);
  fireEvent.click(screen.getByRole('button', { name: 'Rename Source' }));
  fireEvent.change(screen.getByLabelText('New category name'), {
    target: { value: 'Updated source' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Save name' }));
  expect(
    await screen.findByText('Category name saved: Updated source.'),
  ).toBeVisible();
  expect(mocks.refresh).toHaveBeenCalledOnce();
});

it('focuses the category rename draft on open and restores its stable trigger on Cancel and Escape', () => {
  render(<SettingsPanel mode="categories" categories={[source]} canManage />);
  const trigger = screen.getByRole('button', { name: /^Rename/ });
  trigger.focus();
  fireEvent.click(trigger);
  const input = screen.getByLabelText('New category name');
  expect(input).toHaveFocus();
  expect(input).toHaveValue(source.name);
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(trigger).toHaveFocus();
  fireEvent.click(trigger);
  fireEvent.keyDown(screen.getByLabelText('New category name'), {
    key: 'Escape',
  });
  expect(screen.queryByLabelText('New category name')).toBeNull();
  expect(trigger).toHaveFocus();
});

it('identifies every category action independently, including long text names', () => {
  const named = [
    source,
    target,
    {
      ...source,
      id: '00000000-0000-4000-8000-000000000004',
      name:
        'Long category <script> & "name" ' + 'accessories '.repeat(12).trim(),
    },
  ];
  render(<SettingsPanel mode="categories" categories={named} canManage />);
  for (const category of named) {
    expect(
      screen.getByRole('link', { name: 'Edit form for ' + category.name }),
    ).toHaveAttribute('href', `/settings/forms/${category.id}`);
    expect(
      screen.getByRole('button', { name: 'Rename ' + category.name }),
    ).toHaveTextContent('Rename');
    expect(
      screen.getByRole('button', { name: 'Remove ' + category.name }),
    ).toHaveTextContent('Remove');
  }
  expect(screen.queryByRole('heading', { name: 'Categories' })).toBeNull();
  expect(document.querySelector('script')).toBeNull();
});

it.each([source, target])(
  'keeps focus on Remove $name when switching from a rename and restores only the next rename trigger',
  async (category) => {
    const user = userEvent.setup();
    render(
      <SettingsPanel
        mode="categories"
        categories={[source, target]}
        canManage
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Rename Source' }));
    const remove = screen.getByRole('button', {
      name: 'Remove ' + category.name,
    });
    remove.focus();
    await user.keyboard('{Enter}');
    expect(screen.queryByLabelText('New category name')).toBeNull();
    expect(remove).toHaveFocus();
    await user.click(screen.getByRole('button', { name: 'Rename Target' }));
    expect(screen.getByLabelText('New category name')).toHaveFocus();
    expect(screen.getByLabelText('New category name')).toHaveValue('Target');
    await user.keyboard('{Escape}');
    expect(screen.getByRole('button', { name: 'Rename Target' })).toHaveFocus();
  },
);

it('saves shared label defaults using the existing version and payload keys', async () => {
  mocks.submit.mockResolvedValue({ ok: true, result: { changed: true } });
  render(<SettingsPanel mode="labels" labelDefaults={defaults} canManage />);
  fireEvent.change(screen.getByRole('combobox', { name: 'Label size' }), {
    target: { value: '70x35' },
  });
  fireEvent.change(screen.getByRole('combobox', { name: 'Paper size' }), {
    target: { value: 'A4' },
  });
  const barcode = screen.getByRole('combobox', { name: 'Barcode type' });
  expect(barcode).toHaveAccessibleDescription(
    /Scanning a QR code opens the linked inventory record or location/,
  );
  expect(within(barcode).getByRole('option', { name: 'QR code' })).toHaveValue(
    'qr',
  );
  expect(screen.getByRole('option', { name: 'A4 (210 × 297 mm)' })).toHaveValue(
    'A4',
  );
  fireEvent.change(barcode, { target: { value: 'code128' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save shared defaults' }));
  await waitFor(() =>
    expect(mocks.submit).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: 'label_defaults_update',
        payload: {
          expected_version: '1',
          size: '70x35',
          page: 'A4',
          format: 'code128',
        },
      }),
    ),
  );
});

it('retains an invalid rename draft with a durable associated error and input focus', () => {
  render(<SettingsPanel mode="categories" categories={[source]} canManage />);
  fireEvent.click(screen.getByRole('button', { name: /^Rename/ }));
  const input = screen.getByLabelText('New category name');
  fireEvent.change(input, { target: { value: '  ' } });
  fireEvent.submit(input.closest('form')!);
  expect(mocks.submit).not.toHaveBeenCalled();
  expect(input).toHaveFocus();
  expect(input).toHaveValue('  ');
  expect(input).toHaveAttribute('aria-invalid', 'true');
  expect(input).toHaveAccessibleDescription(/Enter/);
});

it.each(['create', 'rename'] as const)(
  'rechecks native category %s validity on blur without another submit or value change',
  (mode) => {
    render(<SettingsPanel mode="categories" categories={[source]} canManage />);
    if (mode === 'rename')
      fireEvent.click(screen.getByRole('button', { name: 'Rename Source' }));
    const input = screen.getByLabelText(
      mode === 'rename' ? 'New category name' : 'Display name',
    ) as HTMLInputElement;
    if (mode === 'create')
      fireEvent.change(input, { target: { value: 'Adapters' } });
    input.setCustomValidity('Choose an available name.');
    fireEvent.submit(input.closest('form')!);
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveFocus();
    expect(mocks.submit).not.toHaveBeenCalled();
    input.setCustomValidity('');
    fireEvent.blur(input);
    expect(input).not.toHaveAttribute('aria-invalid');
    expect(screen.queryByRole('alert')).toBeNull();
    expect(input).not.toHaveAccessibleDescription(/Choose an available/);
    expect(mocks.submit).not.toHaveBeenCalled();
  },
);

it('keeps a submitted rename open through Escape and restores focus by identity after a successful rerender', async () => {
  let finish!: (value: unknown) => void;
  mocks.submit.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const user = userEvent.setup();
  const view = render(
    <SettingsPanel mode="categories" categories={[source]} canManage />,
  );
  await user.click(screen.getByRole('button', { name: 'Rename Source' }));
  const input = screen.getByLabelText('New category name');
  await user.clear(input);
  await user.type(input, 'Renamed source');
  await user.click(screen.getByRole('button', { name: 'Save name' }));
  expect(input).toBeDisabled();
  fireEvent.keyDown(input, { key: 'Escape' });
  expect(input).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
  view.rerender(
    <SettingsPanel
      mode="categories"
      categories={[{ ...source, name: 'Renamed source', version: '2' }]}
      canManage
    />,
  );
  await act(async () => {
    finish({ ok: true, result: { changed: true } });
  });
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'Rename Renamed source' }),
    ).toHaveFocus(),
  );
  expect(screen.queryByLabelText('New category name')).toBeNull();
  expect(mocks.submit).toHaveBeenCalledOnce();
});

it('returns focus to the surviving list when the renamed row is removed while saving', async () => {
  let finish!: (value: unknown) => void;
  mocks.submit.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const view = render(
    <SettingsPanel mode="categories" categories={[source]} canManage />,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Rename Source' }));
  fireEvent.click(screen.getByRole('button', { name: 'Save name' }));
  view.rerender(<SettingsPanel mode="categories" categories={[]} canManage />);
  await act(async () => {
    finish({ ok: true, result: { changed: true } });
  });
  await waitFor(() =>
    expect(screen.getByRole('list', { name: 'Categories' })).toHaveFocus(),
  );
});

it('shows category actions and form deep links without label controls in category mode', () => {
  render(<SettingsPanel mode="categories" categories={[source]} canManage />);
  expect(
    screen.getByRole('link', { name: 'Edit form for Source' }),
  ).toHaveAttribute('href', `/settings/forms/${source.id}`);
  expect(screen.getByRole('button', { name: 'Rename Source' })).toBeVisible();
  expect(screen.getByRole('button', { name: 'Remove Source' })).toBeVisible();
  expect(screen.queryByRole('combobox', { name: 'Label size' })).toBeNull();
});

it('shows only shared print defaults in label mode', () => {
  render(<SettingsPanel mode="labels" labelDefaults={defaults} canManage />);
  expect(screen.getByRole('combobox', { name: 'Label size' })).toBeVisible();
  expect(screen.queryByRole('button', { name: 'Add category' })).toBeNull();
});

it('explains read-only settings without exposing configuration mutations', () => {
  render(
    <SettingsPanel
      categories={[source]}
      labelDefaults={defaults}
      canManage={false}
    />,
  );
  expect(screen.getByRole('note')).toHaveTextContent(
    'requires an active staff membership with configuration access',
  );
  expect(screen.getByText('Source')).toBeVisible();
  expect(screen.getByRole('combobox', { name: 'Label size' })).toBeDisabled();
  expect(screen.queryByRole('button', { name: 'Add category' })).toBeNull();
  expect(
    screen.queryByRole('button', { name: 'Save shared defaults' }),
  ).toBeNull();
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
  fireEvent.click(within(row).getByRole('button', { name: 'Remove Source' }));
  fireEvent.click(within(row).getByRole('button', { name: 'Review impact' }));
  const review = await within(row).findByRole('region', {
    name: 'Removal impact review',
  });
  expect(review).toHaveTextContent('1 historical quantity items');
  expect(review).toHaveTextContent('retained for readable history');
  expect(within(review).getByRole('alert')).toHaveTextContent(
    'Choose a replacement',
  );
  expect(
    within(review).queryByRole('button', { name: 'Remove category Source' }),
  ).toBeNull();
  fireEvent.change(within(row).getByLabelText('Replacement category'), {
    target: { value: target.id },
  });
  fireEvent.click(within(row).getByRole('button', { name: 'Review impact' }));
  await waitFor(() =>
    expect(
      within(row).getByRole('button', { name: 'Remove category Source' }),
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
  fireEvent.click(within(row).getByRole('button', { name: 'Remove Source' }));
  fireEvent.click(within(row).getByRole('button', { name: 'Review impact' }));
  const review = await within(row).findByRole('region', {
    name: 'Removal impact review',
  });
  expect(review).toHaveTextContent('2 current quantity items');
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
  fireEvent.click(screen.getByRole('button', { name: 'Remove Source' }));
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
    'category has no inventory or history references',
  );
  const confirm = within(review).getByRole('button', {
    name: 'Remove category Source',
  });
  await waitFor(() => expect(confirm).toBeEnabled());
  fireEvent.click(confirm);
  await waitFor(() => expect(mocks.submit).toHaveBeenCalledTimes(1));
  expect(await screen.findByText('Category removed: Source.')).toBeVisible();
  view.rerender(
    <SettingsPanel categories={[]} labelDefaults={defaults} canManage />,
  );
  expect(screen.getByText(/No active categories/)).toBeInTheDocument();
});

it('names removal confirmation and committed feedback from the reviewed snapshot despite stale category props', async () => {
  const reviewed = impact(null, '0');
  reviewed.review.source_name = 'Renamed on the server';
  reviewed.review.source_version = '2';
  mocks.review.mockResolvedValue(reviewed);
  let finish!: (value: unknown) => void;
  mocks.submit.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const view = render(
    <SettingsPanel mode="categories" categories={[source]} canManage />,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Remove Source' }));
  fireEvent.click(screen.getByRole('button', { name: 'Review impact' }));
  const review = await screen.findByRole('region', {
    name: 'Removal impact review',
  });
  expect(
    screen.getByRole('heading', { name: 'Remove Renamed on the server?' }),
  ).toBeVisible();
  const confirm = within(review).getByRole('button', {
    name: 'Remove category Renamed on the server',
  });
  await waitFor(() => expect(confirm).toBeEnabled());
  fireEvent.click(confirm);
  await waitFor(() => expect(mocks.submit).toHaveBeenCalledOnce());
  expect(mocks.submit.mock.calls[0][0].payload).toEqual({
    category_id: source.id,
    replacement_id: null,
    review_token: token,
  });
  expect(
    screen.queryByText('Category removed: Renamed on the server.'),
  ).toBeNull();
  view.rerender(
    <SettingsPanel
      mode="categories"
      categories={[{ ...source, name: 'Another stale prop' }]}
      canManage
    />,
  );
  await act(async () => finish({ ok: true, result: { changed: true } }));
  expect(
    await screen.findByText('Category removed: Renamed on the server.'),
  ).toBeVisible();
  expect(screen.queryByText('Category removed: Source.')).toBeNull();
  expect(
    screen.queryByText('Category removed: Another stale prop.'),
  ).toBeNull();
  expect(mocks.refresh).toHaveBeenCalledOnce();
});

it('keeps an authored form category for history and shows target metadata gaps before removal', async () => {
  const authored = impact(target.id, '0');
  authored.review.authored_revision_count = '1';
  authored.review.retained_value_count = '2';
  authored.review.quantity_needs_metadata_count = '1';
  authored.review.will_tombstone = true;
  mocks.review.mockResolvedValue(authored);
  render(
    <SettingsPanel
      categories={[source, target]}
      labelDefaults={defaults}
      canManage
    />,
  );
  const row = screen.getByText('Source').closest('li')!;
  fireEvent.click(within(row).getByRole('button', { name: 'Remove Source' }));
  fireEvent.change(within(row).getByLabelText(/replacement/i), {
    target: { value: target.id },
  });
  fireEvent.click(within(row).getByRole('button', { name: 'Review impact' }));
  const review = await within(row).findByRole('region', {
    name: 'Removal impact review',
  });
  expect(review).toHaveTextContent('1 authored form revisions');
  expect(review).toHaveTextContent('2 records with retained custom values');
  expect(review).toHaveTextContent('1 quantity items');
  expect(review).toHaveTextContent(
    'previous answers stay available for review',
  );
  expect(review).toHaveTextContent('retained for readable history');
});

it('names the category only after its creation commits', async () => {
  let finish!: (value: unknown) => void;
  mocks.submit.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  render(<SettingsPanel mode="categories" categories={[source]} canManage />);
  fireEvent.change(screen.getByLabelText('Display name'), {
    target: { value: 'Adapters' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Add category' }));
  expect(screen.queryByText('Category added: Adapters.')).toBeNull();
  await act(async () => finish({ ok: true, result: { changed: true } }));
  expect(await screen.findByText('Category added: Adapters.')).toBeVisible();
});

it.each(['create', 'rename'] as const)(
  'shows the normalized committed category name after %s without waiting for refresh',
  async (operation) => {
    mocks.submit.mockResolvedValue({ ok: true, result: { changed: true } });
    render(<SettingsPanel mode="categories" categories={[source]} canManage />);
    if (operation === 'rename')
      fireEvent.click(screen.getByRole('button', { name: 'Rename Source' }));
    fireEvent.change(
      screen.getByLabelText(
        operation === 'create' ? 'Display name' : 'New category name',
      ),
      { target: { value: '  USB   Adapters\t and   Cables  ' } },
    );
    fireEvent.click(
      screen.getByRole('button', {
        name: operation === 'create' ? 'Add category' : 'Save name',
      }),
    );
    const expected =
      operation === 'create'
        ? 'Category added: USB Adapters and Cables.'
        : 'Category name saved: USB Adapters and Cables.';
    // textContent preserves repeated spaces that accessible queries normalize.
    expect((await screen.findByText(expected)).textContent).toBe(expected);
    expect(mocks.refresh).toHaveBeenCalledOnce();
  },
);
