'use client';

import { createContext, useContext, useSyncExternalStore } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import { useEffectiveReducedMotion } from './motion-preference';
import { RouteLoading } from './route-pending';
import { routeKey } from './route-key';
import type {
  createPairedRouteLoading,
  PairedLoadingOwner,
} from './paired-route-loading-state';

export const PairedRouteLoadingContext = createContext<{
  store: ReturnType<typeof createPairedRouteLoading>;
  valid: (owner: PairedLoadingOwner) => boolean;
} | null>(null);
const emptySubscribe = () => () => {};
const emptySnapshot = () => null;

export function supportsPairedRouteLoading() {
  return (
    typeof document.startViewTransition === 'function' &&
    typeof CSS !== 'undefined' &&
    typeof CSS.supports === 'function' &&
    CSS.supports('selector(::view-transition-group(.route-content))')
  );
}

/** Only accepted opted-in conventional arrivals bubble to the persistent outer Suspense. */
export function PairedRouteLoading(
  props: React.ComponentProps<typeof RouteLoading>,
) {
  const scope = useContext(PairedRouteLoadingContext);
  const owner = useSyncExternalStore(
    scope?.store.subscribe ?? emptySubscribe,
    scope?.store.snapshot ?? emptySnapshot,
    emptySnapshot,
  );
  const reduced = useEffectiveReducedMotion();
  const pathname = usePathname();
  const query = useSearchParams();
  if (
    owner &&
    scope &&
    !reduced &&
    supportsPairedRouteLoading() &&
    scope.valid(owner) &&
    owner.destination ===
      routeKey(pathname ?? '', query ?? new URLSearchParams())
  ) {
    // Allocated by its accepted navigation event; render never creates a promise.
    throw owner.promise;
  }
  return <RouteLoading {...props} />;
}
