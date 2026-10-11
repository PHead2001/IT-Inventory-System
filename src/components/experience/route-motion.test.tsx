import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  useContext,
  useLayoutEffect,
  type ReactNode,
  type MouseEvent,
} from 'react';
import {
  RouteMotionProvider,
  useRouteMotion,
  useInvalidateRouteMotion,
} from './route-motion';
import { observeRouteActionResult } from './route-action-result';
import {
  RoutePendingTerminal,
  RoutePendingContext,
  useRouteTask,
} from './route-pending';
import RouteLink from './route-link';
import { QueueLogoutForm } from '@/features/labels/queue-logout-form';
import { PrivacyReadinessContext } from '@/components/auth/privacy-readiness';
import {
  assignmentEpoch,
  readPrivacyRevocationRevision,
} from '@/features/scan/assign-batch';
import { SettingsPanel } from '@/features/configuration/settings-panel';
import {
  InventoryBackLink,
  InventoryRecordLink,
  RecordTitle,
} from './record-transition';
import {
  cancelRouteSnapshots,
  createRouteMotionState,
  titleTarget,
  inventoryHolding,
  recordHoldingKey,
  type HoldingIdentity,
} from './route-motion-state';

const runtime = vi.hoisted(() => ({
  pathname: '/inventory',
  query: '',
  callbacks: [] as Array<
    (event: string, session: { user: { id: string } } | null) => void
  >,
  boundaries: [] as Array<{
    name?: string;
    share?: string;
    onShare?: (instance: { name: string }) => void;
  }>,
  unsubscribe: vi.fn(),
  logout: vi.fn(),
  submitConfiguration: vi.fn(),
  refresh: vi.fn(),
  actionPrivacy: '',
}));
vi.mock('@/lib/auth/actions', () => ({
  signOutSession: () => {
    runtime.actionPrivacy =
      document.documentElement.dataset.routeMotionPrivate ?? '';
    runtime.logout();
    return Promise.resolve({ ok: false, message: 'Sign-out unavailable.' });
  },
}));
vi.mock('@/features/configuration/actions', () => ({
  submitConfiguration: runtime.submitConfiguration,
  reviewCategoryRemoval: vi.fn(),
}));
// Intent/callback lifetime only; captured geometry has its own independent suite.
vi.mock('./shared-title-motion', () => ({ sharedTitleMotion: vi.fn() }));
vi.mock('@/features/labels/queue-model', () => ({
  clearLabelQueueSession: vi.fn(),
}));
vi.mock('@/features/metadata/designer-recovery', () => ({
  hasUnresolvedDesignerRecovery: () => true,
  clearAllDesignerRecovery: vi.fn(),
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: runtime.refresh }),
  usePathname: () => runtime.pathname,
  useSearchParams: () => new URLSearchParams(runtime.query),
}));
vi.mock('@/lib/supabase/browser', () => ({
  createSupabaseBrowserClient: () => ({
    auth: {
      onAuthStateChange: (callback: (typeof runtime.callbacks)[number]) => {
        runtime.callbacks.push(callback);
        return { data: { subscription: { unsubscribe: runtime.unsubscribe } } };
      },
    },
  }),
}));
vi.mock('next/link', () => ({
  useLinkStatus: () => ({ pending: false }),
  default: ({
    onNavigate,
    href,
    children,
    ...props
  }: {
    onNavigate?: (event: { preventDefault: () => void }) => void;
    href: string;
    children: ReactNode;
  }) => (
    <a
      {...props}
      href={href}
      onClick={(event: MouseEvent) => {
        if (
          !event.defaultPrevented &&
          !event.ctrlKey &&
          !event.metaKey &&
          event.button === 0
        ) {
          event.preventDefault();
          onNavigate?.({ preventDefault: () => event.preventDefault() });
        }
      }}
    >
      {children}
    </a>
  ),
}));
vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  return {
    ...actual,
    ViewTransition: (props: import('react').ViewTransitionProps) => {
      runtime.boundaries.push(props as (typeof runtime.boundaries)[number]);
      return actual.isValidElement(props.children)
        ? actual.cloneElement(
            props.children as import('react').ReactElement<
              Record<string, unknown>
            >,
            {
              'data-test-transition-name': props.name,
              'data-test-transition-share': props.share,
            },
          )
        : props.children;
    },
  };
});
const record = { kind: 'quantity' as const, id: 'record-id' };
const firstHolding: HoldingIdentity = {
  domain: 'storage',
  id: '00000000-0000-4000-8000-000000000001',
};
const initiatingHolding: HoldingIdentity = {
  domain: 'storage',
  id: '00000000-0000-4000-8000-000000000002',
};
const replacementHolding: HoldingIdentity = {
  domain: 'storage',
  id: '00000000-0000-4000-8000-000000000003',
};
const returnTo = '/inventory#inventory-row-2';
const detailPath = '/inventory/quantity/record-id';
function List({
  wrongRecord = false,
  holdings = [firstHolding, initiatingHolding],
  pairable = true,
  anchored = true,
}: {
  wrongRecord?: boolean;
  holdings?: HoldingIdentity[];
  pairable?: boolean;
  anchored?: boolean;
}) {
  return (
    <ul>
      {holdings.map((holding, index) => {
        const ordinal = index + 1;
        return (
          <li key={ordinal} id={`inventory-row-${ordinal}`}>
            <InventoryRecordLink
              record={wrongRecord ? { ...record, id: 'different' } : record}
              holding={holding}
              pairable={pairable}
              href={detailPath}
              returnTo={
                anchored ? `/inventory#inventory-row-${ordinal}` : undefined
              }
            >
              Cable row {ordinal}
            </InventoryRecordLink>
          </li>
        );
      })}
    </ul>
  );
}
function Detail() {
  return (
    <>
      <RecordTitle record={record}>Cable title</RecordTitle>
      <InventoryBackLink record={record} href={returnTo}>
        Back to results
      </InventoryBackLink>
    </>
  );
}
function Probe() {
  const { enabled } = useRouteMotion();
  return <output>{enabled ? 'enabled' : 'instant'}</output>;
}
type CapturedControls = { logout: () => void; terminal: () => void };
function CaptureControls({
  capture,
}: {
  capture: (controls: CapturedControls) => void;
}) {
  const logout = useInvalidateRouteMotion();
  const scope = useContext(RoutePendingContext)!;
  useLayoutEffect(() => {
    capture({ logout, terminal: scope.terminal });
  }, [capture, logout, scope]);
  return null;
}
function CancelCaptureLink() {
  const { arm } = useRouteMotion();
  return (
    <RouteLink
      href={detailPath}
      onNavigate={(event) => {
        arm(titleTarget(record, returnTo, initiatingHolding)!);
        event.preventDefault();
      }}
    >
      Canceled capture
    </RouteLink>
  );
}
function HeldTask({ work }: { work: Promise<void> }) {
  const [pending, run] = useRouteTask();
  return (
    <button disabled={pending} onClick={() => run(() => work)}>
      Start independent work
    </button>
  );
}
const view = (children: ReactNode, actorId = 'staff') => (
  <PrivacyReadinessContext
    value={{
      ready: true,
      visible: true,
      generation: 'route-fixture',
      revocationRevision: readPrivacyRevocationRevision(),
      verifiedEpoch: assignmentEpoch(),
    }}
  >
    <RouteMotionProvider key={actorId} actorId={actorId}>
      <Probe />
      {children}
    </RouteMotionProvider>
  </PrivacyReadinessContext>
);

