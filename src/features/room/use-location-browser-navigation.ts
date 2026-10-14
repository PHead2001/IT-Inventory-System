'use client';
import {
  useContext,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { useRouter } from 'next/navigation';
import {
  useRouteTransition,
  RoutePendingContext,
} from '@/components/experience/route-pending';
import { usePrivacyReadiness } from '@/components/auth/privacy-readiness';
import {
  freshPresentationGrant,
  retainedPresentationGrantCurrent,
} from '@/components/experience/presentation-privacy';
import type { LocationRef } from '@/features/inventory/contracts-ui';
import type { LocationBrowserState } from './location-browser-state';
import { createLocationBrowserNavigation } from './location-browser-navigation';

const emptySubscribe = () => () => {};
const idleSnapshot = () => null;

export function useLocationBrowserNavigation(
  initial: LocationBrowserState,
  locations: LocationRef[],
  rawKey: string,
) {
  const router = useRouter();
  const [, run] = useRouteTransition();
  const scope = useContext(RoutePendingContext);
  const pendingSnapshot = useSyncExternalStore(
    scope?.state.subscribe ?? emptySubscribe,
    scope?.state.snapshot ?? idleSnapshot,
    idleSnapshot,
  );
  const privacy = usePrivacyReadiness();
  const [mountedScope] = useState(scope);
  const accepted = useRef<{
    revision: number;
    epoch: number;
    generation: string;
  } | null>(null);
  const mountedGeneration = useRef<string | null>(null);
  const drifted = useRef(false);
  const departed = useRef(false);
  const live = useRef(false);
  const [draft, setDraft] = useState(initial);
  const [limited, setLimited] = useState(false);
  const [controller] = useState(() =>
    createLocationBrowserNavigation(
      initial,
      locations,
      () => locations,
      setDraft,
      () => {},
      () => false,
      setLimited,
    ),
  );
  useLayoutEffect(() => {
    const ownerCurrent = () =>
      live.current &&
      !departed.current &&
      !drifted.current &&
      scope === mountedScope &&
      mountedGeneration.current === privacy.generation &&
      location.pathname === '/locations' &&
      (!scope || scope.state.current(scope.state.snapshot().epoch));
    controller.bind({
      locations: () => locations,
      replace: (href) => run(() => router.replace(href, { scroll: false })),
      valid: () =>
        ownerCurrent() &&
        retainedPresentationGrantCurrent(privacy, accepted.current),
      writable: () => ownerCurrent() && freshPresentationGrant(privacy),
    });
  });
  const previousKey = useRef(rawKey);
  useLayoutEffect(() => {
    live.current = true;
    departed.current = false;
    controller.activate();
    const native = () => controller.cancelPending();
    const traverse = (event: Event) => {
      if ((event as NavigateEvent).navigationType === 'traverse') native();
    };
    window.addEventListener('popstate', native);
    window.navigation?.addEventListener('navigate', traverse);
    return () => {
      live.current = false;
      departed.current = true;
      accepted.current = null;
      controller.close();
      window.removeEventListener('popstate', native);
      window.navigation?.removeEventListener('navigate', traverse);
    };
  }, [controller]);
  useLayoutEffect(() => {
    if (
      scope !== mountedScope ||
      (mountedGeneration.current !== null &&
        mountedGeneration.current !== privacy.generation)
    )
      drifted.current = true;
    const ownerCurrent =
      live.current &&
      !departed.current &&
      !drifted.current &&
      location.pathname === '/locations' &&
      (!scope || scope.state.current(scope.state.snapshot().epoch));
    if (ownerCurrent && freshPresentationGrant(privacy)) {
      // A new fresh receipt cannot replay work retained under a revoked epoch.
      if (
        accepted.current &&
        !retainedPresentationGrantCurrent(privacy, accepted.current)
      )
        controller.leave();
      // Initial unready mounts have no grant or generation to inherit. Bind
      // the generation only when this exact mounted owner is genuinely fresh.
      mountedGeneration.current = privacy.generation;
      accepted.current = {
        revision: privacy.revocationRevision!,
        epoch: privacy.verifiedEpoch!,
        generation: privacy.generation,
      };
      controller.activate();
    } else if (!(
      ownerCurrent &&
      retainedPresentationGrantCurrent(privacy, accepted.current)
    )) {
      accepted.current = null;
      controller.leave();
    }
  }, [controller, mountedScope, scope, pendingSnapshot, privacy]);
  useLayoutEffect(() => {
    if (previousKey.current !== rawKey) {
      previousKey.current = rawKey;
      controller.reconcile(initial, rawKey);
    }
  }, [controller, initial, rawKey]);
  useLayoutEffect(
    () =>
      scope?.observeNavigation?.((href) => {
        try {
          const target = new URL(href, location.origin);
          if (
            target.origin !== location.origin ||
            target.pathname !== '/locations'
          ) {
            accepted.current = null;
            departed.current = true;
            controller.leave();
          }
        } catch {
          accepted.current = null;
          departed.current = true;
          controller.leave();
        }
      }),
    [scope, controller],
  );
  useLayoutEffect(() => {
    controller.refresh();
  }, [controller, locations]);
  useLayoutEffect(() => {
    controller.resumeWrites();
  }, [controller, privacy, scope, pendingSnapshot]);
  return {
    draft,
    change: controller.change,
    leave: () => {
      departed.current = true;
      accepted.current = null;
      controller.leave();
    },
    limited,
  };
}
