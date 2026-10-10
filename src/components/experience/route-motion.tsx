'use client';

import {
  createContext,
  useContext,
  useEffect,
  useInsertionEffect,
  useRef,
  useMemo,
  useState,
  useSyncExternalStore,
} from 'react';
import { flushSync } from 'react-dom';
import { usePathname, useSearchParams } from 'next/navigation';
import { createSupabaseBrowserClient } from '@/lib/supabase/browser';
import { useEffectiveReducedMotion } from './motion-preference';
import { bindRouteActionResults } from './route-action-result';
import { createRoutePendingState } from './route-pending-state';
import { createRoutePendingOwners } from './route-pending-owners';
import { createRouteReadiness } from './route-readiness';
import { RouteReadyContext } from './route-ready';
import { routeKey } from './route-key';
import {
  RoutePendingContext,
  RouteProgress,
  RouteTransitionRunner,
} from './route-pending';
import {
  cancelRouteSnapshots,
  createRouteMotionState,
} from './route-motion-state';

const RouteMotionContext = createContext<{
  state: ReturnType<typeof createRouteMotionState>;
  pathname: string | null;
  listHref: string;
  pending: ReturnType<typeof createRoutePendingState>;
  readiness: ReturnType<typeof createRouteReadiness>;
  lifecycleRef: { current: boolean };
  providerToken: symbol;
} | null>(null);
// Client insertion effects alone bind this opaque presentation owner. No actor,
// credentials, request state or private DOM is stored in a module singleton.
let currentRouteProvider: symbol | undefined;
const subscribeSupport = () => () => {};
const supported = () =>
  typeof document.startViewTransition === 'function' &&
  typeof CSS !== 'undefined' &&
  typeof CSS.supports === 'function' &&
  CSS.supports('selector(::view-transition-group(.route-content))');
const serverSupported = () => false;
const emptyIntent = () => null;
const emptySubscribe = () => () => {};

function invalidateRouteMotion(
  state?: ReturnType<typeof createRouteMotionState>,
  notifyListeners = true,
) {
  document.documentElement.dataset.routeMotionPrivate = 'false';
  state?.invalidate(notifyListeners);
  cancelRouteSnapshots();
}

/** Call only after the originating form's existing permission guard allows exit. */
export function useInvalidateRouteMotion() {
  const context = useContext(RouteMotionContext);
  return () => {
    if (
      !context?.lifecycleRef.current ||
      currentRouteProvider !== context.providerToken
    )
      return;
    context?.pending.cancel(true);
    context?.readiness.close();
    invalidateRouteMotion(context?.state);
  };
}

