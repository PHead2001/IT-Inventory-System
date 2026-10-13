import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { flushSync } from 'react-dom';
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
  useRouteActionResult,
} from './route-pending';
import { PageArrival } from './page-arrival';
import RouteLink from './route-link';
import { QueueLogoutForm } from '@/features/labels/queue-logout-form';
import { PrivacyReadinessContext } from '@/components/auth/privacy-readiness';
import {
  assignmentEpoch,
  readPrivacyRevocationRevision,
} from '@/features/scan/assign-batch';
import { RecordName } from '@/components/record-name';
import { SettingsPanel } from '@/features/configuration/settings-panel';
import {
  InventoryBackLink,
  InventoryRecordLink,
  RecordTitle,
} from './record-transition';
import { RouteContentIdentityContext } from './route-content-identity';
import { RouteReady } from './route-ready';
import { routeKey } from './route-key';
import { PairedRouteLoadingContext } from './paired-route-loading';
import { sharedTitleMotion } from './shared-title-motion';
import {
  cancelRouteSnapshots,
  createRouteMotionState,
  titleTarget,
  inventoryHolding,
  recordHoldingKey,
  type HoldingIdentity,
} from './route-motion-state';

const runtime = vi.hoisted(() => ({
  navigation: null as EventTarget | null,
  pathname: '/inventory',
  query: '',
  callbacks: [] as Array<
    (event: string, session: { user: { id: string } } | null) => void
  >,
  boundaries: [] as Array<{
    enter?: string;
    exit?: string;
    name?: string;
    share?: string;
    onShare?: (instance: { name: string }) => void | (() => void);
    onUpdate?: (
      instance: { name: string },
      types: string[],
    ) => void | (() => void);
    update?: string;
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
vi.mock('@/lib/auth/logout-transport', () => ({
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
  clearAllDesignerRecovery: vi.fn(() => true),
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
  listHref = '/inventory',
}: {
  wrongRecord?: boolean;
  holdings?: HoldingIdentity[];
  pairable?: boolean;
  anchored?: boolean;
  listHref?: string;
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
                anchored ? `${listHref}#inventory-row-${ordinal}` : undefined
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
function Detail({ returnHref = returnTo }: { returnHref?: string }) {
  return (
    <>
      <RecordTitle record={record}>Cable title</RecordTitle>
      <InventoryBackLink record={record} href={returnHref}>
        Back to results
      </InventoryBackLink>
    </>
  );
}
function Probe() {
  const { enabled } = useRouteMotion();
  return <output>{enabled ? 'enabled' : 'instant'}</output>;
}

it('generic snapshot completion before a late inner primary preserves its exact title pair', async () => {
  let primaryKey = '/inventory';
  let motion!: ReturnType<typeof useRouteMotion>;
  function Observe() {
    const current = useRouteMotion();
    useLayoutEffect(() => {
      motion = current;
    });
    return null;
  }
  const fixture = () =>
    view(
      <>
        <Observe />
        <PageArrival pathname={runtime.pathname}>
          <RouteContentIdentityContext
            value={{
              pathname: primaryKey,
              listHref: primaryKey,
              rawRouteKey: primaryKey,
            }}
          >
            {primaryKey === '/inventory' ? <List /> : <Detail />}
          </RouteContentIdentityContext>
        </PageArrival>
      </>,
    );
  let finishGeneric!: () => void;
  const genericFinished = new Promise<void>((resolve) => {
    finishGeneric = resolve;
  });
  Object.defineProperty(document, 'getAnimations', {
    configurable: true,
    value: () => [
      {
        effect: { pseudoElement: '::view-transition-group(generic-route)' },
        finished: genericFinished,
      },
    ],
  });
  try {
    const page = render(fixture());
    fireEvent.click(screen.getByRole('link', { name: 'Cable row 2' }));
    const original = motion.intent!;
    const titleArrival = motion.titleArrival;
    const finishEarlierGeneric = motion.finishArrivalAfterSnapshot;
    runtime.pathname = detailPath;
    page.rerender(fixture());
    expect(
      runtime.boundaries.some(
        (boundary) => boundary.update === 'route-content',
      ),
    ).toBe(false);
    await act(async () => {
      finishEarlierGeneric({ name: 'generic-route' });
    });
    await act(async () => {
      finishGeneric();
      await genericFinished;
    });
    expect(motion.arrival).toBeNull();
    expect(motion.intent).toBe(original);
    expect(motion.titleArrival).toBe(titleArrival);
    primaryKey = detailPath;
    page.rerender(fixture());
    expect(screen.getByRole('heading')).toHaveAttribute(
      'data-test-transition-name',
      original.name,
    );
    let finishTitle!: () => void;
    const titleFinished = new Promise<void>((resolve) => {
      finishTitle = resolve;
    });
    Object.defineProperty(document, 'getAnimations', {
      configurable: true,
      value: () => [
        {
          effect: {
            pseudoElement: `::view-transition-group(${original.name})`,
          },
          finished: titleFinished,
        },
        {
          effect: {
            pseudoElement: `::view-transition-new(${original.name}-content)`,
          },
          finished: titleFinished,
        },
      ],
    });
    const title = runtime.boundaries.findLast(
      (boundary) => boundary.name === original.name,
    );
    await act(async () => {
      title!.onShare!({ name: original.name });
    });
    expect(motion.intent).toBe(original);
    await act(async () => {
      finishTitle();
      await titleFinished;
    });
    expect(motion.intent).toBeNull();
    expect(motion.titleArrival).toBeNull();
  } finally {
    Reflect.deleteProperty(document, 'getAnimations');
  }
});

it.each(['inner-first', 'outer-first'])(
  'pairs primary body and title in one capture with %s commits',
  async (order) => {
    let primaryKey = '/inventory';
    let motion!: ReturnType<typeof useRouteMotion>;
    function Observe() {
      const current = useRouteMotion();
      useLayoutEffect(() => {
        motion = current;
      });
      return null;
    }
    const fixture = () =>
      view(
        <>
          <Observe />
          <PageArrival pathname={runtime.pathname}>
            <RouteReady
              actorId="staff"
              routeKey={primaryKey}
              contentIdentity={primaryKey}
              pairedInventory
            >
              {primaryKey === '/inventory' ? <List /> : <Detail />}
            </RouteReady>
          </PageArrival>
        </>,
      );
    const page = render(fixture());
    fireEvent.click(screen.getByRole('link', { name: 'Cable row 2' }));
    const original = motion.intent!;
    expect(motion.arrivalEnabled).toBe(false);
    if (order === 'outer-first') {
      runtime.pathname = detailPath;
      page.rerender(fixture());
    }
    primaryKey = detailPath;
    page.rerender(fixture());
    const title = runtime.boundaries.findLast((b) => b.name === original.name)!;
    const body = runtime.boundaries.findLast(
      (b) => b.name === original.name + '-content',
    )!;
    expect(body).toMatchObject({ share: 'route-content', update: 'none' });
    let finishTitle!: () => void, finishBody!: () => void;
    const titleFinished = new Promise<void>((resolve) => {
      finishTitle = resolve;
    });
    const bodyFinished = new Promise<void>((resolve) => {
      finishBody = resolve;
    });
    Object.defineProperty(document, 'getAnimations', {
      configurable: true,
      value: () => [
        {
          effect: {
            pseudoElement: `::view-transition-group(${original.name})`,
          },
          finished: titleFinished,
        },
        {
          effect: {
            pseudoElement: `::view-transition-old(${original.name}-content)`,
          },
          finished: bodyFinished,
        },
        {
          effect: {
            pseudoElement: `::view-transition-new(${original.name}-content)`,
          },
          finished: bodyFinished,
        },
      ],
    });
    try {
      vi.mocked(sharedTitleMotion).mockReturnValueOnce(() => {});
      await act(async () => {
        body.onShare!({ name: original.name + '-content' });
        title.onShare!({ name: original.name });
      });
      expect(motion.arrival).toBeNull();
      expect(motion.intent).toBe(original);
      runtime.pathname = detailPath;
      runtime.boundaries = [];
      page.rerender(fixture());
      expect(
        runtime.boundaries
          .filter((b) => b.enter !== undefined)
          .every((b) => b.update === 'none'),
      ).toBe(true);
      await act(async () => {
        finishTitle();
        await titleFinished;
      });
      expect(motion.intent).toBe(original);
      await act(async () => {
        finishBody();
        await bodyFinished;
      });
      expect(motion.intent).toBeNull();
    } finally {
      Reflect.deleteProperty(document, 'getAnimations');
    }
  },
);

it('a body-only share crossfades once then retires its unused title without canceling route work', async () => {
  let motion!: ReturnType<typeof useRouteMotion>;
  let pending!: NonNullable<
    React.ContextType<typeof RoutePendingContext>
  >['state'];
  function Observe() {
    const current = useRouteMotion(),
      scope = useContext(RoutePendingContext)!;
    useLayoutEffect(() => {
      motion = current;
      pending = scope.state;
    });
    return null;
  }
  render(
    view(
      <>
        <Observe />
        <List />
      </>,
    ),
  );
  fireEvent.click(screen.getByRole('link', { name: 'Cable row 2' }));
  const original = motion.intent!;
  let release!: () => void;
  const finished = new Promise<void>((resolve) => {
    release = resolve;
  });
  const cancel = vi.fn();
  Object.defineProperty(document, 'getAnimations', {
    configurable: true,
    value: () => [
      {
        effect: {
          pseudoElement: `::view-transition-old(${original.name}-content)`,
        },
        finished,
        cancel,
      },
      {
        effect: {
          pseudoElement: `::view-transition-new(${original.name}-content)`,
        },
        finished,
        cancel,
      },
    ],
  });
  let finishWork!: () => void;
  act(() => {
    finishWork = pending.register();
  });
  try {
    await act(async () => {
      motion.finishPairedContentAfterSnapshot({
        name: original.name + '-content',
      });
    });
    expect(motion.arrival).toBeNull();
    expect(motion.intent).toBe(original);
    expect(cancel).not.toHaveBeenCalled();
    expect(pending.snapshot().pending).toBe(true);
    await act(async () => {
      release();
      await finished;
    });
    expect(motion.intent).toBeNull();
    expect(motion.titleArrival).toBeNull();
    expect(pending.snapshot().pending).toBe(true);
    expect(cancel).not.toHaveBeenCalled();
  } finally {
    act(finishWork);
    Reflect.deleteProperty(document, 'getAnimations');
  }
});

it('a title capture without an opted-in body reveals instantly and cannot replay a generic arrival', async () => {
  let motion!: ReturnType<typeof useRouteMotion>;
  function Observe() {
    const current = useRouteMotion();
    useLayoutEffect(() => {
      motion = current;
    });
    return null;
  }
  render(
    view(
      <>
        <Observe />
        <List />
      </>,
    ),
  );
  fireEvent.click(screen.getByRole('link', { name: 'Cable row 2' }));
  const original = motion.intent!;
  const cancel = vi.fn();
  Object.defineProperty(document, 'getAnimations', {
    configurable: true,
    value: () => [
      {
        effect: { pseudoElement: `::view-transition-group(${original.name})` },
        finished: Promise.resolve(),
        cancel,
      },
    ],
  });
  try {
    await act(async () => {
      motion.finishTitleAfterSnapshot({ name: original.name });
    });
    expect(cancel).toHaveBeenCalled();
    expect(motion.intent).toBeNull();
    expect(motion.arrival).toBeNull();
    expect(motion.titleArrival).toBeNull();
    expect(motion.arrivalEnabled).toBe(false);
    expect(document.documentElement.dataset.routeMotionPrivate).toBe('true');
  } finally {
    Reflect.deleteProperty(document, 'getAnimations');
  }
});

it('a captured inner title consumes its arrival before a later outer commit can add a second route fade', async () => {
  let primaryKey = '/inventory';
  let motion!: ReturnType<typeof useRouteMotion>;
  function Observe() {
    const current = useRouteMotion();
    useLayoutEffect(() => {
      motion = current;
    });
    return null;
  }
  const fixture = () =>
    view(
      <>
        <Observe />
        <PageArrival pathname={runtime.pathname}>
          <RouteContentIdentityContext
            value={{
              pathname: primaryKey,
              listHref: primaryKey,
              rawRouteKey: primaryKey,
            }}
          >
            {primaryKey === '/inventory' ? <List /> : <Detail />}
          </RouteContentIdentityContext>
        </PageArrival>
      </>,
    );
  let finishTitle!: () => void;
  const titleFinished = new Promise<void>((resolve) => {
    finishTitle = resolve;
  });
  const page = render(fixture());
  fireEvent.click(screen.getByRole('link', { name: 'Cable row 2' }));
  const original = motion.intent!;
  const approval = motion.titleArrival;
  Object.defineProperty(document, 'getAnimations', {
    configurable: true,
    value: () => [
      {
        effect: {
          pseudoElement: `::view-transition-group(${original.name})`,
        },
        finished: titleFinished,
      },
      {
        effect: {
          pseudoElement: `::view-transition-new(${original.name}-content)`,
        },
        finished: titleFinished,
      },
    ],
  });
  try {
    // Next's opaque primary reveals before the outer pathname catches up.
    primaryKey = detailPath;
    page.rerender(fixture());
    const title = runtime.boundaries.findLast(
      (boundary) => boundary.name === original.name,
    )!;
    expect(title.onShare).toBeDefined();
    vi.mocked(sharedTitleMotion).mockReturnValueOnce(() => {});
    await act(async () => {
      title.onShare!({ name: original.name });
    });
    // The capture belongs to this navigation, while its native title is alive.
    expect(motion.arrival).toBeNull();
    expect(motion.intent).toBe(original);
    expect(motion.titleArrival).toBe(approval);
    runtime.boundaries = [];
    runtime.pathname = detailPath;
    page.rerender(fixture());
    const arrivals = runtime.boundaries.filter(
      (boundary) => boundary.enter !== undefined,
    );
    expect(arrivals.length).toBeGreaterThan(0);
    expect(arrivals.every((boundary) => boundary.enter === 'none')).toBe(true);
    expect(arrivals.every((boundary) => boundary.exit === 'none')).toBe(true);
    expect(arrivals.every((boundary) => boundary.update === 'none')).toBe(true);
    expect(motion.intent).toBe(original);
    await act(async () => {
      finishTitle();
      await titleFinished;
    });
    expect(motion.intent).toBeNull();
    expect(motion.titleArrival).toBeNull();
  } finally {
    Reflect.deleteProperty(document, 'getAnimations');
  }
});

it('old generic and title completions cannot consume a newer same-provider Back intent', async () => {
  let motion!: ReturnType<typeof useRouteMotion>;
  let loading!: NonNullable<
    React.ContextType<typeof PairedRouteLoadingContext>
  >;
  function Observe() {
    const current = useRouteMotion();
    const currentLoading = useContext(PairedRouteLoadingContext)!;
    useLayoutEffect(() => {
      motion = current;
      loading = currentLoading;
    });
    return null;
  }
  const fixture = (children: ReactNode) =>
    view(
      <>
        <Observe />
        {children}
      </>,
    );
  const page = render(fixture(<List />));
  fireEvent.click(screen.getByRole('link', { name: 'Cable row 2' }));
  const first = motion.intent!;
  let finishOld!: () => void;
  const oldFinished = new Promise<void>((resolve) => {
    finishOld = resolve;
  });
  Object.defineProperty(document, 'getAnimations', {
    configurable: true,
    value: () =>
      ['old-generic', first.name, first.name + '-content'].map((name) => ({
        effect: { pseudoElement: `::view-transition-group(${name})` },
        finished: oldFinished,
        cancel: vi.fn(),
      })),
  });
  try {
    await act(async () => {
      motion.finishArrivalAfterSnapshot({ name: 'old-generic' });
      motion.finishTitleAfterSnapshot({ name: first.name });
      motion.finishPairedContentAfterSnapshot({
        name: first.name + '-content',
      });
    });
    runtime.pathname = detailPath;
    page.rerender(fixture(<Detail />));
    act(() => loading.store.ready(detailPath));
    fireEvent.click(screen.getByRole('link', { name: 'Back to results' }));
    const next = motion.intent!;
    const nextArrival = motion.arrival;
    const nextTitleArrival = motion.titleArrival;
    expect(next.name).not.toBe(first.name);
    expect(nextArrival).not.toBeNull();
    await act(async () => {
      finishOld();
      await oldFinished;
    });
    expect(motion.intent).toBe(next);
    expect(motion.arrival).toBe(nextArrival);
    expect(motion.titleArrival).toBe(nextTitleArrival);
    await act(async () => {
      motion.finishTitleAfterSnapshot({ name: 'unrelated-generic' });
    });
    expect(motion.intent).toBe(next);
    await act(async () => {
      motion.finishTitleAfterSnapshot({ name: next.name });
    });
    expect(motion.intent).toBeNull();
    expect(motion.titleArrival).toBeNull();
  } finally {
    Reflect.deleteProperty(document, 'getAnimations');
  }
});

it.each(['forward', 'native traverse', 'privacy revocation'])(
  'a late inner title after generic arrival consumption respects %s',
  (mode) => {
    let primaryKey = '/inventory';
    let top = -364;
    const scroll = vi
      .spyOn(window, 'scrollBy')
      .mockImplementation((options) => {
        top -= (options as ScrollToOptions).top ?? 0;
      });
    vi.spyOn(HTMLElement.prototype, 'getClientRects').mockReturnValue({
      length: 1,
    } as DOMRectList);
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(
      () => ({
        top,
        bottom: top + 104,
        left: 0,
        right: 200,
        width: 200,
        height: 104,
        x: 0,
        y: top,
        toJSON: () => ({}),
      }),
    );
    vi.stubGlobal('innerHeight', 480);
    let observed!: ReturnType<typeof useRouteMotion>;
    function Observe() {
      const motion = useRouteMotion();
      useLayoutEffect(() => {
        observed = motion;
      });
      return null;
    }
    const fixture = () =>
      view(
        <>
          <Observe />
          <PageArrival pathname={runtime.pathname}>
            <RouteContentIdentityContext
              value={{
                pathname: primaryKey,
                listHref: primaryKey,
                rawRouteKey: primaryKey,
              }}
            >
              {primaryKey === '/inventory' ? <List /> : <Detail />}
            </RouteContentIdentityContext>
          </PageArrival>
        </>,
      );
    try {
      const page = render(fixture());
      fireEvent.click(screen.getByRole('link', { name: 'Cable row 2' }));
      const name = observed.intent!.name;
      runtime.pathname = detailPath;
      page.rerender(fixture());
      expect(observed.arrival).toBeNull();
      expect(observed.intent?.name).toBe(name);
      if (mode === 'native traverse') {
        const event = new Event('navigate');
        Object.defineProperty(event, 'navigationType', { value: 'traverse' });
        act(() => runtime.navigation!.dispatchEvent(event));
      }
      if (mode === 'privacy revocation')
        act(() => runtime.callbacks[0]('SIGNED_OUT', null));
      primaryKey = detailPath;
      page.rerender(fixture());
      if (mode === 'forward') {
        expect(screen.getByRole('heading')).toHaveAttribute(
          'data-test-transition-name',
          name,
        );
        expect(scroll).toHaveBeenCalledWith({ top: -364, behavior: 'instant' });
        expect(top).toBe(0);
      } else {
        expect(observed.titleArrival).toBeNull();
        expect(screen.getByRole('heading')).not.toHaveAttribute(
          'data-test-transition-name',
        );
        expect(scroll).not.toHaveBeenCalled();
      }
    } finally {
      vi.restoreAllMocks();
    }
  },
);
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
const view = (
  children: ReactNode,
  actorId = 'staff',
  generation = 'route-fixture',
) => (
  <PrivacyReadinessContext
    value={{
      ready: true,
      visible: true,
      generation,
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
  runtime.navigation = new EventTarget();
  Object.defineProperty(window, 'navigation', {
    configurable: true,
    value: runtime.navigation,
  });
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
    writable: true,
    value: vi.fn(),
  });
  document.documentElement.dataset.motion = 'full';
  localStorage.removeItem('it-inventory-reduce-motion');
});
afterEach(() => {
  Reflect.deleteProperty(window, 'navigation');
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
      {
        effect: {
          pseudoElement: `::view-transition-new(${sourceName}-content)`,
        },
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

it.each(['row', 'heading'] as const)(
  'returns the exact replacement cleanup from the admitted %s share callback',
  async (surface) => {
    const rendered = render(view(<List />));
    fireEvent.click(screen.getByRole('link', { name: 'Cable row 2' }));
    const name = screen
      .getByRole('link', { name: 'Cable row 2' })
      .getAttribute('data-test-transition-name')!;
    if (surface === 'heading') {
      runtime.pathname = detailPath;
      rendered.rerender(view(<Detail />));
    }
    const captured = runtime.boundaries.findLast(
      (boundary) => boundary.name === name,
    )!;
    const cancelReplacement = vi.fn();
    vi.mocked(sharedTitleMotion).mockReturnValueOnce(cancelReplacement);
    let cleanup: void | (() => void);
    await act(async () => {
      cleanup = captured.onShare!({ name });
    });
    expect(cleanup!).toBe(cancelReplacement);
    expect(cancelReplacement).not.toHaveBeenCalled();
    cleanup!();
    expect(cancelReplacement).toHaveBeenCalledOnce();
  },
);

it('keeps title scope bound to admitted content through a live destination URL and rejects a different admitted query scope', () => {
  const content = (listHref: string) =>
    view(
      <RouteContentIdentityContext value={{ pathname: '/inventory', listHref }}>
        <List />
      </RouteContentIdentityContext>,
    );
  const rendered = render(content('/inventory'));
  const source = screen.getByRole('link', { name: 'Cable row 2' });
  fireEvent.click(source);
  const name = source.getAttribute('data-test-transition-name');
  expect(name).toMatch(/^inventory-title-/);
  runtime.pathname = detailPath;
  rendered.rerender(content('/inventory'));
  expect(screen.getByRole('link', { name: 'Cable row 2' })).toBe(source);
  expect(source).toHaveAttribute('data-test-transition-name', name);
  rendered.rerender(content('/inventory?type=asset'));
  expect(screen.getByRole('link', { name: 'Cable row 2' })).toBe(source);
  expect(source).not.toHaveAttribute('data-test-transition-name');
});

it('failed paired geometry retires only its own title and generic arrival without canceling a newer navigation', () => {
  let motion!: ReturnType<typeof useRouteMotion>;
  let loading!: NonNullable<
    React.ContextType<typeof PairedRouteLoadingContext>
  >['store'];
  let pending!: NonNullable<
    React.ContextType<typeof RoutePendingContext>
  >['state'];
  function Capture() {
    const value = useRouteMotion();
    const scope = useContext(RoutePendingContext)!;
    const paired = useContext(PairedRouteLoadingContext)!;
    useLayoutEffect(() => {
      motion = value;
      pending = scope.state;
      loading = paired.store;
    });
    return null;
  }
  render(
    view(
      <>
        <Capture />
        <List />
      </>,
    ),
  );
  const source = screen.getByRole('link', { name: 'Cable row 2' });
  fireEvent.click(source);
  const first = motion.intent!;
  const arrival = motion.arrival;
  expect(arrival).not.toBeNull();
  // Native onShare runs only after the real primary has released its gate.
  act(() => {
    loading.ready(detailPath);
  });
  const epoch = pending.snapshot().epoch;
  const captured = runtime.boundaries.findLast(
    (boundary) => boundary.name === first.name,
  )!;
  act(() => {
    captured.onShare!({ name: first.name });
  });
  const reject = vi.mocked(sharedTitleMotion).mock.calls.at(-1)?.[2];
  expect(reject).toBeTypeOf('function');
  act(() => {
    reject!();
  });
  expect(motion.intent).toBeNull();
  expect(motion.arrival).toBeNull();
  expect(pending.snapshot().epoch).toBe(epoch);
  expect(screen.getByText('enabled')).toBeVisible();

  fireEvent.click(source);
  const next = motion.intent;
  const nextArrival = motion.arrival;
  expect(next).not.toBeNull();
  act(() => {
    reject!();
  });
  expect(motion.intent).toBe(next);
  expect(motion.arrival).toBe(nextArrival);
});

it('binds title pairing to the actual primary when the opaque router slot commits ahead of its outer pathname', () => {
  const listHref = '/inventory?type=quantity';
  let loading: React.ContextType<typeof PairedRouteLoadingContext>;
  function CaptureLoading() {
    const current = useContext(PairedRouteLoadingContext);
    useLayoutEffect(() => {
      loading = current;
    }, [current]);
    return null;
  }
  const content = (outer: string, primary: string, child: ReactNode) =>
    view(
      <>
        <CaptureLoading />
        <RouteContentIdentityContext
          value={{ pathname: outer.split('?')[0], listHref: outer }}
        >
          <RouteReady
            actorId="staff"
            routeKey={primary}
            contentIdentity={primary}
          >
            {child}
          </RouteReady>
        </RouteContentIdentityContext>
      </>,
    );
  runtime.query = 'type=quantity';
  const page = render(
    content(listHref, listHref, <List listHref={listHref} />),
  );
  fireEvent.click(screen.getByRole('link', { name: 'Cable row 2' }));
  const name = screen
    .getByRole('link', { name: 'Cable row 2' })
    .getAttribute('data-test-transition-name');
  expect(name).toMatch(/^inventory-title-/);
  runtime.pathname = detailPath;
  runtime.query = '';
  // Next's live router child replaces its primary before outer privacy admission.
  page.rerender(
    content(
      listHref,
      detailPath,
      <Detail returnHref={`${listHref}#inventory-row-2`} />,
    ),
  );
  expect(screen.getByRole('heading')).toHaveAttribute(
    'data-test-transition-name',
    name,
  );
  act(() => loading!.store.ready(detailPath));
  fireEvent.click(screen.getByRole('link', { name: 'Back to results' }));
  const backName = screen
    .getByRole('heading')
    .getAttribute('data-test-transition-name');
  expect(backName).toMatch(/^inventory-title-/);
  runtime.pathname = '/inventory';
  runtime.query = 'type=quantity';
  page.rerender(content(detailPath, listHref, <List listHref={listHref} />));
  expect(screen.getByRole('link', { name: 'Cable row 2' })).toHaveAttribute(
    'data-test-transition-name',
    backName,
  );
  // A stale outer match cannot authorize rows from a different actual query.
  page.rerender(
    content(listHref, '/inventory?type=asset', <List listHref={listHref} />),
  );
  expect(document.querySelectorAll('[data-test-transition-name]')).toHaveLength(
    0,
  );
});

it.each([true, false])(
  'matches reordered full-query values forward and Back with exactly one holding name (captured identity=%s)',
  (captured) => {
    const rawList = '/inventory?q=cable&type=quantity&page=2';
    const reordered = '/inventory?page=2&type=quantity&q=cable';
    const rawBack = `${rawList}#inventory-row-2`;
    let loading: React.ContextType<typeof PairedRouteLoadingContext>;
    function CaptureLoading() {
      const current = useContext(PairedRouteLoadingContext);
      useLayoutEffect(() => {
        loading = current;
      }, [current]);
      return null;
    }
    const content = (scope: string, child: ReactNode) => {
      const url = new URL(scope, location.origin);
      return view(
        <>
          <CaptureLoading />
          {captured ? (
            <RouteContentIdentityContext
              value={{
                pathname: url.pathname,
                listHref: routeKey(url.pathname, url.searchParams),
              }}
            >
              {child}
            </RouteContentIdentityContext>
          ) : (
            child
          )}
        </>,
      );
    };
    runtime.query = 'page=2&type=quantity&q=cable';
    const rendered = render(content(reordered, <List listHref={rawList} />));
    const source = screen.getByRole('link', { name: 'Cable row 2' });
    fireEvent.click(source);
    const forwardName = source.getAttribute('data-test-transition-name');
    expect(forwardName).toMatch(/^inventory-title-/);
    expect(
      document.querySelectorAll('[data-test-transition-name]'),
    ).toHaveLength(1);
    runtime.pathname = detailPath;
    runtime.query = '';
    rendered.rerender(content(detailPath, <Detail returnHref={rawBack} />));
    expect(screen.getByRole('heading')).toHaveAttribute(
      'data-test-transition-name',
      forwardName,
    );
    // This title-only adapter has no primary RouteReady wrapper.
    act(() => loading!.store.ready(detailPath));
    const back = screen.getByRole('link', { name: 'Back to results' });
    expect(back).toHaveAttribute('href', rawBack);
    fireEvent.click(back);
    const backName = screen
      .getByRole('heading')
      .getAttribute('data-test-transition-name');
    expect(backName).toMatch(/^inventory-title-/);
    expect(backName).not.toBe(forwardName);
    runtime.pathname = '/inventory';
    runtime.query = 'type=quantity&page=2&q=cable';
    rendered.rerender(content(reordered, <List listHref={reordered} />));
    expect(screen.getByRole('link', { name: 'Cable row 2' })).toHaveAttribute(
      'data-test-transition-name',
      backName,
    );
    expect(
      document.querySelectorAll('[data-test-transition-name]'),
    ).toHaveLength(1);
    runtime.query = 'page=2&type=quantity&q=other';
    rendered.rerender(
      content(
        '/inventory?page=2&type=quantity&q=other',
        <List listHref={rawList} />,
      ),
    );
    expect(
      document.querySelectorAll('[data-test-transition-name]'),
    ).toHaveLength(0);
  },
);

it('native Back clears title motion on an unanchored results entry without changing history', () => {
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
    expect(name).toBeNull();
    runtime.pathname = '/inventory';
    rerender(view(<List />));
    expect(
      screen.getByRole('link', { name: 'Cable row 2' }),
    ).not.toHaveAttribute('data-test-transition-name');
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

it.each(['router first', 'provider first'] as const)(
  'native Back/Forward never authorizes generic arrival with %s listeners',
  (order) => {
    const originalHref = location.href;
    const content = () =>
      view(
        <PageArrival pathname={runtime.pathname}>
          <input aria-label="Mounted draft" defaultValue="draft" />
          <RouteLink href="/history">Open History</RouteLink>
          <RouteLink href="/settings">Open Settings</RouteLink>
        </PageArrival>,
      );
    let page: ReturnType<typeof render>;
    const restore = () => {
      runtime.pathname = location.pathname;
      runtime.query = location.search.slice(1);
      // Model a router listener that commits synchronously before/after the
      // provider's capture listener, without changing Next or browser history.
      page.rerender(content());
    };
    const outer = () =>
      runtime.boundaries.filter((boundary) => boundary.enter !== undefined);
    try {
      window.history.replaceState(null, '', '/inventory?q=cable');
      runtime.query = 'q=cable';
      if (order === 'router first')
        window.addEventListener('popstate', restore, true);
      page = render(content());
      if (order === 'provider first')
        window.addEventListener('popstate', restore, true);
      const draft = screen.getByRole('textbox', { name: 'Mounted draft' });
      fireEvent.change(draft, { target: { value: 'keep editable' } });
      draft.focus();
      expect(outer().every((boundary) => boundary.enter === 'none')).toBe(true);
      fireEvent.click(screen.getByRole('link', { name: 'Open History' }));
      runtime.pathname = '/history';
      runtime.query = '';
      window.history.replaceState(null, '', '/history');
      page.rerender(content());
      expect(
        outer().some((boundary) => boundary.update === 'route-content'),
      ).toBe(true);
      expect(outer().at(-1)).toMatchObject({
        enter: 'none',
        exit: 'none',
        update: 'none',
      });

      for (const destination of ['/inventory?q=cable', '/history']) {
        runtime.boundaries = [];
        window.history.replaceState(null, '', destination);
        act(() => window.dispatchEvent(new PopStateEvent('popstate')));
        expect(outer().length).toBeGreaterThan(0);
        expect(
          outer().every(
            (boundary) =>
              boundary.enter === 'none' &&
              boundary.exit === 'none' &&
              boundary.update === 'none',
          ),
        ).toBe(true);
        expect(screen.getByRole('textbox', { name: 'Mounted draft' })).toBe(
          draft,
        );
        expect(draft).toHaveValue('keep editable');
        expect(draft).toHaveFocus();
        expect(screen.getByText('enabled')).toBeVisible();
      }

      // A new accepted gesture after native Forward can animate again.
      runtime.boundaries = [];
      fireEvent.click(screen.getByRole('link', { name: 'Open Settings' }));
      runtime.pathname = '/settings';
      window.history.replaceState(null, '', '/settings');
      page.rerender(content());
      expect(
        outer().some((boundary) => boundary.update === 'route-content'),
      ).toBe(true);
      runtime.boundaries = [];
      page.rerender(content());
      expect(outer().every((boundary) => boundary.update === 'none')).toBe(
        true,
      );
    } finally {
      window.removeEventListener('popstate', restore, true);
      window.history.replaceState(null, '', originalHref);
    }
  },
);

it('a fresh accepted repeat of the same URL animates once, while same-path query and refresh commits stay instant', () => {
  const fixture = () =>
    view(
      <PageArrival pathname={runtime.pathname}>
        <RouteLink href="/history">Open History</RouteLink>
        <RouteLink href="/inventory">Open Inventory</RouteLink>
        <RouteLink href="/history?q=cable">Filter History</RouteLink>
      </PageArrival>,
    );
  const page = render(fixture());
  for (const [label, pathname] of [
    ['Open History', '/history'],
    ['Open Inventory', '/inventory'],
    ['Open History', '/history'],
  ]) {
    fireEvent.click(screen.getByRole('link', { name: label }));
    runtime.boundaries = [];
    runtime.pathname = pathname;
    page.rerender(fixture());
    expect(
      runtime.boundaries.some(
        (boundary) => boundary.update === 'route-content',
      ),
    ).toBe(true);
    expect(
      runtime.boundaries.findLast((boundary) => boundary.enter !== undefined),
    ).toMatchObject({ enter: 'none', exit: 'none', update: 'none' });
  }
  fireEvent.click(screen.getByRole('link', { name: 'Filter History' }));
  runtime.boundaries = [];
  runtime.query = 'q=cable';
  page.rerender(fixture());
  expect(
    runtime.boundaries.some((boundary) => boundary.update === 'route-content'),
  ).toBe(false);
  runtime.boundaries = [];
  page.rerender(fixture());
  expect(
    runtime.boundaries.some((boundary) => boundary.update === 'route-content'),
  ).toBe(false);
});

it.each([
  { direction: 'Forward', lifetime: 'arrival and title' },
  { direction: 'Back', lifetime: 'arrival and title' },
  { direction: 'Forward', lifetime: 'title only' },
  { direction: 'Back', lifetime: 'title only' },
])(
  'early traversal retires all router-first native $direction boundaries with $lifetime active',
  ({ direction, lifetime }) => {
    const originalHref = location.href;
    let arrival!: ReturnType<typeof useRouteMotion>;
    let loading!: React.ContextType<typeof PairedRouteLoadingContext>;
    function CaptureArrival() {
      const motion = useRouteMotion();
      const paired = useContext(PairedRouteLoadingContext);
      useLayoutEffect(() => {
        arrival = motion;
        loading = paired;
      }, [motion, paired]);
      return null;
    }
    const fixture = () =>
      view(
        <>
          <CaptureArrival />
          <PageArrival pathname={runtime.pathname}>
            {runtime.pathname === detailPath ? <Detail /> : <List />}
          </PageArrival>
        </>,
      );
    let page: ReturnType<typeof render>;
    let beforeProviderPop: (typeof runtime.boundaries)[number][] = [];
    const restore = () => {
      runtime.pathname = location.pathname;
      runtime.query = location.search.slice(1);
      // Explicit synchronous commit reproduces the installed router-first
      // restore; ordinary act batching would mask the pre-provider window.
      flushSync(() => page.rerender(fixture()));
      beforeProviderPop = [...runtime.boundaries];
    };
    window.addEventListener('popstate', restore, true);
    try {
      // History [B, A]: while an accepted A -> B request is still uncommitted,
      // native Back may restore B without any new application gesture.
      window.history.replaceState(null, '', '/inventory');
      page = render(fixture());
      fireEvent.click(screen.getByRole('link', { name: 'Cable row 2' }));
      const commit = (pathname: string) => {
        runtime.pathname = pathname;
        window.history.replaceState(null, '', pathname);
        page.rerender(fixture());
        act(() => loading!.store.ready(pathname));
      };
      if (direction === 'Back' || lifetime === 'title only') commit(detailPath);
      if (direction === 'Back' && lifetime === 'arrival and title')
        fireEvent.click(screen.getByRole('link', { name: 'Back to results' }));
      if (direction === 'Forward' && lifetime === 'title only') {
        fireEvent.click(screen.getByRole('link', { name: 'Back to results' }));
        commit('/inventory');
      }
      expect(arrival.arrivalEnabled).toBe(false);
      expect(arrival.pairedArrivalEnabled).toBe(true);
      expect(arrival.intent?.name).toMatch(/^inventory-title-/);
      const oldName = arrival.intent!.name;

      runtime.boundaries = [];
      const destination = direction === 'Forward' ? detailPath : '/inventory';
      window.history.replaceState(null, '', destination);
      const traversal = new Event('navigate');
      Object.defineProperty(traversal, 'navigationType', { value: 'traverse' });
      act(() => runtime.navigation!.dispatchEvent(traversal));
      expect(arrival.intent).toBeNull();
      expect(arrival.arrival).toBeNull();
      act(() => window.dispatchEvent(new PopStateEvent('popstate')));
      expect(beforeProviderPop.length).toBeGreaterThan(0);
      expect(arrival.arrival).toBeNull();
      expect(arrival.arrivalEnabled).toBe(false);

      // The later pop cleanup must retain the approved origin independently.
      runtime.pathname = detailPath;
      page.rerender(fixture());
      expect(screen.getByRole('heading')).not.toHaveAttribute(
        'data-test-transition-name',
      );
      fireEvent.click(screen.getByRole('link', { name: 'Back to results' }));
      expect(
        screen.getByRole('heading').getAttribute('data-test-transition-name'),
      ).toMatch(/^inventory-title-/);
      expect(
        screen.getByRole('heading').getAttribute('data-test-transition-name'),
      ).not.toBe(oldName);

      expect(
        beforeProviderPop.every(
          (boundary) =>
            boundary.name === undefined &&
            boundary.share !== 'record-title' &&
            ![boundary.enter, boundary.exit, boundary.update].includes(
              'route-content',
            ),
        ),
      ).toBe(true);
      for (const boundary of beforeProviderPop) {
        if (boundary.share !== undefined)
          expect(boundary).toMatchObject({ share: 'none', name: undefined });
        if (boundary.enter !== undefined)
          expect(boundary).toMatchObject({
            enter: 'none',
            exit: 'none',
            update: 'none',
          });
      }
    } finally {
      window.removeEventListener('popstate', restore, true);
      window.history.replaceState(null, '', originalHref);
    }
  },
);

it.each(['missing API', 'registration throws', 'access throws'] as const)(
  'all route motion stays instant when the early traversal observer has %s, preserving functional app Back',
  (failure) => {
    const remove = vi.spyOn(runtime.navigation!, 'removeEventListener');
    if (failure === 'missing API') Reflect.deleteProperty(window, 'navigation');
    if (failure === 'registration throws')
      vi.spyOn(runtime.navigation!, 'addEventListener').mockImplementation(
        () => {
          throw new Error('Observer unavailable');
        },
      );
    if (failure === 'access throws')
      Object.defineProperty(window, 'navigation', {
        configurable: true,
        get: () => {
          throw new Error('Navigation unavailable');
        },
      });
    const fixture = () =>
      view(
        <PageArrival pathname={runtime.pathname}>
          {runtime.pathname === detailPath ? <Detail /> : <List />}
        </PageArrival>,
      );
    const page = render(fixture());
    runtime.boundaries = [];
    fireEvent.click(screen.getByRole('link', { name: 'Cable row 2' }));
    const name = screen
      .getByRole('link', { name: 'Cable row 2' })
      .getAttribute('data-test-transition-name');
    expect(name).toBeNull();
    runtime.pathname = detailPath;
    page.rerender(fixture());
    expect(screen.getByRole('heading')).not.toHaveAttribute(
      'data-test-transition-name',
    );
    fireEvent.click(screen.getByRole('link', { name: 'Back to results' }));
    expect(
      screen.getByRole('link', { name: 'Back to results' }),
    ).toHaveAttribute('href', returnTo);
    runtime.pathname = '/inventory';
    page.rerender(fixture());
    expect(screen.getByRole('link', { name: 'Cable row 2' })).toBeVisible();
    expect(
      runtime.boundaries
        .filter((boundary) => boundary.share !== undefined)
        .every(
          (boundary) =>
            boundary.share === 'none' && boundary.name === undefined,
        ),
    ).toBe(true);
    expect(
      runtime.boundaries
        .filter((boundary) => boundary.enter !== undefined)
        .every(
          (boundary) =>
            boundary.enter === 'none' &&
            boundary.exit === 'none' &&
            boundary.update === 'none',
        ),
    ).toBe(true);
    expect(screen.getByText('instant')).toBeVisible();
    if (failure === 'registration throws')
      expect(remove).toHaveBeenCalledOnce();
  },
);

it('the passive early observer ignores application events and withdraws route/title motion on canceled traversal', () => {
  let motion!: ReturnType<typeof useRouteMotion>;
  let loading!: React.ContextType<typeof PairedRouteLoadingContext>;
  let pending!: NonNullable<
    React.ContextType<typeof RoutePendingContext>
  >['state'];
  function CaptureArrival() {
    const current = useRouteMotion();
    const paired = useContext(PairedRouteLoadingContext);
    const state = useContext(RoutePendingContext)!.state;
    useLayoutEffect(() => {
      motion = current;
      loading = paired;
      pending = state;
    }, [current, paired, state]);
    return null;
  }
  render(
    view(
      <>
        <CaptureArrival />
        <PageArrival pathname={runtime.pathname}>
          <List />
        </PageArrival>
      </>,
    ),
  );
  fireEvent.click(screen.getByRole('link', { name: 'Cable row 2' }));
  const approved = motion.arrival;
  const pair = loading!.store.snapshot();
  const epoch = pending.snapshot().epoch;
  const name = screen
    .getByRole('link', { name: 'Cable row 2' })
    .getAttribute('data-test-transition-name');
  expect(approved).not.toBeNull();
  expect(pair).not.toBeNull();
  for (const type of ['push', 'replace', 'reload', 'traverse']) {
    const event = new Event('navigate', { cancelable: true });
    Object.defineProperty(event, 'navigationType', { value: type });
    const intercept = vi.fn();
    Object.defineProperty(event, 'intercept', { value: intercept });
    const prevent = vi.spyOn(event, 'preventDefault');
    act(() => runtime.navigation!.dispatchEvent(event));
    expect(intercept).not.toHaveBeenCalled();
    expect(prevent).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
    expect(motion.arrival).toBe(type === 'traverse' ? null : approved);
    expect(loading!.store.snapshot()).toBe(pair);
    expect(pending.snapshot().epoch).toBe(epoch);
    if (type === 'traverse')
      expect(
        screen.getByRole('link', { name: 'Cable row 2' }),
      ).not.toHaveAttribute('data-test-transition-name');
    else
      expect(screen.getByRole('link', { name: 'Cable row 2' })).toHaveAttribute(
        'data-test-transition-name',
        name,
      );
    expect(document.documentElement.dataset.routeMotionPrivate).toBe('true');
  }
  // A canceled traversal never revives its old approval. A new accepted event
  // can allocate a fresh generic arrival without changing application routing.
  fireEvent.click(screen.getByRole('link', { name: 'Cable row 1' }));
  expect(motion.arrival).not.toBeNull();
  expect(motion.arrival).not.toBe(approved);
  expect(motion.arrivalEnabled).toBe(true);
});

it('cleanup removes the early observer and a retired provider callback cannot withdraw replacement arrival', () => {
  const add = vi.spyOn(runtime.navigation!, 'addEventListener');
  const remove = vi.spyOn(runtime.navigation!, 'removeEventListener');
  let motion!: ReturnType<typeof useRouteMotion>;
  function CaptureArrival() {
    const current = useRouteMotion();
    useLayoutEffect(() => {
      motion = current;
    }, [current]);
    return null;
  }
  const fixture = (actor: string) =>
    view(
      <>
        <CaptureArrival />
        <PageArrival pathname={runtime.pathname}>
          <List />
        </PageArrival>
      </>,
      actor,
    );
  const page = render(fixture('staff'));
  const old = add.mock.calls.find(
    ([type]) => type === 'navigate',
  )![1] as EventListener;
  fireEvent.click(screen.getByRole('link', { name: 'Cable row 2' }));
  page.rerender(fixture('replacement'));
  expect(remove).toHaveBeenCalledWith('navigate', old);
  fireEvent.click(screen.getByRole('link', { name: 'Cable row 2' }));
  const replacement = motion.arrival;
  expect(replacement).not.toBeNull();
  const event = new Event('navigate');
  Object.defineProperty(event, 'navigationType', { value: 'traverse' });
  act(() => old(event));
  expect(motion.arrival).toBe(replacement);
  expect(motion.arrivalEnabled).toBe(false);
  expect(motion.pairedArrivalEnabled).toBe(true);
  act(() => runtime.navigation!.dispatchEvent(event));
  expect(motion.arrival).toBeNull();
  const current = add.mock.calls.findLast(
    ([type]) => type === 'navigate',
  )![1] as EventListener;
  page.unmount();
  expect(remove).toHaveBeenCalledWith('navigate', current);
  const rendered = runtime.boundaries.length;
  act(() => current(event));
  expect(runtime.boundaries).toHaveLength(rendered);
});

it('native retirement keeps real destination readiness and a fresh app Back title after native Forward', () => {
  const originalHref = location.href;
  const rects = vi
    .spyOn(HTMLElement.prototype, 'getClientRects')
    .mockReturnValue([{ width: 30, height: 20 }] as unknown as DOMRectList);
  let pending!: NonNullable<
    React.ContextType<typeof RoutePendingContext>
  >['state'];
  function CapturePending() {
    const current = useContext(RoutePendingContext)!.state;
    useLayoutEffect(() => {
      pending = current;
    }, [current]);
    return null;
  }
  let primaryReady = true;
  let primaryKey = '/inventory';
  const fixture = () =>
    view(
      <>
        <CapturePending />
        <PageArrival pathname={runtime.pathname}>
          <RouteReady
            actorId="staff"
            routeKey={primaryKey}
            contentIdentity="real-primary"
            ready={primaryReady}
            pairedInventory
          >
            {runtime.pathname === detailPath ? <Detail /> : <List />}
          </RouteReady>
        </PageArrival>
      </>,
    );
  try {
    window.history.replaceState(null, '', '/inventory');
    const page = render(fixture());
    fireEvent.click(screen.getByRole('link', { name: 'Cable row 2' }));
    const forwardName = screen
      .getByRole('link', { name: 'Cable row 2' })
      .getAttribute('data-test-transition-name');
    runtime.pathname = detailPath;
    primaryKey = detailPath;
    window.history.replaceState(null, '', detailPath);
    page.rerender(fixture());
    expect(screen.getByRole('heading')).toHaveAttribute(
      'data-test-transition-name',
      forwardName,
    );

    runtime.boundaries = [];
    primaryReady = false;
    window.history.replaceState(null, '', '/inventory?q=cable');
    act(() => window.dispatchEvent(new PopStateEvent('popstate')));
    runtime.pathname = '/inventory';
    runtime.query = 'q=cable';
    primaryKey = '/inventory?q=other';
    page.rerender(fixture());
    expect(pending.snapshot().pending).toBe(true);
    primaryReady = true;
    page.rerender(fixture());
    expect(pending.snapshot().pending).toBe(true);
    primaryKey = '/inventory?q=cable';
    page.rerender(fixture());
    expect(pending.snapshot().pending).toBe(false);
    expect(
      runtime.boundaries.every(
        (boundary) => boundary.update !== 'route-content',
      ),
    ).toBe(true);

    runtime.boundaries = [];
    window.history.replaceState(null, '', detailPath);
    act(() => window.dispatchEvent(new PopStateEvent('popstate')));
    runtime.pathname = detailPath;
    runtime.query = '';
    primaryKey = detailPath;
    page.rerender(fixture());
    expect(pending.snapshot().pending).toBe(false);
    expect(screen.getByRole('heading')).not.toHaveAttribute(
      'data-test-transition-name',
    );
    expect(
      runtime.boundaries.every(
        (boundary) => boundary.update !== 'route-content',
      ),
    ).toBe(true);

    fireEvent.click(screen.getByRole('link', { name: 'Back to results' }));
    const backName = screen
      .getByRole('heading')
      .getAttribute('data-test-transition-name');
    expect(backName).toMatch(/^inventory-title-/);
    expect(backName).not.toBe(forwardName);
    runtime.boundaries = [];
    runtime.pathname = '/inventory';
    primaryKey = '/inventory';
    window.history.replaceState(null, '', '/inventory#inventory-row-2');
    page.rerender(fixture());
    expect(screen.getByRole('link', { name: 'Cable row 2' })).toHaveAttribute(
      'data-test-transition-name',
      backName,
    );
    expect(
      runtime.boundaries.some(
        (boundary) =>
          boundary.name === backName + '-content' &&
          boundary.share === 'route-content',
      ),
    ).toBe(true);
  } finally {
    rects.mockRestore();
    window.history.replaceState(null, '', originalHref);
  }
});

it('app Back reuses the approved holding and scope, and a changed record falls back', () => {
  let loading: React.ContextType<typeof PairedRouteLoadingContext>;
  function CaptureLoading() {
    const current = useContext(PairedRouteLoadingContext);
    useLayoutEffect(() => {
      loading = current;
    }, [current]);
    return null;
  }
  const { rerender } = render(
    view(
      <>
        <CaptureLoading />
        <List />
      </>,
    ),
  );
  fireEvent.click(screen.getByRole('link', { name: 'Cable row 2' }));
  runtime.pathname = detailPath;
  rerender(view(<Detail />));
  // This title-only fixture has no RouteReady wrapper. Explicitly settle its
  // simulated primary before Back; actual readiness is covered by paired-route.
  act(() => loading!.store.ready(detailPath));
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
  act(() => loading!.store.ready('/inventory'));
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
  'app Back matches the initiating stable holding when $change',
  ({ holdings, matchedRow }) => {
    const originalHref = location.href;
    window.history.replaceState(null, '', '/inventory');
    try {
      const { rerender } = render(view(<List />));
      fireEvent.click(screen.getByRole('link', { name: 'Cable row 2' }));
      runtime.pathname = detailPath;
      rerender(view(<Detail />));
      let loading!: React.ContextType<typeof PairedRouteLoadingContext>;
      function SettlePrimary() {
        const current = useContext(PairedRouteLoadingContext);
        useLayoutEffect(() => {
          loading = current;
        }, [current]);
        return null;
      }
      rerender(
        view(
          <>
            <SettlePrimary />
            <Detail />
          </>,
        ),
      );
      act(() => loading!.store.ready(detailPath));
      fireEvent.click(screen.getByRole('link', { name: 'Back to results' }));
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
      ).toBeNull();
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
      expect(oldName).toBeNull();
      if (canceled) {
        fireEvent.click(screen.getByRole('link', { name: 'Canceled capture' }));
        expect(
          screen.getByRole('link', { name: 'Cable row 2' }),
        ).not.toHaveAttribute('data-test-transition-name');
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

it.each([
  'live',
  'finished',
  'later navigation',
  'no handoff',
  'actor replacement',
  'privacy generation',
  'logout',
] as const)(
  'an unmounted action can deny only its exact outgoing native presentation (%s)',
  async (lifetime) => {
    let settle!: (result: { ok: false; code: string }) => void;
    const action = new Promise<{ ok: false; code: string }>((resolve) => {
      settle = resolve;
    });
    let observed: Promise<{ ok: false; code: string }> | undefined;
    function SourceAction() {
      const observe = useRouteActionResult();
      return (
        <button
          onClick={() => {
            observed = observe(action);
          }}
        >
          Start observed action
        </button>
      );
    }
    const skipTransition = vi.fn();
    Object.defineProperty(document, 'activeViewTransition', {
      configurable: true,
      value: { skipTransition },
    });
    try {
      const fixture = (contents: ReactNode, actor = 'staff') =>
        view(
          <PageArrival pathname={runtime.pathname}>{contents}</PageArrival>,
          actor,
        );
      const page = render(
        fixture(
          <>
            <SourceAction />
            <RouteLink href="/history">Go history</RouteLink>
          </>,
        ),
      );
      fireEvent.click(
        screen.getByRole('button', { name: 'Start observed action' }),
      );
      fireEvent.click(screen.getByRole('link', { name: 'Go history' }));
      runtime.pathname = '/history';
      page.rerender(
        fixture(<RouteLink href="/settings">Go settings</RouteLink>),
      );
      expect(
        screen.queryByRole('button', { name: 'Start observed action' }),
      ).not.toBeInTheDocument();
      const callback = runtime.boundaries.findLast(
        (boundary) => boundary.update === 'route-content',
      )?.onUpdate;
      expect(callback).toBeDefined();
      let finish: (() => void) | undefined;
      if (lifetime !== 'no handoff')
        act(() => {
          finish =
            callback!({ name: 'exact-outgoing-source' }, []) || undefined;
        });
      if (lifetime !== 'no handoff') expect(finish).toBeTypeOf('function');
      if (lifetime === 'finished') act(() => finish!());
      if (lifetime === 'later navigation')
        fireEvent.click(screen.getByRole('link', { name: 'Go settings' }));
      if (lifetime === 'actor replacement')
        page.rerender(fixture(<p>New actor content</p>, 'replacement'));
      if (lifetime === 'privacy generation')
        page.rerender(
          view(
            <PageArrival pathname={runtime.pathname}>
              <p>Reverified generation</p>
            </PageArrival>,
            'staff',
            'new-generation',
          ),
        );
      if (lifetime === 'logout')
        act(() => runtime.callbacks.at(-1)!('SIGNED_OUT', null));
      const priorSkips = skipTransition.mock.calls.length;
      const denied = { ok: false as const, code: 'forbidden' };
      await act(async () => {
        settle(denied);
        expect(await observed).toBe(denied);
      });
      expect(skipTransition.mock.calls.length).toBe(
        lifetime === 'live' ? priorSkips + 1 : priorSkips,
      );
      if (lifetime === 'live')
        expect(document.documentElement.dataset.routeMotionPrivate).toBe(
          'false',
        );
      // Native callback cleanup is exact and harmless even after provider retirement.
      act(() => finish?.());
    } finally {
      Reflect.deleteProperty(document, 'activeViewTransition');
    }
  },
);

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

it('finishes streaming intents, keeps only a valid exact app Back origin, and never rearms invalidated state', () => {
  const state = createRouteMotionState();
  const target = titleTarget(record, returnTo, initiatingHolding)!;
  state.arm(target);
  const firstName = state.snapshot()!.name;
  state.finish();
  expect(state.backTarget(record, '/inventory#inventory-row-1')).toBeNull();
  expect(
    state.backTarget({ ...record, id: 'different-record' }, returnTo),
  ).toBeNull();
  expect(
    state.backTarget(record, '/inventory?q=changed#inventory-row-2'),
  ).toBeNull();
  const approved = state.backTarget(record, returnTo)!;
  expect(approved).toEqual(target);
  state.arm(approved);
  expect(state.snapshot()!.name).not.toBe(firstName);
  state.invalidate();
  state.arm(target);
  expect(state.backTarget(record, returnTo)).toBeNull();
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
  expect(state.backTarget(record, returnTo)).toBeNull();
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

it('shares the measured record heading while disclosure keeps one stable accessible h1 and a non-participating probe', async () => {
  const spies = [
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(300),
    vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockReturnValue(300),
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(100),
    vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockReturnValue(180),
  ];
  const probes: HTMLElement[] = [];
  const append = document.body.append.bind(document.body);
  const appendSpy = vi
    .spyOn(document.body, 'append')
    .mockImplementation((...nodes) => {
      nodes.forEach((node) => {
        if (
          node instanceof HTMLElement &&
          node.getAttribute('aria-hidden') === 'true'
        )
          probes.push(node);
      });
      append(...nodes);
    });
  try {
    const rendered = render(view(<List />));
    fireEvent.click(screen.getByRole('link', { name: 'Cable row 2' }));
    const name = screen
      .getByRole('link', { name: 'Cable row 2' })
      .getAttribute('data-test-transition-name');
    runtime.pathname = detailPath;
    rendered.rerender(
      view(<RecordName record={record} name={'Cable '.repeat(35)} />),
    );
    const heading = screen.getByRole('heading');
    expect(heading).toHaveAttribute('data-test-transition-name', name);
    expect(heading).toHaveAttribute(
      'data-test-transition-share',
      'record-title',
    );
    const toggle = screen.getByRole('button', { name: 'Show full name' });
    expect(toggle).toHaveAttribute('aria-controls', heading.id);
    toggle.focus();
    fireEvent.click(toggle);
    expect(screen.getByRole('button', { name: 'Show less' })).toHaveFocus();
    expect(screen.getByRole('heading')).toBe(heading);
    expect(document.querySelectorAll('h1')).toHaveLength(1);
    expect(probes).toHaveLength(1);
    expect(probes[0].style.viewTransitionName).toBe('none');
    expect(probes[0].isConnected).toBe(false);
    fireEvent.click(toggle);
    expect(screen.getByRole('heading')).toBe(heading);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
  } finally {
    appendSpy.mockRestore();
    spies.forEach((spy) => spy.mockRestore());
  }
});
