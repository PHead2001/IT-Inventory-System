import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import { AssignmentWorkspace } from './assign-workspace';
import {
  invalidateAssignmentPrivacy,
  readBatch,
  batchKey,
} from './assign-batch';
import {
  readAssignmentRecovery,
  storeAssignmentRecovery,
} from './assign-recovery';
import { assignmentCommand } from './assign-contracts';
import { QueueLogoutForm } from '@/features/labels/queue-logout-form';
const mocks = vi.hoisted(() => ({
  find: vi.fn(),
  inspect: vi.fn(),
  submit: vi.fn(),
  receipt: vi.fn(),
  signOut: vi.fn(),
  detection: null as ((value: string | null) => void) | null,
}));
vi.mock('@/lib/auth/actions', () => ({ signOutSession: mocks.signOut }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }),
}));
vi.mock('./assign-actions', () => ({
  findAssignmentRecords: mocks.find,
  inspectAssignmentRecord: mocks.inspect,
}));
vi.mock('@/features/custody/actions', () => ({
  submitCustody: mocks.submit,
  loadCustodyReceipt: mocks.receipt,
}));
vi.mock('./assign-camera', () => ({
  AssignCamera: ({
    onDetection,
  }: {
    onDetection: (value: string | null) => void;
  }) => {
    mocks.detection = onDetection;
    return <p>Controlled scanner input</p>;
  },
}));
const id = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const site = {
  id: id(1),
  name: 'Headquarters',
  code: 'HQ',
  active: true,
  version: '1',
  notes: null,
};
const props = {
  actorId: id(2),
  backend: 'https://isolated.supabase.co',
  sites: [site],
  initialSiteId: site.id,
  locations: [
    {
      id: id(3),
      code: 'ITC-RED',
      name: 'Red',
      breadcrumb: 'Closet / Red',
      active: true,
      can_hold_inventory: true,
      parentId: null,
    },
  ],
};
const candidate = {
  kind: 'quantity' as const,
  id: id(4),
  path: '/inventory/quantity/' + id(4),
  name: 'Adapters',
  identifier: '0001-A/B',
  status: 'active' as const,
  version: '7',
  currentSite: null,
  sources: [{ id: id(3), name: 'Closet / Red', active: true, quantity: 2 }],
};
const match = {
  kind: 'quantity',
  path: candidate.path,
  label: 'Adapters',
  state: 'active',
};
beforeEach(() => {
  sessionStorage.clear();
  vi.resetAllMocks();
  mocks.find.mockResolvedValue({ ok: true, status: 'found', matches: [match] });
  mocks.inspect.mockResolvedValue({ ok: true, candidate });
  mocks.submit.mockResolvedValue({
    ok: true,
    entityId: candidate.id,
    version: '8',
    changed: true,
    eventId: id(8),
    custody: {
      eventId: id(8),
      operation: 'issued',
      actorName: 'Staff',
      createdAt: '2026-10-07T12:00:00Z',
      quantity: 1,
      source: { id: id(3), kind: 'storage', name: 'Closet / Red', after: 1 },
      destination: { id: site.id, kind: 'site', name: site.name, after: 1 },
      reference: 'TICKET-1',
      reason: null,
    },
  });
});
async function inspect() {
  fireEvent.change(screen.getByLabelText('Scan, paste, or search inventory'), {
    target: { value: candidate.path },
  });
  fireEvent.submit(screen.getByRole('form', { name: 'Inspect equipment' }));
  await screen.findByRole('region', { name: 'Review assignment' });
}
it('inspects keyboard input without mutation, confirms once, keeps context and accepts a deliberate fresh repeat', async () => {
  render(<AssignmentWorkspace {...props} />);
  fireEvent.change(
    screen.getByLabelText('Ticket number reference (optional)'),
    { target: { value: 'TICKET-1' } },
  );
  await inspect();
  expect(mocks.submit).not.toHaveBeenCalled();
  expect(screen.getByLabelText('Units to assign')).toHaveValue(1);
  const confirm = screen.getByRole('button', { name: 'Confirm assign' });
  act(() => {
    fireEvent.click(confirm);
    fireEvent.click(confirm);
  });
  await screen.findByRole('region', { name: 'Latest assignment receipt' });
  expect(mocks.submit).toHaveBeenCalledTimes(1);
  expect(
    screen.getByLabelText('Ticket number reference (optional)'),
  ).toHaveValue('TICKET-1');
  expect(screen.getByLabelText('Scan, paste, or search inventory')).toHaveValue(
    '',
  );
  fireEvent.click(
    screen.getByRole('button', { name: 'Rescan / choose another' }),
  );
  mocks.inspect.mockResolvedValue({
    ok: true,
    candidate: {
      ...candidate,
      version: '8',
      sources: [{ ...candidate.sources[0], quantity: 1 }],
    },
  });
  await inspect();
  fireEvent.click(screen.getByRole('button', { name: 'Confirm assign' }));
  await waitFor(() => expect(mocks.submit).toHaveBeenCalledTimes(2));
  expect(mocks.submit.mock.calls[1][0].requestId).not.toBe(
    mocks.submit.mock.calls[0][0].requestId,
  );
  expect(mocks.submit.mock.calls[1][0].payload.expected_version).toBe('8');
});
it('retains exact unknown command across remount and authorization failure before allowing any next operation', async () => {
  mocks.submit
    .mockRejectedValueOnce(new Error('lost response'))
    .mockResolvedValueOnce({
      ok: false,
      code: 'P1001',
      message: 'Access revoked',
    })
    .mockResolvedValueOnce({
      ok: true,
      entityId: candidate.id,
      version: '8',
      changed: true,
      eventId: id(8),
    });
  const view = render(<AssignmentWorkspace {...props} />);
  await inspect();
  fireEvent.click(screen.getByRole('button', { name: 'Confirm assign' }));
  await screen.findByRole('button', { name: 'Retry same assignment' });
  const original = mocks.submit.mock.calls[0][0];
  expect(screen.getByLabelText('Destination site')).toBeDisabled();
  expect(
    screen.getByRole('button', { name: 'Rescan / choose another' }),
  ).toBeDisabled();
  view.unmount();
  render(<AssignmentWorkspace {...props} />);
  fireEvent.click(
    await screen.findByRole('button', { name: 'Retry same assignment' }),
  );
  await screen.findByText('Access revoked', { selector: 'p[role=status]' });
  expect(screen.getByLabelText('Storage source')).toBeDisabled();
  fireEvent.click(
    screen.getByRole('button', { name: 'Retry same assignment' }),
  );
  await screen.findByRole('region', { name: 'Latest assignment receipt' });
  expect(mocks.submit.mock.calls.map((call) => call[0])).toEqual([
    original,
    original,
    original,
  ]);
});
it('requires an explicit choice when there are multiple source holdings and rejects insufficient units', async () => {
  mocks.inspect.mockResolvedValue({
    ok: true,
    candidate: {
      ...candidate,
      sources: [
        ...candidate.sources,
        { id: id(9), name: 'Black', active: true, quantity: 1 },
      ],
    },
  });
  render(<AssignmentWorkspace {...props} />);
  await inspect();
  expect(screen.getByLabelText('Storage source')).toHaveValue('');
  expect(screen.getByRole('button', { name: 'Confirm assign' })).toBeDisabled();
  fireEvent.change(screen.getByLabelText('Storage source'), {
    target: { value: id(9) },
  });
  expect(screen.getByRole('button', { name: 'Confirm assign' })).toBeEnabled();
  fireEvent.change(screen.getByLabelText('Units to assign'), {
    target: { value: '2' },
  });
  expect(screen.getByRole('button', { name: 'Confirm assign' })).toBeDisabled();
});
it('drops late lookups when destination changes and suppresses camera duplicates during review and held-label success', async () => {
  let finish!: (value: unknown) => void;
  mocks.find.mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  render(
    <AssignmentWorkspace
      {...props}
      sites={[site, { ...site, id: id(10), name: 'Remote' }]}
    />,
  );
  act(() => {
    mocks.detection?.(candidate.path);
  });
  fireEvent.change(screen.getByLabelText('Destination site'), {
    target: { value: id(10) },
  });
  await act(async () => {
    finish({ ok: true, status: 'found', matches: [match] });
  });
  expect(mocks.inspect).not.toHaveBeenCalled();
  fireEvent.click(
    screen.getByRole('button', { name: 'Rescan / choose another' }),
  );
  act(() => {
    mocks.detection?.(candidate.path);
    mocks.detection?.(candidate.path);
  });
  await screen.findByRole('region', { name: 'Review assignment' });
  const calls = mocks.find.mock.calls.length;
  act(() => {
    mocks.detection?.(candidate.path);
  });
  expect(mocks.find.mock.calls.length).toBe(calls);
  fireEvent.click(screen.getByRole('button', { name: 'Confirm assign' }));
  await screen.findByRole('region', { name: 'Latest assignment receipt' });
  act(() => {
    mocks.detection?.(candidate.path);
  });
  expect(mocks.find.mock.calls.length).toBe(calls);
  fireEvent.click(
    screen.getByRole('button', { name: 'Rescan / choose another' }),
  );
  act(() => {
    mocks.detection?.(candidate.path);
  });
  await waitFor(() => expect(mocks.find.mock.calls.length).toBe(calls + 1));
});
it('shows ambiguous identities for manual choice without submitting or silently preferring a namespace', async () => {
  mocks.find.mockResolvedValue({
    ok: true,
    status: 'ambiguous',
    matches: [
      match,
      {
        kind: 'asset',
        path: '/inventory/assets/' + id(11),
        label: 'Laptop',
        state: 'active',
      },
    ],
  });
  render(<AssignmentWorkspace {...props} />);
  fireEvent.change(screen.getByLabelText('Scan, paste, or search inventory'), {
    target: { value: 'SHARED' },
  });
  fireEvent.submit(screen.getByRole('form', { name: 'Inspect equipment' }));
  await screen.findByRole('list', { name: 'Choose inventory record' });
  expect(mocks.inspect).not.toHaveBeenCalled();
  expect(mocks.submit).not.toHaveBeenCalled();
  fireEvent.click(
    screen.getByRole('button', { name: 'Adapters · quantity · active' }),
  );
  await screen.findByRole('region', { name: 'Review assignment' });
  expect(mocks.submit).not.toHaveBeenCalled();
});

