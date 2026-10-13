import {
  Activity,
  Component,
  StrictMode,
  Suspense,
  createContext,
  startTransition,
  useContext,
  useLayoutEffect,
  useState,
  type ReactNode,
} from 'react';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { flushSync } from 'react-dom';
import { RedirectBoundary } from 'next/dist/client/components/redirect-boundary';
import { getRedirectError } from 'next/dist/client/components/redirect';
import { isRedirectError } from 'next/dist/client/components/redirect-error';
import { AppRouterContext } from 'next/dist/shared/lib/app-router-context.shared-runtime';
import { PrivacyReadinessContext } from '@/components/auth/privacy-readiness';
import { ProtectedPrivacyBoundary } from '@/components/auth/auth-privacy';
import { ProtectedPrivacyContent } from '@/components/auth/privacy-content';
import {
  assignmentEpoch,
  readPrivacyRevocationRevision,
  revokePrivatePresentation,
} from '@/features/scan/assign-batch';
import { RouteMotionProvider } from './route-motion';
import { ProtectedRouteArrival } from './protected-route-arrival';
import {
  InventoryRecordLink,
  InventoryBackLink,
  RecordTitle,
} from './record-transition';
import RouteLink from './route-link';
import {
  RouteLoading,
  RoutePendingContext,
  RoutePendingTerminal,
} from './route-pending';
import { RouteReady } from './route-ready';
import { PairedRouteLoadingContext } from './paired-route-loading';
import InventoryLoading from '@/app/(protected)/inventory/loading';
import QuantityLoading from '@/app/(protected)/inventory/quantity/[id]/loading';
import { createPairedRouteLoading } from './paired-route-loading-state';
import { createRoutePendingState } from './route-pending-state';
import { routeKey } from './route-key';

const runtime = vi.hoisted(() => ({
  route: () => ({ pathname: '/inventory', query: '' }),
  navigate: (href: string) => {
    void href;
  },
  restoreSync: (href: string) => {
    void href;
  },
  auth: (event: string, session: { user: { id: string } } | null) => {
    void event;
    void session;
  },
  read: vi.fn(),
  compare: vi.fn(),
  identity: vi.fn(),
  titleNames: {} as Record<string, string | undefined>,
  detailName: undefined as string | undefined,
}));
vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  return {
    ...actual,
    ViewTransition: (props: import('react').ViewTransitionProps) => {
      const child = props.children as
        { type?: string; props?: { href?: string } } | undefined;
      const href = child?.props?.href;
      actual.useLayoutEffect(() => {
        if (href) runtime.titleNames[href] = props.name;
        if (child?.type === 'h1') runtime.detailName = props.name;
      });
      return props.children;
    },
  };
});
vi.mock('@/lib/auth/actions', () => ({
  readLogoutPrivacyGeneration: runtime.read,
  acknowledgeLogoutPrivacyGeneration: runtime.compare,
  readProtectedPrivacyIdentity: runtime.identity,
}));
vi.mock('@/lib/auth/privacy-read-transport', () => ({
  readLogoutPrivacyGeneration: runtime.read,
  acknowledgeLogoutPrivacyGeneration: runtime.compare,
  readProtectedPrivacyIdentity: runtime.identity,
}));
vi.mock('@/lib/auth/logout-transport', () => ({
  readLogoutPrivacyGeneration: runtime.read,
  acknowledgeLogoutPrivacyGeneration: runtime.compare,
  readProtectedPrivacyIdentity: runtime.identity,
}));
vi.mock('next/navigation', () => ({
  usePathname: () => runtime.route().pathname,
  useSearchParams: () => new URLSearchParams(runtime.route().query),
  useRouter: () => ({}),
}));
vi.mock('@/lib/supabase/browser', () => ({
  createSupabaseBrowserClient: () => ({
    auth: {
      onAuthStateChange: (callback: typeof runtime.auth) => {
        runtime.auth = callback;
        return { data: { subscription: { unsubscribe: () => {} } } };
      },
    },
  }),
}));
vi.mock('next/link', () => ({
  useLinkStatus: () => ({ pending: false }),
  default: ({
    href,
    onNavigate,
    children,
    ...props
  }: {
    href: string;
    onNavigate?: (event: { preventDefault: () => void }) => void;
    children: ReactNode;
  }) => (
    <a
      {...props}
      href={href}
      onClick={(event) => {
        event.preventDefault();
        let prevented = false;
        onNavigate?.({
          preventDefault: () => {
            prevented = true;
          },
        });
        if (!prevented) runtime.navigate(href);
      }}
    >
      {children}
    </a>
  ),
}));
const record = { kind: 'quantity' as const, id: 'cable' };
const list = '/inventory?type=quantity';
const detail =
  '/inventory/quantity/cable?returnTo=%2Finventory%3Ftype%3Dquantity%23inventory-row-1';
const secondRecord = { kind: 'quantity' as const, id: 'other-cable' };
const secondDetail =
  '/inventory/quantity/other-cable?returnTo=%2Finventory%3Ftype%3Dquantity%23inventory-row-2';
