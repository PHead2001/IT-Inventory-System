import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from '@testing-library/react';
import {
  useContext,
  useInsertionEffect,
  useLayoutEffect,
  type ReactNode,
} from 'react';
import { readFileSync } from 'node:fs';
import { ProtectedPrivacyContent } from '@/components/auth/privacy-content';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { PrivacyReadinessContext } from '@/components/auth/privacy-readiness';
import {
  assignmentEpoch,
  readPrivacyRevocationRevision,
  revokePrivatePresentation,
} from '@/features/scan/assign-batch';
import {
  RouteMotionProvider,
  useInvalidateRouteMotion,
  useRouteMotion,
  useRouteCommandBoundary,
} from './route-motion';
import { RouteReady } from './route-ready';
import { RoutePendingContext, useRouteTask } from './route-pending';
import {
  ThemePreferenceProvider,
  VerifiedThemeScope,
  useThemePreference,
} from './theme-preference';
import {
  privateSnapshotEligible,
  ownThemeSnapshot,
} from './native-transition-owner';
import { freshPresentationGrant } from './presentation-privacy';
import { observeRouteActionResult } from './route-action-result';
import * as snapshotOwner from './native-transition-owner';
import { AuxiliaryRouteCaptureContext } from './auxiliary-route-context';
import type { createAuxiliaryRouteCapture } from './auxiliary-route-capture';
import { cancelRouteSnapshots } from './route-motion-state';

vi.mock('next/navigation', () => ({
  usePathname: () => '/inventory',
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({}),
}));
vi.mock('@/lib/supabase/browser', () => ({
  createSupabaseBrowserClient: () => ({
    auth: {
      onAuthStateChange: () => ({
        data: { subscription: { unsubscribe: () => {} } },
      }),
    },
  }),
}));
const fresh = () => ({
  ready: true,
  visible: true,
  generation: 'fixture',
  revocationRevision: readPrivacyRevocationRevision(),
  verifiedEpoch: assignmentEpoch(),
});
type Grant = React.ContextType<typeof PrivacyReadinessContext>;
let controls: {
  motion: ReturnType<typeof useRouteMotion>;
  scope: NonNullable<React.ContextType<typeof RoutePendingContext>>;
  retire: () => void;
  theme: ReturnType<typeof useThemePreference>;
  auxiliary: ReturnType<typeof createAuxiliaryRouteCapture>;
  command: ReturnType<typeof useRouteCommandBoundary>;
};
let finish: () => void;
let work: Promise<void>;
function Probe() {
  const motion = useRouteMotion();
  const scope = useContext(RoutePendingContext)!;
  const retire = useInvalidateRouteMotion();
  const [busy, run] = useRouteTask();
  const theme = useThemePreference();
  const auxiliary = useContext(AuxiliaryRouteCaptureContext)!;
  const command = useRouteCommandBoundary('staff', 'backend');
  useLayoutEffect(() => {
    controls = { motion, scope, retire, theme, auxiliary, command };
  });
  return (
    <>
      <input aria-label="Draft" defaultValue="original" />
      <button disabled={busy} onClick={() => run(() => work)}>
        Unknown outcome
      </button>
      <output data-testid="scope">{theme.scope}</output>
      <output data-testid="motion">{String(motion.enabled)}</output>
    </>
  );
}
function view(
  grant: Grant,
  actor = 'staff',
  children: ReactNode = <Probe />,
  rootScope = 'test:anonymous',
) {
  return (
    <ThemePreferenceProvider scope={rootScope}>
      <PrivacyReadinessContext value={grant}>
        <RouteMotionProvider actorId={actor}>
          <VerifiedThemeScope scope={`test:${actor}`} />
          {children}
        </RouteMotionProvider>
      </PrivacyReadinessContext>
    </ThemePreferenceProvider>
  );
}
beforeEach(() => {
  localStorage.clear();
  work = new Promise<void>((resolve) => {
    finish = resolve;
  });
  vi.stubGlobal('CSS', { supports: () => true });
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
  document.documentElement.dataset.motion = 'full';
  window.inventoryTheme = {
    parse: () => 'dark',
    key: (scope) => scope,
    read: () => 'dark',
    resolve: (preference) => (preference === 'light' ? 'light' : 'dark'),
    apply: (preference) => (preference === 'light' ? 'light' : 'dark'),
  };
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  delete window.inventoryTheme;
  delete (document as Partial<Document>).startViewTransition;
  delete (document as unknown as { activeViewTransition?: unknown })
    .activeViewTransition;
});

