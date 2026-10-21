import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import {
  Suspense,
  useContext,
  useInsertionEffect,
  useLayoutEffect,
} from 'react';
import { useSearchParams } from 'next/navigation';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ProtectedPrivacyBoundary } from '@/components/auth/auth-privacy';
import { ProtectedPrivacyContent } from '@/components/auth/privacy-content';
import {
  PrivacyReadinessContext,
  PrivateRestorationGate,
} from '@/components/auth/privacy-readiness';
import {
  assignmentEpoch,
  readPrivacyRevocationRevision,
  revokePrivatePresentation,
  invalidateAssignmentCallbacks,
  invalidateAssignmentPrivacy,
} from '@/features/scan/assign-batch';
import type { LogoutPrivacyGeneration } from '@/lib/auth/privacy-barrier';
import { QueueLogoutForm } from '@/features/labels/queue-logout-form';
import {
  RouteMotionProvider,
  useRouteMotion,
  useInvalidateRouteMotion,
} from './route-motion';
import {
  RouteLoading,
  RoutePendingContext,
  useRouteTask,
} from './route-pending';
import { RouteReady, RouteReadyContext } from './route-ready';
import { observeRouteActionResult } from './route-action-result';
import { titleTarget } from './route-motion-state';
import { TaskWorkspace } from '@/features/inventory/components/task-workspace';

