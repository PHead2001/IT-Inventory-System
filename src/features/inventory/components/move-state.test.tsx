import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, it, vi } from 'vitest';
import { MutationForm } from './mutation-form';
import type { LocationRef, QuantityItem } from '../contracts-ui';
import { moveCompletionKey } from '../move-completion';

const mocks = vi.hoisted(() => ({
  submit: vi.fn(),
  refresh: vi.fn(),
  receipt: vi.fn(),
  snapshot: vi.fn(),
}));
vi.mock('../actions', () => ({
  submitInventory: mocks.submit,
  findDuplicateSerials: vi.fn(),
  reloadMoveReceipt: mocks.receipt,
  loadMoveSnapshot: mocks.snapshot,
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: mocks.refresh, push: vi.fn() }),
}));
const actorId = '00000000-0000-4000-8000-000000000099';
const source: LocationRef = {
  id: '00000000-0000-4000-8000-000000000001',
  code: 'ITC-RED',
  name: 'Red Container',
  breadcrumb: 'IT Closet / Red Container',
  active: true,
  can_hold_inventory: true,
  parentId: null,
};
const destination = {
  ...source,
  id: '00000000-0000-4000-8000-000000000002',
  code: 'ITC-BLACK',
  name: 'Black Container',
  breadcrumb: 'IT Closet / Black Container',
};
const item: QuantityItem = {
  id: '00000000-0000-4000-8000-000000000010',
  name: 'Checkpoint cables',
  description: null,
  categoryId: '00000000-0000-4000-8000-000000000020',
  categoryName: 'Cables',
  manufacturer: null,
  model: null,
  version: 1,
  archived: false,
  itemCode: null,
  reorderThreshold: null,
};
const props = {
  actorId,
  backendScope: 'https://checkpoint.example.test',
  operation: 'quantity_move' as const,
  item,
  categories: [],
  locations: [source, destination],
  balances: [{ location: source, quantity: 2 }],
};
const committed = {
  ok: true,
  entityId: item.id,
  version: '2',
  changed: true,
  eventId: '00000000-0000-4000-8000-000000000030',
  movement: {
    itemName: item.name,
    quantity: 1,
    source: { id: source.id, name: source.name, after: 1 },
    destination: { id: destination.id, name: destination.name, after: 1 },
  },
};
beforeEach(() => {
  vi.resetAllMocks();
  sessionStorage.clear();
  mocks.receipt.mockResolvedValue(committed.movement);
  mocks.submit.mockResolvedValue(committed);
  mocks.snapshot.mockResolvedValue({
    item: { ...item, version: 2 },
    locations: props.locations,
    balances: [
      { location: source, quantity: 1 },
      { location: destination, quantity: 1 },
    ],
  });
});
async function prepare() {
  const user = userEvent.setup();
  await user.click(
    await screen.findByLabelText('Destination location', {
      selector: 'button',
    }),
  );
  await user.type(
    screen.getByRole('combobox', { name: 'Search locations' }),
    'Black',
  );
  await user.click(screen.getByRole('option', { name: /Black Container/ }));
  return user;
}
it('rejects the audited 2-unit source / 3-unit overdraw inline before review and permits correction', async () => {
  render(<MutationForm {...props} />);
  const user = await prepare();
  const amount = screen.getByLabelText('Quantity to move');
  fireEvent.change(amount, { target: { value: '3' } });
  await user.click(screen.getByRole('button', { name: 'Review move stock' }));
  expect(
    screen.queryByRole('region', { name: 'Review changes' }),
  ).not.toBeInTheDocument();
  expect(amount).toHaveAttribute('aria-invalid', 'true');
  expect(amount).toHaveFocus();
  expect(screen.getByRole('alert')).toHaveTextContent(/only 2 units/i);
  expect(amount).toHaveAttribute(
    'aria-describedby',
    expect.stringContaining('quantity-error'),
  );
  expect(mocks.submit).not.toHaveBeenCalled();
  fireEvent.change(amount, { target: { value: '1' } });
  await user.click(screen.getByRole('button', { name: 'Review move stock' }));
  expect(
    screen.getByRole('region', { name: 'Review changes' }),
  ).toHaveTextContent('2 → 1 units');
  await user.click(screen.getByRole('button', { name: 'Confirm move stock' }));
  await waitFor(() => expect(mocks.submit).toHaveBeenCalledOnce());
});
it('keeps committed receipt complete across its own refresh and requires Move more', async () => {
  const view = render(<MutationForm {...props} />);
  const user = await prepare();
  await user.click(screen.getByRole('button', { name: 'Review move stock' }));
  await user.click(screen.getByRole('button', { name: 'Confirm move stock' }));
  await waitFor(() => expect(mocks.refresh).toHaveBeenCalled());
  view.rerender(
    <MutationForm
      {...props}
      item={{ ...item, version: 2 }}
      balances={[
        { location: source, quantity: 1 },
        { location: destination, quantity: 1 },
      ]}
    />,
  );
  expect(screen.getByRole('status')).toHaveTextContent(
    'Moved 1 unit from Red Container to Black Container',
  );
  expect(screen.getByRole('status')).toHaveTextContent('After this move');
  expect(screen.queryByText(/Baseline refreshed/)).not.toBeInTheDocument();
  expect(
    screen.queryByRole('button', { name: 'Review move stock' }),
  ).not.toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Move more' }));
  await waitFor(() =>
    expect(screen.getByLabelText('Quantity to move')).toHaveValue(null),
  );
  expect(mocks.submit).toHaveBeenCalledOnce();
});