it.each([
  'navigation',
  'revocation',
  'terminal denial',
  'action-result denial',
  'pending',
  'global cancellation',
] as const)(
  'withdraws an actual authored capture before theme cancellation on %s',
  async (cause) => {
    const deferred = () => {
      let resolve!: () => void;
      const promise = new Promise<void>((done) => {
        resolve = done;
      });
      return { promise, resolve };
    };
    const ready = deferred(),
      updated = deferred(),
      finished = deferred();
    const handle = {
      ready: ready.promise,
      updateCallbackDone: updated.promise,
      finished: finished.promise,
      skipTransition: vi.fn(),
    };
    const nativeStart = vi.fn(() => handle);
    Object.defineProperty(document, 'startViewTransition', {
      configurable: true,
      writable: true,
      value: nativeStart,
    });
    render(view(fresh()));
    const root = screen.getByRole('textbox').parentElement!;
    const region = document.createElement('section');
    root.append(region);
    region.getBoundingClientRect = () =>
      ({
        x: 0,
        y: 0,
        top: 0,
        left: 0,
        right: 100,
        bottom: 40,
        width: 100,
        height: 40,
      }) as DOMRect;
    const epoch = controls.scope.state.snapshot().epoch;
    const current = () =>
      controls.motion.validNow() &&
      controls.scope.state.current(epoch) &&
      !controls.scope.state.snapshot().pending;
    const unregister = controls.auxiliary.register({
      root: region,
      routeKey: '/inventory',
      region: 'body',
      source: Symbol(),
      current,
    });
    controls.auxiliary.arm({
      token: {},
      base: 'theme-joined-body',
      sourceKey: '/inventory',
      destinationKey: '/history',
      sourceRoot: root,
      handoff: () => undefined,
      current,
      admitted: current,
      participate: () => true,
    });
    let releasePending: (() => void) | undefined;
    try {
      document.startViewTransition();
      expect(nativeStart).toHaveBeenCalledOnce();
      expect(region.style.viewTransitionName).toBe('theme-joined-body');
      const cancel = vi.fn(() => {
        expect(region.style.viewTransitionName).toBe('');
        expect(region.style.getPropertyValue('view-transition-class')).toBe('');
        if (
          cause === 'revocation' ||
          cause === 'terminal denial' ||
          cause === 'action-result denial'
        )
          expect(privateSnapshotEligible()).toBe(false);
      });
      ownThemeSnapshot(cancel);
      await act(async () => {
        if (cause === 'navigation') controls.scope.navigation!('/history');
        else if (cause === 'revocation') revokePrivatePresentation();
        else if (cause === 'terminal denial') controls.retire();
        else if (cause === 'action-result denial')
          await observeRouteActionResult(
            Promise.resolve({ ok: false, code: 'forbidden' }),
          );
        else if (cause === 'global cancellation') cancelRouteSnapshots();
        else releasePending = controls.scope.state.register();
      });
      expect(cancel).toHaveBeenCalledOnce();
    } finally {
      controls.auxiliary.withdraw();
      unregister();
      await act(async () => {
        releasePending?.();
        updated.resolve();
        ready.resolve();
        finished.resolve();
      });
      region.remove();
    }
  },
);

