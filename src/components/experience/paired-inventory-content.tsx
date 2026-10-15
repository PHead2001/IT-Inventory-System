'use client';

import { ViewTransition, useContext } from 'react';
import { useRouteMotion } from './route-motion';
import type { InventoryCaptureRegionId } from './inventory-capture-regions';
import { RouteContentIdentityContext } from './route-content-identity';
import { matchesTitleListRoute } from './route-motion-state';
import { useRoutePresentationSource } from './route-presentation-source';
import { routeContentMotion } from './route-content-motion';

/** Successful conventional inventory primaries only; no readiness authority. */
export function PairedInventoryContent({
  children,
  enabled,
  conventionalPrimary = false,
  pairedInventory = true,
  region = 'body',
  wrap = true,
}: {
  children: React.ReactNode;
  enabled: boolean;
  conventionalPrimary?: boolean;
  pairedInventory?: boolean;
  region?: InventoryCaptureRegionId;
  wrap?: boolean;
}) {
  const motion = useRouteMotion();
  const identity = useContext(RouteContentIdentityContext);
  // Inherit the accepted page's source; never register a second active source.
  const { handoff } = useRoutePresentationSource();
  const approval = motion.titleArrival;
  const intent = motion.intent;
  const matches =
    enabled &&
    pairedInventory &&
    motion.captureAvailable !== false &&
    motion.enabled &&
    motion.current() &&
    intent &&
    approval &&
    identity &&
    (identity.rawRouteKey === approval.sourceKey ||
      identity.rawRouteKey === approval.destinationKey) &&
    (identity.pathname === intent.detailPath ||
      matchesTitleListRoute(intent, identity.rawRouteKey));
  const arrival = motion.arrival;
  const primary =
    conventionalPrimary &&
    enabled &&
    motion.captureAvailable !== false &&
    motion.enabled &&
    motion.current() &&
    arrival?.presentation === 'primary' &&
    identity &&
    (identity.rawRouteKey === arrival.sourceKey ||
      identity.rawRouteKey === arrival.destinationKey);
  const name = matches
    ? intent.name + '-content' + (region === 'body' ? '' : '-' + region)
    : primary
      ? arrival.name + (region === 'body' ? '' : '-' + region)
      : undefined;
  const capture = (instance: { name: string }, shared = false) => {
    if (!name || instance.name !== name || !motion.current()) return;
    // Check the exact approval before giving any outgoing source a lease.
    if (matches) {
      if (motion.finishPairedContentAfterSnapshot(instance) === false) return;
    } else if (!motion.finishPrimaryAfterSnapshot(instance)) return;
    const finish = handoff();
    motion.cancelIfInvalid();
    const cleanup = shared
      ? routeContentMotion(
          instance,
          motion.validNow,
          matches ? motion.rejectTitleSnapshot : undefined,
        )
      : undefined;
    if (!cleanup && !finish) return;
    return () => {
      cleanup?.();
      finish?.();
    };
  };
  return (
    <ViewTransition
      default="none"
      update="none"
      name={name}
      share={name ? 'route-content' : 'none'}
      enter={name ? 'route-content' : 'none'}
      exit={name ? 'route-content' : 'none'}
      onShare={(instance) => capture(instance, true)}
      onEnter={(instance) => capture(instance)}
      onExit={(instance) => capture(instance)}
    >
      {wrap ? (
        <div className="experience-paired-inventory-content">{children}</div>
      ) : (
        children
      )}
    </ViewTransition>
  );
}
