import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import { AssignmentWorkspace } from './assign-workspace';
import {
  invalidateAssignmentPrivacy,
  readBatch,
  batchKey,
  adoptAssignmentScope,
} from './assign-batch';
import {
  readAssignmentRecovery,
  storeAssignmentRecovery,
} from './assign-recovery';
import { assignmentCommand } from './assign-contracts';
import { QueueLogoutForm } from '@/features/labels/queue-logout-form';
import { AssignmentScopeGuard } from './assignment-scope-guard';
import { ProtectedPrivacyBoundary } from '@/components/auth/auth-privacy';
import { ProtectedPrivacyContent } from '@/components/auth/privacy-content';
import { useEffect } from 'react';
const mocks = vi.hoisted(() => ({
  find: vi.fn(),
  inspect: vi.fn(),
  submit: vi.fn(),
  receipt: vi.fn(),
  signOut: vi.fn(),
  detection: null as ((value: string | null) => void) | null,
  realCamera: false,
  decode: vi.fn(),
  stop: vi.fn(),
  guardFailure: false,
  privacyRead: vi.fn(),
  identityRead: vi.fn(),
}));
vi.mock('@/lib/supabase/browser', () => ({
  createSupabaseBrowserClient: () => ({
    auth: {
      onAuthStateChange: () => {
        if (mocks.guardFailure) throw new Error('subscription unavailable');
        return { data: { subscription: { unsubscribe: vi.fn() } } };
      },
    },
  }),
}));
vi.mock('@/lib/auth/actions', () => ({
  signOutSession: mocks.signOut,
  acknowledgeLogoutPrivacyGeneration: async () => ({ status: 'match' }),
  readLogoutPrivacyGeneration: mocks.privacyRead,
  readProtectedPrivacyIdentity: mocks.identityRead,
}));
vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/test',
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
vi.mock('./inventory-code-reader', () => ({
  InventoryCodeReader: class {
    decodeFromStream = mocks.decode;
  },
}));
vi.mock('./assign-camera', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./assign-camera')>();
  return {
    AssignCamera: ({
      onDetection,
      scope,
    }: {
      onDetection: (value: string | null) => void;
      scope: string;
    }) => {
      if (mocks.realCamera)
        return <actual.AssignCamera onDetection={onDetection} scope={scope} />;
      mocks.detection = onDetection;
      return <p>Controlled scanner input</p>;
    },
  };
});
const id = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
// jsdom does not expose PointerEvent; retain pointer identity on mouse-backed events.
const pointer = (
  type: string,
  pointerId = 1,
  button = 0,
  clientX = 10,
  clientY = 10,
  pointerType = 'mouse',
) => {
  const event = new MouseEvent(type, {
    bubbles: true,
    button,
    clientX,
    clientY,
  });
  Object.defineProperty(event, 'pointerId', { value: pointerId });
  Object.defineProperty(event, 'pointerType', { value: pointerType });
  return event;
};
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
  adoptAssignmentScope({
    actor: props.actorId,
    origin: window.location.origin,
    backend: props.backend,
  });
  vi.resetAllMocks();
  mocks.realCamera = false;
  mocks.guardFailure = false;
  mocks.privacyRead.mockResolvedValue({ status: 'absent' });
  mocks.identityRead.mockResolvedValue({
    status: 'match',
    generation: { status: 'absent' },
  });
  // jsdom has no layout hit-testing. The button occupies this explicit test point;
  // captured releases at other coordinates must not infer a hit from event.target.
  Object.defineProperty(document, 'elementFromPoint', {
    configurable: true,
    value: (x: number, y: number) =>
      x === 10 && y === 10
        ? document.querySelector('form[aria-label="Inspect equipment"] button')
        : document.body,
  });
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
afterEach(() => vi.unstubAllGlobals());
async function inspect() {
  fireEvent.change(screen.getByLabelText('Scan, paste, or search inventory'), {
    target: { value: candidate.path },
  });
  fireEvent.submit(screen.getByRole('form', { name: 'Inspect equipment' }));
  await screen.findByRole('region', { name: 'Review assignment' });
}
it.each(['subscription', 'adoption'] as const)(
  'catches an earlier sibling guard %s invalidation during initial mount without exposing private saved context or camera',
  async (failure) => {
    const original = render(<AssignmentWorkspace {...props} />);
    fireEvent.change(
      screen.getByLabelText('Ticket number reference (optional)'),
      { target: { value: 'PRIVATE-CONTEXT' } },
    );
    await inspect();
    mocks.submit.mockRejectedValueOnce(new Error('unknown response'));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm assign' }));
    await screen.findByRole('button', { name: 'Retry same assignment' });
    const raw = readAssignmentRecovery(scope).raw;
    original.unmount();
    mocks.realCamera = true;
    mocks.guardFailure = failure === 'subscription';
    let storage: ReturnType<typeof vi.spyOn> | undefined;
    function SetupFailure() {
      useEffect(() => {
        if (failure === 'adoption') {
          const get = Storage.prototype.getItem;
          storage = vi
            .spyOn(Storage.prototype, 'getItem')
            .mockImplementationOnce(function (this: Storage, key) {
              if (key === 'inventory-assign-cleanup-v1')
                throw new Error('temporary adoption failure');
              return get.call(this, key);
            });
        }
      }, []);
      return null;
    }
    try {
      render(
        <>
          <SetupFailure />
          <AssignmentScopeGuard
            actorId={props.actorId}
            backend={props.backend}
          />
          <AssignmentWorkspace {...props} />
        </>,
      );
      expect(
        screen.queryByLabelText('Destination site'),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByLabelText('Ticket number reference (optional)'),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByLabelText('Scan, paste, or search inventory'),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: 'Start camera' }),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: 'Inspect equipment' }),
      ).not.toBeInTheDocument();
      expect(screen.getByRole('status')).toHaveTextContent(
        'Assignment access changed',
      );
      expect(readAssignmentRecovery(scope).raw).toBe(raw);
    } finally {
      storage?.mockRestore();
    }
  },
);
it('stops actual capture on a fatal batch write failure and requires deliberate Start after storage recovers', async () => {
  mocks.realCamera = true;
  const track = { stop: vi.fn() };
  const getUserMedia = vi.fn().mockResolvedValue({ getTracks: () => [track] });
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia },
  });
  mocks.decode.mockResolvedValue({ stop: mocks.stop });
  render(<AssignmentWorkspace {...props} />);
  fireEvent.click(screen.getByRole('button', { name: 'Start camera' }));
  await screen.findByText(/Camera active/);
  let finishLookup!: (result: unknown) => void;
  mocks.find.mockReturnValueOnce(
    new Promise((resolve) => {
      finishLookup = resolve;
    }),
  );
  fireEvent.change(screen.getByLabelText('Scan, paste, or search inventory'), {
    target: { value: candidate.path },
  });
  fireEvent.submit(screen.getByRole('form', { name: 'Inspect equipment' }));
  expect(
    screen.getByRole('region', { name: 'Assignment camera' }),
  ).toHaveTextContent('Camera active');
  expect(track.stop).not.toHaveBeenCalled();
  await act(async () =>
    finishLookup({ ok: true, status: 'found', matches: [match] }),
  );
  await screen.findByRole('region', { name: 'Review assignment' });
  expect(track.stop).not.toHaveBeenCalled();
  const previous = readBatch(scope).raw;
  const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new Error('storage full');
  });
  try {
    fireEvent.change(
      screen.getByLabelText('Ticket number reference (optional)'),
      { target: { value: 'BLOCKED' } },
    );
    expect(
      screen.queryByRole('region', { name: 'Assignment camera' }),
    ).not.toBeInTheDocument();
    expect(track.stop).toHaveBeenCalled();
    act(() =>
      mocks.decode.mock.calls[0][2]({
        getText: () => 'late blocked detection',
      }),
    );
    expect(readBatch(scope).raw).toBe(previous);
    expect(mocks.find).toHaveBeenCalledOnce();
  } finally {
    set.mockRestore();
  }
  fireEvent.change(
    screen.getByLabelText('Ticket number reference (optional)'),
    { target: { value: 'RESTORED' } },
  );
  expect(screen.getByRole('button', { name: 'Start camera' })).toBeEnabled();
  expect(getUserMedia).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole('button', { name: 'Start camera' }));
  await screen.findByText(/Camera active/);
  expect(getUserMedia).toHaveBeenCalledTimes(2);
  expect(mocks.submit).not.toHaveBeenCalled();
});
it.each(['active', 'late permission'] as const)(
  'Finish stops the actual %s camera and End requires a new deliberate Start',
  async (mode) => {
    mocks.realCamera = true;
    const track = { stop: vi.fn() };
    const stream = { getTracks: () => [track] } as unknown as MediaStream;
    let permission!: (value: MediaStream) => void;
    const getUserMedia = vi.fn().mockImplementation(() =>
      mode === 'active'
        ? Promise.resolve(stream)
        : new Promise<MediaStream>((resolve) => {
            permission = resolve;
          }),
    );
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia },
    });
    mocks.decode.mockResolvedValue({ stop: mocks.stop });
    const view = render(<AssignmentWorkspace {...props} />);
    fireEvent.click(screen.getByRole('button', { name: 'Start camera' }));
    await waitFor(() => expect(getUserMedia).toHaveBeenCalledOnce());
    if (mode === 'active') await screen.findByText(/Camera active/);
    fireEvent.click(screen.getByRole('button', { name: 'Finish batch' }));
    expect(
      screen.queryByRole('region', { name: 'Assignment camera' }),
    ).not.toBeInTheDocument();
    if (mode === 'late permission') await act(async () => permission(stream));
    expect(track.stop).toHaveBeenCalled();
    if (mode === 'active') {
      expect(mocks.stop).toHaveBeenCalledOnce();
      act(() =>
        mocks.decode.mock.calls[0][2]({ getText: () => 'late detection' }),
      );
    } else expect(mocks.decode).not.toHaveBeenCalled();
    expect(mocks.find).not.toHaveBeenCalled();
    expect(mocks.submit).not.toHaveBeenCalled();
    view.unmount();
    render(<AssignmentWorkspace {...props} />);
    expect(
      screen.getByRole('region', { name: 'Batch summary' }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Start camera' }),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'End batch' }));
    expect(screen.getByRole('button', { name: 'Start camera' })).toBeEnabled();
    expect(getUserMedia).toHaveBeenCalledOnce();
    getUserMedia.mockResolvedValue({ getTracks: () => [] });
    fireEvent.click(screen.getByRole('button', { name: 'Start camera' }));
    await screen.findByText(/Camera active/);
    expect(getUserMedia).toHaveBeenCalledTimes(2);
  },
);
it('keeps one original request and one confirmed checklist entry for two Confirm attempts before the server settles', async () => {
  const committed = await mocks.submit();
  mocks.submit.mockClear();
  let finish!: (value: typeof committed) => void;
  mocks.submit.mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  render(<AssignmentWorkspace {...props} />);
  await inspect();
  const confirm = screen.getByRole('button', { name: 'Confirm assign' });
  act(() => {
    fireEvent.click(confirm);
    fireEvent.click(confirm);
  });
  expect(mocks.submit).toHaveBeenCalledTimes(1);
  const original = mocks.submit.mock.calls[0][0];
  const pending = readBatch(scope).value!.entries;
  expect(pending).toHaveLength(1);
  expect(pending[0].requestId).toBe(original.requestId);
  expect(pending[0].status).not.toBe('success');
  expect(
    screen.queryByRole('region', { name: 'Latest assignment receipt' }),
  ).not.toBeInTheDocument();
  await act(async () => finish(committed));
  await screen.findByRole('region', { name: 'Latest assignment receipt' });
  expect(mocks.submit).toHaveBeenCalledTimes(1);
  const entries = readBatch(scope).value!.entries;
  expect(entries).toHaveLength(1);
  expect(entries[0]).toMatchObject({
    requestId: original.requestId,
    status: 'success',
    eventId: id(8),
  });
  expect(
    screen.getAllByRole('link', {
      name: 'View committed history for Adapters',
    }),
  ).toHaveLength(1);
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
    screen.getByRole('button', { name: 'Adapters · Quantity item · Active' }),
  );
  await screen.findByRole('region', { name: 'Review assignment' });
  expect(mocks.submit).not.toHaveBeenCalled();
});