it('pages distinct search candidates without losing destination/ticket and inspects only the selected typed record', async () => {
  const later = {
    kind: 'asset',
    path: '/inventory/assets/' + id(11),
    label: 'Later laptop',
    state: 'active',
  };
  mocks.find
    .mockResolvedValueOnce({
      ok: true,
      status: 'ambiguous',
      matches: [match],
      searchPage: { query: 'Adapter', page: 1, pageSize: 25, total: 26 },
    })
    .mockResolvedValueOnce({
      ok: true,
      status: 'ambiguous',
      matches: [later],
      searchPage: { query: 'Adapter', page: 2, pageSize: 25, total: 26 },
    });
  mocks.inspect.mockResolvedValue({
    ok: true,
    candidate: {
      ...candidate,
      kind: 'asset',
      id: id(11),
      path: later.path,
      name: later.label,
    },
  });
  render(<AssignmentWorkspace {...props} />);
  fireEvent.change(
    screen.getByLabelText('Ticket number reference (optional)'),
    { target: { value: 'BATCH-42' } },
  );
  fireEvent.change(screen.getByLabelText('Lookup method'), {
    target: { value: 'search' },
  });
  fireEvent.change(screen.getByLabelText('Scan, paste, or search inventory'), {
    target: { value: 'Adapter' },
  });
  fireEvent.submit(screen.getByRole('form', { name: 'Inspect equipment' }));
  await screen.findByRole('button', { name: 'Next candidates' });
  expect(
    screen.getByRole('button', { name: 'Previous candidates' }),
  ).toBeDisabled();
  expect(mocks.inspect).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Next candidates' }));
  const selected = await screen.findByRole('button', {
    name: 'Later laptop · asset · active',
  });
  expect(
    screen.getByRole('button', { name: 'Next candidates' }),
  ).toBeDisabled();
  expect(
    screen.getByRole('button', { name: 'Previous candidates' }),
  ).toBeEnabled();
  expect(mocks.find).toHaveBeenLastCalledWith({
    actorId: props.actorId,
    text: 'Adapter',
    mode: 'search',
    page: 2,
  });
  expect(screen.getByLabelText('Destination site')).toHaveValue(site.id);
  expect(
    screen.getByLabelText('Ticket number reference (optional)'),
  ).toHaveValue('BATCH-42');
  fireEvent.click(selected);
  await screen.findByRole('region', { name: 'Review assignment' });
  expect(mocks.inspect).toHaveBeenCalledWith({
    actorId: props.actorId,
    siteId: site.id,
    path: later.path,
  });
  expect(mocks.submit).not.toHaveBeenCalled();
});
it('restores an empty search-page failure to one pending review when returning to populated candidates without writes', async () => {
  const populated = {
    ok: true,
    status: 'ambiguous',
    matches: [match],
    searchPage: { query: 'Adapter', page: 1, pageSize: 25, total: 26 },
  };
  mocks.find
    .mockResolvedValueOnce(populated)
    .mockResolvedValueOnce({
      ...populated,
      matches: [],
      searchPage: { ...populated.searchPage, page: 2 },
    })
    .mockResolvedValueOnce(populated);
  render(<AssignmentWorkspace {...props} />);
  fireEvent.change(screen.getByLabelText('Lookup method'), {
    target: { value: 'search' },
  });
  fireEvent.change(screen.getByLabelText('Scan, paste, or search inventory'), {
    target: { value: 'Adapter' },
  });
  fireEvent.submit(screen.getByRole('form', { name: 'Inspect equipment' }));
  fireEvent.click(
    await screen.findByRole('button', { name: 'Next candidates' }),
  );
  await screen.findByText(/No records remain on this candidate page/);
  const failed = readBatch(scope).value!.entries[0];
  expect(failed.status).toBe('failed');
  expect(
    screen.getByRole('region', { name: 'Batch checklist' }),
  ).toHaveTextContent('1 failed');
  fireEvent.click(screen.getByRole('button', { name: 'Previous candidates' }));
  fireEvent.click(
    await screen.findByRole('button', { name: 'Adapters · quantity · active' }),
  );
  await screen.findByRole('region', { name: 'Review assignment' });
  const reviewed = readBatch(scope).value!.entries;
  expect(reviewed).toHaveLength(1);
  expect(reviewed[0]).toMatchObject({
    id: failed.id,
    status: 'pending',
    message: '',
    requestId: null,
  });
  expect(
    screen.getByRole('region', { name: 'Batch checklist' }),
  ).toHaveTextContent('0 failed');
  expect(
    screen.getByRole('region', { name: 'Batch checklist' }),
  ).toHaveTextContent('1 pending');
  expect(
    screen.queryByText('No matching inventory record.'),
  ).not.toBeInTheDocument();
  expect(mocks.submit).not.toHaveBeenCalled();
});
it('drops a late candidate-page response after the batch destination changes', async () => {
  let finish!: (value: unknown) => void;
  mocks.find
    .mockResolvedValueOnce({
      ok: true,
      status: 'ambiguous',
      matches: [match],
      searchPage: { query: 'Adapter', page: 1, pageSize: 25, total: 26 },
    })
    .mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
  render(
    <AssignmentWorkspace
      {...props}
      sites={[site, { ...site, id: id(10), name: 'Remote' }]}
    />,
  );
  fireEvent.change(screen.getByLabelText('Lookup method'), {
    target: { value: 'search' },
  });
  fireEvent.change(screen.getByLabelText('Scan, paste, or search inventory'), {
    target: { value: 'Adapter' },
  });
  fireEvent.submit(screen.getByRole('form', { name: 'Inspect equipment' }));
  fireEvent.click(
    await screen.findByRole('button', { name: 'Next candidates' }),
  );
  fireEvent.change(screen.getByLabelText('Destination site'), {
    target: { value: id(10) },
  });
  await act(async () => {
    finish({
      ok: true,
      status: 'ambiguous',
      matches: [{ ...match, label: 'Stale later page' }],
      searchPage: { query: 'Adapter', page: 2, pageSize: 25, total: 26 },
    });
  });
  expect(screen.queryByText(/Stale later page/)).not.toBeInTheDocument();
  expect(
    screen.queryByRole('navigation', { name: 'Assignment candidate pages' }),
  ).not.toBeInTheDocument();
  expect(screen.getByLabelText('Destination site')).toHaveValue(id(10));
  expect(mocks.inspect).not.toHaveBeenCalled();
  expect(mocks.submit).not.toHaveBeenCalled();
});

