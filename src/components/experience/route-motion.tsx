'use client';

import {
  createContext,
  useContext,
  useEffect,
  useInsertionEffect,
  useLayoutEffect,
  useRef,
  useMemo,
  useState,
  useSyncExternalStore,
} from 'react';
import {
  usePrivacyReadiness,
  usePrivacyRevocationRevision,
} from '@/components/auth/privacy-readiness';
import {
  assignmentEpoch,
  readPrivacyRevocationRevision,
  subscribePrivacyRevocation,
} from '@/features/scan/assign-batch';
import {
  freshPresentationGrant,
  retainedPresentationGrantCurrent,
} from './presentation-privacy';
import { flushSync } from 'react-dom';
import { usePathname, useSearchParams } from 'next/navigation';
import { createSupabaseBrowserClient } from '@/lib/supabase/browser';
import { useEffectiveReducedMotion } from './motion-preference';
import { bindRouteActionResults } from './route-action-result';
import { createRoutePendingState } from './route-pending-state';
import { createRoutePendingOwners } from './route-pending-owners';
import { createRouteReadiness } from './route-readiness';
import { createNativeScrollRestoration } from './native-scroll-restoration';
import { RouteReadyContext } from './route-ready';
import { createPairedRouteLoading } from './paired-route-loading-state';
import {
  PairedRouteLoadingContext,
  supportsPairedRouteLoading,
} from './paired-route-loading';
import { routeKey } from './route-key';
import { createRoutePresentationLifetime } from './route-presentation-lifetime';
import { RoutePresentationLifetimeContext } from './route-presentation-source';
import {
  RoutePendingContext,
  RouteProgress,
  RouteTransitionRunner,
} from './route-pending';
import {
  cancelRouteSnapshots,
  createRouteMotionState,
  matchesTitleListRoute,
} from './route-motion-state';

