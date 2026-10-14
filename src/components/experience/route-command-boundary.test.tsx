import { act, cleanup, render, screen } from '@testing-library/react';
import {
  Activity,
  useContext,
  useLayoutEffect,
  useSyncExternalStore,
} from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  RouteMotionProvider,
  useRouteCommandBoundary,
  type RouteCommandTicket,
} from './route-motion';
import { RoutePendingContext, useRouteRouter } from './route-pending';
import {
  RouteReady,
  useConsumeRouteTask,
  RouteReadyContext,
} from './route-ready';
import { PrivacyReadinessContext } from '@/components/auth/privacy-readiness';
import {
  assignmentEpoch,
  readPrivacyRevocationRevision,
  revokePrivatePresentation,
} from '@/features/scan/assign-batch';
const runtime = vi.hoisted(() => ({
  pathname: '/inventory',
  query: '',
  push: vi.fn(),
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: runtime.push }),
  usePathname: () => runtime.pathname,
  useSearchParams: () => new URLSearchParams(runtime.query),
}));
vi.mock('./motion-preference', () => ({
  useEffectiveReducedMotion: () => true,
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
let boundary: ReturnType<typeof useRouteCommandBoundary>;
let router: ReturnType<typeof useRouteRouter>;
let primary: () => ReturnType<
  NonNullable<React.ContextType<typeof RouteReadyContext>>['currentPrimary']
>;
let consume: ReturnType<typeof useConsumeRouteTask>;
function ConsumptionProbe() {
  const value = useConsumeRouteTask();
  useLayoutEffect(() => {
    consume = value;
  });
  return null;
}
let scope: NonNullable<React.ContextType<typeof RoutePendingContext>>;
function PublicationProbe({
  ticket,
  onLayout,
}: {
  ticket: RouteCommandTicket;
  onLayout: () => void;
}) {
  const value = useRouteCommandBoundary('actor', 'backend');
  const current = useSyncExternalStore(
    value.subscribe,
    () => ticket.current(),
    () => false,
  );
  useLayoutEffect(() => {
    onLayout();
  });
  return (
    <output data-testid="command-publication">
      {current ? 'current' : 'retired'}
    </output>
  );
}
function Probe({ backend }: { backend: string }) {
  const value = useRouteCommandBoundary('actor', backend);
  const navigation = useRouteRouter();
  const pending = useContext(RoutePendingContext);
  const readiness = useContext(RouteReadyContext);
  useLayoutEffect(() => {
    boundary = value;
    router = navigation;
    scope = pending!;
    primary = () => readiness!.currentPrimary();
  });
  return null;
}
function Fixture({
  ready = true,
  generation = 'actor:backend',
  fresh = true,
  backend = 'backend',
  hidden = false,
  actorId = 'actor',
  publication,
  conventionalPrimary = false,
  pairedInventory = false,
}: {
  ready?: boolean;
  generation?: string;
  fresh?: boolean;
  backend?: string;
  hidden?: boolean;
  actorId?: string;
  publication?: { ticket: RouteCommandTicket; onLayout: () => void };
  conventionalPrimary?: boolean;
  pairedInventory?: boolean;
}) {
  return (
    <PrivacyReadinessContext
      value={{
        ready: fresh,
        visible: true,
        generation,
        revocationRevision: readPrivacyRevocationRevision(),
        verifiedEpoch: assignmentEpoch(),
      }}
    >
      <RouteMotionProvider actorId={actorId}>
        <Probe backend={backend} />
        {publication && <PublicationProbe {...publication} />}
        <div hidden={hidden}>
          <RouteReady
            actorId="actor"
            routeKey={
              runtime.pathname + (runtime.query ? '?' + runtime.query : '')
            }
            contentIdentity="primary"
            ready={ready}
            conventionalPrimary={conventionalPrimary}
            pairedInventory={pairedInventory}
          >
            <main>
              <ConsumptionProbe />
              <h1>Authorized primary</h1>
              <input data-inventory-search aria-label="Primary search" />
            </main>
          </RouteReady>
        </div>
        {!ready && <h1>Fallback heading</h1>}
      </RouteMotionProvider>
    </PrivacyReadinessContext>
  );
}
function accept(href: string) {
  let ticket: RouteCommandTicket | null = null;
  act(() => {
    ticket = boundary.issue(href);
    router.push(href);
  });
  expect(ticket).not.toBeNull();
  return ticket!;
}
it.each(['generation', 'actor'] as const)(
  'retires command authority before child layout on %s change without insertion updates',
  (change) => {
    const errors = vi.spyOn(console, 'error');
    const view = render(<Fixture />);
    const ticket = accept('/inventory?task=quantity_move');
    const publication = { ticket, onLayout: vi.fn() };
    view.rerender(<Fixture publication={publication} />);
    expect(screen.getByTestId('command-publication')).toHaveTextContent(
      'current',
    );
    const observed: boolean[] = [];
    publication.onLayout = vi.fn(() => observed.push(ticket.current()));
    view.rerender(
      <Fixture
        publication={publication}
        generation={
          change === 'generation' ? 'new-generation' : 'actor:backend'
        }
        actorId={change === 'actor' ? 'other' : 'actor'}
      />,
    );
    expect(observed.length).toBeGreaterThan(0);
    expect(observed.every((value) => value === false)).toBe(true);
    expect(ticket.current()).toBe(false);
    expect(screen.getByTestId('command-publication')).toHaveTextContent(
      'retired',
    );
    view.unmount();
    expect(
      errors.mock.calls.map((args) => args.join(' ')).join('\n'),
    ).not.toMatch(
      /useInsertionEffect.*(?:schedule|update)|must not schedule updates/i,
    );
  },
);
beforeEach(() => {
  runtime.pathname = '/inventory';
  runtime.query = '';
  runtime.push.mockReset();
  history.replaceState({}, '', '/inventory');
  vi.spyOn(HTMLElement.prototype, 'getClientRects').mockReturnValue([
    {},
  ] as unknown as DOMRectList);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
it('waits for the exact real primary rather than a same-path fallback or hidden retained heading', () => {
  const view = render(<Fixture />);
  const ticket = accept('/inventory?q=next');
  expect(boundary.focus(ticket, 'heading')).toBe(false);
  runtime.query = 'q=next';
  history.replaceState({}, '', '/inventory?q=next');
  view.rerender(<Fixture ready={false} />);
  expect(boundary.focus(ticket, 'heading')).toBe(false);
  expect(screen.getByText('Fallback heading')).not.toHaveFocus();
  view.rerender(<Fixture hidden />);
  expect(boundary.focus(ticket, 'heading')).toBe(false);
  view.rerender(<Fixture />);
  expect(boundary.focus(ticket, 'search')).toBe(true);
  expect(screen.getByLabelText('Primary search')).toHaveFocus();
  expect(boundary.focus(ticket, 'heading')).toBe(false);
});
it('supersedes a ticket on every accepted navigation even when URL and pending epoch repeat', () => {
  render(<Fixture />);
  const epoch = scope.state.snapshot().epoch;
  const first = accept('/inventory');
  const second = accept('/inventory');
  expect(scope.state.snapshot().epoch).toBe(epoch);
  expect(first.current()).toBe(false);
  expect(second.current()).toBe(true);
  expect(boundary.focus(first, 'heading')).toBe(false);
  expect(boundary.focus(second, 'heading')).toBe(true);
});
it('pauses only the original authority through an ordinary recheck and resumes on the same fresh grant', () => {
  const view = render(<Fixture />);
  const ticket = accept('/inventory');
  view.rerender(<Fixture fresh={false} />);
  expect(ticket.retained()).toBe(true);
  expect(ticket.current()).toBe(false);
  expect(boundary.focus(ticket, 'heading')).toBe(false);
  view.rerender(<Fixture />);
  expect(ticket.current()).toBe(true);
  expect(boundary.focus(ticket, 'heading')).toBe(true);
});
it.each(['generation', 'backend'] as const)(
  'cannot resurrect an old ticket after %s A to B to A drift',
  (field) => {
    const view = render(<Fixture />);
    const ticket = accept('/inventory');
    view.rerender(<Fixture {...{ [field]: 'other' }} />);
    expect(ticket.current()).toBe(false);
    view.rerender(<Fixture />);
    expect(ticket.retained()).toBe(false);
    expect(boundary.focus(ticket, 'heading')).toBe(false);
  },
);
it.each(['history', 'terminal', 'revocation', 'unmount'] as const)(
  'retires a ticket on %s before a late focus callback',
  (event) => {
    const view = render(<Fixture />);
    const ticket = accept('/inventory');
    act(() => {
      if (event === 'history')
        window.dispatchEvent(new PopStateEvent('popstate'));
      else if (event === 'terminal') scope.terminal();
      else if (event === 'revocation') revokePrivatePresentation();
      else view.unmount();
    });
    expect(ticket.current()).toBe(false);
    expect(boundary.focus(ticket, 'heading')).toBe(false);
  },
);
it('does not settle pending work merely by observing or focusing an authoritative primary', () => {
  render(<Fixture />);
  const finish = scope.state.register();
  const ticket = accept('/inventory');
  expect(scope.state.snapshot().pending).toBe(true);
  expect(boundary.focus(ticket, 'heading')).toBe(true);
  expect(scope.state.snapshot().pending).toBe(true);
  act(() => finish());
});

it('follows only the explicit same-primary task handoff and creates no new accepted navigation or pending epoch', () => {
  const view = render(<Fixture />);
  const destination =
    '/inventory/quantity/record?other=keep&task=quantity_move';
  const ticket = accept(destination);
  runtime.pathname = '/inventory/quantity/record';
  runtime.query = 'other=keep&task=quantity_move';
  history.replaceState({ next: 'kept' }, '', destination + '#tasks');
  view.rerender(<Fixture />);
  const lifetime = boundary.capture();
  const epoch = scope.state.snapshot().epoch;
  const pop = vi.fn();
  window.addEventListener('popstate', pop);
  try {
    act(() => {
      expect(
        consume?.(
          '/inventory/quantity/record',
          'quantity_move',
          screen.getByText('Authorized primary'),
        ),
      ).toBe(true);
    });
    expect(lifetime()).toBe(true);
    expect(scope.state.snapshot().epoch).toBe(epoch);
    expect(runtime.push).toHaveBeenCalledTimes(1);
    expect(pop).not.toHaveBeenCalled();
    expect(history.state).toEqual({ next: 'kept' });
    expect(location.search).toBe('?other=keep');
    expect(location.hash).toBe('#tasks');
    runtime.query = 'other=keep';
    view.rerender(<Fixture />);
    expect(boundary.focus(ticket, 'heading')).toBe(true);
    expect(screen.getByText('Authorized primary')).toHaveFocus();
    act(() => window.dispatchEvent(new PopStateEvent('popstate')));
    expect(ticket.current()).toBe(false);
    expect(scope.state.snapshot().pending).toBe(false);
  } finally {
    window.removeEventListener('popstate', pop);
  }
});

it.each([
  [true, false],
  [false, true],
  [true, true],
])(
  'preserves consumed-task command focus inside the conventional=%s paired=%s body wrapper without granting readiness',
  (conventionalPrimary, pairedInventory) => {
    const fixture = (
      <Fixture
        conventionalPrimary={conventionalPrimary}
        pairedInventory={pairedInventory}
      />
    );
    const view = render(fixture);
    const destination =
      '/inventory/quantity/record?keep=a&keep=b&task=quantity_move';
    const ticket = accept(destination);
    runtime.pathname = '/inventory/quantity/record';
    runtime.query = 'keep=a&keep=b&task=quantity_move';
    history.replaceState({ next: 'retained' }, '', destination + '#tasks');
    view.rerender(
      <Fixture
        conventionalPrimary={conventionalPrimary}
        pairedInventory={pairedInventory}
      />,
    );
    expect(
      document.querySelectorAll('.experience-paired-inventory-content'),
    ).toHaveLength(1);
    expect(primary()?.conventionalPrimary).toBe(conventionalPrimary);
    const lifetime = boundary.capture();
    const epoch = scope.state.snapshot().epoch;
    let finishBusiness!: () => void;
    act(() => {
      finishBusiness = scope.state.register();
      expect(
        consume?.(
          runtime.pathname,
          'quantity_move',
          screen.getByText('Authorized primary'),
        ),
      ).toBe(true);
    });
    expect(lifetime()).toBe(true);
    expect(scope.state.snapshot().epoch).toBe(epoch);
    expect(scope.state.snapshot().pending).toBe(true);
    expect(primary()?.conventionalPrimary).toBe(conventionalPrimary);
    expect(primary()?.consumedTask).toEqual({
      sourceKey: destination,
      destinationKey: '/inventory/quantity/record?keep=a&keep=b',
    });
    expect(boundary.focus(ticket, 'heading')).toBe(false);
    runtime.query = 'keep=a&keep=b';
    view.rerender(
      <Fixture
        conventionalPrimary={conventionalPrimary}
        pairedInventory={pairedInventory}
      />,
    );
    expect(boundary.focus(ticket, 'heading')).toBe(true);
    expect(screen.getByText('Authorized primary')).toHaveFocus();
    expect(scope.state.snapshot().pending).toBe(true);
    expect(runtime.push).toHaveBeenCalledTimes(1);
    expect(location.hash).toBe('#tasks');
    expect(history.state).toEqual({ next: 'retained' });
    act(() => finishBusiness());
  },
);

it('keeps accepted command navigation authoritative when an incoming presentation observer throws', () => {
  render(<Fixture conventionalPrimary />);
  const older = accept('/inventory');
  const stopObserving = scope.observeNavigation!(() => {
    throw Error('Presentation observer failed');
  });
  try {
    const newer = accept('/inventory');
    expect(older.current()).toBe(false);
    expect(newer.current()).toBe(true);
    expect(boundary.focus(newer, 'heading')).toBe(true);
    expect(runtime.push).toHaveBeenCalledTimes(2);
  } finally {
    stopObserving();
  }
});

it('retires the old provider even if it remains mounted beneath a replacement and permits a fresh gesture after native history', () => {
  const first = render(<Fixture />);
  const oldBoundary = boundary;
  const old = accept('/inventory');
  const replacement = render(<Fixture />);
  expect(old.current()).toBe(false);
  expect(oldBoundary.focus(old, 'heading')).toBe(false);
  const fresh = accept('/inventory');
  act(() => window.dispatchEvent(new PopStateEvent('popstate')));
  expect(fresh.current()).toBe(false);
  const afterHistory = accept('/inventory');
  expect(boundary.focus(afterHistory, 'heading')).toBe(true);
  replacement.unmount();
  expect(old.current()).toBe(false);
  first.unmount();
});

function CachedPrimary({
  children,
  mode = 'visible',
  fresh = true,
}: {
  children: React.ReactNode;
  mode?: 'visible' | 'hidden';
  fresh?: boolean;
}) {
  return (
    <PrivacyReadinessContext
      value={{
        ready: fresh,
        visible: true,
        generation: 'actor:backend',
        revocationRevision: readPrivacyRevocationRevision(),
        verifiedEpoch: assignmentEpoch(),
      }}
    >
      <RouteMotionProvider actorId="actor">
        <Probe backend="backend" />
        <Activity mode={mode}>
          <RouteReady
            actorId="actor"
            routeKey="/inventory/quantity/record?task=quantity_move"
            contentIdentity="record"
          >
            {children}
          </RouteReady>
        </Activity>
      </RouteMotionProvider>
    </PrivacyReadinessContext>
  );
}
function recordPrimary(label = 'Cached record') {
  return (
    <main>
      <ConsumptionProbe />
      <h1>{label}</h1>
    </main>
  );
}
it('keeps the clean alias during outgoing work and rearms a repeated accepted task URL only on a fresh matching primary commit', () => {
  runtime.pathname = '/inventory/quantity/record';
  runtime.query = 'task=quantity_move';
  history.replaceState({}, '', runtime.pathname + '?' + runtime.query);
  const firstChildren = recordPrimary();
  const view = render(<CachedPrimary>{firstChildren}</CachedPrimary>);
  act(() =>
    expect(
      consume?.(
        runtime.pathname,
        'quantity_move',
        screen.getByText('Cached record'),
      ),
    ).toBe(true),
  );
  runtime.query = '';
  view.rerender(<CachedPrimary>{firstChildren}</CachedPrimary>);
  expect(primary()?.routeKey).toBe(runtime.pathname);
  const ticket = accept(runtime.pathname + '?task=quantity_move');
  expect(primary()?.routeKey).toBe(runtime.pathname);
  runtime.query = 'task=quantity_move';
  history.replaceState({}, '', runtime.pathname + '?' + runtime.query);
  view.rerender(<CachedPrimary fresh={false}>{firstChildren}</CachedPrimary>);
  expect(primary()).toBeNull();
  expect(boundary.focus(ticket, 'heading')).toBe(false);
  const nextChildren = recordPrimary('Fresh record');
  view.rerender(<CachedPrimary fresh={false}>{nextChildren}</CachedPrimary>);
  expect(primary()).toBeNull();
  view.rerender(<CachedPrimary>{nextChildren}</CachedPrimary>);
  expect(primary()?.routeKey).toBe(runtime.pathname + '?task=quantity_move');
  act(() =>
    expect(
      consume?.(
        runtime.pathname,
        'quantity_move',
        screen.getByText('Fresh record'),
      ),
    ).toBe(true),
  );
  runtime.query = '';
  view.rerender(<CachedPrimary>{nextChildren}</CachedPrimary>);
  expect(primary()?.routeKey).toBe(runtime.pathname);
  expect(boundary.focus(ticket, 'heading')).toBe(true);
});
it.each(['Back', 'Forward'])(
  'native %s reactivation restores functional task readiness and permanently retires command focus',
  (direction) => {
    runtime.pathname = '/inventory/quantity/record';
    runtime.query = 'task=quantity_move';
    history.replaceState({}, '', runtime.pathname + '?' + runtime.query);
    const cached = recordPrimary();
    const view = render(<CachedPrimary>{cached}</CachedPrimary>);
    const ticket = accept(runtime.pathname + '?' + runtime.query);
    act(() =>
      expect(
        consume?.(
          runtime.pathname,
          'quantity_move',
          screen.getByText('Cached record'),
        ),
      ).toBe(true),
    );
    runtime.query = '';
    view.rerender(<CachedPrimary>{cached}</CachedPrimary>);
    view.rerender(<CachedPrimary mode="hidden">{cached}</CachedPrimary>);
    runtime.query = 'task=quantity_move';
    history.replaceState({}, '', runtime.pathname + '?' + runtime.query);
    act(() =>
      window.dispatchEvent(
        new PopStateEvent('popstate', { state: { direction } }),
      ),
    );
    view.rerender(<CachedPrimary>{cached}</CachedPrimary>);
    expect(primary()?.routeKey).toBe(runtime.pathname + '?task=quantity_move');
    expect(ticket.current()).toBe(false);
    expect(boundary.focus(ticket, 'heading')).toBe(false);
    expect(screen.getByText('Cached record')).not.toHaveFocus();
    act(() =>
      expect(
        consume?.(
          runtime.pathname,
          'quantity_move',
          screen.getByText('Cached record'),
        ),
      ).toBe(true),
    );
    runtime.query = '';
    view.rerender(<CachedPrimary>{cached}</CachedPrimary>);
    expect(primary()?.routeKey).toBe(runtime.pathname);
  },
);

it('rearms the identical cached children without Activity after an accepted matching React router commit', () => {
  runtime.pathname = '/inventory/quantity/record';
  runtime.query = 'task=quantity_move';
  history.replaceState({}, '', runtime.pathname + '?' + runtime.query);
  const cached = recordPrimary();
  const view = render(<CachedPrimary>{cached}</CachedPrimary>);
  act(() =>
    expect(
      consume?.(
        runtime.pathname,
        'quantity_move',
        screen.getByText('Cached record'),
      ),
    ).toBe(true),
  );
  runtime.query = '';
  view.rerender(<CachedPrimary>{cached}</CachedPrimary>);
  const ticket = accept(runtime.pathname + '?task=quantity_move');
  history.replaceState({}, '', runtime.pathname + '?task=quantity_move');
  view.rerender(<CachedPrimary>{cached}</CachedPrimary>);
  expect(primary()).toBeNull();
  expect(boundary.focus(ticket, 'heading')).toBe(false);
  runtime.query = 'task=quantity_move';
  view.rerender(<CachedPrimary>{cached}</CachedPrimary>);
  expect(primary()?.routeKey).toBe(runtime.pathname + '?task=quantity_move');
  act(() =>
    expect(
      consume?.(
        runtime.pathname,
        'quantity_move',
        screen.getByText('Cached record'),
      ),
    ).toBe(true),
  );
  runtime.query = '';
  view.rerender(<CachedPrimary>{cached}</CachedPrimary>);
  expect(boundary.focus(ticket, 'heading')).toBe(true);
});
it('does not rearm from an unrelated accepted navigation followed by a matching raw URL and router key', () => {
  runtime.pathname = '/inventory/quantity/record';
  runtime.query = 'task=quantity_move';
  history.replaceState({}, '', runtime.pathname + '?' + runtime.query);
  const cached = recordPrimary();
  const view = render(<CachedPrimary>{cached}</CachedPrimary>);
  act(() =>
    expect(
      consume?.(
        runtime.pathname,
        'quantity_move',
        screen.getByText('Cached record'),
      ),
    ).toBe(true),
  );
  runtime.query = '';
  view.rerender(<CachedPrimary>{cached}</CachedPrimary>);
  accept('/history');
  runtime.query = 'task=quantity_move';
  history.replaceState({}, '', runtime.pathname + '?' + runtime.query);
  view.rerender(<CachedPrimary>{cached}</CachedPrimary>);
  expect(primary()).toBeNull();
  act(() =>
    expect(
      consume?.(
        runtime.pathname,
        'quantity_move',
        screen.getByText('Cached record'),
      ),
    ).toBe(false),
  );
});