it('keeps a known commit visible when receipt details fail and reloads only its exact authorized event', async () => {
  const saved = await mocks.submit();
  mocks.submit.mockClear();
  mocks.submit.mockResolvedValue({ ...saved, custody: undefined });
  mocks.receipt.mockResolvedValue(saved.custody);
  render(<AssignmentWorkspace {...props} />);
  await inspect();
  fireEvent.click(screen.getByRole('button', { name: 'Confirm assign' }));
  await screen.findByText('Assignment confirmed · Adapters');
  expect(screen.getByText(/Reviewed operation:/)).toHaveTextContent(
    'Closet / Red → Headquarters',
  );
  expect(
    screen.getByLabelText('Scan, paste, or search inventory'),
  ).toBeEnabled();
  fireEvent.click(
    screen.getByRole('button', { name: 'Reload committed receipt' }),
  );
  await screen.findByRole('region', { name: 'Committed custody receipt' });
  expect(mocks.receipt).toHaveBeenCalledWith({
    kind: 'quantity',
    entityId: candidate.id,
    eventId: id(8),
    expectedActorId: props.actorId,
  });
  expect(mocks.submit).toHaveBeenCalledTimes(1);
});

it('recovers from a network failure during explicit stale-state inspection without leaving a busy workspace', async () => {
  mocks.submit.mockResolvedValue({
    ok: false,
    code: 'P1002',
    message: 'Record changed.',
  });
  render(<AssignmentWorkspace {...props} />);
  await inspect();
  fireEvent.click(screen.getByRole('button', { name: 'Confirm assign' }));
  await screen.findByRole('button', { name: 'Inspect current state' });
  mocks.inspect.mockRejectedValue(new Error('network lost'));
  fireEvent.click(
    screen.getByRole('button', { name: 'Inspect current state' }),
  );
  await screen.findByText(
    'Inspection could not complete. Retry the lookup; nothing was assigned.',
  );
  expect(
    screen.getByRole('button', { name: 'Rescan / choose another' }),
  ).toBeEnabled();
  expect(
    screen.queryByRole('button', { name: 'Confirm assign' }),
  ).not.toBeInTheDocument();
  expect(mocks.submit).toHaveBeenCalledTimes(1);
});
it('requires explicit refreshed inspection after a stale rejection and preserves the originally reviewed version until then', async () => {
  mocks.submit.mockResolvedValue({
    ok: false,
    code: 'P1002',
    message: 'Record changed.',
  });
  render(<AssignmentWorkspace {...props} />);
  await inspect();
  fireEvent.click(screen.getByRole('button', { name: 'Confirm assign' }));
  await screen.findByRole('button', { name: 'Inspect current state' });
  const rejected = readBatch(scope).value!.entries[0];
  expect(rejected.status).toBe('failed');
  expect(rejected.requestId).not.toBeNull();
  expect(mocks.inspect).toHaveBeenCalledTimes(1);
  expect(mocks.submit.mock.calls[0][0].payload.expected_version).toBe('7');
  expect(screen.getByRole('button', { name: 'Confirm assign' })).toBeDisabled();
  mocks.inspect.mockResolvedValue({
    ok: true,
    candidate: { ...candidate, version: '9' },
  });
  fireEvent.click(
    screen.getByRole('button', { name: 'Inspect current state' }),
  );
  await screen.findByText(/Version 9/);
  const refreshed = readBatch(scope).value!.entries;
  expect(refreshed).toHaveLength(2);
  expect(refreshed[0]).toEqual(rejected);
  expect(refreshed[1]).toMatchObject({
    status: 'pending',
    message: '',
    requestId: null,
  });
  expect(
    screen.getByRole('region', { name: 'Batch checklist' }),
  ).toHaveTextContent('1 failed');
  expect(
    screen.getByRole('region', { name: 'Batch checklist' }),
  ).toHaveTextContent('1 pending');
  expect(mocks.submit).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole('button', { name: 'Confirm assign' }));
  await waitFor(() => expect(mocks.submit).toHaveBeenCalledTimes(2));
  expect(mocks.submit.mock.calls[1][0].payload.expected_version).toBe('9');
  expect(mocks.submit.mock.calls[1][0].requestId).not.toBe(
    mocks.submit.mock.calls[0][0].requestId,
  );
});
it('does not submit if durable storage fails and preserves success if only terminal cleanup fails', async () => {
  const view = render(<AssignmentWorkspace {...props} />);
  await inspect();
  const store = vi
    .spyOn(Storage.prototype, 'setItem')
    .mockImplementation(() => {
      throw new Error('quota');
    });
  fireEvent.click(screen.getByRole('button', { name: 'Confirm assign' }));
  await screen.findByText(/Nothing was submitted/);
  expect(mocks.submit).not.toHaveBeenCalled();
  store.mockRestore();
  const remove = vi
    .spyOn(Storage.prototype, 'removeItem')
    .mockImplementation(() => {
      throw new Error('storage unavailable');
    });
  fireEvent.click(screen.getByRole('button', { name: 'Confirm assign' }));
  await screen.findByRole('region', { name: 'Latest assignment receipt' });
  expect(
    screen.getByLabelText('Scan, paste, or search inventory'),
  ).toBeDisabled();
  const original = mocks.submit.mock.calls[0][0];
  remove.mockRestore();
  view.unmount();
  render(<AssignmentWorkspace {...props} />);
  await screen.findByRole('region', { name: 'Latest assignment receipt' });
  expect(mocks.submit).toHaveBeenCalledTimes(1);
  expect(mocks.submit.mock.calls[0][0]).toEqual(original);
  expect(
    screen.getByLabelText('Scan, paste, or search inventory'),
  ).toBeEnabled();
});
it('masks the previous actor batch and discards late pending results on account change', async () => {
  let finish!: (value: unknown) => void;
  mocks.submit.mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  const view = render(<AssignmentWorkspace {...props} />);
  await inspect();
  fireEvent.click(screen.getByRole('button', { name: 'Confirm assign' }));
  view.rerender(
    <AssignmentWorkspace
      {...props}
      actorId={id(19)}
      initialSiteId={undefined}
    />,
  );
  expect(screen.queryByText('Adapters')).not.toBeInTheDocument();
  await act(async () => {
    finish({ ok: true, entityId: candidate.id, version: '8', changed: true });
  });
  expect(
    screen.queryByRole('region', { name: 'Latest assignment receipt' }),
  ).not.toBeInTheDocument();
  expect(screen.getByLabelText('Destination site')).toHaveValue('');
  view.rerender(<AssignmentWorkspace {...props} />);
  await screen.findByRole('button', { name: 'Retry same assignment' });
  expect(mocks.submit).toHaveBeenCalledTimes(1);
});