export function RouteMotionProvider({
  actorId,
  children,
}: {
  actorId: string;
  children: React.ReactNode;
}) {
  const [state] = useState(createRouteMotionState);
  const [pending] = useState(createRoutePendingState);
  const lifecycleRef = useRef(true);
  const [providerToken] = useState(() => Symbol());
  const [readiness] = useState(() =>
    createRouteReadiness(actorId, pending, (key) => {
      const intent = state.snapshot();
      if (!intent) return;
      const destination = new URL(key, location.origin);
      const list = new URL(intent.listHref, location.origin);
      if (
        destination.pathname !== intent.detailPath &&
        key !== routeKey(list.pathname, list.searchParams)
      )
        state.finish(intent.name);
    }),
  );
  const [owners] = useState(createRoutePendingOwners);
  const mountedOwners = useSyncExternalStore(
    owners.subscribe,
    owners.snapshot,
    owners.snapshot,
  );
  const scope = useMemo(
    () => ({
      state: pending,
      owners,
      beginNavigation: (href: string) => {
        if (!lifecycleRef.current || currentRouteProvider !== providerToken)
          return;
        const epoch = pending.snapshot().epoch;
        return {
          close: state.beginNavigation(href, epoch),
          current: () =>
            lifecycleRef.current &&
            currentRouteProvider === providerToken &&
            pending.current(epoch),
        };
      },
      navigation: (href: string) => {
        if (!lifecycleRef.current || currentRouteProvider !== providerToken)
          return;
        readiness.cancel();
        const target = state.acceptNavigation(href, pending.snapshot().epoch);
        // Pair approval lives only inside this accepted Link event. Plain detail
        // links/router calls retire an older origin instead of reusing its holding.
        if (target) flushSync(() => state.arm(target));
        else state.retire();
      },
      terminal: () => {
        if (!lifecycleRef.current || currentRouteProvider !== providerToken)
          return;
        // Generic route failure retires presentation, not verified actor eligibility.
        // An already-invalid access scope is never re-enabled here.
        cancelRouteSnapshots();
        state.retire();
        pending.cancel();
        readiness.cancel();
      },
    }),
    [pending, state, readiness, owners, lifecycleRef, providerToken],
  );
  const pendingSnapshot = useSyncExternalStore(
    pending.subscribe,
    pending.snapshot,
    pending.snapshot,
  );
  const pathname = usePathname();
  const query = useSearchParams();
  const listHref = pathname + (query?.size ? `?${query}` : '');
  const reduced = useEffectiveReducedMotion();
  useInsertionEffect(() => {
    lifecycleRef.current = true;
    currentRouteProvider = providerToken;
    document.documentElement.dataset.routeMotionPrivate = 'true';
    const unbind = bindRouteActionResults(
      () => {
        if (!lifecycleRef.current || currentRouteProvider !== providerToken)
          return;
        pending.cancel();
        readiness.cancel();
        invalidateRouteMotion(state);
      },
      undefined,
      () => {
        const epoch = pending.snapshot().epoch;
        return () => pending.current(epoch);
      },
    );
    return () => {
      unbind();
      const ownsDocument = currentRouteProvider === providerToken;
      lifecycleRef.current = false;
      pending.cancel(true, false);
      owners.dispose();
      readiness.close();
      if (ownsDocument) {
        currentRouteProvider = undefined;
        invalidateRouteMotion(state, false);
      } else state.invalidate(false);
    };
  }, [
    state,
    actorId,
    pending,
    scope,
    readiness,
    owners,
    lifecycleRef,
    providerToken,
  ]);
  useEffect(() => {
    let listening = true;
    const invalidate = () => {
      if (
        !listening ||
        !lifecycleRef.current ||
        currentRouteProvider !== providerToken
      )
        return;
      pending.cancel(true);
      readiness.close();
      invalidateRouteMotion(state);
    };
    const {
      data: { subscription },
    } = createSupabaseBrowserClient().auth.onAuthStateChange(
      (_event, session) => {
        if (!session || session.user.id !== actorId) invalidate();
      },
    );
    const pop = () => {
      pending.cancel();
      readiness.cancel();
      flushSync(() => {
        state.finish();
        state.back(
          pathname ?? '',
          location.pathname + location.search + location.hash,
        );
      });
      readiness.history();
    };
    window.addEventListener('popstate', pop);
    return () => {
      listening = false;
      subscription.unsubscribe();
      window.removeEventListener('popstate', pop);
    };
  }, [
    state,
    actorId,
    pathname,
    pending,
    readiness,
    lifecycleRef,
    providerToken,
  ]);
  useEffect(() => {
    if (
      reduced &&
      lifecycleRef.current &&
      currentRouteProvider === providerToken
    ) {
      state.finish();
      cancelRouteSnapshots();
    }
  }, [state, reduced, lifecycleRef, providerToken]);
  return (
    <RouteMotionContext.Provider
      value={{
        state,
        pathname,
        listHref,
        pending,
        readiness,
        lifecycleRef,
        providerToken,
      }}
    >
      <RoutePendingContext.Provider value={scope}>
        {mountedOwners.map((owner) => (
          <RouteTransitionRunner
            key={`${owner.id}:${pendingSnapshot.epoch}`}
            scope={scope}
            epoch={pendingSnapshot.epoch}
            owner={owner}
          />
        ))}
        <RouteProgress />
        <RouteReadyContext.Provider value={readiness}>
          {children}
        </RouteReadyContext.Provider>
      </RoutePendingContext.Provider>
    </RouteMotionContext.Provider>
  );
}

export function useRouteMotion() {
  const context = useContext(RouteMotionContext);
  const state = context?.state;
  const reduced = useEffectiveReducedMotion();
  const support = useSyncExternalStore(
    subscribeSupport,
    supported,
    serverSupported,
  );
  const intent = useSyncExternalStore(
    state?.subscribe ?? emptySubscribe,
    state?.snapshot ?? emptyIntent,
    emptyIntent,
  );
  const enabled = support && !reduced && !!state?.valid();
  const epoch = context?.pending.snapshot().epoch;
  const current = () =>
    !!context?.lifecycleRef.current &&
    currentRouteProvider === context.providerToken &&
    context.pending.current(epoch!) &&
    (!intent || state?.snapshot()?.name === intent.name);
  return {
    enabled,
    pathname: context?.pathname,
    listHref: context?.listHref,
    intent: enabled ? intent : null,
    current,
    retireTitle: () => {
      if (current()) state?.stageNavigation(null);
    },
    arm: (target: Parameters<NonNullable<typeof state>['arm']>[0]) => {
      if (current()) state?.stageNavigation(enabled ? target : null);
    },
    armBack: (
      record: Parameters<NonNullable<typeof state>['backTarget']>[0],
      href: string,
    ) => {
      const target = state?.backTarget(record, href);
      if (current()) state?.stageNavigation(enabled && target ? target : null);
    },
    cancelIfInvalid: () => {
      if (!current()) return;
      if (
        !state?.valid() ||
        document.documentElement.dataset.motion !== 'full' ||
        document.documentElement.dataset.routeMotionPrivate !== 'true'
      )
        cancelRouteSnapshots();
    },
    finishAfterSnapshot: (instance: { name: string }) => {
      const name = intent?.name;
      if (!name) return;
      // React has captured the commit. Observe only its matching native
      // snapshot lifetime; a late completion cannot consume another intent.
      queueMicrotask(() => {
        if (!current()) return;
        const animations =
          document
            .getAnimations?.()
            .filter((animation) =>
              (
                animation.effect as KeyframeEffect | null
              )?.pseudoElement?.endsWith(`(${instance.name})`),
            ) ?? [];
        void Promise.allSettled(
          animations.map((animation) => animation.finished),
        ).then(() => {
          if (current()) state?.finish(name);
        });
      });
    },
    validNow: () =>
      current() &&
      !!state?.valid() &&
      document.documentElement.dataset.motion === 'full' &&
      document.documentElement.dataset.routeMotionPrivate === 'true',
  };
}
