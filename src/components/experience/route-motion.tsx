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
  revokePrivatePresentation,
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
import { createRouteCaptureCompletion } from './route-capture-completion';
import { isInventoryCaptureName } from './inventory-capture-regions';
import { supportsConventionalRoutePrimary } from './conventional-route-primary';
import { createRoutePresentationLifetime } from './route-presentation-lifetime';
import { RoutePresentationLifetimeContext } from './route-presentation-source';
import { createAuxiliaryRouteCapture } from './auxiliary-route-capture';
import { AuxiliaryRouteCaptureContext } from './auxiliary-route-context';
import {
  RoutePendingContext,
  RouteProgress,
  RouteTransitionRunner,
} from './route-pending';
import {
  cancelRouteSnapshots,
  createRouteMotionState,
  matchesTitleListRoute,
  observeRouteSnapshotWithdrawal,
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
  captures: ReturnType<typeof createRouteCaptureCompletion>;
  beginLogoutAttempt: () => (confirmed: boolean) => void;
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
const emptyCaptureRevision = () => 0;

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

/** Suspension releases only through a new authoritative privacy check. */
export function useRouteMotionLogoutAttempt() {
  const context = useContext(RouteMotionContext);
  return () => context?.beginLogoutAttempt() ?? (() => {});
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
  const logoutAttempt = useRef<symbol | null>(null);
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
  const [auxiliary] = useState(createAuxiliaryRouteCapture);
  const [readiness] = useState(() => {
    const value = createRouteReadiness(
      actorId,
      pending,
      (key) => {
        loading.ready(key);
        const intent = state.snapshot();
        if (!intent) return;
        const destination = new URL(key, location.origin);
        if (
          destination.pathname !== intent.detailPath &&
          !matchesTitleListRoute(intent, key)
        )
          state.finish(intent.name);
      },
      (primary) => {
        auxiliary.ordinaryCommit(primary.routeKey);
        const owner = loading.snapshot();
        if (
          owner?.kind === 'primary' &&
          owner.destination === primary.routeKey &&
          pending.current(owner.epoch) &&
          primary.conventionalPrimary !== true
        ) {
          // Real authorized readiness still releases its wait normally below.
          // An unavailable primary cannot complete a shared body capture.
          state.finishArrival(owner.arrival);
        }
      },
    );
    value.suspend();
    return value;
  });
  const [nativeScroll] = useState(() =>
    createNativeScrollRestoration(readiness),
  );
  const [presentation] = useState(createRoutePresentationLifetime);
  const [captures] = useState(createRouteCaptureCompletion);
  const [owners] = useState(createRoutePendingOwners);
  const [navigationObservers] = useState(
    () => new Set<(href: string) => void>(),
  );
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
  const reduced = useEffectiveReducedMotion();
  const latestReduced = useRef(reduced);
  useLayoutEffect(() => {
    latestReduced.current = reduced;
  }, [reduced]);
  const scope = useMemo(
    () => ({
      state: pending,
      owners,
      observeNavigation: (observer: (href: string) => void) => {
        navigationObservers.add(observer);
        return () => {
          navigationObservers.delete(observer);
        };
      },
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
        auxiliary.withdraw();
        navigationObservers.forEach((observer) => {
          try {
            observer(href);
          } catch {
            /* UI observers cannot prevent accepted navigation. */
          }
        });
        presentation.navigation();
        const interruptedPair = loading.snapshot() !== null;
        loading.cancel();
        readiness.cancel();
        const target = state.acceptNavigation(href, pending.snapshot().epoch);
        const sourcePrimary = readiness.currentPrimary();
        let destination: URL | undefined;
        try {
          destination = new URL(href, location.origin);
        } catch {
          /* Unsupported URLs keep ordinary navigation. */
        }
        const primaryPresentation =
          !target &&
          !interruptedPair &&
          sourcePrimary?.conventionalPrimary === true &&
          sourcePrimary.routeKey === liveRouteKey.current &&
          supportsConventionalRoutePrimary(
            sourcePrimary.routeKey.split('?')[0],
          ) &&
          destination &&
          supportsConventionalRoutePrimary(destination.pathname) &&
          destination.origin === location.origin &&
          !destination.hash &&
          destination.pathname !== sourcePrimary.routeKey.split('?')[0] &&
          state.arrivalSupportSnapshot() &&
          !latestReduced.current &&
          supportsPairedRouteLoading() &&
          freshPresentationGrant(latestPrivacy.current) &&
          !suspended.current &&
          document.documentElement.dataset.motion === 'full';
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
            primaryPresentation ? 'primary' : 'outer',
          );
          const approval = state.arrivalSnapshot();
          if (primaryPresentation && approval) loading.armPrimary(approval);
        });
        const pairName = state.snapshot()?.name;
        const approval = pairName
          ? state.titleArrivalSnapshot()
          : state.arrivalSnapshot()?.presentation === 'primary'
            ? state.arrivalSnapshot()
            : null;
        const grant = acceptedGrant.current;
        const generation = latestPrivacy.current.generation;
        const source =
          approval && sourcePrimary
            ? auxiliary.source(sourcePrimary.root, approval.sourceKey)
            : undefined;
        if (
          approval &&
          sourcePrimary?.conventionalPrimary === true &&
          sourcePrimary.routeKey === approval.sourceKey &&
          grant &&
          source &&
          CSS.supports('view-transition-class', 'route-content')
        ) {
          const current = () =>
            lifecycleRef.current &&
            currentRouteProvider === providerToken &&
            pending.current(approval.epoch) &&
            state.valid() &&
            !suspended.current &&
            !latestReduced.current &&
            acceptedGrant.current?.revision === grant.revision &&
            acceptedGrant.current?.epoch === grant.epoch &&
            latestPrivacy.current.generation === generation &&
            retainedPresentationGrantCurrent(latestPrivacy.current, grant) &&
            document.documentElement.dataset.motion === 'full' &&
            document.documentElement.dataset.routeMotionPrivate === 'true';
          const admitted = () =>
            current() &&
            (pairName
              ? state.titleArrivalSnapshot() === approval &&
                state.snapshot()?.name === pairName
              : state.arrivalSnapshot() === approval);
          const base = pairName ? pairName + '-content' : approval.name;
          auxiliary.arm({
            token: approval,
            base,
            sourceKey: approval.sourceKey,
            destinationKey: approval.destinationKey,
            sourceRoot: sourcePrimary.root,
            handoff: presentation.exitCallback(source),
            current,
            admitted,
            participate: (name) =>
              isInventoryCaptureName(name, base) &&
              captures.capture({
                approval,
                name,
                current: admitted,
                captured: () => state.finishArrival(approval),
                body: () => true,
                complete: () => {
                  if (pairName) state.finish(pairName);
                },
                missing: () => {
                  state.finishArrival(approval);
                  if (pairName) state.finish(pairName);
                  cancelRouteSnapshots();
                },
              }),
          });
        }
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
      latestReduced,
      lifecycleRef,
      providerToken,
      presentation,
      liveRouteKey,
      navigationObservers,
      auxiliary,
      captures,
    ],
  );
  const pendingSnapshot = useSyncExternalStore(
    pending.subscribe,
    pending.snapshot,
    pending.snapshot,
  );
  useInsertionEffect(() => {
    // Child primary layout effects may notify readiness before this provider's
    // layout effect. Publish only committed authority before those callbacks.
    latestPrivacy.current = privacy;
    liveScrollActor.current = actorId;
  }, [privacy, actorId]);
  useInsertionEffect(() => {
    lifecycleRef.current = true;
    currentRouteProvider = providerToken;
    const unobserveAuxiliary = auxiliary.attach(document);
    const unbindAuxiliaryWithdrawal = observeRouteSnapshotWithdrawal(() =>
      auxiliary.withdraw(),
    );
    const reconcileAuxiliary = () => auxiliary.reconcile();
    const unbindAuxiliaryState = state.subscribe(reconcileAuxiliary);
    const unbindAuxiliaryPending = pending.subscribe(reconcileAuxiliary);
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
      auxiliary.withdraw();
      unobserveAuxiliary();
      unbindAuxiliaryWithdrawal();
      unbindAuxiliaryState();
      unbindAuxiliaryPending();
      unbindPrivacy();
      unbindNavigation?.();
      unbind();
      const ownsDocument = currentRouteProvider === providerToken;
      lifecycleRef.current = false;
      navigationObservers.clear();
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
    navigationObservers,
    auxiliary,
  ]);
  useLayoutEffect(() => {
    if (!lifecycleRef.current || currentRouteProvider !== providerToken) return;
    if (
      mountedActor.current === actorId &&
      freshPresentationGrant(privacy) &&
      logoutAttempt.current === null
    ) {
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
      if (owner.kind === 'primary') state.finishArrival(owner.arrival);
      else state.finish(owner.name);
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
        captures,
        withdrawGrant: () => {
          nativeScroll.invalidate();
          latestPrivacy.current.navigation?.retire(providerToken);
          document.documentElement.dataset.routeMotionPrivate = 'false';
          suspended.current = true;
          acceptedGrant.current = null;
          presentation.invalidate();
        },
        beginLogoutAttempt: () => {
          const current = () =>
            lifecycleRef.current && currentRouteProvider === providerToken;
          if (!current()) return () => {};
          const attempt = Symbol();
          logoutAttempt.current = attempt;
          // The existing privacy subscriber synchronously suspends stores and
          // cancels native snapshots before the form dispatches its action.
          revokePrivatePresentation();
          return (confirmed) => {
            if (!current() || logoutAttempt.current !== attempt) return;
            logoutAttempt.current = null;
            if (confirmed) {
              nativeScroll.invalidate();
              latestPrivacy.current.navigation?.retire(providerToken);
              suspended.current = true;
              acceptedGrant.current = null;
              presentation.invalidate();
              loading.cancel();
              pending.cancel(true);
              readiness.close();
              invalidateRouteMotion(state);
            }
            // Neither failure nor transport uncertainty is a grant. Retire any
            // check from during the attempt and ask the coordinator anew.
            revokePrivatePresentation();
          };
        },
      }}
    >
      <RoutePendingContext.Provider value={scope}>
        <RoutePresentationLifetimeContext value={presentation}>
          <AuxiliaryRouteCaptureContext value={auxiliary}>
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
                    (owner.kind === 'primary'
                      ? state.arrivalSnapshot() === owner.arrival &&
                        owner.arrival.presentation === 'primary'
                      : state.snapshot()?.name === owner.name) &&
                    document.documentElement.dataset.routeMotionPrivate ===
                      'true',
                }}
              >
                {children}
              </PairedRouteLoadingContext.Provider>
            </RouteReadyContext.Provider>
          </AuxiliaryRouteCaptureContext>
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
  const titleArrival = useSyncExternalStore(
    state?.subscribe ?? emptySubscribe,
    state?.titleArrivalSnapshot ?? emptyIntent,
    emptyIntent,
  );
  // A seal must publish even when the outer pathname already consumed arrival.
  // The receipt changes names only, never route/privacy/readiness authority.
  useSyncExternalStore(
    context?.captures.subscribe ?? emptySubscribe,
    context?.captures.snapshot ?? emptyCaptureRevision,
    emptyCaptureRevision,
  );
  const captureAvailable =
    context?.captures.available(titleArrival ?? arrival) !== false;
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
  const pairedArrivalEnabled =
    enabled &&
    !!intent &&
    !!titleArrival &&
    context?.pending.current(titleArrival.epoch) === true &&
    (key === titleArrival.sourceKey || key === titleArrival.destinationKey);
  const finishPairedAfterSnapshot = (
    instance: { name: string },
    body: boolean,
  ) => {
    const name = intent?.name;
    const approval = titleArrival;
    const contentName = name + '-content';
    const owned = () =>
      current() &&
      !!approval &&
      state?.titleArrivalSnapshot() === approval &&
      context?.pending.current(approval.epoch) === true;
    if (
      !name ||
      !approval ||
      !(body
        ? isInventoryCaptureName(instance.name, contentName)
        : instance.name === name) ||
      !owned()
    )
      return false;
    return context!.captures.capture({
      approval,
      name: instance.name,
      current: owned,
      captured: () => state?.finishArrival(approval),
      body: (participant) => participant !== name,
      complete: () => state?.finish(name),
      missing: () => {
        state?.finishArrival(approval);
        state?.finish(name);
        cancelRouteSnapshots();
      },
    });
  };
  return {
    enabled,
    captureAvailable,
    arrivalEnabled:
      enabled &&
      !pairedArrivalEnabled &&
      arrival?.presentation !== 'primary' &&
      !!arrival &&
      context?.pending.current(arrival.epoch) === true &&
      (key === arrival.sourceKey || key === arrival.destinationKey),
    arrival,
    pairedArrivalEnabled,
    titleArrival:
      enabled && titleArrival && context?.pending.current(titleArrival.epoch)
        ? titleArrival
        : null,
    finishArrival: () => {
      if (
        current() &&
        arrival &&
        arrival.presentation !== 'primary' &&
        (key === arrival.destinationKey || key !== arrival.sourceKey)
      )
        state?.finishArrival(arrival);
    },
    pathname: context?.pathname,
    listHref: context?.listHref,
    intent: enabled ? intent : null,
    current,
    rejectTitleSnapshot: () => {
      if (!current() || !intent) return;
      // A failed pair reveals its live destination directly. Its later outer
      // commit must not start a generic snapshot of that same navigation.
      // Exact captured identities protect a newer navigation from late cleanup.
      if (arrival) state?.finishArrival(arrival);
      state?.finish(intent.name);
    },
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
    finishPrimaryAfterSnapshot: (instance: { name: string }) => {
      if (
        !current() ||
        arrival?.presentation !== 'primary' ||
        !isInventoryCaptureName(instance.name, arrival.name) ||
        state?.arrivalSnapshot() !== arrival
      )
        return false;
      const approval = arrival;
      return context!.captures.capture({
        approval,
        name: instance.name,
        current: () => current() && state?.arrivalSnapshot() === approval,
        captured: () => state?.finishArrival(approval),
        body: () => true,
        complete: () => {},
        missing: () => {
          state?.finishArrival(approval);
          cancelRouteSnapshots();
        },
      });
    },
    finishArrivalAfterSnapshot: (instance: { name: string }) => {
      if (!arrival || arrival.presentation === 'primary') return;
      // Generic page snapshots own only their exact arrival. Their completion
      // can precede an inner shared title's commit and must not consume it.
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
          if (current()) state?.finishArrival(arrival);
        });
      });
    },
    finishTitleAfterSnapshot: (instance: { name: string }) =>
      finishPairedAfterSnapshot(instance, false),
    finishPairedContentAfterSnapshot: (instance: { name: string }) =>
      finishPairedAfterSnapshot(instance, true),
    validNow: () =>
      current() &&
      !!state?.valid() &&
      document.documentElement.dataset.motion === 'full' &&
      document.documentElement.dataset.routeMotionPrivate === 'true',
  };
}