const scope = {
  actor: props.actorId,
  origin: window.location.origin,
  backend: props.backend,
};
it('retains context and historical inspection across a record visit/remount and ignores a new URL destination hint', async () => {
  const view = render(<AssignmentWorkspace {...props} />);
  fireEvent.change(
    screen.getByLabelText('Ticket number reference (optional)'),
    { target: { value: 'PRIVATE-BATCH' } },
  );
  fireEvent.click(
    screen.getByRole('combobox', {
      name: 'Preferred storage source (optional)',
    }),
  );
  fireEvent.click(
    screen.getByRole('treeitem', { name: /Red, selectable location/ }),
  );
  await inspect();
  expect(
    screen.getByRole('region', { name: 'Review assignment' }),
  ).toHaveFocus();
  view.unmount();
  mocks.inspect.mockResolvedValue({
    ok: true,
    candidate: {
      ...candidate,
      version: '12',
      sources: [{ ...candidate.sources[0], quantity: 1 }],
    },
  });
  render(
    <AssignmentWorkspace
      {...props}
      sites={[site, { ...site, id: id(12), name: 'Other' }]}
      initialSiteId={id(12)}
    />,
  );
  expect(screen.getByLabelText('Destination site')).toHaveValue(site.id);
  expect(
    screen.getByLabelText('Ticket number reference (optional)'),
  ).toHaveValue('PRIVATE-BATCH');
  expect(
    screen.getByRole('combobox', {
      name: 'Preferred storage source (optional)',
    }),
  ).toHaveTextContent('Red');
  expect(screen.getByRole('button', { name: 'Confirm assign' })).toBeDisabled();
  expect(mocks.submit).not.toHaveBeenCalled();
  await screen.findByText(/Version 12/);
  expect(mocks.inspect).toHaveBeenCalledTimes(2);
  expect(readBatch(scope).value?.entries).toHaveLength(1);
  expect(screen.getByRole('button', { name: 'Confirm assign' })).toBeEnabled();
  expect(mocks.submit).not.toHaveBeenCalled();
});
it('saves immutable operation context, separates totals, and Finish/End never submits stock writes', async () => {
  const view = render(<AssignmentWorkspace {...props} />);
  fireEvent.change(
    screen.getByLabelText('Ticket number reference (optional)'),
    { target: { value: 'ORIGINAL' } },
  );
  await inspect();
  fireEvent.click(screen.getByRole('button', { name: 'Confirm assign' }));
  await screen.findByRole('region', { name: 'Latest assignment receipt' });
  fireEvent.change(
    screen.getByLabelText('Ticket number reference (optional)'),
    { target: { value: 'NEW-TICKET' } },
  );
  const saved = readBatch(scope).value!;
  expect(saved.context?.reference).toBe('NEW-TICKET');
  expect(saved.entries[0]).toMatchObject({
    status: 'success',
    units: 1,
    source: 'Closet / Red',
    context: { reference: 'ORIGINAL', siteName: 'Headquarters' },
  });
  expect(
    screen.getByRole('link', { name: 'View committed history for Adapters' }),
  ).toHaveAttribute('href', `/history/events/quantity/${id(8)}`);
  fireEvent.click(screen.getByRole('button', { name: 'Finish batch' }));
  expect(
    screen.getByRole('region', { name: 'Batch summary' }),
  ).toHaveTextContent(
    '0 asset assignments · 1 quantity assignment (1 unit) confirmed',
  );
  expect(mocks.submit).toHaveBeenCalledTimes(1);
  view.unmount();
  render(<AssignmentWorkspace {...props} />);
  expect(
    screen.getByRole('region', { name: 'Batch summary' }),
  ).toBeInTheDocument();
  expect(
    screen.getByRole('button', { name: 'Inspect equipment' }),
  ).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'End batch' }));
  expect(screen.getByLabelText('Destination site')).toHaveValue('');
  expect(readBatch(scope).value).toBeNull();
  expect(mocks.submit).toHaveBeenCalledTimes(1);
});
it('immediately announces inspection, focuses Cancel before disabling input, cancels late results and restores input focus', async () => {
  let finish!: (value: unknown) => void;
  mocks.find.mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  render(<AssignmentWorkspace {...props} />);
  const input = screen.getByLabelText('Scan, paste, or search inventory');
  input.focus();
  fireEvent.change(input, { target: { value: 'ADAPTER' } });
  fireEvent.submit(screen.getByRole('form', { name: 'Inspect equipment' }));
  expect(screen.getByText('Inspecting equipment…')).toBeInTheDocument();
  expect(
    screen.getByRole('form', { name: 'Inspect equipment' }),
  ).toHaveAttribute('aria-busy', 'true');
  expect(
    screen.getByRole('button', { name: 'Cancel inspection' }),
  ).toHaveFocus();
  fireEvent.click(screen.getByRole('button', { name: 'Cancel inspection' }));
  expect(input).toHaveFocus();
  await act(async () =>
    finish({ ok: true, status: 'found', matches: [match] }),
  );
  expect(mocks.inspect).not.toHaveBeenCalled();
  expect(mocks.submit).not.toHaveBeenCalled();
  expect(readBatch(scope).value?.entries[0].status).toBe('skipped');
});
it.each(['ticket', 'destination', 'source'] as const)(
  'rejects late inspection/finally after changing %s and permits the new lookup',
  async (fieldName) => {
    let finish!: (value: unknown) => void;
    mocks.inspect.mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    render(
      <AssignmentWorkspace
        {...props}
        sites={[site, { ...site, id: id(12), name: 'Other' }]}
      />,
    );
    fireEvent.change(
      screen.getByLabelText('Scan, paste, or search inventory'),
      { target: { value: candidate.path } },
    );
    fireEvent.submit(screen.getByRole('form', { name: 'Inspect equipment' }));
    await waitFor(() => expect(mocks.inspect).toHaveBeenCalledTimes(1));
    if (fieldName === 'ticket')
      fireEvent.change(
        screen.getByLabelText('Ticket number reference (optional)'),
        { target: { value: 'NEW' } },
      );
    else if (fieldName === 'destination')
      fireEvent.change(screen.getByLabelText('Destination site'), {
        target: { value: id(12) },
      });
    else {
      fireEvent.click(
        screen.getByRole('combobox', {
          name: 'Preferred storage source (optional)',
        }),
      );
      fireEvent.click(
        screen.getByRole('treeitem', { name: /Red, selectable location/ }),
      );
    }
    let second!: (value: unknown) => void;
    mocks.find.mockReturnValueOnce(
      new Promise((resolve) => {
        second = resolve;
      }),
    );
    fireEvent.submit(screen.getByRole('form', { name: 'Inspect equipment' }));
    await act(async () => finish({ ok: true, candidate }));
    expect(
      screen.queryByRole('region', { name: 'Review assignment' }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole('form', { name: 'Inspect equipment' }),
    ).toHaveAttribute('aria-busy', 'true');
    await act(async () => second({ ok: true, status: 'unknown', matches: [] }));
    expect(
      screen.getByLabelText('Scan, paste, or search inventory'),
    ).toHaveFocus();
  },
);
it('retains original uncertain command if terminal ledger fails, then reconciles exactly once without counting replay', async () => {
  render(<AssignmentWorkspace {...props} />);
  await inspect();
  const nativeSet = Storage.prototype.setItem;
  const write = vi
    .spyOn(Storage.prototype, 'setItem')
    .mockImplementation(function (this: Storage, key, value) {
      if (
        key.startsWith('inventory-assign-batch-v1:') &&
        value.includes('"status":"success"')
      )
        throw new Error('terminal quota');
      nativeSet.call(this, key, value);
    });
  fireEvent.click(screen.getByRole('button', { name: 'Confirm assign' }));
  await screen.findByRole('button', { name: 'Retry same assignment' });
  const command = readAssignmentRecovery(scope).value!.command;
  expect(readBatch(scope).value?.entries[0].status).toBe('uncertain');
  expect(screen.queryByText(/Nothing was submitted/)).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Finish batch' })).toBeDisabled();
  write.mockRestore();
  fireEvent.click(
    screen.getByRole('button', { name: 'Retry same assignment' }),
  );
  await screen.findByRole('region', { name: 'Latest assignment receipt' });
  expect(mocks.submit.mock.calls[1][0]).toEqual(command);
  expect(
    readBatch(scope).value?.entries.filter((row) => row.status === 'success'),
  ).toHaveLength(1);
  expect(readAssignmentRecovery(scope).value).toBeNull();
});
it('privacy invalidates an unmounted pending writer and cannot resurrect context after authoritative logout', async () => {
  let finish!: (value: unknown) => void;
  const success = await mocks.submit();
  mocks.submit.mockClear();
  mocks.submit.mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  const view = render(<AssignmentWorkspace {...props} />);
  await inspect();
  fireEvent.click(screen.getByRole('button', { name: 'Confirm assign' }));
  view.unmount();
  invalidateAssignmentPrivacy(true);
  await act(async () => finish(success));
  expect(readBatch(scope).value).toBeNull();
  expect(readAssignmentRecovery(scope).value).toBeNull();
  render(<AssignmentWorkspace {...props} initialSiteId={undefined} />);
  expect(screen.getByLabelText('Destination site')).toHaveValue('');
  expect(
    screen.queryByRole('region', { name: 'Latest assignment receipt' }),
  ).not.toBeInTheDocument();
});
it('blocks a restored inactive destination and keeps corrupt batch data intact', async () => {
  const view = render(<AssignmentWorkspace {...props} />);
  await inspect();
  view.unmount();
  const second = render(
    <AssignmentWorkspace {...props} sites={[{ ...site, active: false }]} />,
  );
  expect(
    screen.getByText(/The saved destination is unavailable/),
  ).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Confirm assign' })).toBeDisabled();
  fireEvent.click(
    screen.getByRole('button', { name: 'Inspect current state' }),
  );
  expect(mocks.inspect).toHaveBeenCalledTimes(1);
  second.unmount();
  sessionStorage.setItem(batchKey(scope), '{broken');
  render(<AssignmentWorkspace {...props} />);
  expect(
    screen.getByText(/earlier assignment recovery record is unavailable/),
  ).toBeInTheDocument();
  expect(
    screen.getByRole('button', { name: 'Inspect equipment' }),
  ).toBeDisabled();
  expect(sessionStorage.getItem(batchKey(scope))).toBe('{broken');
  expect(mocks.submit).not.toHaveBeenCalled();
});
it('migrates legacy command-only recovery into one uncertain row before any fresh read or write', async () => {
  const context = {
    siteId: site.id,
    siteName: site.name,
    sourceId: '',
    reference: 'LEGACY',
  };
  const command = assignmentCommand(
    candidate,
    context,
    id(3),
    '1',
    props.actorId,
    id(20),
  );
  expect(
    storeAssignmentRecovery(
      {
        version: 1,
        scope,
        context,
        candidate,
        sourceId: id(3),
        units: '1',
        command,
      },
      null,
    ),
  ).toBe(true);
  render(<AssignmentWorkspace {...props} />);
  expect(readBatch(scope).value?.entries).toHaveLength(1);
  expect(readBatch(scope).value?.entries[0]).toMatchObject({
    status: 'uncertain',
    requestId: command.requestId,
    context: { reference: 'LEGACY' },
  });
  expect(mocks.inspect).not.toHaveBeenCalled();
  expect(mocks.submit).not.toHaveBeenCalled();
  fireEvent.click(
    screen.getByRole('button', { name: 'Retry same assignment' }),
  );
  await screen.findByRole('region', { name: 'Latest assignment receipt' });
  expect(mocks.submit.mock.calls[0][0]).toEqual(command);
  expect(readBatch(scope).value?.entries).toHaveLength(1);
});
it('keeps storage-unavailable initialization explicit without crashing or permitting writes', () => {
  const read = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
    throw new Error('unavailable');
  });
  expect(() => render(<AssignmentWorkspace {...props} />)).not.toThrow();
  expect(
    screen.getByText(/Session storage is unavailable/),
  ).toBeInTheDocument();
  expect(
    screen.getByRole('button', { name: 'Inspect equipment' }),
  ).toBeDisabled();
  expect(mocks.submit).not.toHaveBeenCalled();
  read.mockRestore();
});
it('repeated Back/remount refreshes availability without adding rows or replacing a vanished chosen source', async () => {
  const first = render(<AssignmentWorkspace {...props} />);
  await inspect();
  first.unmount();
  mocks.inspect.mockResolvedValue({
    ok: true,
    candidate: {
      ...candidate,
      version: '9',
      sources: [
        { id: id(30), name: 'Other holding', active: true, quantity: 10 },
      ],
    },
  });
  const second = render(<AssignmentWorkspace {...props} />);
  await screen.findByText(
    'Availability refreshed. Review the source and units before confirming.',
  );
  expect(screen.getByRole('button', { name: 'Confirm assign' })).toBeDisabled();
  expect(readBatch(scope).value?.historical?.sourceId).toBe(id(3));
  expect(readBatch(scope).value?.entries).toHaveLength(1);
  second.unmount();
  render(<AssignmentWorkspace {...props} />);
  await screen.findByText(
    'Availability refreshed. Review the source and units before confirming.',
  );
  expect(mocks.inspect).toHaveBeenCalledTimes(3);
  expect(readBatch(scope).value?.entries).toHaveLength(1);
  expect(mocks.submit).not.toHaveBeenCalled();
});
it('cancelled restoration ignores its late availability and finally after a new lookup', async () => {
  const first = render(<AssignmentWorkspace {...props} />);
  await inspect();
  first.unmount();
  let restored!: (value: unknown) => void;
  mocks.inspect.mockReturnValueOnce(
    new Promise((resolve) => {
      restored = resolve;
    }),
  );
  render(<AssignmentWorkspace {...props} />);
  fireEvent.click(screen.getByRole('button', { name: 'Cancel inspection' }));
  let current!: (value: unknown) => void;
  mocks.find.mockReturnValueOnce(
    new Promise((resolve) => {
      current = resolve;
    }),
  );
  fireEvent.change(screen.getByLabelText('Scan, paste, or search inventory'), {
    target: { value: 'NEW' },
  });
  fireEvent.submit(screen.getByRole('form', { name: 'Inspect equipment' }));
  await act(async () =>
    restored({
      ok: true,
      candidate: { ...candidate, name: 'Stale restored name' },
    }),
  );
  expect(
    screen.getByRole('form', { name: 'Inspect equipment' }),
  ).toHaveAttribute('aria-busy', 'true');
  expect(screen.queryByText('Stale restored name')).not.toBeInTheDocument();
  await act(async () => current({ ok: true, status: 'unknown', matches: [] }));
  expect(
    screen.getByLabelText('Scan, paste, or search inventory'),
  ).toHaveFocus();
});
it('blocks mismatched terminal/recovery snapshots before cleanup or fresh assignment', async () => {
  const view = render(<AssignmentWorkspace {...props} />);
  await inspect();
  mocks.submit.mockRejectedValueOnce(new Error('lost'));
  fireEvent.click(screen.getByRole('button', { name: 'Confirm assign' }));
  await screen.findByRole('button', { name: 'Retry same assignment' });
  view.unmount();
  const raw = readBatch(scope).value!;
  raw.entries[0] = {
    ...raw.entries[0],
    status: 'success',
    eventId: id(8),
    context: { ...raw.entries[0].context, reference: 'NOT-REVIEWED' },
  };
  sessionStorage.setItem(batchKey(scope), JSON.stringify(raw));
  const commandBefore = readAssignmentRecovery(scope).raw;
  render(<AssignmentWorkspace {...props} />);
  expect(screen.getByText(/Batch and recovery disagree/)).toBeInTheDocument();
  expect(readAssignmentRecovery(scope).raw).toBe(commandBefore);
  expect(
    screen.getByRole('button', { name: 'Inspect equipment' }),
  ).toBeDisabled();
  expect(mocks.submit).toHaveBeenCalledTimes(1);
});
it('halts at capacity without eviction and allows settled Finish/End', () => {
  const saved = {
    version: 1,
    scope,
    context: {
      siteId: site.id,
      siteName: site.name,
      sourceId: '',
      reference: '',
    },
    historical: null,
    finished: false,
    entries: Array.from({ length: 200 }, (_, n) => ({
      id: id(n + 100),
      status: 'skipped',
      name: 'Skipped equipment',
      kind: null,
      entityId: null,
      identifier: null,
      units: 0,
      source: '',
      context: {
        siteId: site.id,
        siteName: site.name,
        sourceId: '',
        reference: '',
      },
      requestId: null,
      eventId: null,
      message: '',
    })),
  };
  sessionStorage.setItem(batchKey(scope), JSON.stringify(saved));
  render(<AssignmentWorkspace {...props} />);
  fireEvent.submit(screen.getByRole('form', { name: 'Inspect equipment' }));
  expect(screen.getByText(/This batch is full/)).toBeInTheDocument();
  expect(readBatch(scope).value?.entries).toHaveLength(200);
  expect(mocks.find).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Finish batch' }));
  fireEvent.click(screen.getByRole('button', { name: 'End batch' }));
  expect(readBatch(scope).value).toBeNull();
  expect(mocks.submit).not.toHaveBeenCalled();
});
it('keeps ticket typing focus after a confirmed receipt and focuses summary/destination on Finish/End', async () => {
  const user = userEvent.setup();
  render(<AssignmentWorkspace {...props} />);
  await inspect();
  await user.click(screen.getByRole('button', { name: 'Confirm assign' }));
  await screen.findByRole('region', { name: 'Latest assignment receipt' });
  const ticket = screen.getByLabelText('Ticket number reference (optional)');
  await user.type(ticket, 'TICKET-ALL-CHARACTERS');
  expect(ticket).toHaveValue('TICKET-ALL-CHARACTERS');
  expect(ticket).toHaveFocus();
  await user.click(screen.getByRole('button', { name: 'Finish batch' }));
  expect(screen.getByRole('region', { name: 'Batch summary' })).toHaveFocus();
  await user.click(screen.getByRole('button', { name: 'End batch' }));
  expect(screen.getByLabelText('Destination site')).toHaveFocus();
});
it('reuses the pending historical row after failed automatic refresh and a deliberate inspection retry', async () => {
  const view = render(<AssignmentWorkspace {...props} />);
  await inspect();
  view.unmount();
  mocks.inspect.mockRejectedValueOnce(new Error('refresh network'));
  render(<AssignmentWorkspace {...props} />);
  await screen.findByText(/Availability could not be refreshed/);
  expect(
    screen.getByRole('button', { name: 'Inspect equipment' }),
  ).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Confirm assign' })).toBeDisabled();
  fireEvent.click(
    screen.getByRole('button', { name: 'Inspect current state' }),
  );
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'Confirm assign' }),
    ).toBeEnabled(),
  );
  expect(readBatch(scope).value?.entries).toHaveLength(1);
  fireEvent.click(screen.getByRole('button', { name: 'Confirm assign' }));
  await screen.findByRole('region', { name: 'Latest assignment receipt' });
  expect(readBatch(scope).value?.entries).toHaveLength(1);
  expect(readBatch(scope).value?.entries[0].status).toBe('success');
  expect(
    screen.getByRole('region', { name: 'Batch checklist' }),
  ).toHaveTextContent('0 pending');
});
it('failed signout preserves the exact batch and blocks a late inspection callback until a fresh workspace return', async () => {
  mocks.signOut.mockResolvedValue({
    ok: false,
    message: 'Unable to sign out. Please try again.',
  });
  const view = render(
    <>
      <QueueLogoutForm />
      <AssignmentWorkspace {...props} />
    </>,
  );
  fireEvent.change(
    screen.getByLabelText('Ticket number reference (optional)'),
    { target: { value: 'PRESERVE-PRIVATE' } },
  );
  await inspect();
  fireEvent.click(screen.getByRole('button', { name: 'Confirm assign' }));
  await screen.findByRole('region', { name: 'Latest assignment receipt' });
  let finish!: (value: unknown) => void;
  mocks.inspect.mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  fireEvent.change(screen.getByLabelText('Scan, paste, or search inventory'), {
    target: { value: candidate.path },
  });
  fireEvent.submit(screen.getByRole('form', { name: 'Inspect equipment' }));
  await waitFor(() => expect(mocks.inspect).toHaveBeenCalledTimes(2));
  const before = readBatch(scope).raw;
  fireEvent.submit(
    screen.getByRole('button', { name: 'Sign out' }).closest('form')!,
  );
  await screen.findByText('Unable to sign out. Please try again.');
  expect(readBatch(scope).raw).toBe(before);
  await act(async () =>
    finish({
      ok: true,
      candidate: { ...candidate, name: 'Late unauthorized callback' },
    }),
  );
  expect(readBatch(scope).raw).toBe(before);
  expect(
    screen.queryByText('Late unauthorized callback'),
  ).not.toBeInTheDocument();
  view.unmount();
  render(<AssignmentWorkspace {...props} />);
  expect(
    screen.getByLabelText('Ticket number reference (optional)'),
  ).toHaveValue('PRESERVE-PRIVATE');
  expect(readBatch(scope).value?.entries[0].status).toBe('success');
  expect(mocks.submit).toHaveBeenCalledTimes(1);
});
it('counts one replayed asset event once and two deliberate assignments as two events for one individual asset', async () => {
  const asset = {
    ...candidate,
    kind: 'asset' as const,
    path: '/inventory/assets/' + candidate.id,
    name: 'Laptop',
    identifier: 'TAG-1',
  };
  mocks.inspect.mockResolvedValue({ ok: true, candidate: asset });
  mocks.submit
    .mockRejectedValueOnce(new Error('lost response'))
    .mockResolvedValueOnce({
      ok: true,
      changed: true,
      entityId: asset.id,
      version: '8',
      eventId: id(8),
    });
  render(<AssignmentWorkspace {...props} />);
  await inspect();
  fireEvent.click(screen.getByRole('button', { name: 'Confirm assign' }));
  fireEvent.click(
    await screen.findByRole('button', { name: 'Retry same assignment' }),
  );
  await screen.findByRole('region', { name: 'Latest assignment receipt' });
  expect(
    readBatch(scope).value?.entries.filter((row) => row.status === 'success'),
  ).toHaveLength(1);
  expect(
    screen.getByRole('region', { name: 'Batch checklist' }),
  ).toHaveTextContent('1 asset assignment');
  // A fresh caller-authorized inspection after a separate external return makes
  // another deliberate assignment possible. Preserve both real events.
  mocks.inspect.mockResolvedValue({
    ok: true,
    candidate: { ...asset, version: '9' },
  });
  mocks.submit.mockResolvedValue({
    ok: true,
    changed: true,
    entityId: asset.id,
    version: '10',
    eventId: id(10),
  });
  await inspect();
  fireEvent.click(screen.getByRole('button', { name: 'Confirm assign' }));
  await waitFor(() =>
    expect(
      screen.getByRole('region', { name: 'Batch checklist' }),
    ).toHaveTextContent('2 asset assignments (1 individual asset)'),
  );
  expect(
    readBatch(scope).value?.entries.filter((row) => row.status === 'success'),
  ).toHaveLength(2);
  expect(mocks.submit.mock.calls[0][0].requestId).toBe(
    mocks.submit.mock.calls[1][0].requestId,
  );
  expect(mocks.submit.mock.calls[2][0].requestId).not.toBe(
    mocks.submit.mock.calls[1][0].requestId,
  );
});
