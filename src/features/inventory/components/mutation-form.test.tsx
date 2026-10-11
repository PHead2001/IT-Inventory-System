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
  loadMove: vi.fn(),
  refresh: vi.fn(),
  push: vi.fn(),
}));
vi.mock('../actions', () => ({
  submitInventory: mocks.submit,
  findDuplicateSerials: mocks.duplicates,
  loadMoveSnapshot: mocks.loadMove,
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
  itemCode: null,
  reorderThreshold: null,
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
  it('shows every Move source balance before selection and retains the source on refresh', async () => {
    const user = userEvent.setup();
    mocks.submit.mockResolvedValue({
      ok: false,
      kind: 'domain',
      code: 'stale_version',
      message: 'Record changed',
    });
    const actorId = '00000000-0000-4000-8000-000000000099';
    const view = render(
      <MutationForm
        {...defaults}
        actorId={actorId}
        operation="quantity_move"
        balances={[
          { location, quantity: 8 },
          { location: destination, quantity: 13 },
        ]}
      />,
    );
    await user.click(
      await screen.findByLabelText('Source location', { exact: true }),
    );
    await user.type(
      screen.getByRole('combobox', { name: 'Search locations' }),
      'ITC',
    );
    expect(
      screen.getByRole('option', { name: /1A.*8 units available/ }),
    ).toBeVisible();
    expect(
      screen.getByRole('option', { name: /1B.*13 units available/ }),
    ).toBeVisible();
    await user.click(
      screen.getByRole('option', { name: /1B.*13 units available/ }),
    );
    await chooseLocation(user, 'Destination location', '1A');
    await user.click(screen.getByRole('button', { name: 'Review move stock' }));
    await user.click(
      screen.getByRole('button', { name: 'Confirm move stock' }),
    );
    await screen.findByText('Record changed');
    expect(mocks.submit.mock.calls[0][0].payload.expected_version).toBe(2);
    view.rerender(
      <MutationForm
        {...defaults}
        actorId={actorId}
        item={{ ...item, version: 3 }}
        operation="quantity_move"
        balances={[
          { location, quantity: 5 },
          { location: destination, quantity: 16 },
        ]}
      />,
    );
    expect(
      screen.getByLabelText('Source location', { exact: true }),
    ).toHaveTextContent('1B');
    await user.click(screen.getByLabelText('Source location', { exact: true }));
    await user.type(
      screen.getByRole('combobox', { name: 'Search locations' }),
      'ITC',
    );
    expect(
      screen.getByRole('option', { name: /1A.*5 units available/ }),
    ).toBeVisible();
    expect(
      screen.getByRole('option', { name: /1B.*16 units available/ }),
    ).toBeVisible();
    expect(
      screen.queryByRole('option', { name: /13 units available/ }),
    ).not.toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(
      screen.getByText(/Recorded source availability: 16 units/),
    ).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Review move stock' }));
    expect(
      screen.queryByRole('button', { name: 'Confirm move stock' }),
    ).not.toBeInTheDocument();
    expect(mocks.submit).toHaveBeenCalledOnce();
    mocks.loadMove.mockResolvedValue({
      item: { ...item, version: 3 },
      locations: defaults.locations,
      balances: [
        { location, quantity: 5 },
        { location: destination, quantity: 16 },
      ],
    });
    await user.click(
      screen.getByRole('button', { name: 'Refresh latest record' }),
    );
    await waitFor(() => expect(mocks.loadMove).toHaveBeenCalledOnce());
    await user.click(screen.getByRole('button', { name: 'Review move stock' }));
    await user.click(
      screen.getByRole('button', { name: 'Confirm move stock' }),
    );
    await waitFor(() => expect(mocks.submit).toHaveBeenCalledTimes(2));
    expect(mocks.submit.mock.calls[1][0].payload).toMatchObject({
      expected_version: 3,
      source_location_id: destination.id,
    });
  });
  it('marks a chosen Move source unavailable when its latest holding becomes zero without choosing another source', async () => {
    const user = userEvent.setup();
    const view = render(
      <MutationForm {...defaults} operation="quantity_move" />,
    );
    view.rerender(
      <MutationForm
        {...defaults}
        operation="quantity_move"
        balances={[
          { location, quantity: 0 },
          { location: destination, quantity: 5 },
        ]}
      />,
    );
    expect(
      screen.getByLabelText('Source location', { exact: true }),
    ).toHaveTextContent('1A');
    expect(
      screen.getByText(/Recorded source availability: unavailable/),
    ).toBeVisible();
    await user.click(screen.getByLabelText('Source location', { exact: true }));
    await user.type(
      screen.getByRole('combobox', { name: 'Search locations' }),
      'ITC',
    );
    expect(screen.queryByRole('option', { name: /1A/ })).toBeNull();
    expect(
      screen.getByRole('option', { name: /1B.*5 units available/ }),
    ).toBeVisible();
    await user.keyboard('{Escape}');
    await user.click(screen.getByRole('button', { name: 'Review move stock' }));
    expect(
      screen.queryByRole('button', { name: 'Confirm move stock' }),
    ).toBeNull();
    expect(mocks.submit).not.toHaveBeenCalled();
  });
  it('reports overdraw and missing destination together, then revalidates corrections without another review', async () => {
    const user = userEvent.setup();
    render(<MutationForm {...defaults} operation="quantity_move" />);
    const amount = screen.getByLabelText('Quantity to move');
    fireEvent.change(amount, { target: { value: '999' } });
    await user.click(screen.getByRole('button', { name: 'Review move stock' }));
    expect(
      screen.getByRole('link', { name: 'Destination location' }),
    ).toBeVisible();
    expect(
      screen.getByRole('link', { name: 'Quantity to move' }),
    ).toBeVisible();
    amount.focus();
    fireEvent.change(amount, { target: { value: '2' } });
    expect(amount).toHaveFocus();
    expect(screen.queryByRole('link', { name: 'Quantity to move' })).toBeNull();
    expect(
      screen.getByRole('link', { name: 'Destination location' }),
    ).toBeVisible();
    await chooseLocation(user, 'Destination location', '1B');
    expect(screen.queryByRole('alert')).toBeNull();
    expect(mocks.submit).not.toHaveBeenCalled();
  });

  it.each([
    [true, true, '1A'],
    [false, true, 'Select a location'],
    [true, false, 'Select a location'],
  ])(
    'defaults Restore only to an eligible recorded storage location (active=%s eligible=%s)',
    (active, eligible, expected) => {
      const recorded = { ...location, active, can_hold_inventory: eligible };
      render(
        <MutationForm
          categories={defaults.categories}
          locations={[recorded, destination]}
          operation="asset_restore"
          asset={{
            ...item,
            status: 'retired',
            assetTag: null,
            serialNumber: null,
          }}
          currentLocation={recorded}
        />,
      );
      expect(
        screen.getByLabelText('Confirmed current location'),
      ).toHaveTextContent(expected);
      expect(mocks.submit).not.toHaveBeenCalled();
    },
  );

  it('leaves site-held or missing Restore storage empty and uses a plain Reason error', async () => {
    const user = userEvent.setup();
    render(
      <MutationForm
        categories={defaults.categories}
        locations={defaults.locations}
        operation="asset_restore"
        asset={{
          ...item,
          status: 'retired',
          assetTag: null,
          serialNumber: null,
        }}
      />,
    );
    expect(
      screen.getByLabelText('Confirmed current location'),
    ).toHaveTextContent('Select a location');
    await user.click(
      screen.getByRole('button', { name: 'Review restore asset' }),
    );
    expect(screen.getByText('Enter a value for Reason.')).toBeVisible();
    expect(
      screen.queryByText('Enter a value for Reason (required).'),
    ).toBeNull();
  });

  it.each([0, 1, 2])(
    'Receive defaults only for one eligible positive holding (%s holdings)',
    (count) => {
      render(
        <MutationForm
          {...defaults}
          operation="quantity_receive"
          balances={[
            { location, quantity: count > 0 ? 1 : 0 },
            ...(count === 2 ? [{ location: destination, quantity: 2 }] : []),
          ]}
        />,
      );
      expect(screen.getByLabelText('Receive at')).toHaveTextContent(
        count === 1 ? '1A' : 'Select a location',
      );
    },
  );

  it.each([
    { ...destination, active: false },
    { ...destination, can_hold_inventory: false },
  ])(
    'Receive excludes an ineligible positive holding when choosing its sole eligible default',
    (ineligible) => {
      render(
        <MutationForm
          {...defaults}
          operation="quantity_receive"
          locations={[location, ineligible]}
          balances={[
            { location, quantity: 8 },
            { location: ineligible, quantity: 13 },
          ]}
        />,
      );
      expect(screen.getByLabelText('Receive at')).toHaveTextContent('1A');
    },
  );

  it('does not replace an edited Receive default when balances refresh', async () => {
    const user = userEvent.setup();
    const view = render(
      <MutationForm {...defaults} operation="quantity_receive" />,
    );
    expect(screen.getByLabelText('Receive at')).toHaveTextContent('1A');
    await chooseLocation(user, 'Receive at', '1B');
    view.rerender(
      <MutationForm
        {...defaults}
        balances={[{ location, quantity: 9 }]}
        operation="quantity_receive"
      />,
    );
    expect(screen.getByLabelText('Receive at')).toHaveTextContent('1B');
  });
  it.each([1, 2])(
    'uses the correct unit for %s available stock without permitting overdraw',
    async (count) => {
      const user = userEvent.setup();
      render(
        <MutationForm
          {...defaults}
          balances={[{ location, quantity: count }]}
          operation="quantity_move"
        />,
      );
      const unit = count === 1 ? 'unit' : 'units';
      expect(
        screen.getByText(`Recorded source availability: ${count} ${unit}.`, {
          exact: true,
        }),
      ).toBeVisible();
      await chooseLocation(user, 'Destination location', '1B');
      const amount = screen.getByLabelText('Quantity to move');
      await user.clear(amount);
      await user.type(amount, String(count + 1));
      await user.click(
        screen.getByRole('button', { name: 'Review move stock' }),
      );
      expect(amount).toHaveFocus();
      expect(amount).toHaveAccessibleDescription(
        `Recorded source availability: ${count} ${unit}. This source has only ${count} ${unit} available. Enter no more than ${count}.`,
      );
      expect(
        screen.queryByRole('region', { name: 'Review changes' }),
      ).toBeNull();
      expect(mocks.submit).not.toHaveBeenCalled();
    },
  );
  it.each([
    ['quantity_receive', 'Receive at', 'Review receive stock'],
    ['asset_move', 'Destination location', 'Review move asset'],
    ['asset_create', 'Destination location', 'Review add individual asset'],
  ] as const)(
    'associates the missing destination error with the actual %s picker',
    async (operation, label, reviewName) => {
      const user = userEvent.setup();
      render(
        <MutationForm
          categories={defaults.categories}
          locations={defaults.locations}
          operation={operation}
          item={operation === 'quantity_receive' ? item : undefined}
          asset={
            operation === 'asset_move'
              ? {
                  ...item,
                  status: 'active',
                  assetTag: null,
                  serialNumber: null,
                }
              : undefined
          }
          currentLocation={operation === 'asset_move' ? location : undefined}
        />,
      );
      if (operation === 'asset_create')
        await user.type(screen.getByLabelText('Name'), 'Fictional asset');
      const reason = screen.queryByLabelText('Reason (required)');
      if (reason) await user.type(reason, 'Fictional operation');
      await user.click(screen.getByRole('button', { name: reviewName }));
      const picker = screen.getByLabelText(label, { selector: 'button' });
      expect(picker).toHaveFocus();
      expect(picker).toHaveAttribute('aria-invalid', 'true');
      expect(picker).toHaveAccessibleDescription('Choose a location.');
      const error = screen.getByText('Choose a location.', { exact: true });
      expect(error).toBeVisible();
      expect(picker).toHaveAttribute('aria-describedby', error.id);
      expect(
        screen.queryByRole('region', { name: 'Review changes' }),
      ).toBeNull();
      expect(mocks.submit).not.toHaveBeenCalled();
      await chooseLocation(user, label, '1B');
      await user.click(screen.getByRole('button', { name: reviewName }));
      expect(picker).not.toHaveAttribute('aria-invalid', 'true');
      expect(
        screen.getByRole('region', { name: 'Review changes' }),
      ).toBeVisible();
      expect(mocks.submit).not.toHaveBeenCalled();
    },
  );
  it('keeps receive validation inline, associated and focused while allowing correction', async () => {
    const user = userEvent.setup();
    render(<MutationForm {...defaults} operation="quantity_receive" />);
    await chooseLocation(user, 'Receive at', '1B');
    await user.type(screen.getByLabelText('Reason (required)'), 'Delivery');
    const amount = screen.getByLabelText('Quantity to receive');
    await user.clear(amount);
    await user.type(amount, '0');
    await user.click(
      screen.getByRole('button', { name: 'Review receive stock' }),
    );
    expect(amount).toHaveFocus();
    expect(amount).toHaveAttribute('aria-invalid', 'true');
    expect(amount).toHaveAccessibleDescription('Enter at least 1.');
    expect(screen.queryByRole('region', { name: 'Review changes' })).toBeNull();
    expect(mocks.submit).not.toHaveBeenCalled();
    await user.clear(amount);
    await user.type(amount, '2');
    await user.click(
      screen.getByRole('button', { name: 'Review receive stock' }),
    );
    expect(amount).toHaveValue(2);
    expect(amount).not.toHaveAttribute('aria-invalid');
    expect(
      screen.getByRole('region', { name: 'Review changes' }),
    ).toBeVisible();
    expect(mocks.submit).not.toHaveBeenCalled();
  });
  it('exposes the Receive receipt only after its deferred mutation commits', async () => {
    let complete!: (value: {
      ok: true;
      entityId: string;
      version: string;
      changed: true;
    }) => void;
    mocks.submit.mockReturnValueOnce(
      new Promise((resolve) => {
        complete = resolve;
      }),
    );
    const user = userEvent.setup();
    render(<MutationForm {...defaults} operation="quantity_receive" />);
    await chooseLocation(user, 'Receive at', '1B');
    await user.type(screen.getByLabelText('Reason (required)'), 'Delivery');
    await user.click(
      screen.getByRole('button', { name: 'Review receive stock' }),
    );
    await user.click(
      screen.getByRole('button', { name: 'Confirm receive stock' }),
    );
    expect(mocks.submit).toHaveBeenCalledOnce();
    expect(screen.queryByText('Saved successfully.')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Done' })).toBeNull();
    expect(mocks.refresh).not.toHaveBeenCalled();

    await act(async () => {
      complete({ ok: true, entityId: item.id, version: '3', changed: true });
    });
    expect(await screen.findByText('Saved successfully.')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Done' })).toBeVisible();
    expect(mocks.refresh).toHaveBeenCalledOnce();
  });
  it('retains acknowledged sibling success when its own record refresh arrives', async () => {
    mocks.submit.mockResolvedValue({
      ok: true,
      entityId: item.id,
      version: '3',
      changed: true,
    });
    const user = userEvent.setup();
    const view = render(
      <MutationForm {...defaults} operation="quantity_receive" />,
    );
    await chooseLocation(user, 'Receive at', '1B');
    await user.type(screen.getByLabelText('Reason (required)'), 'Delivery');
    await user.click(
      screen.getByRole('button', { name: 'Review receive stock' }),
    );
    await user.click(
      screen.getByRole('button', { name: 'Confirm receive stock' }),
    );
    await waitFor(() => expect(mocks.refresh).toHaveBeenCalledOnce());
    view.rerender(
      <MutationForm
        {...defaults}
        item={{ ...item, version: 3 }}
        operation="quantity_receive"
      />,
    );
    expect(screen.getByRole('status')).toHaveTextContent('Saved successfully');
    expect(screen.queryByText(/Baseline refreshed/)).not.toBeInTheDocument();
  });
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
    mocks.submit
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce({
        ok: false,
        kind: 'domain',
        code: 'stale_version',
        message: 'Definitive stale rejection',
      });
    const user = userEvent.setup();
    render(<MutationForm {...defaults} operation="quantity_receive" />);
    await chooseLocation(user, 'Receive at', '1B');
    await user.type(screen.getByLabelText('Reason (required)'), 'Restocked');
    await user.click(
      screen.getByRole('button', { name: 'Review receive stock' }),
    );
    await user.click(
      screen.getByRole('button', {
        name: /Confirm receive stock|Retry same transaction/,
      }),
    );
    await screen.findByRole('alert');
    const first = mocks.submit.mock.calls[0][0].requestId;
    expect(screen.getByLabelText('Reason (required)')).toHaveValue('Restocked');
    await user.click(
      screen.getByRole('button', { name: 'Retry same transaction' }),
    );
    await waitFor(() => expect(mocks.submit).toHaveBeenCalledTimes(2));
    expect(mocks.submit.mock.calls[1][0].requestId).toBe(first);
    await waitFor(() =>
      expect(screen.getByLabelText('Quantity to receive')).toBeEnabled(),
    );
    await user.clear(screen.getByLabelText('Quantity to receive'));
    await user.type(screen.getByLabelText('Quantity to receive'), '2');
    mocks.submit.mockResolvedValue({
      ok: false,
      kind: 'domain',
      code: 'fixture',
      message: 'Test captured',
    });
    await user.click(
      screen.getByRole('button', { name: 'Review receive stock' }),
    );
    await user.click(
      screen.getByRole('button', { name: 'Confirm receive stock' }),
    );
    await waitFor(() => expect(mocks.submit).toHaveBeenCalledTimes(3));
    expect(mocks.submit.mock.calls[2][0].requestId).not.toBe(first);
  });
  it.each(['quantity_receive', 'asset_move', 'asset_retire'] as const)(
    'freezes %s command and keeps authentication rejection uncertain across parent refresh',
    async (operation) => {
      mocks.submit
        .mockRejectedValueOnce(new Error('response lost'))
        .mockResolvedValueOnce({
          ok: false,
          kind: 'domain',
          code: 'actor_changed',
          message: 'Actor unavailable',
        })
        .mockResolvedValueOnce({
          ok: true,
          entityId: item.id,
          version: '3',
          changed: true,
        });
      const user = userEvent.setup();
      const actorId = '00000000-0000-4000-8000-000000000099';
      const asset = {
        ...item,
        status: 'active' as const,
        assetTag: null,
        serialNumber: null,
      };
      const props = {
        ...defaults,
        actorId,
        operation,
        item: operation === 'quantity_receive' ? item : undefined,
        asset: operation === 'quantity_receive' ? undefined : asset,
        currentLocation: location,
      };
      const view = render(<MutationForm {...props} />);
      if (operation !== 'asset_retire')
        await chooseLocation(
          user,
          operation === 'quantity_receive'
            ? 'Receive at'
            : 'Destination location',
          '1B',
        );
      if (operation !== 'asset_move')
        await user.type(
          screen.getByLabelText('Reason (required)'),
          'Reviewed reason',
        );
      await user.click(screen.getByRole('button', { name: /^Review / }));
      if (operation === 'asset_retire')
        expect(
          screen.getByRole('button', { name: 'Confirm retire asset' }),
        ).toHaveAccessibleDescription('Review changes for ' + item.name);
      await user.click(screen.getByRole('button', { name: /^Confirm / }));
      await screen.findByRole('alert');
      const first = mocks.submit.mock.calls[0][0];
      expect(first).toMatchObject({
        expectedActorId: actorId,
        payload: { expected_version: 2 },
      });
      view.rerender(
        <MutationForm
          {...props}
          item={
            props.item ? { ...item, version: 3, archived: true } : undefined
          }
          asset={
            props.asset
              ? { ...asset, version: 3, status: 'retired' }
              : undefined
          }
          locations={[]}
        />,
      );
      await user.click(
        screen.getByRole('button', { name: 'Retry same transaction' }),
      );
      await screen.findByText('Actor unavailable');
      expect(mocks.submit.mock.calls[1][0]).toEqual(first);
      expect(
        screen.getByRole('button', { name: 'Retry same transaction' }),
      ).toBeEnabled();
      await user.click(
        screen.getByRole('button', { name: 'Retry same transaction' }),
      );
      await screen.findByText('Saved successfully.');
      expect(mocks.submit.mock.calls[2][0]).toEqual(first);
      expect(screen.getByRole('button', { name: 'Done' })).toBeVisible();
    },
  );
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
        name: 'Review archive quantity item',
      }),
    );
    await user.click(
      screen.getByRole('button', {
        name: 'Confirm archive quantity item',
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
it('omits an untouched threshold during metadata edits and sends explicit clear', async () => {
  mocks.submit.mockResolvedValue({
    ok: false,
    kind: 'domain',
    code: 'stale_version',
    message: 'Record changed',
  });
  const user = userEvent.setup();
  const view = render(
    <MutationForm
      {...defaults}
      item={{ ...item, reorderThreshold: 3 }}
      operation="quantity_update"
    />,
  );
  await user.clear(screen.getByLabelText('Name'));
  await user.type(screen.getByLabelText('Name'), 'New cable name');
  view.rerender(
    <MutationForm
      {...defaults}
      item={{ ...item, reorderThreshold: 8, version: 3 }}
      operation="quantity_update"
    />,
  );
  await user.click(
    screen.getByRole('button', { name: 'Review edit quantity metadata' }),
  );
  await user.click(
    screen.getByRole('button', { name: 'Confirm edit quantity metadata' }),
  );
  await waitFor(() => expect(mocks.submit).toHaveBeenCalledOnce());
  expect(mocks.submit.mock.calls[0][0].payload).not.toHaveProperty(
    'reorder_threshold',
  );
  expect(mocks.submit.mock.calls[0][0].payload.expected_version).toBe(2);
  await user.click(
    await screen.findByRole('button', { name: 'Refresh latest record' }),
  );
  expect(screen.getByLabelText('Reorder threshold (optional)')).toHaveValue(8);
  expect(screen.getByLabelText('Name')).toHaveValue('New cable name');
  await user.clear(screen.getByLabelText('Reorder threshold (optional)'));
  await user.click(
    screen.getByRole('button', { name: 'Review edit quantity metadata' }),
  );
  await user.click(
    screen.getByRole('button', { name: 'Confirm edit quantity metadata' }),
  );
  await waitFor(() => expect(mocks.submit).toHaveBeenCalledTimes(2));
  expect(mocks.submit.mock.calls[1][0].payload).toMatchObject({
    expected_version: 3,
    reorder_threshold: null,
  });
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
  await user.type(screen.getByLabelText('Serial number (optional)'), '001-A');
  await chooseLocation(user, 'Destination location', '1A');
  await user.click(
    screen.getByRole('button', { name: 'Review add individual asset' }),
  );
  expect(
    await screen.findByText(/Other switch \(SW-2, retired\)/),
  ).toBeVisible();
  expect(mocks.submit).not.toHaveBeenCalled();
  await user.click(
    await screen.findByRole('button', {
      name: 'Confirm add individual asset',
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