it('theme choices retain the exact accepted command primary and draft without minting navigation or reviving a retired ticket', () => {
  vi.spyOn(HTMLElement.prototype, 'getClientRects').mockReturnValue([
    {},
  ] as unknown as DOMRectList);
  history.replaceState({}, '', '/inventory');
  const children = (
    <RouteReady
      actorId="staff"
      routeKey="/inventory"
      contentIdentity="theme-command-primary"
      conventionalPrimary
    >
      <Probe />
    </RouteReady>
  );
  const rendered = render(view(fresh(), 'staff', children));
  expect(controls.command.authorized()).toBe(true);
  const draft = screen.getByRole('textbox');
  fireEvent.change(draft, { target: { value: 'theme-retained draft' } });
  const ticket = controls.command.issue('/inventory');
  act(() => controls.scope.navigation!('/inventory'));
  expect(ticket?.current()).toBe(true);
  const capture = controls.command.capture();
  const epoch = controls.scope.state.snapshot().epoch;
  act(() => controls.theme.choose('light'));
  expect(controls.command.authorized()).toBe(true);
  expect(capture()).toBe(true);
  expect(ticket?.current()).toBe(true);
  expect(controls.scope.state.snapshot().epoch).toBe(epoch);
  expect(controls.scope.state.snapshot().pending).toBe(false);
  expect(location.pathname + location.search).toBe('/inventory');
  expect(screen.getByRole('textbox')).toBe(draft);
  expect(draft).toHaveValue('theme-retained draft');
  act(() => revokePrivatePresentation());
  expect(capture()).toBe(false);
  expect(ticket?.current()).toBe(false);
  rendered.rerender(view(fresh(), 'staff', children));
  expect(ticket?.current()).toBe(false);
  expect(screen.getByRole('textbox')).toBe(draft);
});

it('synchronously withdraws snapshots and leases, then recovers a fresh epoch without losing drafts or unknown work', async () => {
  const oldGrant = fresh();
  const rendered = render(view(oldGrant));
  expect(controls.motion.validNow()).toBe(true);
  const draft = screen.getByRole('textbox');
  fireEvent.change(draft, { target: { value: 'retained draft' } });
  fireEvent.click(screen.getByRole('button'));
  expect(screen.getByRole('button')).toBeDisabled();
  const old = controls;
  const oldEpoch = old.scope.state.snapshot().epoch;
  const cancelNative = vi.fn(() => {
    expect(privateSnapshotEligible()).toBe(false);
  });
  const nativeOwner = ownThemeSnapshot(cancelNative);
  const skip = vi.fn();
  Object.defineProperty(document, 'activeViewTransition', {
    configurable: true,
    value: { skipTransition: skip },
  });
  act(() => {
    revokePrivatePresentation();
    expect(document.documentElement.dataset.routeMotionPrivate).toBe('false');
    expect(privateSnapshotEligible()).toBe(false);
    expect(old.motion.validNow()).toBe(false);
    expect(old.scope.state.current(oldEpoch)).toBe(false);
    expect(cancelNative).toHaveBeenCalledOnce();
    expect(skip).toHaveBeenCalled();
    expect(nativeOwner.current()).toBe(false);
  });
  expect(screen.getByTestId('scope')).toHaveTextContent('test:anonymous');
  rendered.rerender(view(oldGrant));
  expect(controls.motion.enabled).toBe(false);
  rendered.rerender(view(fresh()));
  expect(controls.motion.validNow()).toBe(true);
  expect(privateSnapshotEligible()).toBe(true);
  expect(controls.scope).toBe(old.scope);
  expect(controls.scope.owners).toBe(old.scope.owners);
  expect(screen.getByRole('textbox')).toBe(draft);
  expect(draft).toHaveValue('retained draft');
  expect(screen.getByRole('button')).toBeDisabled();
  expect(old.motion.current()).toBe(false);
  const currentEpoch = controls.scope.state.snapshot().epoch;
  old.scope.state.register(oldEpoch);
  expect(controls.scope.state.snapshot().epoch).toBe(currentEpoch);
  expect(controls.scope.state.snapshot().pending).toBe(false);
  await act(async () => finish());
  expect(screen.getByRole('button')).not.toBeDisabled();
  delete (document as unknown as { activeViewTransition?: unknown })
    .activeViewTransition;
});

it('retains route paint during ordinary rechecking while rejecting new theme snapshots and hidden/stale/different-owner recovery', () => {
  const grant = fresh();
  const rendered = render(view(grant));
  rendered.rerender(view({ ...grant, ready: false, verifiedEpoch: undefined }));
  expect(controls.motion.validNow()).toBe(true);
  expect(privateSnapshotEligible()).toBe(false);
  expect(controls.theme.scope).toBe('test:staff');
  rendered.rerender(view({ ...grant, visible: false }));
  expect(privateSnapshotEligible()).toBe(false);
  rendered.rerender(
    view({ ...grant, revocationRevision: grant.revocationRevision - 1 }),
  );
  expect(controls.motion.enabled).toBe(false);
  rendered.rerender(view(fresh(), 'other'));
  expect(privateSnapshotEligible()).toBe(false);
});