const RouteMotionContext = createContext<{
  state: ReturnType<typeof createRouteMotionState>;
  pathname: string | null;
  listHref: string;
  pending: ReturnType<typeof createRoutePendingState>;
  readiness: ReturnType<typeof createRouteReadiness>;
  loading: ReturnType<typeof createPairedRouteLoading>;
  lifecycleRef: { current: boolean };
  providerToken: symbol;
  withdrawGrant: () => void;
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
    context.withdrawGrant();
    context.loading.cancel();
    context.pending.cancel(true);
    context.readiness.close();
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
  const privacy = usePrivacyReadiness();
  const privacyRevision = usePrivacyRevocationRevision();
  const latestPrivacy = useRef(privacy);
  const mountedActor = useRef(actorId);
  const liveScrollActor = useRef(actorId);
  const suspended = useRef(true);
  const acceptedGrant = useRef<{ revision: number; epoch: number } | null>(
    null,
  );
  const [state] = useState(() => {
    const value = createRouteMotionState();
    value.suspend(false);
    return value;
  });
  const [pending] = useState(() => {
    const value = createRoutePendingState();
    value.suspend();
    return value;
  });
  const lifecycleRef = useRef(true);
  const [providerToken] = useState(() => Symbol());
  const [loading] = useState(() => createPairedRouteLoading(pending));
  const [readiness] = useState(() => {
    const value = createRouteReadiness(actorId, pending, (key) => {
      loading.ready(key);
      const intent = state.snapshot();
      if (!intent) return;
      const destination = new URL(key, location.origin);
      if (
        destination.pathname !== intent.detailPath &&
        !matchesTitleListRoute(intent, key)
      )
        state.finish(intent.name);
    });
    value.suspend();
    return value;
  });
  const [nativeScroll] = useState(() =>
    createNativeScrollRestoration(readiness),
  );
  const [presentation] = useState(createRoutePresentationLifetime);
  const [owners] = useState(createRoutePendingOwners);
  const pathname = usePathname();
  const query = useSearchParams();
  const listHref = pathname + (query?.size ? `?${query}` : '');
  const committedRouteKey = routeKey(
    pathname ?? '',
    query ?? new URLSearchParams(),
  );
  const liveRouteKey = useRef(committedRouteKey);
  useLayoutEffect(() => {
    liveRouteKey.current = committedRouteKey;
  }, [committedRouteKey]);
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
        if (
          !lifecycleRef.current ||
          currentRouteProvider !== providerToken ||
          !state.valid()
        )
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
        if (
          !lifecycleRef.current ||
          currentRouteProvider !== providerToken ||
          !state.valid()
        )
          return;
        presentation.navigation();
        const interruptedPair = loading.snapshot() !== null;
        loading.cancel();
        readiness.cancel();
        const target = state.acceptNavigation(href, pending.snapshot().epoch);
        // Pair approval lives only inside this accepted Link event. Plain detail
        // links/router calls retire an older origin instead of reusing its holding.
        // A second accepted navigation retires the unfinished pair. Its original
        // source may already be leaving; use ordinary loading/crossfade instead
        // of claiming another shared-title source or blocking a server redirect.
        if (interruptedPair) cancelRouteSnapshots();
        flushSync(() => {
          if (target && !interruptedPair && state.arrivalSupportSnapshot()) {
            state.arm(target);
            const intent = state.snapshot();
            const url = new URL(href, location.origin);
            const list = new URL(target.listHref, location.origin);
            const pairedDestination =
              url.pathname === target.detailPath ||
              routeKey(url.pathname, url.searchParams) ===
                routeKey(list.pathname, list.searchParams);
            if (
              intent &&
              pairedDestination &&
              freshPresentationGrant(latestPrivacy.current) &&
              !suspended.current &&
              supportsPairedRouteLoading() &&
              document.documentElement.dataset.motion === 'full'
            )
              loading.arm(intent.name, href, pending.snapshot().epoch);
          } else state.retire();
          state.acceptArrival(
            href,
            liveRouteKey.current,
            pending.snapshot().epoch,
            location.href,
          );
        });
        if (loading.snapshot())
          latestPrivacy.current.navigation?.prepare(href, providerToken);
        else latestPrivacy.current.navigation?.retire(providerToken);
      },
      terminal: () => {
        if (
          !lifecycleRef.current ||
          currentRouteProvider !== providerToken ||
          !state.valid()
        )
          return;
        presentation.invalidate();
        latestPrivacy.current.navigation?.retire(providerToken);
        // Generic route failure retires presentation, not verified actor eligibility.
        // An already-invalid access scope is never re-enabled here.
        cancelRouteSnapshots();
        loading.cancel();
        state.retire();
        pending.cancel();
        readiness.cancel();
      },
    }),
    [
      pending,
      state,
      readiness,
      loading,
      owners,
      lifecycleRef,
      providerToken,
      presentation,
      liveRouteKey,
    ],
  );
  const pendingSnapshot = useSyncExternalStore(
    pending.subscribe,
    pending.snapshot,
    pending.snapshot,
  );
  const reduced = useEffectiveReducedMotion();
  useInsertionEffect(() => {
    // Child primary layout effects may notify readiness before this provider's
    // layout effect. Publish only committed authority before those callbacks.
    latestPrivacy.current = privacy;
    liveScrollActor.current = actorId;
  }, [privacy, actorId]);
  useInsertionEffect(() => {
    lifecycleRef.current = true;
    currentRouteProvider = providerToken;
    nativeScroll.bindAuthority(() => {
      const value = latestPrivacy.current;
      if (
        !lifecycleRef.current ||
        currentRouteProvider !== providerToken ||
        mountedActor.current !== liveScrollActor.current ||
        value.revocationRevision !== readPrivacyRevocationRevision() ||
        (value.ready && !(value.visible ?? value.ready))
      )
        return null;
      return {
        key: JSON.stringify([
          mountedActor.current,
          value.generation,
          value.revocationRevision,
          assignmentEpoch(),
        ]),
        ready: freshPresentationGrant(value),
      };
    });
    const unbindNavigation =
      latestPrivacy.current.navigation?.bind(providerToken);
    const suspendPresentation = () => {
      if (!lifecycleRef.current || currentRouteProvider !== providerToken)
        return;
      nativeScroll.invalidate();
      document.documentElement.dataset.routeMotionPrivate = 'false';
      suspended.current = true;
      acceptedGrant.current = null;
      presentation.invalidate();
      latestPrivacy.current.navigation?.retire(providerToken);
      // Invalidate the store generation before cancellation can invoke apply.
      state.suspend();
      loading.cancel();
      pending.suspend();
      readiness.suspend();
      cancelRouteSnapshots();
    };
    const unbindPrivacy = subscribePrivacyRevocation(suspendPresentation);
    document.documentElement.dataset.routeMotionPrivate = 'false';
    const unbind = bindRouteActionResults(
      () => {
        if (
          !lifecycleRef.current ||
          currentRouteProvider !== providerToken ||
          !state.valid()
        )
          return;
        nativeScroll.invalidate();
        document.documentElement.dataset.routeMotionPrivate = 'false';
        suspended.current = true;
        acceptedGrant.current = null;
        presentation.invalidate();
        latestPrivacy.current.navigation?.retire(providerToken);
        loading.cancel();
        pending.cancel(true);
        readiness.close();
        invalidateRouteMotion(state);
      },
      undefined,
      () => {
        const epoch = pending.snapshot().epoch;
        return () => pending.current(epoch);
      },
      (ownerCurrent, source) => {
        const grant = acceptedGrant.current;
        const privacyGeneration = latestPrivacy.current.generation;
        if (!grant) return undefined;
        return presentation.capture(
          source,
          ownerCurrent,
          () =>
            lifecycleRef.current &&
            currentRouteProvider === providerToken &&
            !suspended.current &&
            state.valid() &&
            acceptedGrant.current?.revision === grant.revision &&
            acceptedGrant.current?.epoch === grant.epoch &&
            latestPrivacy.current.generation === privacyGeneration &&
            retainedPresentationGrantCurrent(latestPrivacy.current, grant),
        );
      },
    );
    return () => {
      unbindPrivacy();
      unbindNavigation?.();
      unbind();
      const ownsDocument = currentRouteProvider === providerToken;
      lifecycleRef.current = false;
      nativeScroll.dispose();
      latestPrivacy.current.navigation?.retire(providerToken);
      presentation.invalidate();
      if (ownsDocument) {
        acceptedGrant.current = null;
      }
      pending.cancel(true, false);
      loading.cancel(false);
      owners.dispose();
      readiness.close();
      if (ownsDocument) {
        currentRouteProvider = undefined;
        invalidateRouteMotion(state, false);
      } else state.invalidate(false);
    };
  }, [
    state,
    pending,
    scope,
    readiness,
    loading,
    owners,
    lifecycleRef,
    providerToken,
    presentation,
    nativeScroll,
  ]);
  useLayoutEffect(() => {
    if (!lifecycleRef.current || currentRouteProvider !== providerToken) return;
    if (mountedActor.current === actorId && freshPresentationGrant(privacy)) {
      if (suspended.current && state.resume()) {
        suspended.current = false;
        readiness.resume();
        pending.resume();
      }
      if (state.valid()) {
        acceptedGrant.current = {
          revision: privacy.revocationRevision!,
          epoch: privacy.verifiedEpoch!,
        };
        document.documentElement.dataset.routeMotionPrivate = 'true';
      }
    } else if (!(
      mountedActor.current === actorId &&
      !privacy.ready &&
      privacy.visible === true &&
      !suspended.current &&
      state.valid() &&
      retainedPresentationGrantCurrent(privacy, acceptedGrant.current)
    )) {
      document.documentElement.dataset.routeMotionPrivate = 'false';
      suspended.current = true;
      acceptedGrant.current = null;
      presentation.invalidate();
      latestPrivacy.current.navigation?.retire(providerToken);
      state.suspend();
      loading.cancel();
      pending.suspend();
      readiness.suspend();
      cancelRouteSnapshots();
    }
    // Temporary same-authority rechecks freeze checkpoints independently of
    // presentation visibility. Only a fresh grant and real primary can restore.
    nativeScroll.reconcile();
  }, [
    privacy,
    privacyRevision,
    actorId,
    state,
    pending,
    readiness,
    loading,
    providerToken,
    presentation,
    nativeScroll,
  ]);
  useEffect(() => {
    nativeScroll.attach();
    return nativeScroll.detach;
  }, [nativeScroll]);
  useEffect(() => {
    let observing = true;
    let navigation: Navigation | undefined;
    const traverse = (event: Event) => {
      if (
        (event as NavigateEvent).navigationType !== 'traverse' ||
        !observing ||
        !lifecycleRef.current ||
        currentRouteProvider !== providerToken ||
        (!state.arrivalSnapshot() && !state.snapshot())
      )
        return;
      // Passive observation runs before history restore. Commit the withdrawn
      // generic/title boundary classes before Next can synchronously restore a
      // page. Preserve the title origin for a later accepted application Back.
      // Never intercept traversal or alter privacy or readiness owners.
      flushSync(() => {
        state.finishArrival();
        state.finish();
      });
    };
    try {
      const candidate = window.navigation;
      if (
        typeof candidate?.addEventListener !== 'function' ||
        typeof candidate.removeEventListener !== 'function'
      )
        return;
      navigation = candidate;
      navigation.addEventListener('navigate', traverse);
      state.supportArrival(true);
    } catch {
      observing = false;
      state.supportArrival(false);
      try {
        navigation?.removeEventListener('navigate', traverse);
      } catch {
        /* A failed observer cannot authorize generic arrival motion. */
      }
      return;
    }
    return () => {
      observing = false;
      state.supportArrival(false);
      try {
        navigation?.removeEventListener('navigate', traverse);
      } catch {
        /* The retired provider callback remains permanently inert. */
      }
    };
  }, [state, providerToken]);
  useEffect(() => {
    let listening = true;
    const invalidate = () => {
      if (
        !listening ||
        !lifecycleRef.current ||
        currentRouteProvider !== providerToken
      )
        return;
      nativeScroll.invalidate();
      document.documentElement.dataset.routeMotionPrivate = 'false';
      suspended.current = true;
      acceptedGrant.current = null;
      presentation.invalidate();
      latestPrivacy.current.navigation?.retire(providerToken);
      loading.cancel();
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
      if (
        !listening ||
        !lifecycleRef.current ||
        currentRouteProvider !== providerToken
      )
        return;
      // Next restores native Back/Forward eagerly. Retire the departing motion
      // and wait for ordinary authorized readiness without preparing a pair or
      // delaying/intercepting the browser's restore. Keep the approved origin
      // so app Back after native Forward can still use its accepted Link event.
      presentation.navigation();
      latestPrivacy.current.navigation?.retire(providerToken);
      loading.cancel();
      pending.cancel();
      readiness.cancel();
      state.finishArrival();
      state.finish();
      cancelRouteSnapshots();
      readiness.history();
      nativeScroll.reconcile();
    };
    window.addEventListener('popstate', pop, true);
    return () => {
      listening = false;
      subscription.unsubscribe();
      window.removeEventListener('popstate', pop, true);
    };
  }, [
    state,
    actorId,
    pending,
    readiness,
    loading,
    lifecycleRef,
    providerToken,
    presentation,
    nativeScroll,
  ]);
  useEffect(() => {
    // Next may redirect through its own router, without an accepted Link event.
    // A different committed route cancels only this presentation wait; actual
    // fallback, Link and task registrations still require their own settlement.
    // Depend on the route key, never on arming: L must not cancel A before Next
    // has committed A's pathname/query context.
    const owner = loading.snapshot();
    if (owner && owner.destination !== committedRouteKey) {
      loading.cancel();
      state.finish(owner.name);
    }
  }, [committedRouteKey, loading, state]);
  useEffect(() => {
    if (
      reduced &&
      lifecycleRef.current &&
      currentRouteProvider === providerToken
    ) {
      presentation.invalidate();
      latestPrivacy.current.navigation?.retire(providerToken);
      loading.cancel();
      state.finishArrival();
      state.finish();
      cancelRouteSnapshots();
    }
  }, [state, loading, reduced, lifecycleRef, providerToken, presentation]);
  return (
    <RouteMotionContext.Provider
      value={{
        state,
        pathname,
        listHref,
        pending,
        readiness,
        loading,
        lifecycleRef,
        providerToken,
        withdrawGrant: () => {
          nativeScroll.invalidate();
          latestPrivacy.current.navigation?.retire(providerToken);
          document.documentElement.dataset.routeMotionPrivate = 'false';
          suspended.current = true;
          acceptedGrant.current = null;
          presentation.invalidate();
        },
      }}
    >
      <RoutePendingContext.Provider value={scope}>
        <RoutePresentationLifetimeContext value={presentation}>
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
            <PairedRouteLoadingContext.Provider
              value={{
                store: loading,
                valid: (owner) =>
                  lifecycleRef.current &&
                  currentRouteProvider === providerToken &&
                  loading.snapshot() === owner &&
                  pending.current(owner.epoch) &&
                  state.valid() &&
                  mountedActor.current === actorId &&
                  !suspended.current &&
                  retainedPresentationGrantCurrent(
                    privacy,
                    acceptedGrant.current,
                  ) &&
                  state.snapshot()?.name === owner.name &&
                  document.documentElement.dataset.routeMotionPrivate ===
                    'true',
              }}
            >
              {children}
            </PairedRouteLoadingContext.Provider>
          </RouteReadyContext.Provider>
        </RoutePresentationLifetimeContext>
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
  const observerSupport = useSyncExternalStore(
    state?.subscribe ?? emptySubscribe,
    state?.arrivalSupportSnapshot ?? serverSupported,
    serverSupported,
  );
  const enabled = support && observerSupport && !reduced && !!state?.valid();
  const arrival = useSyncExternalStore(
    state?.subscribe ?? emptySubscribe,
    state?.arrivalSnapshot ?? emptyIntent,
    emptyIntent,
  );
  const epoch = context?.pending.snapshot().epoch;
  const key = context?.listHref
    ? (() => {
        const url = new URL(context.listHref, 'https://inventory.invalid');
        return routeKey(url.pathname, url.searchParams);
      })()
    : undefined;
  const current = () =>
    !!context?.lifecycleRef.current &&
    currentRouteProvider === context.providerToken &&
    context.pending.current(epoch!) &&
    (!intent || state?.snapshot()?.name === intent.name);
  return {
    enabled,
    arrivalEnabled:
      enabled &&
      !!arrival &&
      context?.pending.current(arrival.epoch) === true &&
      (key === arrival.sourceKey || key === arrival.destinationKey),
    arrival,
    finishArrival: () => {
      if (
        current() &&
        arrival &&
        (key === arrival.destinationKey || key !== arrival.sourceKey)
      )
        state?.finishArrival(arrival);
    },
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
