import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MutationForm, OperationPanel } from './mutation-form';
import type { LocationRef, QuantityItem } from '../contracts-ui';
const mocks = vi.hoisted(() => ({
  submit: vi.fn(),
  duplicates: vi.fn(),
  refresh: vi.fn(),
  push: vi.fn(),
}));
vi.mock('../actions', () => ({
  submitInventory: mocks.submit,
  findDuplicateSerials: mocks.duplicates,
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: mocks.refresh, push: mocks.push }),
}));
const location: LocationRef = {
  id: '00000000-0000-4000-8000-000000000001',
  code: 'ITC-S1A',
  name: '1A',
  breadcrumb: 'IT Closet / Shelf 1 / 1A',
  active: true,
  can_hold_inventory: true,
  parentId: null,
};
const destination: LocationRef = {
  ...location,
  id: '00000000-0000-4000-8000-000000000002',
  code: 'ITC-S1B',
  name: '1B',
  breadcrumb: 'IT Closet / Shelf 1 / 1B',
};
const item: QuantityItem = {
  id: '00000000-0000-4000-8000-000000000010',
  name: 'Patch cables',
  description: null,
  categoryId: '00000000-0000-4000-8000-000000000020',
  categoryName: 'Cables',
  manufacturer: null,
  model: null,
  version: 2,
  archived: false,
};
const defaults = {
  item,
  categories: [{ id: item.categoryId, name: 'Cables', active: true }],
  locations: [location, destination],
  balances: [{ location, quantity: 8 }],
};
beforeEach(() => {
  vi.clearAllMocks();
  mocks.duplicates.mockResolvedValue([]);
});
async function chooseLocation(
  user: ReturnType<typeof userEvent.setup>,
  label: string,
  name: string,
) {
  await user.click(screen.getByLabelText(label, { selector: 'button' }));
  await user.type(
    screen.getByRole('combobox', { name: 'Search locations' }),
    name,
  );
  await user.click(screen.getByRole('option', { name: new RegExp(name) }));
}
describe('inventory operation forms', () => {
  it('reviews a partial transfer and sends its source-scoped command', async () => {
    mocks.submit.mockResolvedValue({
      ok: true,
      entityId: item.id,
      version: 3,
      changed: true,
    });
    const user = userEvent.setup();
    render(<MutationForm {...defaults} operation="quantity_move" />);
    await chooseLocation(user, 'Destination location', '1B');
    await user.clear(screen.getByLabelText('Quantity to move'));
    await user.type(screen.getByLabelText('Quantity to move'), '3');
    await user.click(screen.getByRole('button', { name: 'Review move stock' }));
    expect(mocks.submit).not.toHaveBeenCalled();
    expect(screen.getByText(/8 → 5 units/)).toBeVisible();
    expect(screen.getByText(/0 → 3 units/)).toBeVisible();
    await user.click(
      screen.getByRole('button', { name: 'Confirm move stock' }),
    );
    await waitFor(() => expect(mocks.submit).toHaveBeenCalledOnce());
    expect(mocks.submit.mock.calls[0][0].payload).toMatchObject({
      item_id: item.id,
      expected_version: 2,
      source_location_id: location.id,
      destination_location_id: destination.id,
      quantity: 3,
      move_all: false,
    });
  });
  it('Move All omits a stale numeric quantity and only uses the selected source', async () => {
    mocks.submit.mockResolvedValue({
      ok: true,
      entityId: item.id,
      version: 3,
      changed: true,
    });
    const user = userEvent.setup();
    render(<MutationForm {...defaults} operation="quantity_move" />);
    await chooseLocation(user, 'Destination location', '1B');
    await user.click(
      screen.getByLabelText('Move All from this source location'),
    );
    expect(screen.queryByLabelText('Quantity to move')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Review move stock' }));
    expect(screen.getByText(/8 → 0 units/)).toBeVisible();
    await user.click(
      screen.getByRole('button', { name: 'Confirm move stock' }),
    );
    await waitFor(() => expect(mocks.submit).toHaveBeenCalledOnce());
    expect(mocks.submit.mock.calls[0][0].payload).toMatchObject({
      source_location_id: location.id,
      move_all: true,
    });
    expect(mocks.submit.mock.calls[0][0].payload).not.toHaveProperty(
      'quantity',
    );
  });
  it('keeps a selected destination visible and blocks review if it becomes unavailable', async () => {
    const user = userEvent.setup();
    const view = render(
      <MutationForm {...defaults} operation="quantity_move" />,
    );
    await chooseLocation(user, 'Destination location', '1B');
    view.rerender(
      <MutationForm
        {...defaults}
        locations={[location, { ...destination, active: false }]}
        operation="quantity_move"
      />,
    );
    expect(screen.getByLabelText('Destination location')).toHaveTextContent(
      '1B',
    );
    expect(screen.getByLabelText('Destination location')).toHaveAttribute(
      'aria-invalid',
      'true',
    );
    await user.click(screen.getByRole('button', { name: 'Review move stock' }));
    expect(
      screen.queryByRole('region', { name: 'Review changes' }),
    ).not.toBeInTheDocument();
    expect(mocks.submit).not.toHaveBeenCalled();
  });
  it('requires an explicit source when several holdings exist and excludes it from destinations', async () => {
    const user = userEvent.setup();
    render(
      <MutationForm
        {...defaults}
        balances={[
          { location, quantity: 8 },
          { location: destination, quantity: 2 },
        ]}
        operation="quantity_move"
      />,
    );
    expect(screen.getByLabelText('Source location')).toHaveTextContent(
      'Select a location',
    );
    await user.click(screen.getByLabelText('Source location'));
    await user.click(screen.getByRole('treeitem', { name: /1B/ }));
    await user.click(screen.getByLabelText('Destination location'));
    expect(
      screen.queryByRole('treeitem', { name: /1B/ }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole('treeitem', { name: /1A/ })).toBeVisible();
  });
  it('preserves input and request identity after an uncertain failure, changing identity when input changes', async () => {
    mocks.submit.mockRejectedValue(new Error('network'));
    const user = userEvent.setup();
    render(<MutationForm {...defaults} operation="quantity_receive" />);
    await chooseLocation(user, 'Receive at', '1B');
    await user.type(screen.getByLabelText('Reason (required)'), 'Restocked');
    await user.click(
      screen.getByRole('button', { name: 'Review receive stock' }),
    );
    await user.click(
      screen.getByRole('button', { name: 'Confirm receive stock' }),
    );
    await screen.findByRole('alert');
    const first = mocks.submit.mock.calls[0][0].requestId;
    expect(screen.getByLabelText('Reason (required)')).toHaveValue('Restocked');
    await user.click(
      screen.getByRole('button', { name: 'Confirm receive stock' }),
    );
    await waitFor(() => expect(mocks.submit).toHaveBeenCalledTimes(2));
    expect(mocks.submit.mock.calls[1][0].requestId).toBe(first);
    await user.clear(screen.getByLabelText('Quantity to receive'));
    await user.type(screen.getByLabelText('Quantity to receive'), '2');
    await user.click(
      screen.getByRole('button', { name: 'Review receive stock' }),
    );
    await user.click(
      screen.getByRole('button', { name: 'Confirm receive stock' }),
    );
    await waitFor(() => expect(mocks.submit).toHaveBeenCalledTimes(3));
    expect(mocks.submit.mock.calls[2][0].requestId).not.toBe(first);
  });
  it('surfaces stale conflicts and retains observed count on refresh', async () => {
    mocks.submit.mockResolvedValue({
      ok: false,
      kind: 'domain',
      code: 'stale_version',
      message: 'Record changed',
    });
    const user = userEvent.setup();
    render(<MutationForm {...defaults} operation="quantity_adjust" />);
    await chooseLocation(user, 'Counted location', '1A');
    fireEvent.change(screen.getByLabelText('Observed physical count'), {
      target: { value: '5' },
    });
    await user.type(
      screen.getByLabelText('Reason (required)'),
      'Counted today',
    );
    await user.click(
      screen.getByRole('button', { name: 'Review correct physical count' }),
    );
    expect(screen.getByText(/recorded 8 → observed 5/)).toBeVisible();
    await user.click(
      screen.getByRole('button', { name: 'Confirm correct physical count' }),
    );
    await user.click(
      await screen.findByRole('button', { name: 'Refresh latest record' }),
    );
    expect(mocks.refresh).toHaveBeenCalled();
    expect(screen.getByLabelText('Observed physical count')).toHaveValue(5);
    expect(screen.getByLabelText('Reason (required)')).toHaveValue(
      'Counted today',
    );
  });
  it('disables submit during an outstanding mutation', async () => {
    let finish!: (value: unknown) => void;
    mocks.submit.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const user = userEvent.setup();
    render(<MutationForm {...defaults} operation="quantity_archive" />);
    await user.type(screen.getByLabelText('Reason (required)'), 'Unused');
    await user.click(
      screen.getByRole('button', {
        name: 'Review archive quantity definition',
      }),
    );
    await user.click(
      screen.getByRole('button', {
        name: 'Confirm archive quantity definition',
      }),
    );
    expect(screen.getByRole('button', { name: 'Saving…' })).toBeDisabled();
    expect(screen.getByLabelText('Reason (required)')).toBeDisabled();
    await act(async () =>
      finish({
        ok: false,
        kind: 'unexpected',
        code: 'unexpected',
        message: 'Test completed',
      }),
    );
  });
});

it('keeps edited values paired with their old version until an explicit stale refresh', async () => {
  mocks.submit.mockResolvedValue({
    ok: false,
    kind: 'domain',
    code: 'stale_version',
    message: 'Record changed',
  });
  const user = userEvent.setup();
  const view = render(
    <MutationForm {...defaults} operation="quantity_update" />,
  );
  await user.clear(screen.getByLabelText('Name'));
  await user.type(screen.getByLabelText('Name'), 'My pending edit');
  view.rerender(
    <MutationForm
      {...defaults}
      item={{ ...item, name: 'Concurrent edit', version: 3 }}
      operation="quantity_update"
    />,
  );
  await user.click(
    await screen.findByRole('button', {
      name: 'Review edit quantity metadata',
    }),
  );
  expect(
    screen.getByText('name: Patch cables → My pending edit'),
  ).toBeVisible();
  await user.click(
    screen.getByRole('button', { name: 'Confirm edit quantity metadata' }),
  );
  await screen.findByRole('alert');
  expect(mocks.submit.mock.calls[0][0].payload.expected_version).toBe(2);
  await user.click(
    screen.getByRole('button', { name: 'Refresh latest record' }),
  );
  expect(screen.getByLabelText('Name')).toHaveValue('My pending edit');
  expect(
    screen.queryByRole('button', { name: 'Confirm edit quantity metadata' }),
  ).not.toBeInTheDocument();
  await user.click(
    await screen.findByRole('button', {
      name: 'Review edit quantity metadata',
    }),
  );
  expect(
    screen.getByText('name: Concurrent edit → My pending edit'),
  ).toBeVisible();
  await user.click(
    screen.getByRole('button', { name: 'Confirm edit quantity metadata' }),
  );
  await waitFor(() => expect(mocks.submit).toHaveBeenCalledTimes(2));
  expect(mocks.submit.mock.calls[1][0].payload.expected_version).toBe(3);
});
it('automatically warns about duplicate serials before saving without blocking confirmation', async () => {
  const user = userEvent.setup();
  mocks.duplicates.mockResolvedValue([
    { id: 'other', name: 'Other switch', assetTag: 'SW-2', status: 'retired' },
  ]);
  mocks.submit.mockResolvedValue({
    ok: true,
    entityId: 'new-asset',
    version: 1,
    changed: true,
  });
  render(
    <MutationForm
      categories={defaults.categories}
      locations={defaults.locations}
      operation="asset_create"
    />,
  );
  await user.type(screen.getByLabelText('Name'), 'New switch');
  await user.type(screen.getByLabelText('Serial number'), '001-A');
  await chooseLocation(user, 'Destination location', '1A');
  await user.click(
    screen.getByRole('button', { name: 'Review create serialized asset' }),
  );
  expect(
    await screen.findByText(/Other switch \(SW-2, retired\)/),
  ).toBeVisible();
  expect(mocks.submit).not.toHaveBeenCalled();
  await user.click(
    await screen.findByRole('button', {
      name: 'Confirm create serialized asset',
    }),
  );
  await waitFor(() => expect(mocks.submit).toHaveBeenCalledOnce());
  expect(mocks.submit.mock.calls[0][0].payload.serial_number).toBe('001-A');
});

it('an unopened operation panel captures the latest version when first opened', async () => {
  const user = userEvent.setup();
  mocks.submit.mockResolvedValue({
    ok: false,
    kind: 'domain',
    code: 'stale_version',
    message: 'Test result',
  });
  const view = render(
    <OperationPanel {...defaults} operation="quantity_update" />,
  );
  expect(screen.queryByRole('form')).not.toBeInTheDocument();
  view.rerender(
    <OperationPanel
      {...defaults}
      item={{ ...item, name: 'Received stock', version: 3 }}
      operation="quantity_update"
    />,
  );
  await user.click(screen.getByText('Edit quantity metadata', { exact: true }));
  await screen.findByRole('form', { name: 'Edit quantity metadata' });
  expect(screen.getByLabelText('Name')).toHaveValue('Received stock');
  await user.click(
    screen.getByRole('button', { name: 'Review edit quantity metadata' }),
  );
  await user.click(
    screen.getByRole('button', { name: 'Confirm edit quantity metadata' }),
  );
  await waitFor(() => expect(mocks.submit).toHaveBeenCalledOnce());
  expect(mocks.submit.mock.calls[0][0].payload.expected_version).toBe(3);
});