it('never restores terminally retired motion after fresh same-owner verification', () => {
  const rendered = render(view(fresh()));
  act(() => controls.retire());
  act(() => revokePrivatePresentation());
  rendered.rerender(view(fresh()));
  expect(controls.motion.enabled).toBe(false);
  expect(privateSnapshotEligible()).toBe(false);
});

it.each(['terminal adapter', 'action-result denial'] as const)(
  'withdraws the current route grant before native theme cancellation through %s',
  async (path) => {
    render(view(fresh()));
    const cancelled = vi.fn(() => ({
      eligible: privateSnapshotEligible(),
      document: document.documentElement.dataset.routeMotionPrivate,
    }));
    ownThemeSnapshot(cancelled);
    await act(async () => {
      if (path === 'terminal adapter') controls.retire();
      else {
        const result = { ok: false, code: 'forbidden' };
        expect(await observeRouteActionResult(Promise.resolve(result))).toBe(
          result,
        );
      }
    });
    expect(cancelled).toHaveBeenCalledOnce();
    expect(cancelled.mock.results[0].value).toEqual({
      eligible: false,
      document: 'false',
    });
    expect(controls.theme.scope).toBe('test:anonymous');
    expect(controls.motion.validNow()).toBe(false);
  },
);

it.each(['before native ready', 'after native ready'] as const)(
  'retires the actual theme lease and store callbacks on parent unmount %s without manufacturing privacy revocation',
  async (phase) => {
    const deferred = () => {
      let resolve!: () => void;
      const promise = new Promise<void>((done) => {
        resolve = done;
      });
      return { promise, resolve };
    };
    const ready = deferred(),
      updated = deferred(),
      finished = deferred();
    let update!: () => void;
    const frames = new Map<number, FrameRequestCallback>();
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      frames.set(1, callback);
      return 1;
    });
    vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
    const listeners = new Set<() => void>();
    vi.stubGlobal('matchMedia', () => ({
      matches: false,
      addEventListener: (_: string, callback: () => void) =>
        listeners.add(callback),
      removeEventListener: (_: string, callback: () => void) =>
        listeners.delete(callback),
    }));
    const disconnect = vi.fn();
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        disconnect = disconnect;
      },
    );
    const removed = vi.spyOn(window, 'removeEventListener');
    const added = vi.spyOn(window, 'addEventListener');
    const animate = vi.fn((_frames, options) => ({
      effect: { pseudoElement: options.pseudoElement },
      cancel: vi.fn(),
    }));
    Object.defineProperty(document.documentElement, 'animate', {
      configurable: true,
      value: animate,
    });
    const actualOwn = snapshotOwner.ownThemeSnapshot;
    const cancelledWithCurrent: boolean[] = [];
    vi.spyOn(snapshotOwner, 'ownThemeSnapshot').mockImplementation((cancel) => {
      const lease = actualOwn(() => {
        cancelledWithCurrent.push(lease.current());
        cancel();
      });
      return lease;
    });
    const skip = vi.fn(() => update());
    Object.defineProperty(document, 'startViewTransition', {
      configurable: true,
      value: vi.fn((callback: () => void) => {
        update = callback;
        return {
          ready: ready.promise,
          updateCallbackDone: updated.promise,
          finished: finished.promise,
          skipTransition: skip,
        };
      }),
    });
    const apply = vi.spyOn(window.inventoryTheme!, 'apply');
    const revision = readPrivacyRevocationRevision(),
      epoch = assignmentEpoch();
    const nativeStart = document.startViewTransition;
    const rendered = render(view(fresh()));
    const oldChoose = controls.theme.choose;
    act(() => oldChoose('light'));
    expect(nativeStart).toHaveBeenCalledOnce();
    expect(document.querySelector('[data-theme-region]')).not.toBeNull();
    expect(frames.size).toBe(1);
    const staleListeners = [...listeners];
    const storageListener = added.mock.calls.find(
      ([event]) => event === 'storage',
    )![1];
    if (phase === 'after native ready') {
      await act(async () => {
        update();
        ready.resolve();
        updated.resolve();
      });
      expect(animate.mock.calls.length).toBeGreaterThan(0);
    }
    const callsBeforeUnmount = apply.mock.calls.length;
    rendered.unmount();
    expect(cancelledWithCurrent).toEqual([false]);
    expect(skip).toHaveBeenCalledOnce();
    expect(apply).toHaveBeenCalledTimes(callsBeforeUnmount);
    expect(privateSnapshotEligible()).toBe(false);
    expect(document.documentElement.dataset.routeMotionPrivate).toBe('false');
    expect(readPrivacyRevocationRevision()).toBe(revision);
    expect(assignmentEpoch()).toBe(epoch);
    expect(
      document.querySelector(
        '[data-theme-region],.experience-theme-background',
      ),
    ).toBeNull();
    expect(document.documentElement.dataset.themeTransition).toBeUndefined();
    expect(frames.size).toBe(0);
    expect(listeners.size).toBe(0);
    expect(disconnect).toHaveBeenCalledOnce();
    expect(removed.mock.calls.some(([event]) => event === 'storage')).toBe(
      true,
    );
    await act(async () => {
      oldChoose('light');
      staleListeners.forEach((callback) => callback());
      if (typeof storageListener === 'function')
        storageListener(
          new StorageEvent('storage', {
            key: 'test:staff',
            newValue: '{"version":1,"preference":"light"}',
          }),
        );
      update();
      ready.resolve();
      updated.resolve();
      finished.resolve();
    });
    expect(apply).toHaveBeenCalledTimes(callsBeforeUnmount);
    if (phase === 'before native ready') expect(animate).not.toHaveBeenCalled();
    else
      animate.mock.results.forEach((result) =>
        expect(result.value.cancel).toHaveBeenCalledOnce(),
      );
    expect(frames.size).toBe(0);
  },
);

