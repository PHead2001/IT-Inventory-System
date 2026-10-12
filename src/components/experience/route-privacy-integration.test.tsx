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
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ProtectedPrivacyBoundary } from '@/components/auth/auth-privacy';
import { ProtectedPrivacyContent } from '@/components/auth/privacy-content';
import { PrivacyReadinessContext } from '@/components/auth/privacy-readiness';
import {
  assignmentEpoch,
  readPrivacyRevocationRevision,
  revokePrivatePresentation,
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
  clearAllDesignerRecovery: vi.fn(),
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
  vi.stubGlobal('matchMedia', () => ({
    matches: false,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
  Object.defineProperty(document, 'startViewTransition', {
    configurable: true,
    value: vi.fn(),
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
  Reflect.deleteProperty(document, 'activeViewTransition');
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

it('declining the real unknown-outcome logout guard preserves presentation; approved exit invalidates before action dispatch', async () => {
  await admitted();
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
  const form = screen
    .getByRole('button', { name: 'Sign out' })
    .closest('form')!;
  fireEvent.submit(form);
  expect(runtime.signOut).not.toHaveBeenCalled();
  expect(controls.motion.enabled).toBe(true);
  runtime.signOut.mockImplementation(async () => {
    expect(document.documentElement.dataset.routeMotionPrivate).toBe('false');
    expect(controls.scope.state.snapshot().pending).toBe(false);
    return { ok: false, message: 'Sign-out unavailable.' };
  });
  confirm.mockReturnValue(true);
  fireEvent.submit(form);
  await waitFor(() => expect(runtime.signOut).toHaveBeenCalledOnce());
  expect(controls.motion.enabled).toBe(false);
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
