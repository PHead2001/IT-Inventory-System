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
import { createRouteCommandState } from './route-command-state';
import { createApplicationReturn } from './application-return';
import {
  RouteReadyContext,
  RouteNavigationIdentityContext,
} from './route-ready';
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
  applicationReturn: ReturnType<typeof createApplicationReturn>;
  lifecycleRef: { current: boolean };
  providerToken: symbol;
  commands: ReturnType<typeof createRouteCommandState>;
  actorId: string;
  latestPrivacy: { current: ReturnType<typeof usePrivacyReadiness> };
  withdrawGrant: () => void;
  captures: ReturnType<typeof createRouteCaptureCompletion>;
  beginLogoutAttempt: () => (confirmed: boolean) => void;
} | null>(null);
// Client insertion effects alone bind this opaque presentation owner. No actor,
// credentials, request state or private DOM is stored in a module singleton.
let currentRouteProvider: symbol | undefined;
const subscribeSupport = () => () => {};
const supported = supportsPairedRouteLoading;
const serverSupported = () => false;
const commandDestination = (href: string | undefined) => {
  if (!href) return null;
  try {
    const url = new URL(href, location.href);
    return url.origin === location.origin
      ? routeKey(url.pathname, url.searchParams)
      : null;
  } catch {
    return null;
  }
};
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
  const [mountedActor] = useState(actorId);
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
  const [commands] = useState(createRouteCommandState);
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
  const [applicationReturn] = useState(() =>
    createApplicationReturn(readiness),
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
    applicationReturn.routeChanged(committedRouteKey);
  }, [committedRouteKey, applicationReturn]);
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
        const closeMotion = state.beginNavigation(href, epoch);
        const closeReturn = applicationReturn.beginNavigation(href, epoch);
        return {
          close: () => {
            closeMotion();
            closeReturn();
          },
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
        commands.navigation(commandDestination(href));
        applicationReturn.acceptNavigation(href, pending.snapshot().epoch);
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
        commands.retire();
        presentation.invalidate();
        applicationReturn.invalidate();
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
      commands,
      navigationObservers,
      auxiliary,
      captures,
      applicationReturn,
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
    if (
      latestPrivacy.current.generation !== privacy.generation ||
      mountedActor !== actorId
    )
      commands.retire(false);
    latestPrivacy.current = privacy;
    liveScrollActor.current = actorId;
  }, [privacy, actorId, commands]);
  useLayoutEffect(() => {
    commands.publish();
  }, [privacy, actorId, commands]);
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
    const readAuthority = () => {
      const value = latestPrivacy.current;
      if (
        !lifecycleRef.current ||
        currentRouteProvider !== providerToken ||
        mountedActor !== liveScrollActor.current ||
        value.revocationRevision !== readPrivacyRevocationRevision() ||
        (value.ready && !(value.visible ?? value.ready))
      )
        return null;
      return {
        key: JSON.stringify([
          mountedActor,
          value.generation,
          value.revocationRevision,
          assignmentEpoch(),
        ]),
        ready: freshPresentationGrant(value),
      };
    };
    nativeScroll.bindAuthority(readAuthority);
    applicationReturn.bindAuthority(readAuthority);
    const unbindNavigation =
      latestPrivacy.current.navigation?.bind(providerToken);
    const suspendPresentation = () => {
      if (!lifecycleRef.current || currentRouteProvider !== providerToken)
        return;
      commands.retire();
      nativeScroll.invalidate();
      applicationReturn.invalidate();
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
        commands.retire();
        nativeScroll.invalidate();
        applicationReturn.invalidate();
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
      commands.retire(false);
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
      applicationReturn.dispose();
      latestPrivacy.current.navigation?.retire(providerToken);
      presentation.invalidate();
      if (ownsDocument) {
        acceptedGrant.current = null;
      }
      pending.cancel(true, false);
      loading.cancel(false);
      owners.dispose();
      readiness.close(false);
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
    commands,
    applicationReturn,
    navigationObservers,
    auxiliary,
  ]);
  useLayoutEffect(() => {
    if (!lifecycleRef.current || currentRouteProvider !== providerToken) return;
    if (
      mountedActor === actorId &&
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
      mountedActor === actorId &&
      !privacy.ready &&
      privacy.visible === true &&
      !suspended.current &&
      state.valid() &&
      retainedPresentationGrantCurrent(privacy, acceptedGrant.current)
    )) {
      commands.retire();
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
    applicationReturn.reconcile();
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
    commands,
    mountedActor,
    applicationReturn,
  ]);
  useEffect(() => {
    nativeScroll.attach();
    return nativeScroll.detach;
  }, [nativeScroll]);
  useEffect(() => {
    applicationReturn.attach();
    return applicationReturn.detach;
  }, [applicationReturn]);
  useEffect(() => {
    let observing = true;
    let navigation: Navigation | undefined;
    const traverse = (event: Event) => {
      if (
        (event as NavigateEvent).navigationType !== 'traverse' ||
        !observing ||
        !lifecycleRef.current ||
        currentRouteProvider !== providerToken
      )
        return;
      // Passive observation runs before history restore. Commit the withdrawn
      // generic/title boundary classes before Next can synchronously restore a
      // page. Preserve the title origin for a later accepted application Back.
      // Never intercept traversal or alter privacy or readiness owners.
      flushSync(() => {
        commands.history(
          commandDestination((event as NavigateEvent).destination?.url),
        );
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
  }, [state, providerToken, commands]);
  useEffect(() => {
    let listening = true;
    const invalidate = () => {
      if (
        !listening ||
        !lifecycleRef.current ||
        currentRouteProvider !== providerToken
      )
        return;
      commands.retire();
      nativeScroll.invalidate();
      applicationReturn.invalidate();
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
      commands.history(
        routeKey(location.pathname, new URLSearchParams(location.search)),
      );
      presentation.navigation();
      latestPrivacy.current.navigation?.retire(providerToken);
      loading.cancel();
      pending.cancel();
      readiness.cancel();
      state.finishArrival();
      state.finish();
      cancelRouteSnapshots();
      readiness.history();
      applicationReturn.cancel();
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
    commands,
    nativeScroll,
    applicationReturn,
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
        applicationReturn,
        lifecycleRef,
        providerToken,
        commands,
        actorId: mountedActor,
        latestPrivacy,
        captures,
        withdrawGrant: () => {
          commands.retire();
          nativeScroll.invalidate();
          applicationReturn.invalidate();
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
              applicationReturn.invalidate();
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
            <RouteNavigationIdentityContext
              value={{ state: commands, committedRouteKey }}
            >
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
                      mountedActor === actorId &&
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
            </RouteNavigationIdentityContext>
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
    registerReturnSource: (
      target: Parameters<NonNullable<typeof state>['arm']>[0],
      element: HTMLElement,
    ) => context?.applicationReturn.registerSource(target, element),
    arm: (target: Parameters<NonNullable<typeof state>['arm']>[0]) => {
      if (current()) {
        context?.applicationReturn.stageForward(target);
        state?.stageNavigation(enabled ? target : null);
      }
    },
    armBack: (
      record: Parameters<NonNullable<typeof state>['backTarget']>[0],
      href: string,
    ) => {
      const target = state?.backTarget(record, href);
      if (current()) {
        context?.applicationReturn.stageBack(record, href);
        state?.stageNavigation(enabled && target ? target : null);
      }
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

export type RouteCommandTicket = {
  destination: string;
  current: () => boolean;
  retained: () => boolean;
  used: boolean;
};
const visibleCommandTarget = (target: HTMLElement | null) =>
  !!target?.isConnected &&
  !target.closest('[hidden], [inert]') &&
  !target.matches(':disabled') &&
  target.getClientRects().length > 0 &&
  getComputedStyle(target).visibility !== 'hidden';

/** Commands observe existing route ownership/readiness; they never grant it. */
export function useRouteCommandBoundary(actorId: string, backend: string) {
  const context = useContext(RouteMotionContext);
  const caller = useRef({ actorId, backend });
  const liveCaller = useRef({ actorId, backend });
  const drifted = useRef(false);
  useInsertionEffect(() => {
    if (
      caller.current.actorId !== actorId ||
      caller.current.backend !== backend
    )
      drifted.current = true;
    liveCaller.current = { actorId, backend };
  }, [actorId, backend]);
  return useMemo(() => {
    const owned = () =>
      !!context?.lifecycleRef.current &&
      currentRouteProvider === context.providerToken &&
      context.actorId === actorId &&
      !drifted.current &&
      caller.current.actorId === liveCaller.current.actorId &&
      caller.current.backend === backend &&
      liveCaller.current.backend === backend &&
      context.state.valid();
    const authorized = () =>
      owned() && freshPresentationGrant(context!.latestPrivacy.current);
    const capture = (nextNavigation = false) => {
      const identity = context?.commands.snapshot();
      const epoch = context?.pending.snapshot().epoch;
      const grant = context?.latestPrivacy.current;
      const accepted = authorized();
      return (fresh = true) => {
        const live = context?.latestPrivacy.current;
        const navigation = context?.commands.snapshot();
        return (
          accepted &&
          owned() &&
          context?.pending.current(epoch!) === true &&
          navigation?.generation === identity?.generation &&
          navigation?.serial ===
            (identity?.serial ?? 0) + (nextNavigation ? 1 : 0) &&
          live?.generation === grant?.generation &&
          retainedPresentationGrantCurrent(live!, {
            revision: grant!.revocationRevision!,
            epoch: grant!.verifiedEpoch!,
          }) &&
          (!fresh || freshPresentationGrant(live!))
        );
      };
    };
    return {
      authorized,
      capture: () => capture(),
      issue(href: string): RouteCommandTicket | null {
        if (!authorized()) return null;
        const url = new URL(href, location.href);
        if (url.origin !== location.origin) return null;
        const current = capture(true);
        return {
          destination: routeKey(url.pathname, url.searchParams),
          current,
          retained: () => current(false),
          used: false,
        };
      },
      cancel(ticket: RouteCommandTicket | null) {
        if (ticket) ticket.used = true;
      },
      focus(ticket: RouteCommandTicket, kind: 'heading' | 'search') {
        if (ticket.used || !ticket.current()) return false;
        const primary = context?.readiness.currentPrimary();
        if (!primary) return false;
        const actualKey = routeKey(
          location.pathname,
          new URLSearchParams(location.search),
        );
        const committed = new URL(context!.listHref, location.origin);
        if (routeKey(committed.pathname, committed.searchParams) !== actualKey)
          return false;
        const destination =
          primary.consumedTask?.sourceKey === ticket.destination
            ? primary.consumedTask.destinationKey
            : ticket.destination;
        if (primary.routeKey !== destination || actualKey !== destination)
          return false;
        const target = primary.root.querySelector<HTMLElement>(
          kind === 'search' ? '[data-inventory-search]' : 'h1',
        );
        if (!visibleCommandTarget(target) || !ticket.current()) return false;
        ticket.used = true;
        if (kind === 'heading') target!.tabIndex = -1;
        target!.focus();
        return true;
      },
      focusInvoker(current: () => boolean, target: HTMLElement | null) {
        if (
          !current() ||
          !visibleCommandTarget(target) ||
          Array.from(
            document.querySelectorAll<HTMLElement>(
              '[role="dialog"], [role="alertdialog"], dialog[open]',
            ),
          ).some(visibleCommandTarget)
        )
          return;
        target!.focus();
      },
      subscribe(listener: () => void) {
        const navigation = context?.commands.subscribe(listener);
        const ready = context?.readiness.subscribePrimary(listener);
        return () => {
          navigation?.();
          ready?.();
        };
      },
    };
  }, [context, actorId, backend]);
}