const NavigationContext = createContext({
  pathname: '/inventory',
  query: 'type=quantity',
});
runtime.route = function useRoute() {
  return useContext(NavigationContext);
};
let gate: NonNullable<React.ContextType<typeof PairedRouteLoadingContext>>;
let pending: NonNullable<React.ContextType<typeof RoutePendingContext>>;
let mountedPrivacy: React.ContextType<typeof PrivacyReadinessContext>;
function Controls() {
  const currentGate = useContext(PairedRouteLoadingContext)!;
  const currentPending = useContext(RoutePendingContext)!;
  const currentPrivacy = useContext(PrivacyReadinessContext);
  useLayoutEffect(() => {
    gate = currentGate;
    pending = currentPending;
    mountedPrivacy = currentPrivacy;
  });
  return <RouteLink href="/history">Other route</RouteLink>;
}
function deferred() {
  let ready = false,
    failed = false;
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return {
    settled: () => ready,
    read: () => {
      if (!ready) throw promise;
      if (failed) throw new Error('Read failed');
    },
    resolve: async () => {
      ready = true;
      resolve();
      await promise;
    },
    reject: async () => {
      failed = true;
      ready = true;
      resolve();
      await promise;
    },
  };
}
class Boundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError(error: unknown) {
    if (isRedirectError(error)) throw error;
    return { failed: true };
  }
  render() {
    return this.state.failed ? (
      <>
        <RoutePendingTerminal />
        <p role="alert">Read failed</p>
      </>
    ) : (
      this.props.children
    );
  }
}
function Source({
  read,
  destination = list,
  redirectTo,
  listHref = list,
}: {
  read?: () => void;
  destination?: string;
  redirectTo?: string;
  listHref?: string;
}) {
  read?.();
  if (redirectTo) throw getRedirectError(redirectTo, 'replace');
  useLayoutEffect(
    () => () => {
      sourceRetirements++;
    },
    [],
  );
  const destinationURL = new URL(destination, location.origin);
  return (
    <RouteReady
      actorId="staff"
      routeKey={routeKey(destinationURL.pathname, destinationURL.searchParams)}
      contentIdentity="list-primary"
    >
      <div id="inventory-row-1">
        <InventoryRecordLink
          record={record}
          holding={{ domain: 'storage', id: 'shelf' }}
          returnTo={listHref + '#inventory-row-1'}
          href={`/inventory/quantity/cable?returnTo=${encodeURIComponent(listHref + '#inventory-row-1')}`}
        >
          Source cable title
        </InventoryRecordLink>
      </div>
      <input aria-label="Business draft" defaultValue="retained draft" />
      <div id="inventory-row-2">
        <InventoryRecordLink
          record={secondRecord}
          holding={{ domain: 'storage', id: 'shelf' }}
          returnTo={listHref + '#inventory-row-2'}
          href={`/inventory/quantity/other-cable?returnTo=${encodeURIComponent(listHref + '#inventory-row-2')}`}
        >
          Other cable title
        </InventoryRecordLink>
      </div>
    </RouteReady>
  );
}
function Detail({
  work,
  destination = detail,
  redirectTo,
  listHref = list,
}: {
  work: ReturnType<typeof deferred>;
  destination?: string;
  redirectTo?: string;
  listHref?: string;
}) {
  work.read();
  if (redirectTo) throw getRedirectError(redirectTo, 'replace');
  const isFirst =
    new URL(destination, location.origin).pathname ===
    '/inventory/quantity/cable';
  return (
    <RouteReady
      actorId="staff"
      routeKey={destination}
      contentIdentity="detail-primary"
    >
      <RecordTitle record={isFirst ? record : secondRecord}>
        {isFirst ? 'Authorized detail title' : 'Second authorized detail title'}
      </RecordTitle>
      <InventoryBackLink record={record} href={listHref + '#inventory-row-1'}>
        Back to results
      </InventoryBackLink>
    </RouteReady>
  );
}
function GatedPrimary({
  work,
  routeKey,
}: {
  work: ReturnType<typeof deferred>;
  routeKey: string;
}) {
  // Like the server page, finish the primary read before returning its success gate.
  work.read();
  return (
    <ProtectedPrivacyContent routeKey={routeKey}>
      <Detail work={work} />
    </ProtectedPrivacyContent>
  );
}
function OpaqueRouterSlot({
  work,
  cache = false,
}: {
  work: ReturnType<typeof deferred>;
  cache?: boolean;
}) {
  const route = useContext(NavigationContext);
  const href = route.pathname + (route.query ? `?${route.query}` : '');
  const isDetail = route.pathname.startsWith('/inventory/quantity/');
  if (cache)
    return (
      <>
        <Activity mode={isDetail ? 'hidden' : 'visible'}>
          <Boundary>
            <Suspense fallback={<InventoryLoading />}>
              <ProtectedPrivacyContent routeKey={list}>
                <Source />
              </ProtectedPrivacyContent>
            </Suspense>
          </Boundary>
        </Activity>
        <Activity mode={isDetail ? 'visible' : 'hidden'}>
          <Boundary>
            <Suspense fallback={<QuantityLoading />}>
              <GatedPrimary work={work} routeKey={detail} />
            </Suspense>
          </Boundary>
        </Activity>
      </>
    );
  return (
    <Boundary key={href}>
      <Suspense
        key={href}
        fallback={isDetail ? <QuantityLoading /> : <InventoryLoading />}
      >
        {isDetail ? (
          <GatedPrimary
            work={work}
            routeKey={routeKey(
              route.pathname,
              new URLSearchParams(route.query),
            )}
          />
        ) : (
          <ProtectedPrivacyContent
            routeKey={routeKey(
              route.pathname,
              new URLSearchParams(route.query),
            )}
          >
            <Source />
          </ProtectedPrivacyContent>
        )}
      </Suspense>
    </Boundary>
  );
}
function Router({
  work,
  back,
  privacy,
  pairedFallback = true,
  actualPrivacy = false,
  opaqueSlot = false,
  cacheSlot = false,
  secondWork,
  redirectTo,
  backRedirectTo,
  listHref = list,
}: {
  work: ReturnType<typeof deferred>;
  back?: ReturnType<typeof deferred>;
  privacy: ReturnType<typeof grant>;
  pairedFallback?: boolean;
  actualPrivacy?: boolean;
  opaqueSlot?: boolean;
  cacheSlot?: boolean;
  secondWork?: ReturnType<typeof deferred>;
  redirectTo?: string;
  backRedirectTo?: string;
  listHref?: string;
}) {
  const [href, setHref] = useState(listHref);
  const [stableSlot] = useState(() => (
    <OpaqueRouterSlot work={work} cache={cacheSlot} />
  ));
  useLayoutEffect(() => {
    runtime.restoreSync = (next) => {
      const destination = new URL(next, location.origin);
      setHref(destination.pathname + destination.search);
    };
    runtime.navigate = (next) => {
      const destination = new URL(next, location.origin);
      if (destination.pathname + destination.search === href) return;
      history.replaceState(null, '', next);
      startTransition(() => {
        setHref(destination.pathname + destination.search);
      });
    };
  });
  const inner = href.startsWith('/inventory/quantity/') ? (
    <Detail
      work={href === secondDetail ? (secondWork ?? work) : work}
      destination={href}
      redirectTo={redirectTo}
      listHref={listHref}
    />
  ) : href.startsWith('/inventory') ? (
    <Source
      read={href === listHref && workDone ? back?.read : undefined}
      destination={href}
      redirectTo={href === listHref && workDone ? backRedirectTo : undefined}
      listHref={listHref}
    />
  ) : (
    <RouteReady actorId="staff" routeKey={href} contentIdentity="other-primary">
      <h1>Other destination</h1>
    </RouteReady>
  );
  const url = new URL(href, location.origin);
  const body = (
    <RouteMotionProvider actorId="staff">
      <Controls />
      <RedirectBoundary>
        <ProtectedRouteArrival>
          {opaqueSlot ? (
            stableSlot
          ) : (
            <Boundary key={href}>
              <Suspense
                key={href}
                fallback={
                  !pairedFallback ? (
                    <RouteLoading shape="record" />
                  ) : href.startsWith('/inventory/quantity/') ? (
                    <QuantityLoading />
                  ) : (
                    <InventoryLoading />
                  )
                }
              >
                {inner}
              </Suspense>
            </Boundary>
          )}
        </ProtectedRouteArrival>
      </RedirectBoundary>
    </RouteMotionProvider>
  );
  return (
    <AppRouterContext
      value={
        {
          push: (next: string) => runtime.navigate(next),
          replace: (next: string) => runtime.navigate(next),
        } as React.ContextType<typeof AppRouterContext>
      }
    >
      <NavigationContext
        value={{ pathname: url.pathname, query: url.search.slice(1) }}
      >
        {actualPrivacy ? (
          <ProtectedPrivacyBoundary
            serverGeneration={{ status: 'absent' }}
            binding={{
              actorId: 'staff',
              backend: 'https://isolated.example',
              role: 'staff',
              canManageConfiguration: true,
            }}
          >
            {body}
          </ProtectedPrivacyBoundary>
        ) : (
          <PrivacyReadinessContext value={privacy}>
            {body}
          </PrivacyReadinessContext>
        )}
      </NavigationContext>
    </AppRouterContext>
  );
}
let workDone = false;
let sourceRetirements = 0;
const grant = (ready = true, visible = ready) => ({
  ready,
  visible,
  generation: 'original',
  revocationRevision: readPrivacyRevocationRevision(),
  verifiedEpoch: assignmentEpoch(),
});
function tree(
  work: ReturnType<typeof deferred>,
  privacy = grant(),
  back?: ReturnType<typeof deferred>,
  pairedFallback = true,
  actualPrivacy = false,
  secondWork?: ReturnType<typeof deferred>,
  redirectTo?: string,
  backRedirectTo?: string,
) {
  return (
    <StrictMode>
      <Router
        work={work}
        back={back}
        privacy={privacy}
        pairedFallback={pairedFallback}
        actualPrivacy={actualPrivacy}
        secondWork={secondWork}
        redirectTo={redirectTo}
        backRedirectTo={backRedirectTo}
      />
    </StrictMode>
  );
}
beforeEach(() => {
  workDone = false;
  sourceRetirements = 0;
  runtime.titleNames = {};
  runtime.detailName = undefined;
  history.replaceState(null, '', list);
  localStorage.clear();
  runtime.read.mockReset().mockResolvedValue({ status: 'absent' });
  runtime.compare.mockReset().mockResolvedValue({ status: 'match' });
  runtime.identity
    .mockReset()
    .mockResolvedValue({ status: 'match', generation: { status: 'absent' } });
  vi.stubGlobal('CSS', { supports: () => true });
  // These application-pair cases support passive early traversal observation;
  // native entry/scroll restoration has its own provider/browser regressions.
  vi.stubGlobal('navigation', new EventTarget());
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
  vi.spyOn(HTMLElement.prototype, 'getClientRects').mockReturnValue([
    { width: 30, height: 20 },
  ] as unknown as DOMRectList);
  document.documentElement.dataset.motion = 'full';
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(document, 'startViewTransition');
  history.replaceState(null, '', '/');
});

