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
import { freshPresentationGrant } from '@/components/experience/presentation-privacy';
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
    controller.bind({
      locations: () => locations,
      replace: (href) => run(() => router.replace(href, { scroll: false })),
      valid: () =>
        location.pathname === '/locations' &&
        freshPresentationGrant(privacy) &&
        (!scope || scope.state.current(scope.state.snapshot().epoch)),
    });
  });
  const previousKey = useRef(rawKey);
  const scopeWasBlocked = useRef(false);
  useLayoutEffect(() => {
    controller.activate();
    const native = () => controller.cancelPending();
    const traverse = (event: Event) => {
      if ((event as NavigateEvent).navigationType === 'traverse') native();
    };
    window.addEventListener('popstate', native);
    window.navigation?.addEventListener('navigate', traverse);
    return () => {
      controller.close();
      window.removeEventListener('popstate', native);
      window.navigation?.removeEventListener('navigate', traverse);
    };
  }, [controller]);
  useLayoutEffect(() => {
    if (previousKey.current !== rawKey) {
      previousKey.current = rawKey;
      controller.reconcile(initial, rawKey);
    }
  }, [controller, initial, rawKey]);
  useLayoutEffect(() => {
    if (!freshPresentationGrant(privacy)) controller.leave();
    else if (location.pathname === '/locations') controller.activate();
  }, [controller, privacy]);
  useLayoutEffect(() => {
    const blocked =
      !!scope &&
      !!pendingSnapshot &&
      !scope.state.current(pendingSnapshot.epoch);
    if (blocked) controller.leave();
    else if (
      scopeWasBlocked.current &&
      freshPresentationGrant(privacy) &&
      location.pathname === '/locations'
    )
      controller.activate();
    scopeWasBlocked.current = blocked;
  }, [controller, scope, pendingSnapshot, privacy]);
  useLayoutEffect(
    () =>
      scope?.observeNavigation?.((href) => {
        try {
          const target = new URL(href, location.origin);
          if (
            target.origin !== location.origin ||
            target.pathname !== '/locations'
          )
            controller.leave();
        } catch {
          controller.leave();
        }
      }),
    [scope, controller],
  );
  useLayoutEffect(() => {
    controller.refresh();
  }, [controller, locations]);
  return { draft, change: controller.change, leave: controller.leave, limited };
}
