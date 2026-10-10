import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { AssignmentWorkspace } from './assign-workspace';
const mocks = vi.hoisted(() => ({
  find: vi.fn(),
  inspect: vi.fn(),
  submit: vi.fn(),
  receipt: vi.fn(),
  detection: null as ((value: string | null) => void) | null,
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
it('a saturated serial chooser shows context and search guidance without inspecting or assigning automatically', async () => {
  mocks.find.mockResolvedValue({
    ok: true,
    status: 'ambiguous',
    truncated: true,
    matches: [{ ...match, context: 'Manufacturer: Dell · Closet / Red' }],
  });
  render(<AssignmentWorkspace {...props} />);
  fireEvent.change(screen.getByLabelText('Scan, paste, or search inventory'), {
    target: { value: 'Serial' },
  });
  fireEvent.submit(screen.getByRole('form', { name: 'Inspect equipment' }));
  expect(
    await screen.findByText(/Lookup reached the 20-record limit/),
  ).toBeVisible();
  expect(
    screen.getByRole('list', { name: 'Choose inventory record' }),
  ).toHaveTextContent('Manufacturer: Dell · Closet / Red');
  expect(
    screen.getByRole('link', { name: 'Search inventory' }),
  ).toHaveAttribute('href', '/inventory');
  expect(mocks.inspect).not.toHaveBeenCalled();
  expect(mocks.submit).not.toHaveBeenCalled();
});
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
  await screen.findByText('Access revoked');
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
  expect(mocks.submit).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole('button', { name: 'Confirm assign' }));
  await waitFor(() => expect(mocks.submit).toHaveBeenCalledTimes(2));
  expect(mocks.submit.mock.calls[1][0].payload.expected_version).toBe('9');
  expect(mocks.submit.mock.calls[1][0].requestId).not.toBe(
    mocks.submit.mock.calls[0][0].requestId,
  );
});
it('does not submit if durable storage fails and preserves success if only terminal cleanup fails', async () => {
  const store = vi
    .spyOn(Storage.prototype, 'setItem')
    .mockImplementation(() => {
      throw new Error('quota');
    });
  const view = render(<AssignmentWorkspace {...props} />);
  await inspect();
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
  fireEvent.click(
    await screen.findByRole('button', { name: 'Retry same assignment' }),
  );
  await screen.findByRole('region', { name: 'Latest assignment receipt' });
  expect(mocks.submit.mock.calls[1][0]).toEqual(original);
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