it('retains the exact mounted source and draft until real primary reveal, with one cached event-owned gate', async () => {
  const work = deferred();
  render(tree(work));
  const source = screen.getByRole('link', { name: 'Source cable title' });
  const draft = screen.getByRole('textbox');
  draft.focus();
  fireEvent.change(draft, { target: { value: 'edited in original owner' } });
  fireEvent.click(source);
  const owned = gate.store.snapshot()!;
  expect(owned).not.toBeNull();
  expect(owned.destination).toBe(detail);
  await waitFor(() => expect(pending.state.snapshot().delayed).toBe(true));
  expect(source.isConnected).toBe(true);
  expect(screen.getByRole('link', { name: 'Source cable title' })).toBe(source);
  expect(screen.getByRole('textbox')).toBe(draft);
  expect(draft).toHaveValue('edited in original owner');
  expect(document.querySelector('[data-loading-shape]')).toBeNull();
  expect(gate.store.snapshot()?.promise).toBe(owned.promise);
  expect(screen.getAllByRole('status')).toHaveLength(1);
  await act(work.resolve);
  await screen.findByRole('heading', { name: 'Authorized detail title' });
  expect(gate.store.snapshot()).toBeNull();
  expect(pending.state.snapshot().pending).toBe(false);
});

it('retains the source when a stable opaque router slot resolves its gated primary before privacy verification', async () => {
  const work = deferred();
  render(
    <StrictMode>
      <Router work={work} privacy={grant()} actualPrivacy opaqueSlot />
    </StrictMode>,
  );
  const source = await screen.findByRole('link', {
    name: 'Source cable title',
  });
  await waitFor(() => expect(mountedPrivacy.ready).toBe(true));
  let verify!: (value: { status: 'absent' }) => void;
  const verification = new Promise<{ status: 'absent' }>((resolve) => {
    verify = resolve;
  });
  runtime.read.mockReturnValueOnce(verification);
  const initialChecks = runtime.read.mock.calls.length;
  try {
    fireEvent.click(source);
    expect(source.isConnected).toBe(true);
    expect(document.querySelector('[data-loading-shape]')).toBeNull();
    // Preparation starts before the primary lets Next commit its pathname.
    expect(runtime.read.mock.calls.length).toBeGreaterThan(initialChecks);
    await act(work.resolve);
    await waitFor(() =>
      expect(runtime.read.mock.calls.length).toBeGreaterThan(initialChecks),
    );
    expect(mountedPrivacy.ready).toBe(false);
    expect(document.querySelector('[data-loading-shape]')).toBeNull();
    // Production LayoutRouter can advance internally despite the accepted outer node.
    expect(source.isConnected).toBe(true);
    expect(screen.queryByRole('heading')).toBeNull();
    expect(pending.state.snapshot().pending).toBe(true);
  } finally {
    await act(async () => {
      verify({ status: 'absent' });
      await verification;
    });
  }
  await screen.findByRole('heading', { name: 'Authorized detail title' });
  expect(gate.store.snapshot()).toBeNull();
});

