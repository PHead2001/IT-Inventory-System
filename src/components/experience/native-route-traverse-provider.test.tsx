import { act, cleanup, render } from '@testing-library/react';
import { useContext, useLayoutEffect } from 'react';
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
} from './route-motion';
import { RoutePendingContext } from './route-pending';
import { RouteReadyContext } from './route-ready';
import { PairedRouteLoadingContext } from './paired-route-loading';
import { titleTarget } from './route-motion-state';

const runtime = vi.hoisted(() => ({
  pathname: '/inventory',
  query: '',
  auth: undefined as
    | ((event: string, session: { user: { id: string } } | null) => void)
    | undefined,
}));
vi.mock('next/navigation', () => ({
  usePathname: () => runtime.pathname,
  useSearchParams: () => new URLSearchParams(runtime.query),
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

class ObservedNavigation {
  currentEntry = { key: 'list-entry' };
  listeners = new Map<string, Set<(event: NavigateEvent) => void>>();
  addEventListener(type: string, listener: (event: NavigateEvent) => void) {
    const listeners = this.listeners.get(type) ?? new Set();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }
  removeEventListener(type: string, listener: (event: NavigateEvent) => void) {
    this.listeners.get(type)?.delete(listener);
  }
  emit(type: string, event = {} as NavigateEvent) {
    this.listeners.get(type)?.forEach((listener) => listener(event));
  }
}
let controls: {
  motion: ReturnType<typeof useRouteMotion>;
  scope: NonNullable<React.ContextType<typeof RoutePendingContext>>;
  readiness: NonNullable<React.ContextType<typeof RouteReadyContext>>;
  loading: NonNullable<React.ContextType<typeof PairedRouteLoadingContext>>;
  logout: () => void;
};
function Controls() {
  const motion = useRouteMotion();
  const scope = useContext(RoutePendingContext)!;
  const readiness = useContext(RouteReadyContext)!;
  const loading = useContext(PairedRouteLoadingContext)!;
  const logout = useInvalidateRouteMotion();
  useLayoutEffect(() => {
    controls = { motion, scope, readiness, loading, logout };
  });
  return <p>Existing authorized content</p>;
}
const target = titleTarget(
  { kind: 'quantity', id: 'cable' },
  '/inventory#inventory-row-2',
  { domain: 'storage', id: 'holding' },
)!;
function view({ ready = true, actor = 'staff' } = {}) {
  return (
    <PrivacyReadinessContext
      value={{
        ready,
        visible: true,
        generation: 'original-binding',
        verifiedEpoch: ready ? assignmentEpoch() : undefined,
        revocationRevision: readPrivacyRevocationRevision(),
        navigation: privacyNavigation,
      }}
    >
      <RouteMotionProvider key={actor} actorId={actor}>
        <Controls />
      </RouteMotionProvider>
    </PrivacyReadinessContext>
  );
}
const privacyNavigation = {
  bind: vi.fn(() => () => {}),
  prepare: vi.fn(),
  retire: vi.fn(),
  admission: () => ({ ready: false }),
};
let navigation: ObservedNavigation;
let originalHref: string;
beforeEach(() => {
  originalHref = location.href;
  window.history.replaceState(null, '', '/inventory');
  runtime.pathname = '/inventory';
  runtime.query = '';
  navigation = new ObservedNavigation();
  Object.defineProperty(window, 'navigation', {
    configurable: true,
    value: navigation,
  });
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
  privacyNavigation.prepare.mockReset();
  privacyNavigation.retire.mockReset();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(window, 'navigation');
  Reflect.deleteProperty(document, 'startViewTransition');
  Reflect.deleteProperty(document, 'visibilityState');
  window.history.replaceState(null, '', originalHref);
  localStorage.removeItem('it-inventory-reduce-motion');
});
function detailFixture() {
  const page = render(view());
  act(() => {
    const gesture = controls.scope.beginNavigation!(target.detailPath);
    controls.motion.arm(target);
    controls.scope.navigation!(target.detailPath);
    gesture?.close();
  });
  window.history.replaceState(null, '', target.detailPath);
  navigation.currentEntry = { key: 'detail-entry' };
  runtime.pathname = target.detailPath;
  page.rerender(view());
  // Complete the initial forward load through the actual visible readiness
  // protocol, so native Back begins with the already-approved origin only.
  const source = document.createElement('div');
  const child = document.createElement('p');
  child.getClientRects = () => [{ width: 100 }] as unknown as DOMRectList;
  source.append(child);
  document.body.append(source);
  act(() => {
    controls.readiness.register({
      actorId: 'staff',
      routeKey: target.detailPath,
      contentIdentity: 'authorized-detail',
      root: source,
    });
  });
  expect(controls.loading.store.snapshot()).toBeNull();
  privacyNavigation.prepare.mockClear();
  privacyNavigation.retire.mockClear();
  return { page, source };
}
function traverse(key = 'list-entry', href = `${location.origin}/inventory`) {
  const abort = new AbortController();
  const event = {
    isTrusted: true,
    navigationType: 'traverse',
    destination: { key, url: href, sameDocument: true },
    signal: abort.signal,
    intercept: vi.fn(),
    preventDefault: vi.fn(),
  } as unknown as NavigateEvent;
  act(() => navigation.emit('navigate', event));
  return { abort, event, key, href };
}

it.each([false, true])(
  'native Back/Forward stays unpaired and settles authorized readiness (eager router first=%s)',
  (routerFirst) => {
    const { page, source } = detailFixture();
    const skipTransition = vi.fn();
    Object.defineProperty(document, 'activeViewTransition', {
      configurable: true,
      value: { skipTransition },
    });
    const push = vi.spyOn(window.history, 'pushState');
    const replace = vi.spyOn(window.history, 'replaceState');
    const destination = document.createElement('div');
    const child = document.createElement('p');
    child.getClientRects = () => [{ width: 100 }] as unknown as DOMRectList;
    destination.append(child);
    document.body.append(destination);
    const restore = (href: string, route: string) => {
      const observed = traverse('entry-' + route, location.origin + href);
      expect(controls.loading.store.snapshot()).toBeNull();
      expect(privacyNavigation.prepare).not.toHaveBeenCalled();
      window.history.replaceState(null, '', href);
      replace.mockClear();
      push.mockClear();
      runtime.pathname = route;
      const commit = () => page.rerender(view({ ready: false }));
      if (routerFirst) commit();
      act(() => window.dispatchEvent(new PopStateEvent('popstate')));
      if (!routerFirst) commit();
      expect(push).not.toHaveBeenCalled();
      expect(replace).not.toHaveBeenCalled();
      expect(controls.motion.intent).toBeNull();
      expect(controls.loading.store.snapshot()).toBeNull();
      expect(privacyNavigation.prepare).not.toHaveBeenCalled();
      expect(observed.event.intercept).not.toHaveBeenCalled();
      expect(observed.event.preventDefault).not.toHaveBeenCalled();
      page.rerender(view());
      act(() =>
        controls.readiness.register({
          actorId: 'staff',
          routeKey: route,
          contentIdentity: 'authorized-' + route,
          root: destination,
        }),
      );
      expect(controls.scope.state.snapshot().pending).toBe(false);
    };
    try {
      restore('/inventory#inventory-row-2', '/inventory');
      expect(location.hash).toBe('#inventory-row-2');
      restore(target.detailPath, target.detailPath);
      expect(skipTransition).toHaveBeenCalledTimes(2);
      // Native traversal retains only the approved origin; a later app Back
      // must still stage and consume a fresh pair through its accepted gesture.
      act(() => {
        const gesture = controls.scope.beginNavigation!(
          '/inventory#inventory-row-2',
        );
        controls.motion.armBack(target, '/inventory#inventory-row-2');
        controls.scope.navigation!('/inventory#inventory-row-2');
        gesture?.close();
      });
      expect(controls.loading.store.snapshot()).not.toBeNull();
      expect(privacyNavigation.prepare).toHaveBeenCalledOnce();
    } finally {
      push.mockRestore();
      replace.mockRestore();
      Reflect.deleteProperty(document, 'activeViewTransition');
      source.remove();
      destination.remove();
    }
  },
);

it.each(['logout', 'revocation', 'provider retirement'])(
  'native traversal cannot revive presentation after %s',
  (reason) => {
    const { page, source } = detailFixture();
    act(() => {
      if (reason === 'logout') controls.logout();
      if (reason === 'revocation') revokePrivatePresentation();
    });
    if (reason === 'provider retirement') page.rerender(view({ actor: 'new' }));
    const back = traverse();
    window.history.replaceState(null, '', '/inventory');
    act(() => {
      navigation.emit('currententrychange');
      back.abort.abort();
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    expect(controls.motion.intent).toBeNull();
    expect(controls.loading.store.snapshot()).toBeNull();
    expect(privacyNavigation.prepare).not.toHaveBeenCalled();
    source.remove();
  },
);

it.each(['reduced', 'unsupported API', 'unsupported snapshots'])(
  '%s retains ordinary native navigation without animation preparation',
  (mode) => {
    const { page, source } = detailFixture();
    if (mode === 'unsupported API')
      Reflect.deleteProperty(window, 'navigation');
    else if (mode === 'unsupported snapshots')
      Reflect.deleteProperty(document, 'startViewTransition');
    else
      act(() => {
        localStorage.setItem('it-inventory-reduce-motion', 'true');
        window.dispatchEvent(
          new StorageEvent('storage', {
            key: 'it-inventory-reduce-motion',
          }),
        );
      });
    window.history.replaceState(null, '', '/inventory');
    act(() => window.dispatchEvent(new PopStateEvent('popstate')));
    runtime.pathname = '/inventory';
    page.rerender(view());
    expect(location.pathname).toBe('/inventory');
    expect(controls.motion.intent).toBeNull();
    expect(privacyNavigation.prepare).not.toHaveBeenCalled();
    expect(controls.loading.store.snapshot()).toBeNull();
    source.remove();
  },
);