beforeEach(() => {
  runtime.pathname = '/inventory';
  runtime.query = '';
  runtime.callbacks = [];
  runtime.boundaries = [];
  runtime.submitConfiguration.mockReset();
  runtime.refresh.mockReset();
  vi.stubGlobal('CSS', { supports: () => true });
  vi.stubGlobal('matchMedia', () => ({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
  Object.defineProperty(document, 'startViewTransition', {
    configurable: true,
    value: vi.fn(),
  });
  document.documentElement.dataset.motion = 'full';
  localStorage.removeItem('it-inventory-reduce-motion');
});
afterEach(() => {
  vi.unstubAllGlobals();
  delete (document as Partial<Document>).startViewTransition;
  localStorage.removeItem('it-inventory-reduce-motion');
});

it('names only the initiating holding and the authorized matching title until actual native callback completion', async () => {
  const { rerender } = render(view(<List />));
  fireEvent.click(screen.getByRole('link', { name: 'Cable row 2' }));
  const sourceName = screen
    .getByRole('link', { name: 'Cable row 2' })
    .getAttribute('data-test-transition-name');
  expect(sourceName).toMatch(/^inventory-title-/);
  expect(sourceName).not.toContain(record.id);
  expect(screen.getByRole('link', { name: 'Cable row 1' })).not.toHaveAttribute(
    'data-test-transition-name',
  );
  runtime.pathname = detailPath;
  rerender(view(<Detail />));
  expect(runtime.boundaries).toContainEqual(
    expect.objectContaining({ name: sourceName, share: 'record-title' }),
  );
  expect(screen.getByRole('heading')).toHaveAttribute(
    'data-test-transition-name',
    sourceName,
  );
  const captured = runtime.boundaries.findLast(
    (boundary) => boundary.name === sourceName,
  );
  let finish!: () => void;
  const finished = new Promise<void>((resolve) => {
    finish = resolve;
  });
  Object.defineProperty(document, 'getAnimations', {
    configurable: true,
    value: () => [
      {
        effect: { pseudoElement: `::view-transition-group(${sourceName})` },
        finished,
        cancel: vi.fn(),
      },
    ],
  });
  // The environment adapter has no native capture. Explicitly deliver React's
  // captured instance callback; geometry/replacement has separate unit coverage.
  await act(async () => {
    captured!.onShare!({ name: sourceName! });
  });
  expect(screen.getByRole('heading')).toHaveAttribute(
    'data-test-transition-name',
    sourceName,
  );
  await act(async () => {
    finish();
    await finished;
  });
  // Actual callback completion consumes the name; pathname arrival alone did not.
  expect(screen.getByRole('heading')).not.toHaveAttribute(
    'data-test-transition-name',
  );
  Reflect.deleteProperty(document, 'getAnimations');
});

it('first native Back names the remembered initiating ordinal on an unanchored results entry without changing history', () => {
  const originalHref = location.href;
  window.history.replaceState(null, '', '/inventory');
  const push = vi.spyOn(window.history, 'pushState');
  const replace = vi.spyOn(window.history, 'replaceState');
  try {
    const { rerender } = render(view(<List />));
    fireEvent.click(screen.getByRole('link', { name: 'Cable row 2' }));
    runtime.pathname = detailPath;
    rerender(view(<Detail />));
    act(() => window.dispatchEvent(new PopStateEvent('popstate')));
    const name = screen
      .getByRole('heading')
      .getAttribute('data-test-transition-name');
    expect(name).toMatch(/^inventory-title-/);
    runtime.pathname = '/inventory';
    rerender(view(<List />));
    expect(screen.getByRole('link', { name: 'Cable row 2' })).toHaveAttribute(
      'data-test-transition-name',
      name,
    );
    expect(
      screen.getByRole('link', { name: 'Cable row 1' }),
    ).not.toHaveAttribute('data-test-transition-name');
    expect(location.hash).toBe('');
    expect(push).not.toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();
  } finally {
    push.mockRestore();
    replace.mockRestore();
    window.history.replaceState(null, '', originalHref);
  }
});

it('app Back reuses the approved holding and scope, and a changed record falls back', () => {
  const { rerender } = render(view(<List />));
  fireEvent.click(screen.getByRole('link', { name: 'Cable row 2' }));
  runtime.pathname = detailPath;
  rerender(view(<Detail />));
  runtime.boundaries = [];
  fireEvent.click(screen.getByRole('link', { name: 'Back to results' }));
  const sourceName = screen
    .getByRole('heading')
    .getAttribute('data-test-transition-name');
  runtime.pathname = '/inventory';
  rerender(view(<List />));
  expect(
    runtime.boundaries.filter((boundary) => boundary.name === sourceName),
  ).toHaveLength(2);
  runtime.pathname = detailPath;
  rerender(view(<Detail />));
  fireEvent.click(screen.getByRole('link', { name: 'Back to results' }));
  const mismatchName = screen
    .getByRole('heading')
    .getAttribute('data-test-transition-name');
  runtime.pathname = '/inventory';
  rerender(view(<List wrongRecord />));
  expect(
    runtime.boundaries.filter((boundary) => boundary.name === mismatchName),
  ).toHaveLength(1);
});

it.each([
  {
    change: 'replaced at the original ordinal',
    holdings: [firstHolding, replacementHolding],
    matchedRow: null,
  },
  { change: 'deleted', holdings: [firstHolding], matchedRow: null },
  {
    change: 'reordered',
    holdings: [initiatingHolding, firstHolding],
    matchedRow: 'Cable row 1',
  },
  {
    change: 'same UUID in a different holding domain',
    holdings: [
      firstHolding,
      { domain: 'site', id: initiatingHolding.id } as HoldingIdentity,
    ],
    matchedRow: null,
  },
])(
  'native Back matches the initiating stable holding when $change',
  ({ holdings, matchedRow }) => {
    const originalHref = location.href;
    window.history.replaceState(null, '', '/inventory');
    try {
      const { rerender } = render(view(<List />));
      fireEvent.click(screen.getByRole('link', { name: 'Cable row 2' }));
      runtime.pathname = detailPath;
      rerender(view(<Detail />));
      act(() => window.dispatchEvent(new PopStateEvent('popstate')));
      const name = screen
        .getByRole('heading')
        .getAttribute('data-test-transition-name');
      expect(name).toMatch(/^inventory-title-/);
      runtime.pathname = '/inventory';
      rerender(view(<List holdings={holdings} />));
      for (const link of screen.getAllByRole('link')) {
        if (link.textContent === matchedRow)
          expect(link).toHaveAttribute('data-test-transition-name', name);
        else expect(link).not.toHaveAttribute('data-test-transition-name');
      }
    } finally {
      window.history.replaceState(null, '', originalHref);
    }
  },
);

it('direct detail Back without an approved holding origin uses ordinary navigation', () => {
  runtime.pathname = detailPath;
  const { rerender } = render(view(<Detail />));
  fireEvent.click(screen.getByRole('link', { name: 'Back to results' }));
  expect(screen.getByRole('heading')).not.toHaveAttribute(
    'data-test-transition-name',
  );
  runtime.pathname = '/inventory';
  rerender(view(<List />));
  expect(
    screen
      .getAllByRole('link')
      .every((link) => !link.hasAttribute('data-test-transition-name')),
  ).toBe(true);
});

it('holding keys distinguish storage, site and explicit unplaced sources and refuse ambiguous source data', () => {
  const id = initiatingHolding.id;
  const storage = inventoryHolding({ location: { id }, site: null });
  const site = inventoryHolding({ location: null, site: { id } });
  const unplaced = inventoryHolding({ location: null });
  expect(storage).toEqual({ domain: 'storage', id });
  expect(site).toEqual({ domain: 'site', id });
  expect(unplaced).toEqual({ domain: 'unplaced' });
  expect(
    new Set(
      [storage, site, unplaced].map((holding) =>
        recordHoldingKey(record, holding),
      ),
    ).size,
  ).toBe(3);
  expect(inventoryHolding({ location: { id }, site: { id } })).toBeNull();
  expect(titleTarget(record, returnTo, null)).toBeNull();
});

it.each([
  'ambiguous holding',
  'missing return anchor',
  'duplicate anchor',
] as const)(
  'accepted $0 navigation retires an existing different holding origin before native Back',
  async (reason) => {
    const originalHref = location.href;
    window.history.replaceState(null, '', '/inventory');
    const duplicate = document.createElement('div');
    let finish!: () => void;
    const work = new Promise<void>((resolve) => {
      finish = resolve;
    });
    try {
      const { rerender } = render(view(<List />));
      fireEvent.click(screen.getByRole('link', { name: 'Cable row 2' }));
      expect(
        screen
          .getByRole('link', { name: 'Cable row 2' })
          .getAttribute('data-test-transition-name'),
      ).toMatch(/^inventory-title-/);
      runtime.pathname = detailPath;
      rerender(view(<Detail />));
      act(() => window.dispatchEvent(new PopStateEvent('popstate')));
      runtime.pathname = '/inventory';
      rerender(view(<List />));
      expect(
        screen
          .getByRole('link', { name: 'Cable row 2' })
          .getAttribute('data-test-transition-name'),
      ).toMatch(/^inventory-title-/);
      rerender(
        view(
          <>
            <List
              pairable={reason !== 'ambiguous holding'}
              anchored={reason !== 'missing return anchor'}
            />
            <HeldTask work={work} />
          </>,
        ),
      );
      fireEvent.click(
        screen.getByRole('button', { name: 'Start independent work' }),
      );
      await waitFor(() =>
        expect(
          document.querySelector('.experience-route-progress'),
        ).toHaveAttribute('data-visible', 'true'),
      );
      if (reason === 'duplicate anchor') {
        duplicate.id = 'inventory-row-1';
        document.body.appendChild(duplicate);
      }
      fireEvent.click(screen.getByRole('link', { name: 'Cable row 1' }));
      expect(
        screen.getByRole('button', { name: 'Start independent work' }),
      ).toBeDisabled();
      expect(
        document.querySelector('.experience-route-progress'),
      ).toHaveAttribute('data-visible', 'true');
      duplicate.remove();
      runtime.pathname = detailPath;
      rerender(view(<Detail />));
      expect(screen.getByRole('heading')).not.toHaveAttribute(
        'data-test-transition-name',
      );
      act(() => window.dispatchEvent(new PopStateEvent('popstate')));
      runtime.pathname = '/inventory';
      rerender(view(<List />));
      expect(
        screen
          .getAllByRole('link')
          .every((link) => !link.hasAttribute('data-test-transition-name')),
      ).toBe(true);
    } finally {
      duplicate.remove();
      await act(async () => {
        finish();
        await work;
      });
      window.history.replaceState(null, '', originalHref);
    }
  },
);

it.each([false, true])(
  'plain same-record full-details navigation cannot reuse an older origin (canceled capture=$0)',
  (canceled) => {
    const originalHref = location.href;
    window.history.replaceState(null, '', '/inventory');
    try {
      const { rerender } = render(view(<List />));
      fireEvent.click(screen.getByRole('link', { name: 'Cable row 2' }));
      runtime.pathname = detailPath;
      rerender(view(<Detail />));
      act(() => window.dispatchEvent(new PopStateEvent('popstate')));
      runtime.pathname = '/inventory';
      rerender(
        view(
          <>
            <List />
            <CancelCaptureLink />
            <RouteLink href={detailPath}>Full details</RouteLink>
          </>,
        ),
      );
      const oldName = screen
        .getByRole('link', { name: 'Cable row 2' })
        .getAttribute('data-test-transition-name');
      expect(oldName).toMatch(/^inventory-title-/);
      if (canceled) {
        fireEvent.click(screen.getByRole('link', { name: 'Canceled capture' }));
        expect(
          screen.getByRole('link', { name: 'Cable row 2' }),
        ).toHaveAttribute('data-test-transition-name', oldName);
      }
      fireEvent.click(screen.getByRole('link', { name: 'Full details' }));
      runtime.pathname = detailPath;
      rerender(view(<Detail />));
      expect(screen.getByRole('heading')).not.toHaveAttribute(
        'data-test-transition-name',
      );
      act(() => window.dispatchEvent(new PopStateEvent('popstate')));
      runtime.pathname = '/inventory';
      rerender(view(<List />));
      expect(
        screen
          .getAllByRole('link')
          .every((link) => !link.hasAttribute('data-test-transition-name')),
      ).toBe(true);
    } finally {
      window.history.replaceState(null, '', originalHref);
    }
  },
);

it('canceled or thrown capture transactions retain the prior origin but cannot approve a later plain same-href navigation', () => {
  const state = createRouteMotionState();
  const old = titleTarget(record, returnTo, firstHolding)!;
  const replacement = titleTarget(record, returnTo, initiatingHolding)!;
  state.arm(old);
  const name = state.snapshot()!.name;
  const cancel = state.beginNavigation(detailPath, 0);
  try {
    state.stageNavigation(replacement);
    throw new Error('Canceled handler');
  } catch {
    /* Original handler failed. */
  } finally {
    cancel();
  }
  expect(state.snapshot()!.name).toBe(name);
  expect(state.backTarget(record, returnTo)?.holding).toEqual(firstHolding);
  const plain = state.beginNavigation(detailPath, 0);
  expect(state.acceptNavigation(detailPath, 0)).toBeNull();
  plain();
  const stale = state.beginNavigation(detailPath, 0);
  state.stageNavigation(replacement);
  expect(state.acceptNavigation(detailPath, 1)).toBeNull();
  stale();
});

it.each(['dirty guard', 'modified gesture'] as const)(
  '$0 keeps the current approved origin',
  (gesture) => {
    const { rerender } = render(view(<List />));
    fireEvent.click(screen.getByRole('link', { name: 'Cable row 2' }));
    const name = screen
      .getByRole('link', { name: 'Cable row 2' })
      .getAttribute('data-test-transition-name');
    const block = (event: Event) => {
      event.preventDefault();
      event.stopPropagation();
    };
    try {
      if (gesture === 'dirty guard')
        document.addEventListener('click', block, true);
      fireEvent.click(screen.getByRole('link', { name: 'Cable row 1' }), {
        ctrlKey: gesture === 'modified gesture',
      });
      expect(screen.getByRole('link', { name: 'Cable row 2' })).toHaveAttribute(
        'data-test-transition-name',
        name,
      );
      runtime.pathname = detailPath;
      rerender(view(<Detail />));
      expect(screen.getByRole('heading')).toHaveAttribute(
        'data-test-transition-name',
        name,
      );
    } finally {
      document.removeEventListener('click', block, true);
    }
  },
);

it('blocked, modified and colliding row gestures never arm private shared names', () => {
  render(view(<List />));
  const block = (event: Event) => {
    event.preventDefault();
    event.stopPropagation();
  };
  document.addEventListener('click', block, true);
  fireEvent.click(screen.getByRole('link', { name: 'Cable row 2' }));
  document.removeEventListener('click', block, true);
  fireEvent.click(screen.getByRole('link', { name: 'Cable row 2' }), {
    ctrlKey: true,
  });
  const duplicate = document.createElement('div');
  duplicate.id = 'inventory-row-2';
  document.body.appendChild(duplicate);
  fireEvent.click(screen.getByRole('link', { name: 'Cable row 2' }));
  duplicate.remove();
  expect(screen.getByRole('link', { name: 'Cable row 2' })).not.toHaveAttribute(
    'data-test-transition-name',
  );
});

it.each([null, { user: { id: 'other-account' } }])(
  'invalidates and cancels immediately on auth loss/account change',
  (session) => {
    const skipTransition = vi.fn();
    Object.defineProperty(document, 'activeViewTransition', {
      configurable: true,
      value: { skipTransition },
    });
    const { rerender } = render(view(<List />));
    fireEvent.click(screen.getByRole('link', { name: 'Cable row 2' }));
    const stale = runtime.boundaries.findLast(
      (boundary) => boundary.name,
    )?.onShare;
    act(() => runtime.callbacks.at(-1)!('SIGNED_OUT', session));
    expect(skipTransition).toHaveBeenCalledOnce();
    expect(document.documentElement.dataset.routeMotionPrivate).toBe('false');
    expect(
      screen.getByRole('link', { name: 'Cable row 2' }),
    ).not.toHaveAttribute('data-test-transition-name');
    runtime.pathname = detailPath;
    rerender(view(<Detail />));
    const priorSkips = skipTransition.mock.calls.length;
    stale?.({ name: 'retired-instance' });
    expect(skipTransition).toHaveBeenCalledTimes(priorSkips);
    expect(screen.getByRole('heading')).not.toHaveAttribute(
      'data-test-transition-name',
    );
    Reflect.deleteProperty(document, 'activeViewTransition');
  },
);

it('a guarded real server-action form keeps intent, while permitted intercepted submission cancels before dispatch', async () => {
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
  const observedSubmits: boolean[] = [];
  const observe = (event: Event) =>
    observedSubmits.push(event.defaultPrevented);
  document.addEventListener('submit', observe);
  try {
    render(
      view(
        <>
          <List />
          <QueueLogoutForm />
        </>,
      ),
    );
    fireEvent.click(screen.getByRole('link', { name: 'Cable row 2' }));
    const form = screen
      .getByRole('button', { name: 'Sign out' })
      .closest('form')!;
    fireEvent.submit(form);
    expect(document.documentElement.dataset.routeMotionPrivate).toBe('true');
    expect(runtime.logout).not.toHaveBeenCalled();
    expect(screen.getByRole('link', { name: 'Cable row 2' })).toHaveAttribute(
      'data-test-transition-name',
    );
    confirm.mockReturnValue(true);
    fireEvent.submit(form);
    expect(document.documentElement.dataset.routeMotionPrivate).toBe('false');
    await waitFor(() => expect(runtime.logout).toHaveBeenCalledOnce());
    expect(runtime.actionPrivacy).toBe('false');
    // Both events are prevented: the first by our guard, the second by React.
    expect(observedSubmits).toEqual([true, true]);
    expect(
      screen.getByRole('link', { name: 'Cable row 2' }),
    ).not.toHaveAttribute('data-test-transition-name');
  } finally {
    confirm.mockRestore();
    document.removeEventListener('submit', observe);
  }
});
it('same-actor refresh preserves intent while unmounted callbacks cannot suppress a new account', () => {
  const { rerender } = render(view(<List />));
  const oldCallback = runtime.callbacks.at(-1)!;
  fireEvent.click(screen.getByRole('link', { name: 'Cable row 2' }));
  act(() => oldCallback('TOKEN_REFRESHED', { user: { id: 'staff' } }));
  expect(screen.getByRole('link', { name: 'Cable row 2' })).toHaveAttribute(
    'data-test-transition-name',
  );
  rerender(view(<List />, 'other-account'));
  act(() => oldCallback('SIGNED_OUT', null));
  expect(document.documentElement.dataset.routeMotionPrivate).toBe('true');
});

it('same-actor action denial cancels active snapshots, clears intent and blocks stale animation callbacks', async () => {
  const skipTransition = vi.fn();
  const cancel = vi.fn();
  Object.defineProperty(document, 'activeViewTransition', {
    configurable: true,
    value: { skipTransition },
  });
  Object.defineProperty(document, 'getAnimations', {
    configurable: true,
    value: () => [
      { effect: { pseudoElement: '::view-transition-group(title)' }, cancel },
    ],
  });
  try {
    const { rerender } = render(view(<List />));
    fireEvent.click(screen.getByRole('link', { name: 'Cable row 2' }));
    const stale = runtime.boundaries.findLast(
      (boundary) => boundary.name,
    )?.onShare;
    const denied = { ok: false, code: 'forbidden' };
    await act(async () => {
      expect(await observeRouteActionResult(Promise.resolve(denied))).toBe(
        denied,
      );
      // Invalidation happens before the original caller resumes.
      expect(document.documentElement.dataset.routeMotionPrivate).toBe('false');
      expect(skipTransition).toHaveBeenCalled();
      expect(cancel).toHaveBeenCalled();
    });
    act(() =>
      runtime.callbacks.at(-1)!('TOKEN_REFRESHED', { user: { id: 'staff' } }),
    );
    fireEvent.click(screen.getByRole('link', { name: 'Cable row 2' }));
    expect(screen.getByText('instant')).toBeVisible();
    expect(
      screen.getByRole('link', { name: 'Cable row 2' }),
    ).not.toHaveAttribute('data-test-transition-name');
    runtime.pathname = detailPath;
    rerender(view(<Detail />));
    const priorSkips = skipTransition.mock.calls.length;
    stale?.({ name: 'retired-instance' });
    expect(skipTransition.mock.calls.length).toBe(priorSkips);
    expect(screen.getByRole('heading')).not.toHaveAttribute(
      'data-test-transition-name',
    );
  } finally {
    Reflect.deleteProperty(document, 'activeViewTransition');
    Reflect.deleteProperty(document, 'getAnimations');
  }
});

it('local reduction cancels in-flight pseudo-element animations and disables later gestures', () => {
  const cancel = vi.fn();
  Object.defineProperty(document, 'getAnimations', {
    configurable: true,
    value: () => [
      { effect: { pseudoElement: '::view-transition-new(route)' }, cancel },
    ],
  });
  render(view(<List />));
  fireEvent.click(screen.getByRole('link', { name: 'Cable row 2' }));
  act(() => {
    localStorage.setItem('it-inventory-reduce-motion', 'true');
    window.dispatchEvent(
      new StorageEvent('storage', { key: 'it-inventory-reduce-motion' }),
    );
  });
  expect(cancel).toHaveBeenCalled();
  expect(document.documentElement.dataset.motion).toBe('reduced');
  fireEvent.click(screen.getByRole('link', { name: 'Cable row 2' }));
  expect(screen.getByRole('link', { name: 'Cable row 2' })).not.toHaveAttribute(
    'data-test-transition-name',
  );
  delete (document as Partial<Document>).getAnimations;
});

it('unsupported browsers preserve ordinary links instantly', () => {
  delete (document as Partial<Document>).startViewTransition;
  render(view(<List />));
  expect(screen.getByText('instant')).toBeVisible();
  fireEvent.click(screen.getByRole('link', { name: 'Cable row 2' }));
  expect(screen.getByRole('link', { name: 'Cable row 2' })).toHaveAttribute(
    'href',
    detailPath,
  );
  expect(screen.getByRole('link', { name: 'Cable row 2' })).not.toHaveAttribute(
    'data-test-transition-name',
  );
});

it('finishes streaming intents, keeps only a valid exact Back origin, and never rearms invalidated state', () => {
  const state = createRouteMotionState();
  const target = titleTarget(record, returnTo, initiatingHolding)!;
  state.arm(target);
  const firstName = state.snapshot()!.name;
  state.finish();
  state.back(detailPath, '/inventory#inventory-row-1');
  expect(state.snapshot()).toBeNull();
  state.back('/inventory/quantity/different-record', '/inventory');
  expect(state.snapshot()).toBeNull();
  state.back(detailPath, '/inventory?q=changed');
  expect(state.snapshot()).toBeNull();
  state.back(detailPath, '/inventory');
  expect(state.snapshot()).toMatchObject({
    id: record.id,
    anchor: 'inventory-row-2',
  });
  state.finish();
  state.back(detailPath, returnTo);
  expect(state.snapshot()!.name).not.toBe(firstName);
  state.invalidate();
  state.arm(target);
  state.back(detailPath, returnTo);
  expect(state.snapshot()).toBeNull();
  expect(
    titleTarget(
      record,
      'https://evil.test/inventory#inventory-row-2',
      initiatingHolding,
    ),
  ).toBeNull();
  expect(
    titleTarget(record, '/inventory#inventory-row-1000', initiatingHolding),
  ).toBeNull();
  expect(titleTarget(record, '/inventory', initiatingHolding)).toBeNull();
  expect(() => cancelRouteSnapshots()).not.toThrow();
});

it('generic committed route errors retire snapshots/Back origin but preserve verified motion for the next valid route', () => {
  const state = createRouteMotionState();
  const target = titleTarget(record, returnTo, initiatingHolding)!;
  state.arm(target);
  state.retire();
  state.back(detailPath, '/inventory');
  expect(state.snapshot()).toBeNull();
  expect(state.valid()).toBe(true);
  const { rerender } = render(view(<List />));
  fireEvent.click(screen.getByRole('link', { name: 'Cable row 2' }));
  rerender(
    view(
      <>
        <RoutePendingTerminal />
        <p>Unavailable route</p>
      </>,
    ),
  );
  expect(screen.getByText('enabled')).toBeVisible();
  rerender(view(<List />));
  fireEvent.click(screen.getByRole('link', { name: 'Cable row 2' }));
  expect(
    screen
      .getByRole('link', { name: 'Cable row 2' })
      .getAttribute('data-test-transition-name'),
  ).toMatch(/^inventory-title-/);
});

it('access denial stays suppressed after a generic terminal commit until an authorized provider remount', async () => {
  const { rerender } = render(view(<List />));
  await act(async () => {
    await observeRouteActionResult(
      Promise.resolve({ ok: false, code: 'forbidden' }),
    );
  });
  rerender(view(<RoutePendingTerminal />));
  expect(screen.getByText('instant')).toBeVisible();
  rerender(view(<List />));
  fireEvent.click(screen.getByRole('link', { name: 'Cable row 2' }));
  expect(screen.getByRole('link', { name: 'Cable row 2' })).not.toHaveAttribute(
    'data-test-transition-name',
  );
  rerender(view(<List />, 'renewed-verified-actor'));
  expect(screen.getByText('enabled')).toBeVisible();
});

it('quiet provider retirement prevents old native callbacks/completion from canceling or notifying a replacement', async () => {
  const warnings = vi.spyOn(console, 'error').mockImplementation(() => {});
  let finish!: () => void;
  const finished = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const cancel = vi.fn();
  try {
    const { rerender } = render(view(<List />));
    fireEvent.click(screen.getByRole('link', { name: 'Cable row 2' }));
    const oldName = screen
      .getByRole('link', { name: 'Cable row 2' })
      .getAttribute('data-test-transition-name')!;
    const old = runtime.boundaries.findLast(
      (boundary) => boundary.name === oldName,
    )!;
    Object.defineProperty(document, 'getAnimations', {
      configurable: true,
      value: () => [
        {
          effect: { pseudoElement: `::view-transition-group(${oldName})` },
          finished,
          cancel,
        },
      ],
    });
    await act(async () => {
      old.onShare!({ name: oldName });
    });
    rerender(view(<List />, 'replacement-actor'));
    fireEvent.click(screen.getByRole('link', { name: 'Cable row 2' }));
    const newName = screen
      .getByRole('link', { name: 'Cable row 2' })
      .getAttribute('data-test-transition-name');
    expect(newName).toMatch(/^inventory-title-/);
    expect(newName).not.toBe(oldName);
    const prior = cancel.mock.calls.length;
    Object.defineProperty(document, 'getAnimations', {
      configurable: true,
      value: () => [
        {
          effect: { pseudoElement: `::view-transition-group(${newName})` },
          finished: Promise.resolve(),
          cancel,
        },
      ],
    });
    await act(async () => {
      old.onShare!({ name: oldName });
      finish();
      await finished;
    });
    expect(cancel).toHaveBeenCalledTimes(prior);
    expect(screen.getByRole('link', { name: 'Cable row 2' })).toHaveAttribute(
      'data-test-transition-name',
      newName,
    );
    expect(
      warnings.mock.calls.some((args) =>
        args.some((value) =>
          String(value).includes(
            'useInsertionEffect must not schedule updates',
          ),
        ),
      ),
    ).toBe(false);
  } finally {
    warnings.mockRestore();
    Reflect.deleteProperty(document, 'getAnimations');
  }
});

it('retired logout and terminal closures cannot cancel a replacement while current closures still invalidate immediately', () => {
  const controls: CapturedControls[] = [];
  const capture = (value: CapturedControls) => {
    controls.push(value);
  };
  const skipTransition = vi.fn();
  Object.defineProperty(document, 'activeViewTransition', {
    configurable: true,
    value: { skipTransition },
  });
  try {
    const { rerender } = render(
      view(
        <>
          <List />
          <CaptureControls capture={capture} />
        </>,
      ),
    );
    const retired = controls.at(-1)!;
    fireEvent.click(screen.getByRole('link', { name: 'Cable row 2' }));
    rerender(
      view(
        <>
          <List />
          <CaptureControls capture={capture} />
        </>,
        'replacement-actor',
      ),
    );
    fireEvent.click(screen.getByRole('link', { name: 'Cable row 2' }));
    const current = controls.at(-1)!;
    const name = screen
      .getByRole('link', { name: 'Cable row 2' })
      .getAttribute('data-test-transition-name');
    skipTransition.mockClear();
    act(() => {
      retired.logout();
      retired.terminal();
    });
    expect(skipTransition).not.toHaveBeenCalled();
    expect(document.documentElement.dataset.routeMotionPrivate).toBe('true');
    expect(screen.getByRole('link', { name: 'Cable row 2' })).toHaveAttribute(
      'data-test-transition-name',
      name,
    );
    act(() => current.terminal());
    expect(skipTransition).toHaveBeenCalledOnce();
    expect(screen.getByText('enabled')).toBeVisible();
    expect(
      screen.getByRole('link', { name: 'Cable row 2' }),
    ).not.toHaveAttribute('data-test-transition-name');
    act(() => current.logout());
    expect(skipTransition).toHaveBeenCalledTimes(2);
    expect(document.documentElement.dataset.routeMotionPrivate).toBe('false');
    expect(screen.getByText('instant')).toBeVisible();
  } finally {
    Reflect.deleteProperty(document, 'activeViewTransition');
  }
});

it('hash Back keeps a still-mounted Settings request busy until its actual action settles', async () => {
  const originalHref = location.href;
  runtime.pathname = '/settings/categories';
  window.history.replaceState(null, '', runtime.pathname);
  let finish!: (result: { ok: true; result: { changed: boolean } }) => void;
  const work = new Promise<{ ok: true; result: { changed: boolean } }>(
    (resolve) => {
      finish = resolve;
    },
  );
  runtime.submitConfiguration.mockReturnValueOnce(work);
  try {
    render(
      view(
        <SettingsPanel
          mode="categories"
          categories={[
            {
              id: '00000000-0000-4000-8000-000000000001',
              code: 'SOURCE',
              name: 'Source',
              active: true,
              sort_order: 1,
              version: '1',
              removed_at: null,
            },
          ]}
          canManage
        />,
      ),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Rename Source' }));
    fireEvent.change(screen.getByLabelText('New category name'), {
      target: { value: 'Updated source' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save name' }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Save name' })).toBeDisabled(),
    );
    window.history.pushState(null, '', '/settings/categories#filters');
    await act(async () => {
      const returned = new Promise<void>((resolve) =>
        window.addEventListener('popstate', () => resolve(), { once: true }),
      );
      window.history.back();
      await returned;
    });
    expect(location.hash).toBe('');
    expect(screen.getByRole('button', { name: 'Save name' })).toBeDisabled();
    expect(screen.getByLabelText('New category name')).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Save name' }));
    expect(runtime.submitConfiguration).toHaveBeenCalledOnce();
    await act(async () => {
      finish({ ok: true, result: { changed: true } });
      await work;
    });
    await screen.findByText('Category name saved: Updated source.');
    expect(screen.getByRole('button', { name: 'Rename Source' })).toBeEnabled();
    expect(runtime.refresh).toHaveBeenCalledOnce();
  } finally {
    window.history.replaceState(null, '', originalHref);
  }
});