it.each(['verification-first', 'primary-first'] as const)(
  'real pathname/query privacy recheck retains the original pair in %s settlement order',
  async (order) => {
    const work = deferred();
    render(tree(work, grant(), undefined, true, true));
    const source = await screen.findByRole('link', {
      name: 'Source cable title',
    });
    await waitFor(() => expect(mountedPrivacy.ready).toBe(true));
    // A separate promise resolves the actual privacy server read, not primary data.
    let verified!: (value: { status: 'absent' }) => void;
    const verification = new Promise<{ status: 'absent' }>((resolve) => {
      verified = resolve;
    });
    runtime.read.mockReturnValueOnce(verification);
    const initialChecks = runtime.read.mock.calls.length;
    fireEvent.click(source);
    await waitFor(() =>
      expect(runtime.read.mock.calls.length).toBeGreaterThan(initialChecks),
    );
    expect(mountedPrivacy.ready).toBe(false);
    expect(mountedPrivacy.visible).toBe(true);
    expect(gate.store.snapshot()).not.toBeNull();
    expect(runtime.titleNames[detail]).toBe(gate.store.snapshot()?.name);
    expect(screen.getByRole('link', { name: 'Source cable title' })).toBe(
      source,
    );
    expect(source.isConnected).toBe(true);
    expect(document.querySelector('[data-loading-shape]')).toBeNull();
    if (order === 'verification-first') {
      await act(async () => {
        verified({ status: 'absent' });
        await verification;
      });
      await waitFor(() => expect(mountedPrivacy.ready).toBe(true));
      expect(screen.getByRole('link', { name: 'Source cable title' })).toBe(
        source,
      );
      expect(work.settled()).toBe(false);
      await act(work.resolve);
    } else {
      await act(work.resolve);
      expect(mountedPrivacy.ready).toBe(false);
      expect(screen.getByRole('link', { name: 'Source cable title' })).toBe(
        source,
      );
      expect(pending.state.snapshot().pending).toBe(true);
      await act(async () => {
        verified({ status: 'absent' });
        await verification;
      });
    }
    await screen.findByRole('heading', { name: 'Authorized detail title' });
    expect(gate.store.snapshot()).toBeNull();
    expect(pending.state.snapshot().pending).toBe(false);
  },
);

it('a queued real-controller route admission is retired on revocation and late primary cannot reappear before fresh original-binding recovery', async () => {
  const work = deferred();
  render(tree(work, grant(), undefined, true, true));
  const source = await screen.findByRole('link', {
    name: 'Source cable title',
  });
  await waitFor(() => expect(mountedPrivacy.ready).toBe(true));
  fireEvent.click(source);
  await waitFor(() => expect(mountedPrivacy.ready).toBe(true));
  await waitFor(() => expect(pending.state.snapshot().delayed).toBe(true));
  expect(screen.getByRole('link', { name: 'Source cable title' })).toBe(source);
  expect(work.settled()).toBe(false);
  let recovered!: (value: { status: 'absent' }) => void;
  const recovery = new Promise<{ status: 'absent' }>((resolve) => {
    recovered = resolve;
  });
  runtime.read.mockReturnValueOnce(recovery);
  act(() => revokePrivatePresentation());
  expect(screen.queryByRole('link', { name: 'Source cable title' })).toBeNull();
  expect(source.closest('[hidden][inert]')).not.toBeNull();
  expect(gate.store.snapshot()).toBeNull();
  expect(document.documentElement.dataset.routeMotionPrivate).toBe('false');
  await act(work.resolve);
  expect(
    screen.queryByRole('heading', { name: 'Authorized detail title' }),
  ).toBeNull();
  expect(document.querySelector('h1')).toBeNull();
  expect(pending.state.snapshot().pending).toBe(false);
  await act(async () => {
    recovered({ status: 'absent' });
    await recovery;
  });
  await screen.findByRole('heading', { name: 'Authorized detail title' });
  expect(document.documentElement.dataset.routeMotionPrivate).toBe('true');
  expect(runtime.identity).toHaveBeenLastCalledWith({
    actorId: 'staff',
    backend: 'https://isolated.example',
    role: 'staff',
    canManageConfiguration: true,
  });
});