it('starts unverified without private snapshots and stays ineligible after private unmount', () => {
  const rendered = render(view({ ...fresh(), ready: false, visible: false }));
  expect(privateSnapshotEligible()).toBe(false);
  expect(screen.getByTestId('scope')).toHaveTextContent('test:anonymous');
  expect(
    freshPresentationGrant({
      ...fresh(),
      verifiedEpoch: assignmentEpoch() - 1,
    }),
  ).toBe(false);
  rendered.unmount();
  expect(privateSnapshotEligible()).toBe(false);
});

it('rejects old native promise callbacks after revocation and fresh recovery while permitting a new theme snapshot', async () => {
  const deferred = () => {
    let resolve!: () => void;
    const promise = new Promise<void>((done) => {
      resolve = done;
    });
    return { promise, resolve };
  };
  const jobs: Array<{
    update: () => void;
    ready: ReturnType<typeof deferred>;
    updated: ReturnType<typeof deferred>;
    finished: ReturnType<typeof deferred>;
    skip: ReturnType<typeof vi.fn>;
  }> = [];
  vi.stubGlobal(
    'requestAnimationFrame',
    vi.fn(() => 1),
  );
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  Object.defineProperty(document.documentElement, 'animate', {
    configurable: true,
    value: vi.fn((_frames, options) => ({
      effect: { pseudoElement: options.pseudoElement },
      cancel: vi.fn(),
    })),
  });
  Object.defineProperty(document, 'startViewTransition', {
    configurable: true,
    value: vi.fn((update: () => void) => {
      const job = {
        update,
        ready: deferred(),
        updated: deferred(),
        finished: deferred(),
        skip: vi.fn(),
      };
      jobs.push(job);
      return {
        ready: job.ready.promise,
        updateCallbackDone: job.updated.promise,
        finished: job.finished.promise,
        skipTransition: job.skip,
      };
    }),
  });
  const rendered = render(view(fresh()));
  act(() => controls.theme.choose('light'));
  expect(jobs).toHaveLength(1);
  act(() => {
    revokePrivatePresentation();
    expect(jobs[0].skip).toHaveBeenCalledOnce();
  });
  act(() => controls.theme.choose('light', undefined, true));
  expect(jobs).toHaveLength(1); // suspended changes apply directly, never snapshot.
  act(() => {
    revokePrivatePresentation(); // Already anonymous: still retire its generation.
    expect(controls.theme.scope).toBe('test:anonymous');
  });
  expect(controls.theme.theme).toBe('dark');
  rendered.rerender(view(fresh()));
  act(() => controls.theme.choose('light'));
  expect(jobs).toHaveLength(2);
  await act(async () => {
    jobs[0].update();
    jobs[0].ready.resolve();
    jobs[0].updated.resolve();
    jobs[0].finished.resolve();
  });
  expect(jobs[1].skip).not.toHaveBeenCalled();
  expect(controls.theme.theme).toBe('dark');
  await act(async () => {
    jobs[1].update();
    jobs[1].ready.resolve();
    jobs[1].updated.resolve();
    jobs[1].finished.resolve();
  });
  expect(controls.theme.theme).toBe('light');
});