const runtime = vi.hoisted(() => ({
  read: vi.fn(),
  compare: vi.fn(),
  identity: vi.fn(),
  signOut: vi.fn(),
  replace: vi.fn(),
  refresh: vi.fn(),
  pathname: '/inventory',
  query: '',
  authCallbacks: [] as Array<
    (event: string, session: { user: { id: string } } | null) => void
  >,
}));
vi.mock('@/lib/auth/actions', () => ({
  readLogoutPrivacyGeneration: runtime.read,
  acknowledgeLogoutPrivacyGeneration: runtime.compare,
  readProtectedPrivacyIdentity: runtime.identity,
  signOutSession: runtime.signOut,
}));
vi.mock('@/lib/auth/privacy-read-transport', () => ({
  readLogoutPrivacyGeneration: runtime.read,
  acknowledgeLogoutPrivacyGeneration: runtime.compare,
  readProtectedPrivacyIdentity: runtime.identity,
  signOutSession: runtime.signOut,
}));
vi.mock('@/lib/auth/logout-transport', () => ({
  readLogoutPrivacyGeneration: runtime.read,
  acknowledgeLogoutPrivacyGeneration: runtime.compare,
  readProtectedPrivacyIdentity: runtime.identity,
  signOutSession: runtime.signOut,
}));
vi.mock('next/navigation', () => ({
  usePathname: () => runtime.pathname,
  useSearchParams: () => new URLSearchParams(runtime.query),
  useRouter: () => ({ replace: runtime.replace, refresh: runtime.refresh }),
}));
vi.mock('@/lib/supabase/browser', () => ({
  createSupabaseBrowserClient: () => ({
    auth: {
      onAuthStateChange: (callback: (typeof runtime.authCallbacks)[number]) => {
        runtime.authCallbacks.push(callback);
        return { data: { subscription: { unsubscribe: () => {} } } };
      },
    },
  }),
}));
vi.mock('@/features/metadata/designer-recovery', () => ({
  hasUnresolvedDesignerRecovery: () => true,
  clearAllDesignerRecovery: vi.fn(() => true),
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((finish) => {
    resolve = finish;
  });
  return { promise, resolve };
}
const binding = {
  actorId: 'staff',
  backend: 'https://isolated.example',
  role: 'staff' as const,
  canManageConfiguration: true,
};
const target = titleTarget(
  { kind: 'quantity', id: 'cable' },
  '/inventory#inventory-row-1',
  { domain: 'storage', id: 'shelf' },
)!;
let controls: {
  motion: ReturnType<typeof useRouteMotion>;
  scope: NonNullable<React.ContextType<typeof RoutePendingContext>>;
  readiness: NonNullable<React.ContextType<typeof RouteReadyContext>>;
  retire: () => void;
};
let work: ReturnType<typeof deferred<void>>;
let refreshWork: ReturnType<typeof deferred<void>>;
let businessMounts = 0;

function Controls() {
  const motion = useRouteMotion();
  const scope = useContext(RoutePendingContext)!;
  const readiness = useContext(RouteReadyContext)!;
  const retire = useInvalidateRouteMotion();
  useLayoutEffect(() => {
    controls = { motion, scope, readiness, retire };
  });
  return <output data-testid="route-enabled">{String(motion.enabled)}</output>;
}
function BusinessOwner() {
  const [busy, run] = useRouteTask();
  const [refreshBusy, runRefresh] = useRouteTask();
  useLayoutEffect(() => {
    businessMounts++;
  }, []);
  return (
    <>
      <input aria-label="Original draft" defaultValue="original" />
      <button disabled={busy} onClick={() => run(() => work.promise)}>
        Save original request
      </button>
      <button
        disabled={refreshBusy}
        onClick={() => runRefresh(() => refreshWork.promise)}
      >
        Refresh current contents
      </button>
      <QueueLogoutForm />
    </>
  );
}
function tree(owner = binding, actor = 'staff') {
  return (
    <ProtectedPrivacyBoundary
      serverGeneration={{ status: 'absent' }}
      binding={owner}
    >
      <RouteMotionProvider actorId={actor}>
        <Controls />
        <ProtectedPrivacyContent>
          <RouteReady
            actorId="staff"
            routeKey="/inventory"
            contentIdentity="inventory"
          >
            <BusinessOwner />
          </RouteReady>
        </ProtectedPrivacyContent>
      </RouteMotionProvider>
    </ProtectedPrivacyBoundary>
  );
}
async function admitted() {
  const view = render(tree());
  await waitFor(() =>
    expect(view.container.querySelector('input')).not.toBeNull(),
  );
  await waitFor(() => expect(controls.motion.enabled).toBe(true));
  return view;
}
beforeEach(() => {
  businessMounts = 0;
  sessionStorage.clear();
  localStorage.clear();
  work = deferred<void>();
  refreshWork = deferred<void>();
  runtime.pathname = '/inventory';
  runtime.query = '';
  runtime.authCallbacks = [];
  runtime.read.mockReset().mockResolvedValue({ status: 'absent' });
  runtime.compare.mockReset().mockResolvedValue({ status: 'match' });
  runtime.identity
    .mockReset()
    .mockResolvedValue({ status: 'match', generation: { status: 'absent' } });
  runtime.signOut
    .mockReset()
    .mockResolvedValue({ ok: false, message: 'Sign-out unavailable.' });
  vi.stubGlobal('CSS', { supports: () => true });
  // Explicit supported-browser motion fixture, restored with the other globals.
  // Native entry/scroll restoration is outside this privacy/controller suite.
  vi.stubGlobal('navigation', new EventTarget());
  vi.stubGlobal('matchMedia', () => ({
    matches: false,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
  Object.defineProperty(document, 'startViewTransition', {
    configurable: true,
    writable: true,
    value: vi.fn(),
  });
  Object.defineProperty(document, 'activeViewTransition', {
    configurable: true,
    value: null,
  });
  document.documentElement.dataset.motion = 'full';
  history.replaceState(null, '', '/inventory');
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(document, 'startViewTransition');
  Reflect.deleteProperty(document, 'activeViewTransition');
  history.replaceState(null, '', '/');
});

const nativeId = 'a3010000-0000-4000-8000-0000000000ab';
const nativePath = '/inventory/assets/' + nativeId;
type NativeOptions = {
  kind?: 'asset' | 'quantity';
  owner?: typeof binding;
  revision?: number;
  serverGeneration?: LogoutPrivacyGeneration;
  primaryKey?: string;
  content?: string;
  anchor?: string;
  hidden?: boolean;
  contentRouteKey?: string;
  incomingText?: string;
};
let taskPrivacy: React.ContextType<typeof PrivacyReadinessContext>;
let taskPrivacyEvents: Array<{
  ready: boolean;
  status: string | undefined;
  current: boolean;
  consumptionReady: boolean;
}> = [];
let taskPublicationEvents: Array<{
  status: string | undefined;
  consumptionReady: boolean;
}> = [];
function TaskPrivacyProbe() {
  const privacy = useContext(PrivacyReadinessContext);
  useInsertionEffect(() => {
    taskPublicationEvents.push({
      status: privacy.taskQuery?.status(),
      consumptionReady: privacy.taskQuery?.consumptionReady() === true,
    });
  });
  useLayoutEffect(() => {
    taskPrivacy = privacy;
    taskPrivacyEvents.push({
      ready: privacy.ready,
      status: privacy.taskQuery?.status(),
      current: privacy.taskQuery?.current() === true,
      consumptionReady: privacy.taskQuery?.consumptionReady() === true,
    });
  });
  return (
    <output data-testid="task-private-ready">{String(privacy.ready)}</output>
  );
}
function NativeTaskWorkspace({ kind }: { kind: 'asset' | 'quantity' }) {
  // Model DetailTasks' mounted query consumer rather than passing a query prop
  // through the server node that AcceptedPrivacyContent intentionally retains.
  const query = useSearchParams();
  const privacy = useContext(PrivacyReadinessContext);
  return (
    <>
      <output data-testid="task-primary-ready">{String(privacy.ready)}</output>
      <TaskWorkspace
        choices={[
          {
            id: kind + '_move',
            label: kind === 'asset' ? 'Move asset' : 'Move stock',
          },
        ]}
        context="Owned asset"
        recordIdentity={kind + ':' + nativeId}
        taskIntent={query.get('task') ?? undefined}
      >
        {() => <p>Move form</p>}
      </TaskWorkspace>
      {query.has('task') && (
        <PrivateRestorationGate scope="new-native-task-restoration">
          <p>Fresh task storage bootstrap</p>
        </PrivateRestorationGate>
      )}
    </>
  );
}
function nativeTaskTree(options: NativeOptions = {}) {
  const kind = options.kind ?? 'asset';
  const path =
    '/inventory/' + (kind === 'asset' ? 'assets' : 'quantity') + '/' + nativeId;
  return (
    <ProtectedPrivacyBoundary
      serverGeneration={options.serverGeneration ?? { status: 'absent' }}
      binding={options.owner ?? binding}
      revision={options.revision}
    >
      <RouteMotionProvider actorId="staff">
        <Controls />
        <TaskPrivacyProbe />
        <ProtectedPrivacyContent routeKey={options.contentRouteKey}>
          <div hidden={options.hidden}>
            <RouteReady
              actorId="staff"
              routeKey={options.anchor ?? path}
              contentIdentity={options.content ?? 'record'}
              conventionalPrimary
              key={options.primaryKey ?? 'original'}
            >
              <main>
                <h1>Owned asset</h1>
                <p>{options.incomingText ?? 'Original primary content'}</p>
                <NativeTaskWorkspace kind={kind} />
              </main>
            </RouteReady>
          </div>
        </ProtectedPrivacyContent>
      </RouteMotionProvider>
    </ProtectedPrivacyBoundary>
  );
}
async function admittedNativeTask(query = '', options: NativeOptions = {}) {
  runtime.pathname =
    options.kind === 'quantity'
      ? '/inventory/quantity/' + nativeId
      : nativePath;
  runtime.query = query;
  taskPrivacyEvents = [];
  taskPublicationEvents = [];
  history.replaceState(null, '', runtime.pathname + (query ? '?' + query : ''));
  vi.spyOn(HTMLElement.prototype, 'getClientRects').mockReturnValue([
    {},
  ] as unknown as DOMRectList);
  const view = render(nativeTaskTree(options));
  await waitFor(() => expect(taskPrivacy.ready).toBe(true));
  return view;
}
function nativeQuery(
  view: ReturnType<typeof render>,
  query: string,
  options?: NativeOptions,
) {
  runtime.query = query;
  history.replaceState({}, '', runtime.pathname + (query ? '?' + query : ''));
  view.rerender(nativeTaskTree(options));
}
async function freshNativeTask() {
  await waitFor(() => expect(taskPrivacy.ready).toBe(true));
  await act(async () => {});
}

it('holds a native task closed through its exact privacy check, consumes once, and permits deliberate reentry after cleanup', async () => {
  const view = await admittedNativeTask();
  expect(controls.readiness.currentPrimary()?.routeKey).toBe(nativePath);
  const acceptedSecurity = JSON.stringify([
    taskPrivacy.generation,
    taskPrivacy.cleanupRevision,
    taskPrivacy.revocationRevision,
    taskPrivacy.verifiedEpoch,
    assignmentEpoch(),
    taskPrivacy.cleanupRevision,
  ]);
  const check = deferred<LogoutPrivacyGeneration>();
  runtime.read.mockReturnValueOnce(check.promise);
  const events = taskPrivacyEvents.length;
  nativeQuery(view, 'returnTo=%2Finventory&task=asset_move');
  await waitFor(() => expect(taskPrivacy.ready).toBe(false));
  expect(taskPrivacyEvents[events]).toEqual({
    ready: false,
    status: 'pending',
    current: true,
    consumptionReady: false,
  });
  expect(taskPrivacy.verifiedEpoch).toBeUndefined();
  expect(taskPrivacy.taskQuery?.securityRevision).toBe(acceptedSecurity);
  expect(screen.queryByRole('heading', { name: 'Move asset' })).toBeNull();
  await act(async () => {
    check.resolve({ status: 'absent' });
    await check.promise;
  });
  await screen.findByRole('heading', { name: 'Move asset' });
  expect(location.search).toBe('?returnTo=%2Finventory');
  const cleanup = deferred<LogoutPrivacyGeneration>();
  runtime.read.mockReturnValueOnce(cleanup.promise);
  nativeQuery(view, 'returnTo=%2Finventory');
  await waitFor(() => expect(taskPrivacy.ready).toBe(false));
  expect(taskPrivacy.taskQuery?.kind).toBe('cleanup');
  fireEvent.click(screen.getByRole('button', { name: 'Close task' }));
  await act(async () => {
    cleanup.resolve({ status: 'absent' });
    await cleanup.promise;
  });
  await freshNativeTask();
  expect(screen.queryByRole('heading', { name: 'Move asset' })).toBeNull();
  nativeQuery(view, 'returnTo=%2Finventory&task=asset_move');
  await screen.findByRole('heading', { name: 'Move asset' });
  expect(location.search).toBe('?returnTo=%2Finventory');
});

it.each(['asset', 'quantity'] as const)(
  'consumes and reenters a verified native %s task beneath its explicit server-primary gate without admitting content or storage',
  async (kind) => {
    const path =
      '/inventory/' +
      (kind === 'asset' ? 'assets' : 'quantity') +
      '/' +
      nativeId;
    const options: NativeOptions = { kind, contentRouteKey: path };
    const view = await admittedNativeTask('', options);
    const heading = kind === 'asset' ? 'Move asset' : 'Move stock';
    const taskQuery = 'returnTo=%2Finventory&task=' + kind + '_move';
    for (let repeat = 0; repeat < 2; repeat++) {
      const check = deferred<LogoutPrivacyGeneration>();
      runtime.read.mockReturnValueOnce(check.promise);
      const first = taskPrivacyEvents.length;
      nativeQuery(view, taskQuery, {
        ...options,
        incomingText: 'Unaccepted incoming primary',
      });
      await waitFor(() => expect(taskPrivacy.ready).toBe(false));
      expect(taskPrivacyEvents[first]).toEqual({
        ready: false,
        status: 'pending',
        current: true,
        consumptionReady: false,
      });
      expect(taskPrivacy.taskQuery?.consumptionReady()).toBe(false);
      expect(screen.queryByRole('heading', { name: heading })).toBeNull();
      await act(async () => {
        check.resolve({ status: 'absent' });
        await check.promise;
      });
      await freshNativeTask();
      expect(taskPrivacy.taskQuery?.status(), 'repeat ' + repeat).toBe(
        'consumed',
      );
      expect(taskPrivacy.taskQuery?.consumptionReady()).toBe(true);
      expect(taskPublicationEvents).toContainEqual({
        status: 'verified',
        consumptionReady: false,
      });
      expect(screen.getByTestId('task-primary-ready')).toHaveTextContent(
        'false',
      );
      expect(taskPrivacy.navigation?.admission(path).ready).toBe(false);
      expect(screen.queryByText('Fresh task storage bootstrap')).toBeNull();
      expect(screen.queryByText('Unaccepted incoming primary')).toBeNull();
      expect(screen.getByRole('heading', { name: heading })).toHaveFocus();
      expect(location.search).toBe('?returnTo=%2Finventory');
      const cleanup = deferred<LogoutPrivacyGeneration>();
      runtime.read.mockReturnValueOnce(cleanup.promise);
      nativeQuery(view, 'returnTo=%2Finventory', options);
      await waitFor(() => expect(taskPrivacy.ready).toBe(false));
      expect(taskPrivacy.taskQuery?.kind).toBe('cleanup');
      expect(taskPrivacy.taskQuery?.consumptionReady()).toBe(false);
      fireEvent.click(screen.getByRole('button', { name: 'Close task' }));
      await act(async () => {
        cleanup.resolve({ status: 'absent' });
        await cleanup.promise;
      });
      await freshNativeTask();
      expect(taskPrivacy.taskQuery?.consumptionReady()).toBe(true);
      expect(screen.queryByRole('heading', { name: heading })).toBeNull();
      expect(screen.getByTestId('task-primary-ready')).toHaveTextContent(
        'false',
      );
    }
  },
);

it.each(
  (['asset', 'quantity'] as const).flatMap((kind) =>
    (['revocation', 'owner', 'late', 'generic-recheck'] as const).map(
      (reason) => ({
        kind,
        reason,
      }),
    ),
  ),
)(
  'rejects $kind receipt consumption through the explicit gate after $reason',
  async ({ kind, reason }) => {
    const path =
      '/inventory/' +
      (kind === 'asset' ? 'assets' : 'quantity') +
      '/' +
      nativeId;
    const options: NativeOptions = { kind, contentRouteKey: path };
    const view = await admittedNativeTask('', options);
    const check = deferred<LogoutPrivacyGeneration>();
    runtime.read.mockReturnValueOnce(check.promise);
    nativeQuery(view, 'returnTo=%2Finventory&task=' + kind + '_move', options);
    await waitFor(() => expect(taskPrivacy.ready).toBe(false));
    const held = taskPrivacy.taskQuery!;
    expect(held.consumptionReady()).toBe(false);
    if (reason === 'revocation') act(() => revokePrivatePresentation());
    if (reason === 'owner') {
      view.rerender(
        nativeTaskTree({
          ...options,
          owner: { ...binding, actorId: 'replacement' },
        }),
      );
    }
    if (reason === 'late') {
      nativeQuery(view, '', options);
      await freshNativeTask();
    }
    if (reason === 'generic-recheck')
      act(() => window.dispatchEvent(new Event('focus')));
    expect(held.consumptionReady()).toBe(false);
    await act(async () => {
      check.resolve({ status: 'absent' });
      await check.promise;
    });
    expect(held.consumptionReady()).toBe(false);
    expect(
      screen.queryByRole('heading', { name: /Move asset|Move stock/ }),
    ).toBeNull();
    expect(screen.queryByText('Fresh task storage bootstrap')).toBeNull();
    if (reason !== 'late') expect(location.search).toContain('task=');
  },
);

it.each(['asset', 'quantity'] as const)(
  'retains native %s task consumption after two application entries on the explicit task-bearing server gate',
  async (kind) => {
    const path =
      '/inventory/' +
      (kind === 'asset' ? 'assets' : 'quantity') +
      '/' +
      nativeId;
    const task = kind + '_move';
    const anchor = path + '?task=' + task;
    const options: NativeOptions = { kind, anchor, contentRouteKey: anchor };
    const view = await admittedNativeTask('task=' + task, options);
    const originalConsume = controls.readiness.consumeTask;
    const ordinarySnapshots: Array<{ idle: boolean; pending: boolean }> = [];
    vi.spyOn(controls.readiness, 'consumeTask').mockImplementation(
      (...args) => {
        const before = {
          idle: controls.readiness.nativeTaskIdle(),
          pending: controls.scope.state.snapshot().pending,
        };
        const handoff = originalConsume(...args);
        if (handoff) ordinarySnapshots.push(before);
        return handoff;
      },
    );
    const heading = kind === 'asset' ? 'Move asset' : 'Move stock';
    for (let repeat = 0; repeat < 2; repeat++) {
      if (repeat) {
        act(() => controls.scope.navigation?.(anchor));
        nativeQuery(view, 'task=' + task, options);
      }
      await screen.findByRole('heading', { name: heading });
      expect(location.search).toBe('');
      nativeQuery(view, '', options);
      await freshNativeTask();
      fireEvent.click(screen.getByRole('button', { name: 'Close task' }));
    }
    expect(ordinarySnapshots).toEqual([{ idle: true, pending: false }]);
    nativeQuery(view, 'returnTo=%2Finventory&task=' + task, options);
    await freshNativeTask();
    expect(screen.getByRole('heading', { name: heading })).toHaveFocus();
    expect(location.search).toBe('?returnTo=%2Finventory');
  },
);

it.each(['notify-revocation', 'busy', 'changed-epoch', 'no-success'] as const)(
  'declines ordinary receipt transfer on %s while retaining the ordinary result',
  async (reason) => {
    const anchor = nativePath + '?task=asset_move';
    const options: NativeOptions = { anchor, contentRouteKey: anchor };
    const view = await admittedNativeTask('task=asset_move', options);
    nativeQuery(view, '', options);
    await freshNativeTask();
    fireEvent.click(screen.getByRole('button', { name: 'Close task' }));
    let finish: (() => void) | undefined;
    if (reason === 'notify-revocation') {
      let sawTaskSource = false;
      const stop = controls.readiness.subscribePrimary(() => {
        if (location.search) {
          sawTaskSource = true;
          return;
        }
        if (!sawTaskSource) return;
        stop();
        revokePrivatePresentation();
      });
    } else {
      const original = controls.readiness.consumeTask;
      vi.spyOn(controls.readiness, 'consumeTask').mockImplementation(
        (...args) => {
          if (reason === 'no-success') return null;
          const result = original(...args);
          if (result && reason === 'busy')
            finish = controls.scope.state.register();
          if (result && reason === 'changed-epoch')
            controls.scope.state.cancel();
          return result;
        },
      );
    }
    act(() => controls.scope.navigation?.(anchor));
    nativeQuery(view, 'task=asset_move', options);
    await freshNativeTask();
    if (reason === 'no-success') {
      expect(screen.queryByRole('heading', { name: 'Move asset' })).toBeNull();
      expect(location.search).toBe('?task=asset_move');
    } else {
      expect(screen.getByRole('heading', { name: 'Move asset' })).toBeVisible();
      expect(location.search).toBe('');
    }
    if (finish) act(finish);
    nativeQuery(view, '', options);
    await freshNativeTask();
    if (reason !== 'no-success')
      fireEvent.click(screen.getByRole('button', { name: 'Close task' }));
    nativeQuery(view, 'returnTo=%2Finventory&task=asset_move', options);
    await freshNativeTask();
    expect(screen.queryByRole('heading', { name: 'Move asset' })).toBeNull();
    expect(location.search).toContain('task=asset_move');
  },
);

it('an initial raw task URL has no native receipt to preserve', async () => {
  await admittedNativeTask('task=asset_move');
  expect(taskPrivacy.taskQuery).toBeUndefined();
  expect(screen.queryByRole('heading', { name: 'Move asset' })).toBeNull();
  expect(location.search).toBe('?task=asset_move');
});

it('a generic same-binding focus recheck permanently retires the original native receipt', async () => {
  const view = await admittedNativeTask();
  const check = deferred<LogoutPrivacyGeneration>();
  runtime.read.mockReturnValueOnce(check.promise);
  act(() => window.dispatchEvent(new Event('focus')));
  expect(taskPrivacy.ready).toBe(false);
  expect(taskPrivacy.taskQuery).toBeUndefined();
  await act(async () => {
    check.resolve({ status: 'absent' });
    await check.promise;
  });
  await freshNativeTask();
  nativeQuery(view, 'task=asset_move');
  await freshNativeTask();
  expect(screen.queryByRole('heading', { name: 'Move asset' })).toBeNull();
  expect(location.search).toBe('?task=asset_move');
});

it('a failed exact task verification cannot revive its receipt after later recovery', async () => {
  const view = await admittedNativeTask();
  runtime.read.mockRejectedValueOnce(new Error('unavailable'));
  nativeQuery(view, 'task=asset_move');
  await screen.findByRole('alert');
  expect(taskPrivacy.taskQuery?.status()).toBe('retired');
  act(() => window.dispatchEvent(new Event('focus')));
  await freshNativeTask();
  expect(screen.queryByRole('heading', { name: 'Move asset' })).toBeNull();
  expect(location.search).toBe('?task=asset_move');
});

it.each([
  'backend',
  'actor',
  'role',
  'configuration-grant',
  'server',
  'revision',
  'root',
  'content',
  'anchor',
  'hidden',
  'business',
  'navigation',
  'revocation',
  'assignment',
  'cleanup',
  'generic-refresh',
] as const)(
  'retires a held task attestation on %s without recovery from its late success',
  async (reason) => {
    const view = await admittedNativeTask();
    const check = deferred<LogoutPrivacyGeneration>();
    runtime.read.mockReturnValueOnce(check.promise);
    nativeQuery(view, 'task=asset_move');
    await waitFor(() => expect(taskPrivacy.ready).toBe(false));
    const old = taskPrivacy.taskQuery!;
    const options: NativeOptions = {};
    if (reason === 'backend')
      options.owner = { ...binding, backend: 'https://other.invalid' };
    if (reason === 'actor') options.owner = { ...binding, actorId: 'other' };
    if (reason === 'role')
      options.owner = { ...binding, role: 'viewer' as typeof binding.role };
    if (reason === 'configuration-grant')
      options.owner = { ...binding, canManageConfiguration: false };
    if (reason === 'server')
      options.serverGeneration = {
        status: 'valid',
        generation: '00000000-0000-4000-8000-000000000001',
      };
    if (reason === 'revision') options.revision = 1;
    if (reason === 'root') options.primaryKey = 'replacement';
    if (reason === 'content') options.content = 'replacement';
    if (reason === 'anchor') options.anchor = nativePath + '?changed=true';
    if (reason === 'hidden') options.hidden = true;
    let finish: (() => void) | undefined;
    if (reason === 'business')
      act(() => {
        finish = controls.scope.state.register();
      });
    if (reason === 'navigation')
      act(() => controls.scope.navigation?.('/history'));
    if (reason === 'revocation') act(() => revokePrivatePresentation());
    if (reason === 'assignment') act(() => invalidateAssignmentCallbacks());
    if (reason === 'cleanup')
      act(() => {
        invalidateAssignmentPrivacy(true, false);
      });
    if (reason === 'generic-refresh')
      act(() => window.dispatchEvent(new Event('focus')));
    view.rerender(nativeTaskTree(options));
    await act(async () => {
      check.resolve({ status: 'absent' });
      await check.promise;
    });
    if (finish) act(finish);
    view.rerender(nativeTaskTree());
    await act(async () => {});
    expect(screen.queryByRole('heading', { name: 'Move asset' })).toBeNull();
    expect(location.search).toBe('?task=asset_move');
    if (
      [
        'backend',
        'actor',
        'role',
        'configuration-grant',
        'server',
        'revision',
        'revocation',
      ].includes(reason)
    )
      expect(old.current()).toBe(false);
  },
);

it('superseding task A to clean B to task A rejects the first late result and cannot revive its receipt', async () => {
  const view = await admittedNativeTask();
  const check = deferred<LogoutPrivacyGeneration>();
  runtime.read.mockReturnValueOnce(check.promise);
  nativeQuery(view, 'task=asset_move');
  await waitFor(() => expect(taskPrivacy.ready).toBe(false));
  const old = taskPrivacy.taskQuery!;
  nativeQuery(view, '');
  await freshNativeTask();
  await act(async () => {
    check.resolve({ status: 'absent' });
    await check.promise;
  });
  expect(old.current()).toBe(false);
  nativeQuery(view, 'task=asset_move');
  await freshNativeTask();
  expect(screen.queryByRole('heading', { name: 'Move asset' })).toBeNull();
  expect(location.search).toBe('?task=asset_move');
});

it.each([
  'task=asset_move&task=asset_move',
  'task=quantity_move',
  'task=asset_move&returnTo=%2Finventory&returnTo=%2Fhistory',
  'task=asset_move&returnTo=https%3A%2F%2Fevil.invalid',
  'task=asset_move&unknown=changed',
])(
  'does not attest malformed or semantically different task query %s',
  async (query) => {
    const view = await admittedNativeTask();
    nativeQuery(view, query);
    await freshNativeTask();
    expect(taskPrivacy.taskQuery).toBeUndefined();
    expect(screen.queryByRole('heading', { name: 'Move asset' })).toBeNull();
    nativeQuery(view, 'task=asset_move');
    await freshNativeTask();
    expect(screen.queryByRole('heading', { name: 'Move asset' })).toBeNull();
  },
);

it('passes the opaque route slot while deferred initial verification keeps presentation and business bootstrap closed', async () => {
  const check = deferred<LogoutPrivacyGeneration>();
  runtime.read.mockReturnValueOnce(check.promise);
  render(tree());
  expect(screen.getByTestId('route-enabled')).toHaveTextContent('false');
  expect(document.documentElement.dataset.routeMotionPrivate).toBe('false');
  expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  expect(businessMounts).toBe(0);
  controls.scope.state.register();
  controls.readiness.history();
  expect(controls.scope.state.snapshot().pending).toBe(false);
  await act(async () => {
    check.resolve({ status: 'absent' });
    await check.promise;
  });
  await screen.findByRole('textbox');
  expect(controls.motion.enabled).toBe(true);
  expect(document.documentElement.dataset.routeMotionPrivate).toBe('true');
  expect(businessMounts).toBe(1);
});

it('admits a mounted opaque route fallback only under the fresh privacy grant and never treats its geometry as ready content', async () => {
  const check = deferred<LogoutPrivacyGeneration>();
  const content = deferred<void>();
  let contentReady = false;
  runtime.read.mockReturnValueOnce(check.promise);
  function DelayedPage() {
    if (!contentReady) throw content.promise;
    return (
      <ProtectedPrivacyContent>
        <RouteReady
          actorId="staff"
          routeKey="/inventory"
          contentIdentity="authorized-primary"
        >
          <h1>Private inventory</h1>
        </RouteReady>
      </ProtectedPrivacyContent>
    );
  }
  const view = render(
    <ProtectedPrivacyBoundary
      serverGeneration={{ status: 'absent' }}
      binding={binding}
    >
      <RouteMotionProvider actorId="staff">
        <Controls />
        <Suspense
          fallback={
            <RouteLoading shape="inventory" label="Loading inventory…" />
          }
        >
          <DelayedPage />
        </Suspense>
      </RouteMotionProvider>
    </ProtectedPrivacyBoundary>,
  );
  expect(
    view.container.querySelector('[data-loading-shape="inventory"]'),
  ).not.toBeNull();
  expect(view.container.querySelector('[data-route-ready]')).toBeNull();
  expect(document.documentElement.dataset.routeMotionPrivate).toBe('false');
  expect(controls.scope.state.snapshot().pending).toBe(false);
  controls.readiness.history();
  expect(controls.scope.state.snapshot().pending).toBe(false);
  await act(async () => {
    check.resolve({ status: 'absent' });
    await check.promise;
  });
  await waitFor(() =>
    expect(controls.scope.state.snapshot().pending).toBe(true),
  );
  expect(document.documentElement.dataset.routeMotionPrivate).toBe('true');
  expect(screen.queryByRole('heading')).toBeNull();
  const recovery = deferred<LogoutPrivacyGeneration>();
  runtime.read.mockReturnValueOnce(recovery.promise);
  act(() => revokePrivatePresentation());
  expect(controls.scope.state.snapshot().pending).toBe(false);
  expect(document.documentElement.dataset.routeMotionPrivate).toBe('false');
  await act(async () => {
    contentReady = true;
    content.resolve();
    await content.promise;
  });
  expect(
    screen.queryByRole('heading', { name: 'Private inventory' }),
  ).toBeNull();
  expect(controls.scope.state.snapshot().pending).toBe(false);
  expect(document.documentElement.dataset.routeMotionPrivate).toBe('false');
  await act(async () => {
    recovery.resolve({ status: 'absent' });
    await recovery.promise;
  });
  await screen.findByRole('heading', { name: 'Private inventory' });
  expect(controls.scope.state.snapshot().pending).toBe(false);
  expect(document.documentElement.dataset.routeMotionPrivate).toBe('true');
});

it('keeps a same-binding ordinary recheck visible with the original field, focus, selection and actual business busy owner', async () => {
  await admitted();
  const draft = screen.getByRole('textbox') as HTMLInputElement;
  fireEvent.change(draft, { target: { value: 'retained draft' } });
  draft.focus();
  draft.setSelectionRange(2, 7);
  fireEvent.click(
    screen.getByRole('button', { name: 'Save original request' }),
  );
  const epoch = controls.scope.state.snapshot().epoch;
  const check = deferred<LogoutPrivacyGeneration>();
  runtime.read.mockReturnValueOnce(check.promise);
  act(() => {
    window.dispatchEvent(new Event('focus'));
  });
  expect(controls.motion.enabled).toBe(true);
  expect(controls.scope.state.snapshot()).toMatchObject({
    epoch,
    pending: true,
  });
  expect(screen.getByRole('textbox')).toBe(draft);
  expect(draft).toHaveValue('retained draft');
  expect(draft).toHaveFocus();
  expect([draft.selectionStart, draft.selectionEnd]).toEqual([2, 7]);
  expect(
    screen.getByRole('button', { name: 'Save original request' }),
  ).toBeDisabled();
  await act(async () => {
    check.resolve({ status: 'absent' });
    await check.promise;
  });
  expect(businessMounts).toBe(1);
  expect(
    screen.getByRole('button', { name: 'Save original request' }),
  ).toBeDisabled();
  await act(async () => {
    work.resolve();
    await work.promise;
  });
  expect(
    screen.getByRole('button', { name: 'Save original request' }),
  ).toBeEnabled();
  expect(controls.scope.state.snapshot().pending).toBe(false);
});

it('revokes synchronously before native cancellation, rejects late callbacks, and readmits only original-binding presentation without replacing busy work', async () => {
  await admitted();
  const draft = screen.getByRole('textbox');
  fireEvent.change(draft, { target: { value: 'retain through recovery' } });
  fireEvent.click(
    screen.getByRole('button', { name: 'Save original request' }),
  );
  const captured = controls;
  const epoch = captured.scope.state.snapshot().epoch;
  const check = deferred<LogoutPrivacyGeneration>();
  runtime.read.mockReturnValueOnce(check.promise);
  const cancel = vi.fn(() => {
    expect(document.documentElement.dataset.routeMotionPrivate).toBe('false');
    expect(captured.motion.validNow()).toBe(false);
    expect(captured.scope.state.current(epoch)).toBe(false);
    expect(captured.scope.state.snapshot().pending).toBe(false);
    captured.scope.navigation?.('/inventory/quantity/cable');
    captured.motion.arm(target);
    captured.readiness.history();
    expect(captured.scope.state.snapshot().pending).toBe(false);
  });
  Object.defineProperty(document, 'activeViewTransition', {
    configurable: true,
    value: { skipTransition: cancel },
  });
  act(() => {
    revokePrivatePresentation();
  });
  expect(cancel).toHaveBeenCalled();
  expect(controls.motion.enabled).toBe(false);
  expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  // Retained owners remain in the DOM while inaccessible, without changing their business state.
  expect(draft.isConnected).toBe(true);
  // Finishing a supported transition restores its idle value, not an absent API.
  Object.defineProperty(document, 'activeViewTransition', {
    configurable: true,
    value: null,
  });
  await act(async () => {
    check.resolve({ status: 'absent' });
    await check.promise;
  });
  await screen.findByRole('textbox');
  await waitFor(() => expect(controls.motion.enabled).toBe(true));
  expect(runtime.identity).toHaveBeenCalledWith(binding);
  expect(screen.getByRole('textbox')).toBe(draft);
  expect(draft).toHaveValue('retain through recovery');
  expect(businessMounts).toBe(1);
  expect(
    screen.getByRole('button', { name: 'Save original request' }),
  ).toBeDisabled();
  expect(controls.scope.state.snapshot().pending).toBe(false);
  await act(async () => {
    work.resolve();
    await work.promise;
  });
  expect(
    screen.getByRole('button', { name: 'Save original request' }),
  ).toBeEnabled();
});

it('binding drift remains denied and a late older verification cannot admit another actor', async () => {
  const view = await admitted();
  const old = deferred<LogoutPrivacyGeneration>();
  runtime.read.mockReturnValueOnce(old.promise);
  act(() => {
    window.dispatchEvent(new Event('focus'));
  });
  runtime.identity.mockResolvedValue({ status: 'denied' });
  view.rerender(tree({ ...binding, actorId: 'another' }, 'another'));
  await screen.findByText(/original account access could not be verified/);
  await act(async () => {
    old.resolve({ status: 'absent' });
    await old.promise;
  });
  expect(controls.motion.enabled).toBe(false);
  expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  expect(runtime.identity).toHaveBeenCalledWith(binding);
  expect(businessMounts).toBe(1);
});

it('real protected content acknowledges hash Back while preserving original busy work and an overlapping refresh owner', async () => {
  await admitted();
  vi.spyOn(HTMLElement.prototype, 'getClientRects').mockReturnValue([
    { width: 30, height: 20 },
  ] as unknown as DOMRectList);
  const draft = screen.getByRole('textbox');
  fireEvent.change(draft, { target: { value: 'draft before Back' } });
  fireEvent.click(
    screen.getByRole('button', { name: 'Save original request' }),
  );
  const beforeBack = controls.scope.state.snapshot().epoch;
  act(() => {
    history.replaceState(null, '', '/inventory#inventory-row-1');
    window.dispatchEvent(new PopStateEvent('popstate'));
  });
  expect(controls.scope.state.snapshot().epoch).toBeGreaterThan(beforeBack);
  expect(controls.scope.state.snapshot().pending).toBe(false);
  expect(screen.getByRole('textbox')).toBe(draft);
  expect(draft).toHaveValue('draft before Back');
  expect(
    screen.getByRole('button', { name: 'Save original request' }),
  ).toBeDisabled();
  fireEvent.click(
    screen.getByRole('button', { name: 'Refresh current contents' }),
  );
  expect(controls.scope.state.snapshot().pending).toBe(true);
  await act(async () => {
    work.resolve();
    await work.promise;
  });
  expect(
    screen.getByRole('button', { name: 'Save original request' }),
  ).toBeEnabled();
  expect(
    screen.getByRole('button', { name: 'Refresh current contents' }),
  ).toBeDisabled();
  act(() => {
    controls.readiness.history();
  });
  expect(controls.scope.state.snapshot().pending).toBe(true);
  await act(async () => {
    refreshWork.resolve();
    await refreshWork.promise;
  });
  expect(controls.scope.state.snapshot().pending).toBe(false);
  expect(businessMounts).toBe(1);
});

it.each(['denial', 'logout', 'auth'] as const)(
  'terminal %s cannot reopen from a subsequent fresh grant',
  async (kind) => {
    const view = await admitted();
    if (kind === 'denial')
      await act(async () => {
        await observeRouteActionResult(
          Promise.resolve({ ok: false, code: 'forbidden' }),
        );
      });
    else if (kind === 'logout')
      act(() => {
        controls.retire();
      });
    else
      act(() => {
        runtime.authCallbacks.at(-1)!('SIGNED_OUT', null);
      });
    expect(document.documentElement.dataset.routeMotionPrivate).toBe('false');
    const epoch = controls.scope.state.snapshot().epoch;
    view.rerender(tree());
    act(() => {
      controls.scope.state.register();
      controls.readiness.history();
    });
    expect(controls.motion.enabled).toBe(false);
    expect(controls.scope.state.snapshot()).toMatchObject({
      epoch,
      pending: false,
    });
  },
);

it('declining the real unknown-outcome logout guard preserves presentation; failed approved exit needs fresh verification', async () => {
  await admitted();
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
  const form = screen
    .getByRole('button', { name: 'Sign out' })
    .closest('form')!;
  fireEvent.submit(form);
  expect(runtime.signOut).not.toHaveBeenCalled();
  expect(controls.motion.enabled).toBe(true);
  const logout = deferred<{ ok: false; message: string }>();
  runtime.signOut.mockImplementation(() => {
    expect(document.documentElement.dataset.routeMotionPrivate).toBe('false');
    expect(controls.scope.state.snapshot().pending).toBe(false);
    return logout.promise;
  });
  confirm.mockReturnValue(true);
  fireEvent.submit(form);
  await waitFor(() => expect(runtime.signOut).toHaveBeenCalledOnce());
  expect(controls.motion.enabled).toBe(false);
  const identity = deferred<{
    status: 'match';
    generation: { status: 'absent' };
  }>();
  runtime.identity.mockReturnValue(identity.promise);
  const priorChecks = runtime.identity.mock.calls.length;
  await act(async () =>
    logout.resolve({ ok: false, message: 'Sign-out unavailable.' }),
  );
  await waitFor(() =>
    expect(runtime.identity.mock.calls.length).toBeGreaterThan(priorChecks),
  );
  expect(controls.motion.enabled).toBe(false);
  await act(async () =>
    identity.resolve({ status: 'match', generation: { status: 'absent' } }),
  );
  await waitFor(() => expect(controls.motion.enabled).toBe(true));
});

// The injected stale context here targets the insertion-order race independently
// of the controller flows above; it does not replace real-boundary integration.
it('a sibling revocation before provider insertion cannot enable a render-time stale grant', () => {
  const stale = {
    ready: true,
    visible: true,
    generation: 'stale',
    revocationRevision: readPrivacyRevocationRevision(),
    verifiedEpoch: assignmentEpoch(),
  };
  function RevokeFirst() {
    useInsertionEffect(() => {
      revokePrivatePresentation();
    }, []);
    return null;
  }
  render(
    <>
      <RevokeFirst />
      <PrivacyReadinessContext value={stale}>
        <RouteMotionProvider actorId="staff">
          <Controls />
        </RouteMotionProvider>
      </PrivacyReadinessContext>
    </>,
  );
  expect(controls.motion.enabled).toBe(false);
  expect(document.documentElement.dataset.routeMotionPrivate).toBe('false');
});

it('retiring an older provider leaves a newly verified provider and its presentation work live', async () => {
  const old = await admitted();
  const oldControls = controls;
  const replacement = await admitted();
  const newControls = controls;
  let finish!: () => void;
  act(() => {
    finish = newControls.scope.state.register();
  });
  old.unmount();
  act(() => {
    oldControls.retire();
  });
  expect(document.documentElement.dataset.routeMotionPrivate).toBe('true');
  expect(newControls.scope.state.snapshot().pending).toBe(true);
  act(finish);
  replacement.unmount();
});