it('supersedes a gated navigation without a late old primary releasing or replacing its destination', async () => {
  const work = deferred();
  render(tree(work));
  fireEvent.click(screen.getByRole('link', { name: 'Source cable title' }));
  const old = gate.store.snapshot()!;
  fireEvent.click(screen.getByRole('link', { name: 'Other route' }));
  await screen.findByRole('heading', { name: 'Other destination' });
  await old.promise;
  expect(gate.store.snapshot()).toBeNull();
  await act(work.resolve);
  expect(screen.getByRole('heading')).toHaveTextContent('Other destination');
  expect(pending.state.snapshot().pending).toBe(false);
});

it.each(['reveal', 'cancel'] as const)(
  'a second accepted record navigation cancels the interrupted pair and safely handles %s without stale primary replay',
  async (outcome) => {
    const first = deferred(),
      second = deferred();
    render(tree(first, grant(), undefined, true, true, second));
    const source = await screen.findByRole('link', {
      name: 'Other cable title',
    });
    await waitFor(() => expect(mountedPrivacy.ready).toBe(true));
    fireEvent.click(screen.getByRole('link', { name: 'Source cable title' }));
    const retired = gate.store.snapshot()!;
    await waitFor(() => expect(mountedPrivacy.ready).toBe(true));
    fireEvent.click(source);
    expect(gate.store.snapshot()).toBeNull();
    await retired.promise;
    await waitFor(() => expect(pending.state.snapshot().delayed).toBe(true));
    expect(
      document.querySelector('[data-loading-shape="record"]'),
    ).not.toBeNull();
    expect(location.pathname + location.search).toBe(secondDetail);
    await act(first.resolve);
    expect(gate.store.snapshot()).toBeNull();
    expect(screen.queryByRole('heading')).toBeNull();
    expect(pending.state.snapshot().pending).toBe(true);
    if (outcome === 'cancel') {
      fireEvent.click(screen.getByRole('link', { name: 'Other route' }));
      await screen.findByRole('heading', { name: 'Other destination' });
      await act(second.resolve);
      expect(screen.getByRole('heading')).toHaveTextContent(
        'Other destination',
      );
      expect(gate.store.snapshot()).toBeNull();
      expect(pending.state.snapshot().pending).toBe(false);
      return;
    }
    await act(second.resolve);
    await screen.findByRole('heading', {
      name: 'Second authorized detail title',
    });
    expect(runtime.detailName).toBeUndefined();
    expect(gate.store.snapshot()).toBeNull();
    expect(pending.state.snapshot().pending).toBe(false);
  },
);

it('holds a paired app Back until current list data actually reveals', async () => {
  const work = deferred(),
    back = deferred();
  render(tree(work, grant(), back));
  fireEvent.click(screen.getByRole('link', { name: 'Source cable title' }));
  await act(work.resolve);
  workDone = true;
  const title = await screen.findByRole('heading', {
    name: 'Authorized detail title',
  });
  fireEvent.click(screen.getByRole('link', { name: 'Back to results' }));
  expect(gate.store.snapshot()?.destination).toBe(list);
  await waitFor(() => expect(pending.state.snapshot().delayed).toBe(true));
  expect(title.isConnected).toBe(true);
  expect(runtime.detailName).toBe(gate.store.snapshot()?.name);
  expect(document.querySelector('[data-loading-shape]')).toBeNull();
  await act(back.resolve);
  await screen.findByRole('link', { name: 'Source cable title' });
  expect(gate.store.snapshot()).toBeNull();
  expect(pending.state.snapshot().pending).toBe(false);
});

it('retains the one named source and title through multifilter forward and Back primary waits while preserving raw URLs', async () => {
  const rawList = '/inventory?q=cable&type=quantity&page=2';
  const key = '/inventory?page=2&q=cable&type=quantity';
  const rawDetail = `/inventory/quantity/cable?returnTo=${encodeURIComponent(rawList + '#inventory-row-1')}`;
  const work = deferred(),
    back = deferred();
  history.replaceState(null, '', rawList);
  render(
    <StrictMode>
      <Router work={work} back={back} privacy={grant()} listHref={rawList} />
    </StrictMode>,
  );
  const source = screen.getByRole('link', { name: 'Source cable title' });
  expect(source).toHaveAttribute('href', rawDetail);
  fireEvent.click(source);
  const forward = gate.store.snapshot()!;
  expect(forward).not.toBeNull();
  await waitFor(() => expect(pending.state.snapshot().delayed).toBe(true));
  expect(source.isConnected).toBe(true);
  expect(runtime.titleNames[rawDetail]).toBe(forward.name);
  expect(
    Object.values(runtime.titleNames).filter((name) => name === forward.name),
  ).toHaveLength(1);
  await act(work.resolve);
  workDone = true;
  const title = await screen.findByRole('heading', {
    name: 'Authorized detail title',
  });
  expect(runtime.detailName).toBe(forward.name);
  const backLink = screen.getByRole('link', { name: 'Back to results' });
  expect(backLink).toHaveAttribute('href', rawList + '#inventory-row-1');
  fireEvent.click(backLink);
  const backward = gate.store.snapshot()!;
  expect(backward?.destination).toBe(key);
  await waitFor(() => expect(pending.state.snapshot().delayed).toBe(true));
  expect(title.isConnected).toBe(true);
  expect(runtime.detailName).toBe(backward.name);
  expect(location.search).toBe('?q=cable&type=quantity&page=2');
  expect(location.hash).toBe('#inventory-row-1');
  await act(back.resolve);
  await screen.findByRole('link', { name: 'Source cable title' });
  expect(runtime.titleNames[rawDetail]).toBe(backward.name);
  expect(
    Object.values(runtime.titleNames).filter((name) => name === backward.name),
  ).toHaveLength(1);
  expect(gate.store.snapshot()).toBeNull();
  expect(pending.state.snapshot().pending).toBe(false);
});