it('retiring an older mounted provider preserves the replacement provider snapshot and eligibility', () => {
  const grant = fresh();
  const siblings = (old: boolean) => (
    <ThemePreferenceProvider scope="test:anonymous">
      {old && (
        <PrivacyReadinessContext key="old" value={grant}>
          <RouteMotionProvider actorId="old">
            <Probe />
          </RouteMotionProvider>
        </PrivacyReadinessContext>
      )}
      <PrivacyReadinessContext key="new" value={grant}>
        <RouteMotionProvider actorId="new">
          <Probe />
        </RouteMotionProvider>
      </PrivacyReadinessContext>
    </ThemePreferenceProvider>
  );
  const rendered = render(siblings(true));
  const replacement = controls;
  expect(replacement.motion.validNow()).toBe(true);
  const cancel = vi.fn();
  const snapshot = ownThemeSnapshot(cancel);
  rendered.rerender(siblings(false));
  expect(cancel).not.toHaveBeenCalled();
  expect(snapshot.current()).toBe(true);
  expect(privateSnapshotEligible()).toBe(true);
  expect(controls.scope).toBe(replacement.scope);
  expect(controls.motion.validNow()).toBe(true);
});

function bootstrap(scope: string, preference: 'light' | 'system') {
  document.documentElement.dataset.themeScope = scope;
  localStorage.setItem(
    `it-inventory:theme:v1:${scope}`,
    JSON.stringify({ version: 1, preference }),
  );
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query === '(prefers-color-scheme: light)',
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
  window.eval(readFileSync('public/theme-bootstrap.v1.js', 'utf8'));
}
it.each(['light', 'system'] as const)(
  'retains initial %s Light prepaint while delayed verification keeps private content and native snapshots closed',
  (preference) => {
    bootstrap('test:staff', preference);
    const waiting = { ...fresh(), ready: false, visible: false };
    const children = (
      <>
        <Probe />
        <ProtectedPrivacyContent>
          <p>Private inventory</p>
        </ProtectedPrivacyContent>
      </>
    );
    const nativeStart = document.startViewTransition;
    const rendered = render(view(waiting, 'staff', children, 'test:staff'));
    expect(document.documentElement.dataset.theme).toBe('light');
    expect(controls.theme.scope).toBe('test:staff');
    expect(controls.theme.preference).toBe(preference);
    expect(controls.motion.validNow()).toBe(false);
    expect(privateSnapshotEligible()).toBe(false);
    act(() => {
      controls.theme.choose('dark', undefined, true);
      controls.theme.choose(preference, undefined, true);
    });
    expect(nativeStart).not.toHaveBeenCalled();
    expect(controls.scope.state.snapshot().pending).toBe(false);
    const registration = controls.scope.state.register();
    expect(controls.scope.state.snapshot().pending).toBe(false);
    registration();
    expect(screen.queryByText('Private inventory')).not.toBeInTheDocument();
    rendered.rerender(view(fresh(), 'staff', children, 'test:staff'));
    expect(document.documentElement.dataset.theme).toBe('light');
    expect(screen.getByText('Private inventory')).toBeVisible();
    expect(privateSnapshotEligible()).toBe(true);
  },
);
it('rejects a revocation between render and subscription before the first grant', () => {
  bootstrap('test:staff', 'light');
  const stale = { ...fresh(), ready: false, visible: false };
  function Gap() {
    useInsertionEffect(() => {
      revokePrivatePresentation();
    }, []);
    return null;
  }
  render(
    <ThemePreferenceProvider scope="test:staff">
      <Gap />
      <PrivacyReadinessContext value={stale}>
        <RouteMotionProvider actorId="staff">
          <Probe />
        </RouteMotionProvider>
      </PrivacyReadinessContext>
    </ThemePreferenceProvider>,
  );
  expect(controls.theme.scope).toBe('test:anonymous');
  expect(document.documentElement.dataset.theme).toBe('dark');
  expect(privateSnapshotEligible()).toBe(false);
});
it.each([false, true])(
  'actor drift with initial grant %s withdraws the original bootstrap scope and cannot reopen a different owner',
  (accepted) => {
    bootstrap('test:staff', 'light');
    const grant = { ...fresh(), ready: accepted, visible: accepted };
    const rendered = render(view(grant, 'staff', <Probe />, 'test:staff'));
    rendered.rerender(view(fresh(), 'other', <Probe />, 'test:staff'));
    expect(controls.theme.scope).toBe('test:anonymous');
    expect(privateSnapshotEligible()).toBe(false);
    rendered.rerender(
      view(
        { ...fresh(), ready: false, visible: false },
        'staff',
        <Probe />,
        'test:staff',
      ),
    );
    expect(controls.theme.scope).toBe('test:anonymous');
    expect(document.documentElement.dataset.theme).toBe('dark');
  },
);
it.each([false, true])(
  'backend prop drift with initial grant %s resets the destination anonymous scope and cannot adopt an unverified private prop',
  (accepted) => {
    bootstrap('test:staff', 'light');
    const grant = { ...fresh(), ready: accepted, visible: accepted };
    const rendered = render(view(grant, 'staff', <Probe />, 'test:staff'));
    localStorage.setItem(
      'it-inventory:theme:v1:other:staff',
      '{"version":1,"preference":"light"}',
    );
    rendered.rerender(
      view(
        { ...grant, ready: false, visible: false },
        'staff',
        <Probe />,
        'other:staff',
      ),
    );
    expect(controls.theme.scope).toBe('other:anonymous');
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(privateSnapshotEligible()).toBe(false);
    rendered.rerender(
      view(
        { ...fresh(), ready: false, visible: false },
        'staff',
        <Probe />,
        'other:staff',
      ),
    );
    expect(controls.theme.scope).toBe('other:anonymous');
    rendered.rerender(view(fresh(), 'staff', <Probe />, 'other:staff'));
    // Only the server member boundary's independently verified scope is adopted.
    expect(controls.theme.scope).toBe('test:staff');
  },
);