it('labels an exact location match correctly and preserves its location path when selected for rejected assignment inspection', async () => {
  const location = {
    kind: 'location',
    path: '/locations/ITC-RED',
    label: 'Red (ITC-RED)',
    state: 'active',
  };
  mocks.find.mockResolvedValue({
    ok: true,
    status: 'ambiguous',
    matches: [
      location,
      match,
      {
        kind: 'asset',
        path: '/inventory/assets/' + id(11),
        label: 'Laptop',
        state: 'active',
      },
    ],
  });
  const rejection =
    'This label identifies a location. Select an existing quantity item or individual asset to assign.';
  mocks.inspect.mockResolvedValueOnce({ ok: false, message: rejection });
  render(<AssignmentWorkspace {...props} />);
  fireEvent.change(screen.getByLabelText('Scan, paste, or search inventory'), {
    target: { value: 'ITC-RED' },
  });
  fireEvent.submit(screen.getByRole('form', { name: 'Inspect equipment' }));
  const chooser = await screen.findByRole('list', {
    name: 'Choose inventory record',
  });
  expect(
    within(chooser).getByRole('button', {
      name: 'Adapters · Quantity item · Active',
    }),
  ).toBeVisible();
  expect(
    within(chooser).getByRole('button', {
      name: 'Laptop · Individual asset · Active',
    }),
  ).toBeVisible();
  expect(mocks.inspect).not.toHaveBeenCalled();
  fireEvent.click(
    within(chooser).getByRole('button', {
      name: 'Red (ITC-RED) · Location · Active',
    }),
  );
  await screen.findByText(rejection, { selector: '[role="status"]' });
  expect(mocks.find).toHaveBeenCalledWith({
    actorId: props.actorId,
    text: 'ITC-RED',
    mode: 'identifier',
  });
  expect(mocks.inspect).toHaveBeenCalledExactlyOnceWith({
    actorId: props.actorId,
    path: location.path,
    siteId: site.id,
  });
  expect(
    screen.queryByRole('region', { name: 'Review assignment' }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole('button', { name: 'Confirm assign' }),
  ).not.toBeInTheDocument();
  expect(mocks.submit).not.toHaveBeenCalled();
});

it('keeps a found LOC label as a location target and rejects it without offering asset assignment', async () => {
  const path = '/locations/ITC-RED';
  mocks.find.mockResolvedValue({
    ok: true,
    status: 'found',
    matches: [
      { kind: 'location', path, label: 'Red (ITC-RED)', state: 'active' },
    ],
  });
  const rejection =
    'This label identifies a location. Select an existing quantity item or individual asset to assign.';
  mocks.inspect.mockResolvedValue({ ok: false, message: rejection });
  render(<AssignmentWorkspace {...props} />);
  fireEvent.change(screen.getByLabelText('Scan, paste, or search inventory'), {
    target: { value: 'LOC:ITC-RED' },
  });
  fireEvent.submit(screen.getByRole('form', { name: 'Inspect equipment' }));
  await screen.findByText(rejection, { selector: '[role="status"]' });
  expect(mocks.find).toHaveBeenCalledWith({
    actorId: props.actorId,
    text: 'LOC:ITC-RED',
    mode: 'identifier',
  });
  expect(mocks.inspect).toHaveBeenCalledExactlyOnceWith({
    actorId: props.actorId,
    path,
    siteId: site.id,
  });
  expect(
    screen.queryByRole('region', { name: 'Review assignment' }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole('button', { name: 'Confirm assign' }),
  ).not.toBeInTheDocument();
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
    name: 'Later laptop · Individual asset · Active',
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
    await screen.findByRole('button', {
      name: 'Adapters · Quantity item · Active',
    }),
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

it.each([
  ['context', 'success', 'unrequested'],
  ['context', 'error', 'unrequested'],
  ['next', 'success', 'unrequested'],
  ['next', 'error', 'unrequested'],
  ['context', 'success', 'failed'],
  ['context', 'error', 'failed'],
  ['next', 'success', 'failed'],
  ['next', 'error', 'failed'],
] as const)(
  'a canceled receipt read by %s ignores stale %s and preserves prior %s state',
  async (resetAction, outcome, prior) => {
    const saved = await mocks.submit();
    mocks.submit.mockClear();
    const original = render(<AssignmentWorkspace {...props} />);
    await inspect();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm assign' }));
    await screen.findByRole('region', { name: 'Latest assignment receipt' });
    original.unmount();
    mocks.find.mockClear();
    mocks.inspect.mockClear();
    render(<AssignmentWorkspace {...props} />);
    const latest = await screen.findByRole('region', {
      name: 'Latest assignment receipt',
    });
    const reload = screen.getByRole('button', {
      name: 'Reload committed receipt',
    });
    if (prior === 'failed') {
      mocks.receipt.mockRejectedValueOnce(new Error('earlier read failed'));
      fireEvent.click(reload);
      await waitFor(() =>
        expect(latest).toHaveTextContent(
          'Receipt details could not be loaded. The assignment remains confirmed.',
        ),
      );
    }
    let complete!: (value: typeof saved.custody) => void;
    let fail!: (reason: Error) => void;
    mocks.receipt.mockReturnValueOnce(
      new Promise((resolve, reject) => {
        complete = resolve;
        fail = reject;
      }),
    );
    fireEvent.click(reload);
    expect(latest).toHaveTextContent('Loading receipt details…');
    if (resetAction === 'context')
      fireEvent.change(
        screen.getByLabelText('Ticket number reference (optional)'),
        { target: { value: 'CHANGED-WHILE-READING' } },
      );
    else
      fireEvent.click(
        screen.getByRole('button', { name: 'Rescan / choose another' }),
      );
    const expected =
      prior === 'unrequested'
        ? 'Receipt details have not been loaded.'
        : 'Event receipt details could not be loaded.';
    expect(latest).toHaveTextContent(expected);
    expect(latest).not.toHaveTextContent('Loading receipt details');
    expect(reload).toBeEnabled();
    const raw = sessionStorage.getItem(batchKey(scope));
    await act(async () => {
      if (outcome === 'success') complete(saved.custody);
      else fail(new Error('obsolete private read failure'));
    });
    expect(latest).toHaveTextContent(expected);
    expect(latest).toHaveTextContent('Assignment confirmed · Adapters');
    expect(latest).not.toHaveTextContent(
      /obsolete private|Receipt details are unavailable|Loading receipt details/,
    );
    expect(
      screen.queryByRole('region', { name: 'Committed custody receipt' }),
    ).not.toBeInTheDocument();
    expect(mocks.receipt).toHaveBeenCalledTimes(prior === 'failed' ? 2 : 1);
    expect(mocks.receipt).toHaveBeenLastCalledWith({
      kind: 'quantity',
      entityId: candidate.id,
      eventId: id(8),
      expectedActorId: props.actorId,
    });
    expect(mocks.find).not.toHaveBeenCalled();
    expect(mocks.inspect).not.toHaveBeenCalled();
    expect(mocks.submit).toHaveBeenCalledTimes(1);
    expect(sessionStorage.getItem(batchKey(scope))).toBe(raw);
    expect(readBatch(scope).value?.entries).toHaveLength(1);
    expect(readBatch(scope).value?.entries[0]).toMatchObject({
      status: 'success',
      eventId: id(8),
    });
  },
);

it.each([
  ['account', 'success'],
  ['account', 'error'],
  ['privacy', 'success'],
  ['privacy', 'error'],
  ['unmount', 'success'],
  ['unmount', 'error'],
] as const)(
  'a %s cancellation ignores late receipt %s completion without exposing the original account receipt',
  async (cancellation, outcome) => {
    const saved = await mocks.submit();
    mocks.submit.mockClear();
    const original = render(<AssignmentWorkspace {...props} />);
    await inspect();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm assign' }));
    await screen.findByRole('region', { name: 'Latest assignment receipt' });
    original.unmount();
    const view = render(<AssignmentWorkspace {...props} />);
    await screen.findByRole('region', { name: 'Latest assignment receipt' });
    let complete!: (value: typeof saved.custody) => void;
    let fail!: (reason: Error) => void;
    mocks.receipt.mockReturnValueOnce(
      new Promise((resolve, reject) => {
        complete = resolve;
        fail = reject;
      }),
    );
    fireEvent.click(
      screen.getByRole('button', { name: 'Reload committed receipt' }),
    );
    if (cancellation === 'account')
      view.rerender(<AssignmentWorkspace {...props} actorId={id(19)} />);
    else if (cancellation === 'privacy')
      act(() => invalidateAssignmentPrivacy(true));
    else view.unmount();
    const raw = sessionStorage.getItem(batchKey(scope));
    await act(async () => {
      if (outcome === 'success') complete(saved.custody);
      else fail(new Error('obsolete original-account read failure'));
    });
    expect(
      screen.queryByRole('region', { name: 'Latest assignment receipt' }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('region', { name: 'Committed custody receipt' }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText(/obsolete original-account/),
    ).not.toBeInTheDocument();
    expect(sessionStorage.getItem(batchKey(scope))).toBe(raw);
    expect(mocks.receipt).toHaveBeenCalledExactlyOnceWith({
      kind: 'quantity',
      entityId: candidate.id,
      eventId: id(8),
      expectedActorId: props.actorId,
    });
    expect(mocks.submit).toHaveBeenCalledTimes(1);
  },
);

it.each([
  ['unavailable', 'context'],
  ['unavailable', 'next'],
  ['unavailable', 'finish'],
  ['failed', 'context'],
  ['failed', 'next'],
  ['failed', 'finish'],
] as const)(
  'restores an unrequested confirmed receipt, then preserves the attempted %s read after %s without another assignment',
  async (outcome, resetAction) => {
    const saved = await mocks.submit();
    mocks.submit.mockClear();
    const original = render(<AssignmentWorkspace {...props} />);
    await inspect();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm assign' }));
    await screen.findByRole('region', { name: 'Latest assignment receipt' });
    const raw = sessionStorage.getItem(batchKey(scope));
    original.unmount();
    mocks.find.mockClear();
    mocks.inspect.mockClear();
    let complete!: (value: null) => void;
    let fail!: (reason: Error) => void;
    mocks.receipt.mockReturnValueOnce(
      new Promise((resolve, reject) => {
        complete = resolve;
        fail = reject;
      }),
    );
    render(<AssignmentWorkspace {...props} />);
    const latest = await screen.findByRole('region', {
      name: 'Latest assignment receipt',
    });
    expect(latest).toHaveTextContent('Assignment confirmed · Adapters');
    expect(latest).toHaveTextContent('Receipt details have not been loaded.');
    expect(latest).not.toHaveTextContent(/could not be loaded|unavailable/);
    expect(mocks.receipt).not.toHaveBeenCalled();
    expect(mocks.find).not.toHaveBeenCalled();
    expect(mocks.inspect).not.toHaveBeenCalled();
    expect(mocks.submit).toHaveBeenCalledTimes(1);
    expect(
      document.querySelectorAll(`a[href="/history/events/quantity/${id(8)}"]`),
    ).toHaveLength(1);
    const reload = screen.getByRole('button', {
      name: 'Reload committed receipt',
    });
    fireEvent.click(reload);
    expect(reload).toBeDisabled();
    expect(latest).toHaveTextContent('Loading receipt details…');
    expect(latest).not.toHaveTextContent('have not been loaded');
    await act(async () => {
      if (outcome === 'unavailable') complete(null);
      else fail(new Error('receipt read failed'));
    });
    expect(latest).toHaveTextContent(
      outcome === 'unavailable'
        ? 'Receipt details are unavailable.'
        : 'Receipt details could not be loaded.',
    );
    expect(latest).not.toHaveTextContent('have not been loaded');
    expect(latest).toHaveTextContent('The assignment remains confirmed');
    expect(reload).toBeEnabled();
    expect(sessionStorage.getItem(batchKey(scope))).toBe(raw);
    if (resetAction === 'context') {
      fireEvent.change(
        screen.getByLabelText('Ticket number reference (optional)'),
        {
          target: { value: 'TICKET-CHANGED' },
        },
      );
    } else {
      fireEvent.click(
        screen.getByRole('button', {
          name:
            resetAction === 'next' ? 'Rescan / choose another' : 'Finish batch',
        }),
      );
    }
    expect(latest).toHaveTextContent('Assignment confirmed · Adapters');
    expect(latest).toHaveTextContent(
      'Event receipt details could not be loaded.',
    );
    expect(latest).not.toHaveTextContent('have not been loaded');
    const afterReset = sessionStorage.getItem(batchKey(scope));
    mocks.receipt.mockResolvedValueOnce(saved.custody);
    fireEvent.click(reload);
    await screen.findByRole('region', { name: 'Committed custody receipt' });
    expect(mocks.receipt).toHaveBeenCalledTimes(2);
    for (const call of [1, 2])
      expect(mocks.receipt).toHaveBeenNthCalledWith(call, {
        kind: 'quantity',
        entityId: candidate.id,
        eventId: id(8),
        expectedActorId: props.actorId,
      });
    expect(mocks.submit).toHaveBeenCalledTimes(1);
    expect(sessionStorage.getItem(batchKey(scope))).toBe(afterReset);
    expect(readBatch(scope).value?.entries).toHaveLength(1);
    expect(readBatch(scope).value?.entries[0]).toMatchObject({
      status: 'success',
      eventId: id(8),
    });
  },
);

it('keeps a known commit visible when receipt details fail and reloads only its exact authorized event', async () => {
  const saved = await mocks.submit();
  mocks.submit.mockClear();
  mocks.submit.mockResolvedValue({ ...saved, custody: undefined });
  mocks.receipt.mockResolvedValue(saved.custody);
  render(<AssignmentWorkspace {...props} />);
  await inspect();
  fireEvent.click(screen.getByRole('button', { name: 'Confirm assign' }));
  await screen.findByText('Assignment confirmed · Adapters');
  expect(
    screen.getByRole('region', { name: 'Latest assignment receipt' }),
  ).toHaveTextContent('Event receipt details could not be loaded.');
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
  await waitFor(() => expect(mocks.inspect).toHaveBeenCalledTimes(2));
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'Confirm assign' }),
    ).toBeEnabled(),
  );
  expect(
    screen.getByRole('region', { name: 'Review assignment' }),
  ).not.toHaveTextContent('Version');
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
it('keeps a new blocked-assignment alert distinct from retained interrupted-inspection history', async () => {
  mocks.find.mockReturnValueOnce(new Promise(() => {}));
  const interrupted = render(<AssignmentWorkspace {...props} />);
  fireEvent.change(screen.getByLabelText('Scan, paste, or search inventory'), {
    target: { value: candidate.path },
  });
  fireEvent.submit(screen.getByRole('form', { name: 'Inspect equipment' }));
  await waitFor(() => expect(mocks.find).toHaveBeenCalledOnce());
  interrupted.unmount();
  render(<AssignmentWorkspace {...props} />);
  const checklist = screen.getByRole('region', { name: 'Batch checklist' });
  expect(
    within(checklist).getByText(
      'Inspection interrupted before confirmation. Nothing was submitted.',
      { exact: true },
    ),
  ).toBeVisible();
  await inspect();
  const set = Storage.prototype.setItem;
  const blocked = vi
    .spyOn(Storage.prototype, 'setItem')
    .mockImplementation(function (this: Storage, key, value) {
      if (key.startsWith('inventory-assign-v1:')) throw new Error('quota');
      set.call(this, key, value);
    });
  try {
    fireEvent.click(screen.getByRole('button', { name: 'Confirm assign' }));
    await screen.findByRole('alert');
    expect(screen.getByRole('alert')).toHaveTextContent(
      /^This assignment could not be saved\. Keep the review open and retry when browser storage is available\. Nothing was submitted\.$/,
    );
    expect(screen.getByRole('alert')).toBeVisible();
    expect(checklist).toHaveTextContent(
      'Inspection interrupted before confirmation. Nothing was submitted.',
    );
    expect(
      screen.getByRole('region', { name: 'Review assignment' }),
    ).toBeVisible();
    expect(readBatch(scope).value?.entries).toHaveLength(2);
    expect(readBatch(scope).value?.entries[0].status).toBe('skipped');
    expect(mocks.submit).not.toHaveBeenCalled();
  } finally {
    blocked.mockRestore();
  }
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
  expect(await screen.findByRole('alert')).toHaveTextContent(
    /^This assignment could not be saved\. Keep the review open and restore browser storage access\. Nothing was submitted\.$/,
  );
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
  view.unmount();
  const newOwner = render(
    <ProtectedPrivacyBoundary
      binding={{
        actorId: id(19),
        backend: props.backend,
        role: 'staff',
        canManageConfiguration: false,
      }}
    >
      <ProtectedPrivacyContent>
        <AssignmentWorkspace
          {...props}
          actorId={id(19)}
          initialSiteId={undefined}
        />
      </ProtectedPrivacyContent>
    </ProtectedPrivacyBoundary>,
  );
  expect(await screen.findByLabelText('Destination site')).toHaveValue('');
  expect(
    screen.getByLabelText('Ticket number reference (optional)'),
  ).toHaveValue('');
  newOwner.unmount();
  render(
    <ProtectedPrivacyBoundary
      binding={{
        actorId: props.actorId,
        backend: props.backend,
        role: 'staff',
        canManageConfiguration: false,
      }}
    >
      <ProtectedPrivacyContent>
        <AssignmentWorkspace {...props} />
      </ProtectedPrivacyContent>
    </ProtectedPrivacyBoundary>,
  );
  await screen.findByRole('button', { name: 'Retry same assignment' });
  expect(mocks.submit).toHaveBeenCalledTimes(1);
});

it('inspects with a capitalized shared status and mono identifier, hiding the record version', async () => {
  const { container } = render(<AssignmentWorkspace {...props} />);
  await inspect();
  const review = screen.getByRole('region', { name: 'Review assignment' });
  expect(review).toHaveTextContent('Active');
  expect(review).not.toHaveTextContent('Version');
  expect(container.querySelector('.experience-code')).toHaveTextContent(
    candidate.identifier,
  );
  expect(mocks.submit).not.toHaveBeenCalled();
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
  await waitFor(() =>
    expect(readBatch(scope).value?.historical?.candidate.version).toBe('12'),
  );
  expect(
    screen.getByRole('region', { name: 'Review assignment' }),
  ).not.toHaveTextContent('Version');
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
  expect(screen.getByText('Inspecting equipment…')).toHaveClass('sr-only');
  expect(
    screen.getByText('Inspecting equipment…').closest('[aria-busy="true"]'),
  ).toBeNull();
  expect(
    document.querySelector('[data-loading-shape="inspection"]'),
  ).toBeInTheDocument();
  expect(
    screen.getByRole('form', { name: 'Inspect equipment' }),
  ).toHaveAttribute('aria-busy', 'true');
  expect(
    screen.getByRole('button', { name: 'Cancel inspection' }),
  ).toHaveFocus();
  fireEvent.click(screen.getByRole('button', { name: 'Cancel inspection' }));
  expect(input).toHaveFocus();
  expect(
    document.querySelector('[data-loading-shape="inspection"]'),
  ).not.toBeInTheDocument();
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
  for (const alert of screen.getAllByRole('alert'))
    expect(alert).not.toHaveTextContent(/recovery|reconcile|original request/i);
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
it('describes terminal save cleanup in plain language while retaining the original assignment until reload', async () => {
  const view = render(<AssignmentWorkspace {...props} />);
  await inspect();
  const nativeRemove = Storage.prototype.removeItem;
  const remove = vi
    .spyOn(Storage.prototype, 'removeItem')
    .mockImplementation(function (this: Storage, key: string) {
      if (key.startsWith('inventory-assign-v1:'))
        throw new Error('storage unavailable');
      nativeRemove.call(this, key);
    });
  try {
    fireEvent.click(screen.getByRole('button', { name: 'Confirm assign' }));
    await screen.findByRole('region', { name: 'Latest assignment receipt' });
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent(
      'Assignment confirmed. Reload to finish updating this batch',
    );
    expect(alert).not.toHaveTextContent(/recovery|reconcile|original request/i);
    expect(readAssignmentRecovery(scope).value?.command).toEqual(
      mocks.submit.mock.calls[0][0],
    );
    expect(readBatch(scope).value?.entries[0].status).toBe('success');
    expect(screen.getByRole('button', { name: 'Finish batch' })).toBeDisabled();
  } finally {
    remove.mockRestore();
  }
  view.unmount();
  render(<AssignmentWorkspace {...props} />);
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(readAssignmentRecovery(scope).value).toBeNull();
  expect(mocks.submit).toHaveBeenCalledOnce();
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
    screen.getByText(/Your earlier assignment cannot be opened/),
  ).toBeInTheDocument();
  expect(
    screen.getByRole('button', { name: 'Inspect equipment' }),
  ).toBeDisabled();
  expect(sessionStorage.getItem(batchKey(scope))).toBe('{broken');
  expect(screen.getByRole('alert')).not.toHaveTextContent(
    /recovery|incompatible|reconcile/i,
  );
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
it.each([
  'lookup reload',
  'lookup Back',
  'inspection reload',
  'inspection Back',
])(
  'persists a truthful interrupted outcome for %s before a new inspection is usable',
  async (interruption) => {
    let finish!: (value: unknown) => void;
    const held = new Promise((resolve) => {
      finish = resolve;
    });
    if (interruption.startsWith('lookup')) mocks.find.mockReturnValueOnce(held);
    else mocks.inspect.mockReturnValueOnce(held);
    const original = render(<AssignmentWorkspace {...props} />);
    fireEvent.change(
      screen.getByLabelText('Scan, paste, or search inventory'),
      { target: { value: candidate.path } },
    );
    fireEvent.submit(screen.getByRole('form', { name: 'Inspect equipment' }));
    await waitFor(() =>
      expect(
        interruption.startsWith('lookup') ? mocks.find : mocks.inspect,
      ).toHaveBeenCalledOnce(),
    );
    const pending = readBatch(scope).value!.entries[0];
    expect(pending).toMatchObject({ status: 'pending', requestId: null });
    expect(readBatch(scope).value!.historical).toBeNull();
    original.unmount(); // Reload and Back both enter a new mounted route owner.
    const resumed = render(<AssignmentWorkspace {...props} />);
    expect(
      screen.getByRole('button', { name: 'Inspect equipment' }),
    ).toBeEnabled();
    expect(readBatch(scope).value!.entries[0]).toMatchObject({
      id: pending.id,
      status: 'skipped',
      message:
        'Inspection interrupted before confirmation. Nothing was submitted.',
    });
    expect(
      screen.getByRole('region', { name: 'Batch checklist' }),
    ).toHaveTextContent('0 pending');
    const reconciled = readBatch(scope).raw;
    await act(async () =>
      finish(
        interruption.startsWith('lookup')
          ? { ok: true, status: 'found', matches: [match] }
          : { ok: true, candidate },
      ),
    );
    expect(readBatch(scope).raw).toBe(reconciled);
    expect(
      screen.queryByRole('region', { name: 'Review assignment' }),
    ).not.toBeInTheDocument();
    resumed.unmount();
    render(<AssignmentWorkspace {...props} />);
    expect(readBatch(scope).raw).toBe(reconciled);
    await inspect();
    expect(readBatch(scope).value!.entries).toHaveLength(2);
    expect(readBatch(scope).value!.entries[0].status).toBe('skipped');
    expect(mocks.submit).not.toHaveBeenCalled();
  },
);
it.each(['write denied', 'CAS changed'])(
  'does not expose usable hydration when interrupted-read reconciliation fails because %s',
  async (failure) => {
    mocks.find.mockReturnValueOnce(new Promise(() => {}));
    const original = render(<AssignmentWorkspace {...props} />);
    fireEvent.change(
      screen.getByLabelText('Scan, paste, or search inventory'),
      { target: { value: candidate.path } },
    );
    fireEvent.submit(screen.getByRole('form', { name: 'Inspect equipment' }));
    const before = readBatch(scope).raw!;
    original.unmount();
    const set = Storage.prototype.setItem;
    const get = Storage.prototype.getItem;
    let reads = 0;
    const changed = JSON.stringify({ ...JSON.parse(before), finished: true });
    const storage =
      failure === 'write denied'
        ? vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (
            this: Storage,
            key,
            value,
          ) {
            if (key === batchKey(scope)) throw new Error('Storage denied');
            return set.call(this, key, value);
          })
        : vi.spyOn(Storage.prototype, 'getItem').mockImplementation(function (
            this: Storage,
            key,
          ) {
            if (key === batchKey(scope) && ++reads === 2)
              set.call(this, key, changed);
            return get.call(this, key);
          });
    try {
      render(<AssignmentWorkspace {...props} />);
      expect(
        screen.getByText(/This batch could not be saved/),
      ).toBeInTheDocument();
      expect(
        screen.getByRole('button', { name: 'Inspect equipment' }),
      ).toBeDisabled();
      expect(
        screen.queryByText(/Inspection interrupted before confirmation/),
      ).not.toBeInTheDocument();
      expect(get.call(sessionStorage, batchKey(scope))).toBe(
        failure === 'write denied' ? before : changed,
      );
      expect(mocks.find).toHaveBeenCalledOnce();
      expect(mocks.submit).not.toHaveBeenCalled();
    } finally {
      storage.mockRestore();
    }
  },
);
it('settles an orphaned read while reopening only the retained historical identity', async () => {
  const original = render(<AssignmentWorkspace {...props} />);
  await inspect();
  original.unmount();
  const saved = readBatch(scope).value!;
  const retained = saved.entries[0];
  const orphan = {
    ...retained,
    id: id(99),
    kind: null,
    entityId: null,
    units: 0,
    name: 'Interrupted lookup',
  };
  sessionStorage.setItem(
    batchKey(scope),
    JSON.stringify({ ...saved, entries: [orphan, retained] }),
  );
  render(<AssignmentWorkspace {...props} />);
  await screen.findByText(
    'Availability refreshed. Review the source and units before confirming.',
  );
  expect(readBatch(scope).value!.entries).toMatchObject([
    { id: orphan.id, status: 'skipped' },
    { id: retained.id, status: 'pending' },
  ]);
  expect(readBatch(scope).value!.historical?.entryId).toBe(retained.id);
  expect(mocks.inspect).toHaveBeenCalledTimes(2);
  expect(mocks.submit).not.toHaveBeenCalled();
});
it('settles an orphaned read without replacing uncertain recovery or dispatching a new command', async () => {
  const original = render(<AssignmentWorkspace {...props} />);
  await inspect();
  mocks.submit.mockRejectedValueOnce(new Error('Lost acknowledgement'));
  fireEvent.click(screen.getByRole('button', { name: 'Confirm assign' }));
  await screen.findByRole('button', { name: 'Retry same assignment' });
  original.unmount();
  const saved = readBatch(scope).value!;
  const uncertain = saved.entries[0];
  const recovery = readAssignmentRecovery(scope).raw;
  const orphan = {
    ...uncertain,
    id: id(99),
    requestId: null,
    status: 'pending' as const,
    kind: null,
    entityId: null,
    units: 0,
    name: 'Interrupted lookup',
  };
  sessionStorage.setItem(
    batchKey(scope),
    JSON.stringify({
      ...saved,
      historical: null,
      entries: [orphan, uncertain],
    }),
  );
  mocks.inspect.mockClear();
  render(<AssignmentWorkspace {...props} />);
  expect(
    screen.getByRole('button', { name: 'Retry same assignment' }),
  ).toBeEnabled();
  expect(readBatch(scope).value!.entries).toMatchObject([
    { id: orphan.id, status: 'skipped' },
    uncertain,
  ]);
  expect(readAssignmentRecovery(scope).raw).toBe(recovery);
  expect(mocks.inspect).not.toHaveBeenCalled();
  expect(mocks.submit).toHaveBeenCalledOnce();
  fireEvent.click(
    screen.getByRole('button', { name: 'Retry same assignment' }),
  );
  await screen.findByRole('region', { name: 'Latest assignment receipt' });
  expect(mocks.submit.mock.calls[1][0]).toEqual(mocks.submit.mock.calls[0][0]);
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

it.each(['success', 'failure'] as const)(
  'accepts cancellation during restoration and ignores its late %s without reviving pending accounting or review',
  async (outcome) => {
    const first = render(<AssignmentWorkspace {...props} />);
    await inspect();
    first.unmount();
    let finish!: (value: unknown) => void;
    mocks.inspect.mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    render(<AssignmentWorkspace {...props} />);
    const cancel = screen.getByRole('button', { name: 'Cancel inspection' });
    expect(cancel).toBeEnabled();
    fireEvent.click(cancel);
    expect(readBatch(scope).value?.entries[0].status).toBe('skipped');
    expect(readBatch(scope).value?.historical).toBeNull();
    await act(async () =>
      finish(
        outcome === 'success'
          ? { ok: true, candidate }
          : { ok: false, message: 'Late restoration failure' },
      ),
    );
    expect(
      screen.queryByRole('region', { name: 'Review assignment' }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Confirm assign' }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole('form', { name: 'Inspect equipment' }),
    ).toHaveAttribute('aria-busy', 'false');
    expect(
      screen.getByLabelText('Scan, paste, or search inventory'),
    ).toHaveFocus();
    expect(readBatch(scope).value?.entries[0].status).toBe('skipped');
    expect(readBatch(scope).value?.historical).toBeNull();
    expect(mocks.submit).not.toHaveBeenCalled();
  },
);

it('accepts a delivered cancellation even when restoration completes immediately before click', async () => {
  const first = render(<AssignmentWorkspace {...props} />);
  await inspect();
  first.unmount();
  let finish!: (value: unknown) => void;
  mocks.inspect.mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  render(<AssignmentWorkspace {...props} />);
  const cancel = screen.getByRole('button', { name: 'Cancel inspection' });
  await act(async () => finish({ ok: true, candidate }));
  expect(cancel).toBe(
    screen.getByRole('button', { name: 'Skip inspection / review' }),
  );
  fireEvent.click(cancel);
  expect(
    screen.queryByRole('region', { name: 'Review assignment' }),
  ).not.toBeInTheDocument();
  expect(readBatch(scope).value?.entries[0].status).toBe('skipped');
  expect(readBatch(scope).value?.historical).toBeNull();
  expect(
    screen.getByLabelText('Scan, paste, or search inventory'),
  ).toHaveFocus();
  expect(mocks.submit).not.toHaveBeenCalled();
});

it('does not steal focus from an in-progress primary Cancel press when restoration completes before release', async () => {
  const first = render(<AssignmentWorkspace {...props} />);
  await inspect();
  first.unmount();
  let finish!: (value: unknown) => void;
  mocks.inspect.mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  render(<AssignmentWorkspace {...props} />);
  const cancel = screen.getByRole('button', { name: 'Cancel inspection' });
  expect(cancel).toHaveFocus();
  fireEvent(cancel, pointer('pointerdown'));
  await act(async () => finish({ ok: true, candidate }));
  // Focus() scrolls by default in a browser. Moving it to the below-form review
  // between press/release can move the physical cancellation target on phones.
  expect(cancel).toHaveFocus();
  expect(readBatch(scope).value?.entries[0].status).toBe('pending');
  fireEvent(cancel, pointer('pointerup'));
  fireEvent.click(cancel);
  expect(
    screen.getByLabelText('Scan, paste, or search inventory'),
  ).toHaveFocus();
  expect(readBatch(scope).value?.entries[0].status).toBe('skipped');
  expect(readBatch(scope).value?.historical).toBeNull();
  expect(
    screen.queryByRole('button', { name: 'Confirm assign' }),
  ).not.toBeInTheDocument();
  expect(mocks.submit).not.toHaveBeenCalled();
});
it.each(['outside pointerup', 'pointercancel', 'window blur'])(
  'resumes deferred current review focus after restoration completes before an aborted %s',
  async (gesture) => {
    const original = render(<AssignmentWorkspace {...props} />);
    await inspect();
    original.unmount();
    let finish!: (value: unknown) => void;
    mocks.inspect.mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    render(
      <>
        <AssignmentWorkspace {...props} />
        <p data-testid="outside-release">Outside</p>
      </>,
    );
    const cancel = screen.getByRole('button', { name: 'Cancel inspection' });
    fireEvent(cancel, pointer('pointerdown', 7));
    await act(async () => finish({ ok: true, candidate }));
    expect(cancel).toHaveFocus();
    if (gesture === 'window blur') {
      fireEvent(window, new Event('blur'));
      expect(cancel).toHaveFocus(); // A background window must not take focus.
      fireEvent(window, new Event('focus'));
    } else if (gesture === 'pointercancel')
      fireEvent(cancel, pointer('pointercancel', 7));
    else
      fireEvent(
        screen.getByTestId('outside-release'),
        pointer('pointerup', 7, 0, 20, 20),
      );
    expect(
      screen.getByRole('region', { name: 'Review assignment' }),
    ).toHaveFocus();
    expect(readBatch(scope).value!.entries[0].status).toBe('pending');
    expect(readBatch(scope).value!.historical).not.toBeNull();
    expect(mocks.submit).not.toHaveBeenCalled();
  },
);
it.each(['touch', 'pen'] as const)(
  'uses release hit-testing for an implicitly captured %s pointer instead of its button target',
  async (pointerType) => {
    const original = render(<AssignmentWorkspace {...props} />);
    await inspect();
    original.unmount();
    let finish!: (value: unknown) => void;
    mocks.inspect.mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    render(<AssignmentWorkspace {...props} />);
    const cancel = screen.getByRole('button', { name: 'Cancel inspection' });
    fireEvent(cancel, pointer('pointerdown', 7, 0, 10, 10, pointerType));
    await act(async () => finish({ ok: true, candidate }));
    expect(cancel).toHaveFocus();
    // Real implicit capture retargets pointerup to Cancel even outside its box.
    fireEvent(cancel, pointer('pointerup', 8, 0, 20, 20, pointerType));
    expect(cancel).toHaveFocus(); // A different pointer cannot release this press.
    fireEvent(cancel, pointer('pointerup', 7, 0, 20, 20, pointerType));
    expect(
      screen.getByRole('region', { name: 'Review assignment' }),
    ).toHaveFocus();
    // Capture can also target the compatibility click at the original button.
    fireEvent(cancel, pointer('click', 7, 0, 20, 20, pointerType));
    expect(readBatch(scope).value!.entries[0].status).toBe('pending');
    expect(readBatch(scope).value!.historical).not.toBeNull();
    expect(mocks.submit).not.toHaveBeenCalled();
    act(() => cancel.focus());
    fireEvent.click(cancel); // A deliberate keyboard click remains usable.
    expect(readBatch(scope).value!.entries[0].status).toBe('skipped');
  },
);
it.each(['touch', 'pen'] as const)(
  'keeps an inside captured %s release stationary until its native click',
  async (pointerType) => {
    const original = render(<AssignmentWorkspace {...props} />);
    await inspect();
    original.unmount();
    let finish!: (value: unknown) => void;
    mocks.inspect.mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    render(<AssignmentWorkspace {...props} />);
    const cancel = screen.getByRole('button', { name: 'Cancel inspection' });
    fireEvent(cancel, pointer('pointerdown', 7, 0, 10, 10, pointerType));
    await act(async () => finish({ ok: true, candidate }));
    fireEvent(cancel, pointer('pointerup', 7, 0, 10, 10, pointerType));
    expect(cancel).toHaveFocus();
    expect(readBatch(scope).value!.entries[0].status).toBe('pending');
    fireEvent.click(cancel);
    expect(readBatch(scope).value!.entries[0].status).toBe('skipped');
    expect(mocks.submit).not.toHaveBeenCalled();
  },
);
it('does not steal deliberate focus navigation after a held restoration or a later window activation', async () => {
  const original = render(<AssignmentWorkspace {...props} />);
  await inspect();
  original.unmount();
  let finish!: (value: unknown) => void;
  mocks.inspect.mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  render(
    <>
      <AssignmentWorkspace {...props} />
      <button>Unrelated task</button>
    </>,
  );
  const cancel = screen.getByRole('button', { name: 'Cancel inspection' });
  fireEvent(cancel, pointer('pointerdown', 7));
  await act(async () => finish({ ok: true, candidate }));
  const unrelated = screen.getByRole('button', { name: 'Unrelated task' });
  act(() => unrelated.focus());
  fireEvent(document.body, pointer('pointerup', 7));
  fireEvent(window, new Event('focus'));
  expect(unrelated).toHaveFocus();
  expect(readBatch(scope).value!.entries[0].status).toBe('pending');
  expect(mocks.submit).not.toHaveBeenCalled();
});
it('does not resume an older deferred review after cancellation starts a new lookup generation', async () => {
  const original = render(<AssignmentWorkspace {...props} />);
  await inspect();
  original.unmount();
  let finish!: (value: unknown) => void;
  mocks.inspect.mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  render(<AssignmentWorkspace {...props} />);
  const cancel = screen.getByRole('button', { name: 'Cancel inspection' });
  fireEvent(cancel, pointer('pointerdown', 7));
  await act(async () => finish({ ok: true, candidate }));
  fireEvent(window, new Event('blur'));
  fireEvent.click(cancel);
  mocks.find.mockReturnValueOnce(new Promise(() => {}));
  fireEvent.change(screen.getByLabelText('Scan, paste, or search inventory'), {
    target: { value: 'NEW' },
  });
  fireEvent.submit(screen.getByRole('form', { name: 'Inspect equipment' }));
  fireEvent(window, new Event('focus'));
  expect(
    screen.getByRole('button', { name: 'Cancel inspection' }),
  ).toHaveFocus();
  expect(
    screen.queryByRole('region', { name: 'Review assignment' }),
  ).not.toBeInTheDocument();
  expect(readBatch(scope).value!.entries[0].status).toBe('skipped');
  expect(mocks.submit).not.toHaveBeenCalled();
});
it.each(['keyboard', 'secondary press', 'cancelled press', 'released press'])(
  'keeps normal review focus after restoration for %s navigation',
  async (navigation) => {
    const first = render(<AssignmentWorkspace {...props} />);
    await inspect();
    first.unmount();
    let finish!: (value: unknown) => void;
    mocks.inspect.mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    render(<AssignmentWorkspace {...props} />);
    const cancel = screen.getByRole('button', { name: 'Cancel inspection' });
    if (navigation !== 'keyboard') {
      fireEvent(
        cancel,
        pointer('pointerdown', 1, navigation === 'secondary press' ? 2 : 0),
      );
      if (navigation === 'cancelled press')
        fireEvent(cancel, pointer('pointercancel'));
      if (navigation === 'released press')
        fireEvent(cancel, pointer('pointerup'));
    }
    await act(async () => finish({ ok: true, candidate }));
    expect(
      screen.getByRole('region', { name: 'Review assignment' }),
    ).toHaveFocus();
    expect(readBatch(scope).value?.entries[0].status).toBe('pending');
    expect(mocks.submit).not.toHaveBeenCalled();
  },
);

it.each(['pointerup', 'pointercancel'])(
  'releases a Cancel press on an outside sibling %s without accepting cancellation',
  async (type) => {
    const first = render(<AssignmentWorkspace {...props} />);
    await inspect();
    first.unmount();
    let finish!: (value: unknown) => void;
    mocks.inspect.mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    render(
      <>
        <AssignmentWorkspace {...props} />
        <p data-testid="outside-release">Outside</p>
      </>,
    );
    const cancel = screen.getByRole('button', { name: 'Cancel inspection' });
    fireEvent(cancel, pointer('pointerdown', 7));
    fireEvent(
      screen.getByTestId('outside-release'),
      pointer(type, 7, 0, 20, 20),
    );
    // A nonfocusable release target leaves the button focused but is not a click.
    expect(cancel).toHaveFocus();
    expect(readBatch(scope).value?.entries[0].status).toBe('pending');
    await act(async () => finish({ ok: true, candidate }));
    expect(
      screen.getByRole('region', { name: 'Review assignment' }),
    ).toHaveFocus();
    expect(readBatch(scope).value?.entries[0].status).toBe('pending');
    expect(mocks.submit).not.toHaveBeenCalled();
  },
);

it.each(['pointerup', 'pointercancel'])(
  'does not release the held Cancel pointer for another pointer %s',
  async (type) => {
    const first = render(<AssignmentWorkspace {...props} />);
    await inspect();
    first.unmount();
    let finish!: (value: unknown) => void;
    mocks.inspect.mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    render(
      <>
        <AssignmentWorkspace {...props} />
        <p data-testid="outside-release">Outside</p>
      </>,
    );
    const cancel = screen.getByRole('button', { name: 'Cancel inspection' });
    fireEvent(cancel, pointer('pointerdown', 7));
    fireEvent(screen.getByTestId('outside-release'), pointer(type, 8));
    await act(async () => finish({ ok: true, candidate }));
    expect(cancel).toHaveFocus();
    expect(readBatch(scope).value?.entries[0].status).toBe('pending');
    fireEvent(cancel, pointer('pointerup', 7));
    fireEvent.click(cancel);
    expect(readBatch(scope).value?.entries[0].status).toBe('skipped');
    expect(mocks.submit).not.toHaveBeenCalled();
  },
);

it('removes outside Cancel release listeners on unmount while restoration is pending', async () => {
  const first = render(<AssignmentWorkspace {...props} />);
  await inspect();
  first.unmount();
  let finish!: (value: unknown) => void;
  mocks.inspect.mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  const add = vi.spyOn(window, 'addEventListener');
  const remove = vi.spyOn(window, 'removeEventListener');
  try {
    const restored = render(<AssignmentWorkspace {...props} />);
    fireEvent(
      screen.getByRole('button', { name: 'Cancel inspection' }),
      pointer('pointerdown', 7),
    );
    const registrations = add.mock.calls.filter(
      ([type, , capture]) =>
        (type === 'pointerup' || type === 'pointercancel') && capture === true,
    );
    expect(registrations).toHaveLength(2);
    const before = readBatch(scope).raw;
    restored.unmount();
    for (const registration of registrations)
      expect(remove).toHaveBeenCalledWith(...registration);
    fireEvent(document.body, pointer('pointerup', 7));
    await act(async () => finish({ ok: true, candidate }));
    expect(readBatch(scope).raw).toBe(before);
    expect(mocks.submit).not.toHaveBeenCalled();
    let refresh!: (value: unknown) => void;
    mocks.inspect.mockReturnValueOnce(
      new Promise((resolve) => {
        refresh = resolve;
      }),
    );
    render(<AssignmentWorkspace {...props} />);
    // The historical review is already visible while availability refresh is
    // pending. Its presence alone does not establish completed review focus.
    const review = screen.getByRole('region', { name: 'Review assignment' });
    expect(
      screen.getByRole('form', { name: 'Inspect equipment' }),
    ).toHaveAttribute('aria-busy', 'true');
    expect(
      screen.getByRole('button', { name: 'Cancel inspection' }),
    ).toHaveFocus();
    expect(
      screen.getByRole('button', { name: 'Confirm assign' }),
    ).toBeDisabled();
    await act(async () =>
      refresh({
        ok: true,
        candidate: { ...candidate, name: 'Freshly inspected adapters' },
      }),
    );
    expect(
      screen.getByRole('form', { name: 'Inspect equipment' }),
    ).toHaveAttribute('aria-busy', 'false');
    expect(
      screen.getByRole('heading', { name: 'Freshly inspected adapters' }),
    ).toBeInTheDocument();
    expect(review).toHaveFocus();
    expect(mocks.submit).not.toHaveBeenCalled();
  } finally {
    add.mockRestore();
    remove.mockRestore();
  }
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
  expect(
    screen.getByText(/The saved assignment details do not match/),
  ).toBeInTheDocument();
  expect(screen.getByRole('alert')).not.toHaveTextContent(
    /recovery|reconcile/i,
  );
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

it('selects inactive inventory-bearing preferred sources through navigation-only ancestors and restores them without mutation', async () => {
  const parent = {
    ...props.locations[0],
    id: id(20),
    code: 'OLD-OFFICE',
    name: 'Old office',
    active: false,
    can_hold_inventory: false,
    parentId: null,
  };
  const inactive = {
    ...props.locations[0],
    parentId: parent.id,
    active: false,
  };
  const localProps = { ...props, locations: [parent, inactive] };
  mocks.inspect.mockResolvedValue({
    ok: true,
    candidate: {
      ...candidate,
      sources: [{ ...candidate.sources[0], active: false }],
    },
  });
  const view = render(<AssignmentWorkspace {...localProps} />);
  fireEvent.click(
    screen.getByRole('combobox', {
      name: 'Preferred storage source (optional)',
    }),
  );
  expect(
    screen.queryByRole('treeitem', { name: /Red, selectable location/ }),
  ).toBeInTheDocument();
  const navigation = screen.getByRole('treeitem', {
    name: /Old office, navigation group/,
  });
  const beforeNavigation = readBatch(scope).raw;
  fireEvent.click(navigation);
  expect(readBatch(scope).raw).toBe(beforeNavigation);
  expect(
    screen.getByRole('button', { name: 'Preferred storage source (optional)' }),
  ).toHaveTextContent('Choose for each item');
  expect(
    screen.getByRole('tree', { name: 'Preferred storage source (optional)' }),
  ).toBeInTheDocument();
  fireEvent.click(navigation);
  fireEvent.click(
    screen.getByRole('treeitem', { name: /Red, selectable location/ }),
  );
  expect(readBatch(scope).value?.context?.sourceId).toBe(inactive.id);
  await inspect();
  expect(screen.getByLabelText('Storage source')).toHaveValue(inactive.id);
  expect(
    screen.getByRole('option', { name: /inactive source/ }),
  ).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Confirm assign' })).toBeEnabled();
  view.unmount();
  render(<AssignmentWorkspace {...localProps} />);
  await screen.findByText(/Availability refreshed/);
  expect(
    screen.getByRole('combobox', {
      name: 'Preferred storage source (optional)',
    }),
  ).toHaveTextContent('Red');
  expect(
    screen.queryByText(
      'Selected location is unavailable. Choose another location.',
    ),
  ).not.toBeInTheDocument();
  expect(screen.getByLabelText('Storage source')).toHaveValue(inactive.id);
  expect(readBatch(scope).value?.entries).toHaveLength(1);
  expect(mocks.submit).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Confirm assign' }));
  await screen.findByRole('region', { name: 'Latest assignment receipt' });
  expect(mocks.submit.mock.calls[0][0].payload).toMatchObject({
    source_location_id: inactive.id,
    destination_site_id: site.id,
  });
});
it('retains an inactive preferred source across refresh but blocks confirmation when its item holding disappears', async () => {
  const inactive = { ...props.locations[0], active: false };
  const alternate = {
    ...props.locations[0],
    id: id(21),
    code: 'OTHER',
    name: 'Other holding',
  };
  const localProps = { ...props, locations: [inactive, alternate] };
  mocks.inspect.mockResolvedValue({
    ok: true,
    candidate: {
      ...candidate,
      sources: [{ ...candidate.sources[0], active: false }],
    },
  });
  const view = render(<AssignmentWorkspace {...localProps} />);
  fireEvent.click(
    screen.getByRole('combobox', {
      name: 'Preferred storage source (optional)',
    }),
  );
  fireEvent.click(
    screen.getByRole('treeitem', { name: /Red, selectable location/ }),
  );
  await inspect();
  view.unmount();
  mocks.inspect.mockResolvedValue({
    ok: true,
    candidate: {
      ...candidate,
      version: '9',
      sources: [
        { id: alternate.id, name: alternate.name, active: true, quantity: 2 },
      ],
    },
  });
  render(<AssignmentWorkspace {...localProps} />);
  await screen.findByText(/Availability refreshed/);
  expect(readBatch(scope).value?.context?.sourceId).toBe(inactive.id);
  expect(readBatch(scope).value?.historical?.sourceId).toBe(inactive.id);
  expect(screen.getByRole('button', { name: 'Confirm assign' })).toBeDisabled();
  expect(mocks.submit).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText('Storage source'), {
    target: { value: alternate.id },
  });
  expect(screen.getByRole('button', { name: 'Confirm assign' })).toBeEnabled();
  expect(mocks.submit).not.toHaveBeenCalled();
});

it('defers assignment bootstrap and scope rebinding while privacy verification is pending', async () => {
  const { PrivacyReadinessContext } =
    await import('@/components/auth/privacy-readiness');
  const get = vi.spyOn(Storage.prototype, 'getItem');
  const view = render(
    <PrivacyReadinessContext value={{ ready: false, generation: 'first' }}>
      <AssignmentWorkspace {...props} />
    </PrivacyReadinessContext>,
  );
  expect(get).not.toHaveBeenCalled();
  expect(
    screen.queryByRole('form', { name: 'Inspect equipment' }),
  ).not.toBeInTheDocument();
  view.rerender(
    <PrivacyReadinessContext value={{ ready: true, generation: 'first' }}>
      <AssignmentWorkspace {...props} />
    </PrivacyReadinessContext>,
  );
  await screen.findByRole('form', { name: 'Inspect equipment' });
  fireEvent.change(screen.getByLabelText('Scan, paste, or search inventory'), {
    target: { value: 'typed lookup' },
  });
  get.mockClear();
  view.rerender(
    <PrivacyReadinessContext value={{ ready: false, generation: 'first' }}>
      <AssignmentWorkspace {...props} />
    </PrivacyReadinessContext>,
  );
  expect(get).not.toHaveBeenCalled();
  view.rerender(
    <PrivacyReadinessContext value={{ ready: true, generation: 'first' }}>
      <AssignmentWorkspace {...props} />
    </PrivacyReadinessContext>,
  );
  expect(screen.getByLabelText('Scan, paste, or search inventory')).toHaveValue(
    'typed lookup',
  );
  expect(get).not.toHaveBeenCalled();
  view.rerender(
    <PrivacyReadinessContext value={{ ready: false, generation: 'first' }}>
      <AssignmentWorkspace {...props} actorId={id(98)} />
    </PrivacyReadinessContext>,
  );
  expect(get).not.toHaveBeenCalled();
  expect(
    screen.queryByRole('form', { name: 'Inspect equipment' }),
  ).not.toBeInTheDocument();
  get.mockRestore();
});
it('retains the original in-flight mutation and reconciles it once while privacy verification is pending', async () => {
  const { PrivacyReadinessContext } =
    await import('@/components/auth/privacy-readiness');
  let finish!: (value: unknown) => void;
  mocks.submit.mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  const view = render(
    <PrivacyReadinessContext value={{ ready: true, generation: 'first' }}>
      <AssignmentWorkspace {...props} />
    </PrivacyReadinessContext>,
  );
  await inspect();
  fireEvent.click(screen.getByRole('button', { name: 'Confirm assign' }));
  await waitFor(() => expect(mocks.submit).toHaveBeenCalledOnce());
  const original = mocks.submit.mock.calls[0][0];
  view.rerender(
    <PrivacyReadinessContext value={{ ready: false, generation: 'first' }}>
      <AssignmentWorkspace {...props} />
    </PrivacyReadinessContext>,
  );
  expect(readAssignmentRecovery(scope).value?.command.requestId).toBe(
    original.requestId,
  );
  await act(async () =>
    finish({
      ok: true,
      entityId: candidate.id,
      version: '8',
      changed: true,
      eventId: id(8),
    }),
  );
  expect(readBatch(scope).value?.entries[0]).toMatchObject({
    status: 'success',
    requestId: original.requestId,
  });
  expect(readAssignmentRecovery(scope).value).toBeNull();
  view.rerender(
    <PrivacyReadinessContext value={{ ready: true, generation: 'first' }}>
      <AssignmentWorkspace {...props} />
    </PrivacyReadinessContext>,
  );
  await screen.findByRole('region', { name: 'Latest assignment receipt' });
  expect(mocks.submit).toHaveBeenCalledOnce();
  expect(readBatch(scope).value?.entries).toHaveLength(1);
});

it.each(['original', 'different'] as const)(
  'keeps a deferred command after failed logout and permits explicit replay only after %s actor verification',
  async (actor) => {
    let oldOutcome!: (value: unknown) => void;
    mocks.submit.mockReturnValueOnce(
      new Promise((resolve) => {
        oldOutcome = resolve;
      }),
    );
    mocks.signOut.mockResolvedValue({
      ok: false,
      message: 'Signout transport failed.',
    });
    render(
      <ProtectedPrivacyBoundary
        binding={{
          actorId: props.actorId,
          backend: props.backend,
          role: 'staff',
          canManageConfiguration: false,
        }}
      >
        <QueueLogoutForm />
        <ProtectedPrivacyContent>
          <AssignmentWorkspace {...props} />
        </ProtectedPrivacyContent>
      </ProtectedPrivacyBoundary>,
    );
    await screen.findByRole('button', { name: 'Inspect equipment' });
    await inspect();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm assign' }));
    await waitFor(() => expect(mocks.submit).toHaveBeenCalledOnce());
    const command = mocks.submit.mock.calls[0][0];
    const originalRaw = readAssignmentRecovery(scope).raw;
    let originalIdentity!: (value: unknown) => void;
    mocks.identityRead.mockReturnValueOnce(
      new Promise((resolve) => {
        originalIdentity = resolve;
      }),
    );
    fireEvent.submit(
      screen.getByRole('button', { name: 'Sign out' }).closest('form')!,
    );
    await waitFor(() => expect(mocks.identityRead).toHaveBeenCalledOnce());
    expect(readAssignmentRecovery(scope).raw).toBe(originalRaw);
    expect(readBatch(scope).value?.entries[0].status).toBe('uncertain');
    expect(
      screen.queryByRole('region', { name: 'Latest assignment receipt' }),
    ).not.toBeInTheDocument();
    await act(async () =>
      originalIdentity(
        actor === 'original'
          ? { status: 'match', generation: { status: 'absent' } }
          : { status: 'denied' },
      ),
    );
    expect(mocks.identityRead).toHaveBeenCalledWith({
      actorId: props.actorId,
      backend: props.backend,
      role: 'staff',
      canManageConfiguration: false,
    });
    expect(mocks.submit).toHaveBeenCalledOnce();
    if (actor === 'different') {
      await act(async () =>
        oldOutcome({
          ok: true,
          changed: true,
          entityId: candidate.id,
          version: '8',
          eventId: id(8),
        }),
      );
      expect(await screen.findByRole('alert')).toHaveTextContent(
        'original account access',
      );
      expect(
        screen.queryByRole('button', { name: 'Retry same assignment' }),
      ).not.toBeInTheDocument();
      expect(readAssignmentRecovery(scope).raw).toBe(originalRaw);
      return;
    }
    expect(await screen.findByText('Signout transport failed.')).toBeVisible();
    const retry = await screen.findByRole('button', {
      name: 'Retry same assignment',
    });
    await waitFor(() => expect(retry).toBeEnabled());
    await act(async () =>
      oldOutcome({
        ok: true,
        changed: true,
        entityId: candidate.id,
        version: '8',
        eventId: id(8),
      }),
    );
    expect(readBatch(scope).value?.entries[0].status).toBe('uncertain');
    expect(
      screen.queryByRole('region', { name: 'Latest assignment receipt' }),
    ).not.toBeInTheDocument();
    fireEvent.click(retry);
    await screen.findByRole('region', { name: 'Latest assignment receipt' });
    expect(mocks.submit).toHaveBeenCalledTimes(2);
    expect(mocks.submit.mock.calls[1][0]).toEqual(command);
    expect(readBatch(scope).value?.entries).toHaveLength(1);
    expect(readAssignmentRecovery(scope).value).toBeNull();
  },
);