it('a real error escapes retained content and retires only presentation ownership', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  const work = deferred();
  render(tree(work));
  fireEvent.click(screen.getByRole('link', { name: 'Source cable title' }));
  const old = gate.store.snapshot()!;
  await act(work.reject);
  await screen.findByRole('alert');
  await old.promise;
  expect(gate.store.snapshot()).toBeNull();
  expect(pending.state.snapshot().pending).toBe(false);
});

it('an installed Next redirect boundary can replace a held pair without a tracked navigation signal or stranded presentation busy', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  const work = deferred();
  render(tree(work, grant(), undefined, true, true, undefined, '/history'));
  const source = await screen.findByRole('link', {
    name: 'Source cable title',
  });
  await waitFor(() => expect(mountedPrivacy.ready).toBe(true));
  fireEvent.click(source);
  const owner = gate.store.snapshot()!;
  expect(owner).not.toBeNull();
  await act(work.resolve);
  await screen.findByRole('heading', { name: 'Other destination' });
  expect(location.pathname).toBe('/history');
  expect(gate.store.snapshot()).toBeNull();
  expect(pending.state.snapshot().pending).toBe(false);
  await owner.promise;
});

it('a query-only server redirect during paired Back cancels only its gate and preserves unrelated actual work', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  const work = deferred(),
    back = deferred();
  const canonical = list + '&page=1';
  render(
    tree(work, grant(), back, true, true, undefined, undefined, canonical),
  );
  const source = await screen.findByRole('link', {
    name: 'Source cable title',
  });
  await waitFor(() => expect(mountedPrivacy.ready).toBe(true));
  fireEvent.click(source);
  await act(work.resolve);
  await screen.findByRole('heading', { name: 'Authorized detail title' });
  await waitFor(() => expect(mountedPrivacy.ready).toBe(true));
  workDone = true;
  fireEvent.click(screen.getByRole('link', { name: 'Back to results' }));
  const owner = gate.store.snapshot()!;
  expect(owner?.destination).toBe(list);
  let finish!: () => void;
  act(() => {
    finish = pending.state.register();
  });
  await act(back.resolve);
  await screen.findByRole('link', { name: 'Source cable title' });
  expect(location.pathname + location.search).toBe(canonical);
  expect(gate.store.snapshot()).toBeNull();
  await owner.promise;
  expect(pending.state.snapshot().pending).toBe(true);
  act(finish);
  expect(pending.state.snapshot().pending).toBe(false);
});

it('hides retained content on revocation; accepted navigation may unmount its outgoing owner without declaring the request ready', async () => {
  const work = deferred();
  const view = render(tree(work));
  const draft = screen.getByRole('textbox');
  fireEvent.change(draft, { target: { value: 'original private draft' } });
  fireEvent.click(screen.getByRole('link', { name: 'Source cable title' }));
  const old = gate.store.snapshot()!;
  await waitFor(() => expect(pending.state.snapshot().delayed).toBe(true));
  expect(draft.isConnected).toBe(true);
  const retiredBefore = sourceRetirements;
  act(() => {
    revokePrivatePresentation();
    view.rerender(tree(work, grant(false)));
  });
  await old.promise;
  expect(gate.store.snapshot()).toBeNull();
  expect(document.documentElement.dataset.routeMotionPrivate).toBe('false');
  expect(screen.queryByRole('textbox')).toBeNull();
  // Captured route identity keeps the outgoing owner attached but inaccessible.
  expect(draft.isConnected).toBe(true);
  expect(draft.closest('[hidden][inert]')).not.toBeNull();
  expect(sourceRetirements).toBe(retiredBefore);
  expect(work.settled()).toBe(false);
  expect(draft).toHaveValue('original private draft');
  await act(work.resolve);
  expect(screen.queryByRole('heading')).toBeNull();
  expect(document.documentElement.dataset.routeMotionPrivate).toBe('false');
  expect(pending.state.snapshot().pending).toBe(false);
});

it('baseline automatic fallback already unmounts the outgoing owner during an accepted navigation before revocation', async () => {
  const work = deferred();
  const view = render(tree(work, grant(), undefined, false));
  const draft = screen.getByRole('textbox');
  fireEvent.click(screen.getByRole('link', { name: 'Source cable title' }));
  await waitFor(() =>
    expect(
      document.querySelector('[data-loading-shape="record"]'),
    ).not.toBeNull(),
  );
  expect(draft.isConnected).toBe(false);
  expect(work.settled()).toBe(false);
  act(() => {
    revokePrivatePresentation();
    view.rerender(tree(work, grant(false), undefined, false));
  });
  expect(
    document.querySelector('[data-loading-shape]')?.closest('[hidden][inert]'),
  ).not.toBeNull();
  await act(work.resolve);
  expect(screen.queryByRole('heading')).toBeNull();
});

it('same-page ordinary rechecks preserve the same business draft owner, value and focus', () => {
  const work = deferred();
  const view = render(tree(work));
  const draft = screen.getByRole('textbox');
  fireEvent.change(draft, { target: { value: 'same-page draft' } });
  draft.focus();
  const retirements = sourceRetirements;
  view.rerender(tree(work, grant(false, true)));
  expect(screen.getByRole('textbox')).toBe(draft);
  expect(draft).toHaveValue('same-page draft');
  expect(draft).toHaveFocus();
  expect(sourceRetirements).toBe(retirements);
  expect(gate.store.snapshot()).toBeNull();
  view.rerender(tree(work, grant()));
  expect(screen.getByRole('textbox')).toBe(draft);
  expect(sourceRetirements).toBe(retirements);
});