it.each(['test:staff', 'other:staff'])(
  'revocation while never granted in %s never regains its bootstrap exception',
  (rootScope) => {
    bootstrap(rootScope, 'light');
    const waiting = { ...fresh(), ready: false, visible: false };
    const rendered = render(view(waiting, 'staff', <Probe />, rootScope));
    act(() => revokePrivatePresentation());
    rendered.rerender(
      view(
        { ...fresh(), ready: false, visible: false },
        'staff',
        <Probe />,
        rootScope,
      ),
    );
    expect(controls.theme.scope).toBe(
      rootScope.replace(/:[^:]+$/, ':anonymous'),
    );
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(privateSnapshotEligible()).toBe(false);
    act(() => controls.theme.choose('light', undefined, true));
    act(() => revokePrivatePresentation());
    expect(document.documentElement.dataset.theme).toBe('dark');
  },
);
it('root actor prop drift alone cannot replace anonymous reset, while a later strictly fresh member scope can', () => {
  bootstrap('test:staff', 'light');
  const content = (rootScope: string, grant: Grant, verifiedScope: string) => (
    <ThemePreferenceProvider scope={rootScope}>
      <PrivacyReadinessContext value={grant}>
        <RouteMotionProvider actorId="staff">
          <VerifiedThemeScope scope={verifiedScope} />
          <Probe />
        </RouteMotionProvider>
      </PrivacyReadinessContext>
    </ThemePreferenceProvider>
  );
  const grant = fresh();
  const rendered = render(content('test:staff', grant, 'test:staff'));
  localStorage.setItem(
    'it-inventory:theme:v1:test:other',
    '{"version":1,"preference":"light"}',
  );
  // Even a ready grant from before this prop drift is invalidated synchronously.
  rendered.rerender(content('test:other', grant, 'test:other'));
  expect(controls.theme.scope).toBe('test:anonymous');
  expect(privateSnapshotEligible()).toBe(false);
  rendered.rerender(content('test:other', grant, 'test:other'));
  expect(controls.theme.scope).toBe('test:anonymous');
  rendered.rerender(content('test:other', fresh(), 'test:other'));
  expect(controls.theme.scope).toBe('test:other');
  expect(controls.theme.theme).toBe('light');
});