it.each(['', '0', '-1', '1.5', '2147483648', '1e100'])(
  'rejects invalid whole-unit amount %j with a persistent field error',
  async (value) => {
    render(<MutationForm {...props} />);
    const user = await prepare();
    fireEvent.change(screen.getByLabelText('Quantity to move'), {
      target: { value },
    });
    await user.click(screen.getByRole('button', { name: 'Review move stock' }));
    expect(screen.getByRole('alert')).toHaveTextContent('whole number');
    expect(
      screen.queryByRole('button', { name: 'Confirm move stock' }),
    ).not.toBeInTheDocument();
    expect(mocks.submit).not.toHaveBeenCalled();
  },
);
it('invalidates reviewed stock when a newly observed revision or balance changes', async () => {
  const view = render(<MutationForm {...props} />);
  const user = await prepare();
  await user.click(screen.getByRole('button', { name: 'Review move stock' }));
  view.rerender(
    <MutationForm
      {...props}
      item={{ ...item, version: 2 }}
      balances={[{ location: source, quantity: 1 }]}
    />,
  );
  expect(
    screen.queryByRole('button', { name: 'Confirm move stock' }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole('region', { name: 'Review changes' }),
  ).not.toBeInTheDocument();
  view.rerender(<MutationForm {...props} />);
  expect(
    screen.queryByRole('button', { name: 'Confirm move stock' }),
  ).not.toBeInTheDocument();
  expect(mocks.submit).not.toHaveBeenCalled();
});
it('freezes an uncertain move and retries the exact payload, actor and request after stock refresh', async () => {
  mocks.submit
    .mockRejectedValueOnce(new Error('response lost'))
    .mockResolvedValueOnce(committed);
  const view = render(<MutationForm {...props} />);
  const user = await prepare();
  await user.click(screen.getByRole('button', { name: 'Review move stock' }));
  await user.click(screen.getByRole('button', { name: 'Confirm move stock' }));
  const retry = await screen.findByRole('button', {
    name: 'Retry this move safely',
  });
  const original = mocks.submit.mock.calls[0][0];
  expect(original.expectedActorId).toBe(actorId);
  expect(screen.getByLabelText('Quantity to move')).toBeDisabled();
  view.rerender(
    <MutationForm
      {...props}
      item={{ ...item, version: 2 }}
      balances={[{ location: source, quantity: 1 }]}
    />,
  );
  await user.click(retry);
  await waitFor(() => expect(mocks.submit).toHaveBeenCalledTimes(2));
  expect(mocks.submit.mock.calls[1][0]).toEqual(original);
  expect(await screen.findByRole('status')).toHaveTextContent('move completed');
});
it('separates genuine CAS rejection from completion and preserves intent for deliberate fresh review', async () => {
  mocks.submit
    .mockResolvedValueOnce({
      ok: false,
      kind: 'domain',
      code: 'stale_version',
      message: 'Record changed',
    })
    .mockResolvedValueOnce({ ...committed, version: '3' });
  const view = render(<MutationForm {...props} />);
  const user = await prepare();
  await user.click(screen.getByRole('button', { name: 'Review move stock' }));
  await user.click(screen.getByRole('button', { name: 'Confirm move stock' }));
  await screen.findByRole('alert');
  expect(screen.getByLabelText('Quantity to move')).toHaveValue(1);
  expect(
    screen.queryByRole('button', { name: 'Confirm move stock' }),
  ).not.toBeInTheDocument();
  await user.click(
    screen.getByRole('button', { name: 'Refresh latest record' }),
  );
  await waitFor(() => expect(mocks.snapshot).toHaveBeenCalledOnce());
  view.rerender(
    <MutationForm
      {...props}
      item={{ ...item, version: 2 }}
      balances={[
        { location: source, quantity: 1 },
        { location: destination, quantity: 1 },
      ]}
    />,
  );
  await user.click(screen.getByRole('button', { name: 'Review move stock' }));
  await user.click(screen.getByRole('button', { name: 'Confirm move stock' }));
  await waitFor(() => expect(mocks.submit).toHaveBeenCalledTimes(2));
  expect(mocks.submit.mock.calls[1][0].payload.expected_version).toBe(2);
  expect(mocks.submit.mock.calls[1][0].requestId).not.toBe(
    mocks.submit.mock.calls[0][0].requestId,
  );
});
it('requires a successful fresh read for Move more and creates a new identity with an intentional amount', async () => {
  const view = render(<MutationForm {...props} />);
  const user = await prepare();
  await user.click(screen.getByRole('button', { name: 'Review move stock' }));
  await user.click(screen.getByRole('button', { name: 'Confirm move stock' }));
  await screen.findByRole('button', { name: 'Move more' });
  const first = mocks.submit.mock.calls[0][0].requestId;
  mocks.snapshot.mockRejectedValueOnce(new Error('read failed'));
  await user.click(screen.getByRole('button', { name: 'Move more' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'could not be loaded',
  );
  expect(screen.getByRole('status')).toHaveTextContent('move completed');
  expect(
    screen.queryByRole('button', { name: 'Review move stock' }),
  ).not.toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Move more' }));
  await waitFor(() =>
    expect(screen.getByLabelText('Quantity to move')).toHaveValue(null),
  );
  view.rerender(
    <MutationForm
      {...props}
      item={{ ...item, version: 2 }}
      balances={[
        { location: source, quantity: 1 },
        { location: destination, quantity: 1 },
      ]}
    />,
  );
  fireEvent.change(screen.getByLabelText('Quantity to move'), {
    target: { value: '1' },
  });
  await user.click(screen.getByRole('button', { name: 'Review move stock' }));
  await user.click(screen.getByRole('button', { name: 'Confirm move stock' }));
  await waitFor(() => expect(mocks.submit).toHaveBeenCalledTimes(2));
  expect(mocks.submit.mock.calls[1][0].requestId).not.toBe(first);
  expect(mocks.submit.mock.calls[1][0].payload.expected_version).toBe(2);
});
it('retains acknowledged success if its receipt read failed and reloads only the receipt', async () => {
  mocks.submit.mockResolvedValue({
    ...committed,
    movement: undefined,
    refreshFailed: true,
  });
  mocks.receipt.mockResolvedValue(committed.movement);
  render(<MutationForm {...props} />);
  const user = await prepare();
  await user.click(screen.getByRole('button', { name: 'Review move stock' }));
  await user.click(screen.getByRole('button', { name: 'Confirm move stock' }));
  await user.click(
    await screen.findByRole('button', { name: 'Load move receipt' }),
  );
  await waitFor(() =>
    expect(screen.getByRole('status')).toHaveTextContent('After this move'),
  );
  expect(mocks.receipt).toHaveBeenCalledWith({
    entityId: item.id,
    eventId: committed.eventId,
    expectedActorId: actorId,
  });
  expect(mocks.submit).toHaveBeenCalledOnce();
});
it('blocks double submission while the original command is pending', async () => {
  let finish!: (result: unknown) => void;
  mocks.submit.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  render(<MutationForm {...props} />);
  const user = await prepare();
  await user.click(screen.getByRole('button', { name: 'Review move stock' }));
  const button = screen.getByRole('button', { name: 'Confirm move stock' });
  fireEvent.click(button);
  fireEvent.click(button);
  expect(mocks.submit).toHaveBeenCalledOnce();
  expect(screen.getByRole('button', { name: 'Saving…' })).toBeDisabled();
  await act(async () => finish(committed));
});

const completionKey = () =>
  moveCompletionKey(
    window.location.origin,
    props.backendScope,
    actorId,
    item.id,
  );
it('explicitly discards only a corrupt completed receipt reference after a successful fresh authorized snapshot', async () => {
  sessionStorage.setItem(completionKey(), 'malformed');
  sessionStorage.setItem('other-receipt', 'preserve');
  const view = render(<MutationForm {...props} />);
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'does not undo inventory or history',
  );
  expect(mocks.receipt).not.toHaveBeenCalled();
  mocks.snapshot.mockRejectedValueOnce(new Error('read failed'));
  const user = userEvent.setup();
  await user.click(
    screen.getByRole('button', { name: 'Discard invalid receipt reference' }),
  );
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'reference is retained',
  );
  expect(sessionStorage.getItem(completionKey())).toBe('malformed');
  mocks.refresh.mockImplementationOnce(() => {
    throw new Error('route refresh failed');
  });
  await user.click(
    screen.getByRole('button', { name: 'Discard invalid receipt reference' }),
  );
  await waitFor(() =>
    expect(screen.getByLabelText('Quantity to move')).toHaveValue(null),
  );
  expect(sessionStorage.getItem(completionKey())).toBeNull();
  expect(
    screen.getByText(
      /reference was discarded and current balances were verified/,
    ),
  ).toBeVisible();
  expect(sessionStorage.getItem('other-receipt')).toBe('preserve');
  expect(mocks.submit).not.toHaveBeenCalled();
  view.rerender(
    <MutationForm
      {...props}
      item={{ ...item, version: 2 }}
      balances={[
        { location: source, quantity: 1 },
        { location: destination, quantity: 1 },
      ]}
    />,
  );
  expect(
    screen.getByRole('button', { name: 'Review move stock' }),
  ).toBeVisible();
});
it.each(['forbidden', 'actor_changed', 'idempotency_conflict'])(
  'preserves an unresolved move identity across pre-replay %s rejection and repeated lost responses',
  async (code) => {
    mocks.submit
      .mockRejectedValueOnce(new Error('response lost'))
      .mockResolvedValueOnce({
        ok: false,
        kind: 'domain',
        code,
        message: 'Retry blocked before replay',
      })
      .mockRejectedValueOnce(new Error('second lost response'))
      .mockResolvedValueOnce(committed);
    render(<MutationForm {...props} />);
    const user = await prepare();
    await user.click(screen.getByRole('button', { name: 'Review move stock' }));
    await user.click(
      screen.getByRole('button', { name: 'Confirm move stock' }),
    );
    const command = mocks.submit.mock.calls[0][0];
    await user.click(
      await screen.findByRole('button', { name: 'Retry this move safely' }),
    );
    await waitFor(() => expect(mocks.submit).toHaveBeenCalledTimes(2));
    expect(screen.getByLabelText('Quantity to move')).toBeDisabled();
    await user.click(
      screen.getByRole('button', { name: 'Retry this move safely' }),
    );
    await waitFor(() => expect(mocks.submit).toHaveBeenCalledTimes(3));
    await user.click(
      screen.getByRole('button', { name: 'Retry this move safely' }),
    );
    await waitFor(() => expect(mocks.submit).toHaveBeenCalledTimes(4));
    for (const [retry] of mocks.submit.mock.calls)
      expect(retry).toEqual(command);
    expect(await screen.findByRole('status')).toHaveTextContent(
      'move completed',
    );
  },
);
it('restores only an authorized receipt after remount with a loading barrier and retains its pointer until fresh Move more succeeds', async () => {
  const first = render(<MutationForm {...props} />);
  const user = await prepare();
  await user.click(screen.getByRole('button', { name: 'Review move stock' }));
  await user.click(screen.getByRole('button', { name: 'Confirm move stock' }));
  await screen.findByRole('button', { name: 'Move more' });
  expect(JSON.parse(sessionStorage.getItem(completionKey())!)).toEqual({
    entityId: item.id,
    eventId: committed.eventId,
  });
  first.unmount();
  let finish!: (receipt: unknown) => void;
  mocks.receipt.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  render(<MutationForm {...props} item={{ ...item, version: 7 }} />);
  expect(screen.queryByRole('form')).not.toBeInTheDocument();
  await waitFor(() => expect(mocks.receipt).toHaveBeenCalledOnce());
  await act(async () => finish(committed.movement));
  expect(screen.getByRole('status')).toHaveTextContent(
    'After this move: Red Container 1 unit; Black Container 1 unit',
  );
  expect(
    screen.queryByRole('button', { name: 'Confirm move stock' }),
  ).not.toBeInTheDocument();
  mocks.snapshot.mockRejectedValueOnce(new Error('read failed'));
  await user.click(screen.getByRole('button', { name: 'Move more' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'could not be loaded',
  );
  expect(sessionStorage.getItem(completionKey())).not.toBeNull();
  mocks.snapshot.mockResolvedValueOnce({
    ...(await mocks.snapshot()),
    item: { ...item, version: 7 },
  });
  await user.click(screen.getByRole('button', { name: 'Move more' }));
  await waitFor(() =>
    expect(sessionStorage.getItem(completionKey())).toBeNull(),
  );
  expect(mocks.submit).toHaveBeenCalledOnce();
});
it.each([
  { actorId: '00000000-0000-4000-8000-000000000098' },
  { backendScope: 'https://other.example.test' },
])('isolates the saved receipt scope %j', async (other) => {
  sessionStorage.setItem(
    completionKey(),
    JSON.stringify({ entityId: item.id, eventId: committed.eventId }),
  );
  render(<MutationForm {...props} {...other} />);
  await screen.findByLabelText('Quantity to move');
  expect(mocks.receipt).not.toHaveBeenCalled();
  expect(screen.queryByText(/move completed/)).not.toBeInTheDocument();
});
it('does not treat a stored pointer as success until the authorized history read succeeds', async () => {
  sessionStorage.setItem(
    completionKey(),
    JSON.stringify({ entityId: item.id, eventId: committed.eventId }),
  );
  mocks.receipt.mockRejectedValueOnce(new Error('unavailable'));
  render(<MutationForm {...props} />);
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'could not be verified',
  );
  expect(screen.queryByRole('form')).not.toBeInTheDocument();
  expect(screen.queryByText(/move completed/)).not.toBeInTheDocument();
  await userEvent
    .setup()
    .click(screen.getByRole('button', { name: 'Retry loading move receipt' }));
  expect(await screen.findByRole('status')).toHaveTextContent('move completed');
  expect(mocks.submit).not.toHaveBeenCalled();
});
it('retains in-memory completion with a truthful limitation when saving the pointer fails', async () => {
  const first = render(<MutationForm {...props} />);
  const user = await prepare();
  const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new Error('quota');
  });
  await user.click(screen.getByRole('button', { name: 'Review move stock' }));
  await user.click(screen.getByRole('button', { name: 'Confirm move stock' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'cannot be retained through a page reload',
  );
  expect(screen.getByRole('status')).toHaveTextContent('move completed');
  set.mockRestore();
  first.unmount();
});
it('reports unavailable browser storage on initial recovery without preventing in-memory moves', async () => {
  const get = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
    throw new Error('storage denied');
  });
  render(<MutationForm {...props} />);
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Browser storage is unavailable',
  );
  const user = await prepare();
  await user.click(screen.getByRole('button', { name: 'Review move stock' }));
  await user.click(screen.getByRole('button', { name: 'Confirm move stock' }));
  expect(await screen.findByRole('status')).toHaveTextContent('move completed');
  get.mockRestore();
});