it('native Back cancels a held forward navigation without waiting for its old primary', async () => {
  const work = deferred();
  render(tree(work));
  const source = screen.getByRole('link', { name: 'Source cable title' });
  fireEvent.click(source);
  const old = gate.store.snapshot()!;
  act(() => {
    history.replaceState(null, '', list);
    window.dispatchEvent(new PopStateEvent('popstate'));
    runtime.navigate(list);
  });
  await old.promise;
  expect(
    screen.getByRole('link', { name: 'Source cable title' }),
  ).toBeVisible();
  expect(location.pathname + location.search).toBe(list);
  expect(gate.store.snapshot()).toBeNull();
  await act(work.resolve);
  expect(screen.queryByRole('heading')).toBeNull();
  expect(pending.state.snapshot().pending).toBe(false);
});

it('reduction during a held pair releases its opaque gate while the genuine request remains busy', async () => {
  const work = deferred();
  render(tree(work));
  fireEvent.click(screen.getByRole('link', { name: 'Source cable title' }));
  const old = gate.store.snapshot()!;
  act(() => {
    localStorage.setItem('it-inventory-reduce-motion', 'true');
    window.dispatchEvent(
      new StorageEvent('storage', { key: 'it-inventory-reduce-motion' }),
    );
  });
  await old.promise;
  expect(gate.store.snapshot()).toBeNull();
  expect(work.settled()).toBe(false);
  await waitFor(() =>
    expect(
      document.querySelector('[data-loading-shape="record"]'),
    ).toHaveAttribute('data-shimmer', 'false'),
  );
  expect(pending.state.snapshot().pending).toBe(true);
  await act(work.resolve);
  await screen.findByRole('heading', { name: 'Authorized detail title' });
  expect(pending.state.snapshot().pending).toBe(false);
});

it('provider retirement resolves only its owned gate and late Auth callbacks cannot withdraw a replacement provider', async () => {
  const work = deferred();
  const view = render(tree(work));
  fireEvent.click(screen.getByRole('link', { name: 'Source cable title' }));
  const old = gate.store.snapshot()!;
  const lateAuth = runtime.auth;
  view.unmount();
  await old.promise;
  const replacement = deferred();
  render(tree(replacement));
  act(() => lateAuth('SIGNED_OUT', null));
  expect(document.documentElement.dataset.routeMotionPrivate).toBe('true');
  expect(
    screen.getByRole('link', { name: 'Source cable title' }),
  ).toBeVisible();
  expect(gate.store.snapshot()).toBeNull();
  await act(work.resolve);
  expect(screen.queryByRole('heading')).toBeNull();
});

it.each(['reduced', 'unsupported', 'unpaired'] as const)(
  'shows an ordinary skeleton for %s navigation without allocating a paired wait',
  async (mode) => {
    const work = deferred();
    render(tree(work));
    if (mode === 'reduced') {
      act(() => {
        localStorage.setItem('it-inventory-reduce-motion', 'true');
        window.dispatchEvent(
          new StorageEvent('storage', { key: 'it-inventory-reduce-motion' }),
        );
      });
    } else if (mode === 'unsupported')
      Reflect.deleteProperty(document, 'startViewTransition');
    if (mode === 'unpaired') {
      act(() => {
        pending.navigation?.(detail);
        runtime.navigate(detail);
      });
    } else
      fireEvent.click(screen.getByRole('link', { name: 'Source cable title' }));
    expect(gate.store.snapshot()).toBeNull();
    await waitFor(() =>
      expect(
        document.querySelector('[data-loading-shape="record"]'),
      ).not.toBeNull(),
    );
    await act(work.resolve);
    await screen.findByRole('heading', { name: 'Authorized detail title' });
    expect(pending.state.snapshot().pending).toBe(false);
  },
);

it('keeps standalone gate ownership exact through cancellation and repeated destinations', async () => {
  const state = createRoutePendingState(),
    store = createPairedRouteLoading(state);
  store.arm(
    'first',
    '/inventory/quantity/cable?b=2&a=1',
    state.snapshot().epoch,
  );
  const first = store.snapshot()!;
  const unrelated = state.register();
  store.ready('/inventory/quantity/cable?a=1');
  expect(store.snapshot()).toBe(first);
  store.arm('second', '/inventory?type=quantity', state.snapshot().epoch);
  await first.promise;
  expect(state.snapshot().pending).toBe(true);
  const second = store.snapshot()!;
  store.ready(first.destination);
  expect(store.snapshot()).toBe(second);
  store.cancel();
  store.cancel();
  await second.promise;
  expect(state.snapshot().pending).toBe(true);
  unrelated();
  expect(state.snapshot().pending).toBe(false);
  state.cancel(true);
  store.arm('retired', list, state.snapshot().epoch);
  expect(store.snapshot()).toBeNull();
});

it('native Back uses canonical privacy admission without a paired preparation', async () => {
  const work = deferred();
  render(
    <StrictMode>
      <Router work={work} privacy={grant()} actualPrivacy opaqueSlot />
    </StrictMode>,
  );
  const source = await screen.findByRole('link', {
    name: 'Source cable title',
  });
  await waitFor(() => expect(mountedPrivacy.ready).toBe(true));
  fireEvent.click(source);
  await act(work.resolve);
  await screen.findByRole('heading', {
    name: 'Authorized detail title',
  });
  await waitFor(() => expect(mountedPrivacy.ready).toBe(true));
  let settle!: (value: { status: 'absent' }) => void;
  const verification = new Promise<{ status: 'absent' }>((resolve) => {
    settle = resolve;
  });
  runtime.read.mockReturnValueOnce(verification);
  const checks = runtime.read.mock.calls.length;
  act(() => {
    history.replaceState(null, '', list);
    window.dispatchEvent(new PopStateEvent('popstate'));
    expect(gate.store.snapshot()).toBeNull();
    runtime.navigate(list);
  });
  await waitFor(() =>
    expect(runtime.read.mock.calls.length).toBeGreaterThan(checks),
  );
  expect(gate.store.snapshot()).toBeNull();
  expect(screen.queryByRole('link', { name: 'Source cable title' })).toBeNull();
  await act(async () => {
    settle({ status: 'absent' });
    await verification;
  });
  await screen.findByRole('link', { name: 'Source cable title' });
  expect(gate.store.snapshot()).toBeNull();
  expect(pending.state.snapshot().pending).toBe(false);
});

it.each([false, true])(
  'cached Activity native Back after repeated pairs restores its primary (router listener first=%s)',
  async (routerFirst) => {
    const work = deferred();
    render(
      <StrictMode>
        <Router
          work={work}
          privacy={grant()}
          actualPrivacy
          opaqueSlot
          cacheSlot
        />
      </StrictMode>,
    );
    await screen.findByRole('link', { name: 'Source cable title' });
    await waitFor(() => expect(mountedPrivacy.ready).toBe(true));
    fireEvent.click(screen.getByRole('link', { name: 'Source cable title' }));
    await act(work.resolve);
    await screen.findByRole('heading', { name: 'Authorized detail title' });
    await waitFor(() => expect(mountedPrivacy.ready).toBe(true));
    fireEvent.click(screen.getByRole('link', { name: 'Back to results' }));
    await screen.findByRole('link', { name: 'Source cable title' });
    await waitFor(() => expect(mountedPrivacy.ready).toBe(true));
    fireEvent.click(screen.getByRole('link', { name: 'Source cable title' }));
    await screen.findByRole('heading', { name: 'Authorized detail title' });
    await waitFor(() => expect(mountedPrivacy.ready).toBe(true));
    let settle!: (value: { status: 'absent' }) => void;
    const verification = new Promise<{ status: 'absent' }>((resolve) => {
      settle = resolve;
    });
    runtime.read.mockReturnValueOnce(verification);
    act(() => {
      history.replaceState(null, '', list + '#inventory-row-1');
      if (routerFirst) runtime.navigate(list + '#inventory-row-1');
      window.dispatchEvent(new PopStateEvent('popstate'));
      if (!routerFirst) runtime.navigate(list + '#inventory-row-1');
    });
    await act(async () => {
      settle({ status: 'absent' });
      await verification;
    });
    await screen.findByRole('link', { name: 'Source cable title' });
    await waitFor(() => expect(mountedPrivacy.ready).toBe(true));
    expect(gate.store.snapshot()).toBeNull();
    expect(pending.state.snapshot().pending).toBe(false);
    expect(runtime.titleNames[list + '#inventory-row-1']).toBeUndefined();
    act(() => {
      history.replaceState(null, '', detail);
      if (routerFirst) runtime.navigate(detail);
      window.dispatchEvent(new PopStateEvent('popstate'));
      if (!routerFirst) runtime.navigate(detail);
    });
    await screen.findByRole('heading', { name: 'Authorized detail title' });
    await waitFor(() => expect(mountedPrivacy.ready).toBe(true));
    expect(gate.store.snapshot()).toBeNull();
    expect(pending.state.snapshot().pending).toBe(false);
    expect(runtime.detailName).toBeUndefined();
  },
);

it('native Back restores with canonical privacy when an earlier router listener eagerly commits', async () => {
  const work = deferred();
  const restore = () => flushSync(() => runtime.restoreSync(location.href));
  // Model a real event's inter-listener React commit, not a synthetic event
  // whose entire dispatch remains in the same JavaScript stack.
  window.addEventListener('popstate', restore);
  try {
    render(
      <StrictMode>
        <Router work={work} privacy={grant()} actualPrivacy opaqueSlot />
      </StrictMode>,
    );
    await screen.findByRole('link', { name: 'Source cable title' });
    await waitFor(() => expect(mountedPrivacy.ready).toBe(true));
    fireEvent.click(screen.getByRole('link', { name: 'Source cable title' }));
    await act(work.resolve);
    await screen.findByRole('heading', { name: 'Authorized detail title' });
    await waitFor(() => expect(mountedPrivacy.ready).toBe(true));
    let settle!: (value: { status: 'absent' }) => void;
    const verification = new Promise<{ status: 'absent' }>((resolve) => {
      settle = resolve;
    });
    runtime.read.mockReturnValueOnce(verification);
    const before = pending.state.snapshot().epoch;
    act(() => {
      history.replaceState(null, '', list + '#inventory-row-1');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    expect(pending.state.snapshot().epoch).toBeGreaterThan(before);
    expect(mountedPrivacy.navigation!.admission(list)).toEqual({
      ready: false,
    });
    expect(gate.store.snapshot()).toBeNull();
    await act(async () => {
      settle({ status: 'absent' });
      await verification;
    });
    await screen.findByRole('link', { name: 'Source cable title' });
    await waitFor(() => expect(mountedPrivacy.ready).toBe(true));
  } finally {
    window.removeEventListener('popstate', restore);
  }
});

it('a committed pathname update cannot remove the native observer from an in-progress capture dispatch', async () => {
  const work = deferred();
  const restore = () => flushSync(() => runtime.restoreSync(location.href));
  window.addEventListener('popstate', restore, true);
  try {
    render(
      <StrictMode>
        <Router work={work} privacy={grant()} actualPrivacy opaqueSlot />
      </StrictMode>,
    );
    await screen.findByRole('link', { name: 'Source cable title' });
    await waitFor(() => expect(mountedPrivacy.ready).toBe(true));
    fireEvent.click(screen.getByRole('link', { name: 'Source cable title' }));
    await act(work.resolve);
    await screen.findByRole('heading', { name: 'Authorized detail title' });
    await waitFor(() => expect(mountedPrivacy.ready).toBe(true));
    const before = pending.state.snapshot().epoch;
    act(() => {
      history.replaceState(null, '', list);
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    expect(pending.state.snapshot().epoch).toBeGreaterThan(before);
    await screen.findByRole('link', { name: 'Source cable title' });
    await waitFor(() => expect(mountedPrivacy.ready).toBe(true));
    expect(gate.store.snapshot()).toBeNull();
    expect(pending.state.snapshot().pending).toBe(false);
  } finally {
    window.removeEventListener('popstate', restore, true);
  }
});
