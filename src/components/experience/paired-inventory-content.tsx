'use client';

import { ViewTransition, useContext } from 'react';
import { useRouteMotion } from './route-motion';
import { RouteContentIdentityContext } from './route-content-identity';
import { matchesTitleListRoute } from './route-motion-state';
import { useRoutePresentationSource } from './route-presentation-source';
import { routeContentMotion } from './route-content-motion';

/** Successful conventional inventory primaries only; no readiness authority. */
export function PairedInventoryContent({
  children,
  enabled,
  conventionalPrimary = false,
}: {
  children: React.ReactNode;
  enabled: boolean;
  conventionalPrimary?: boolean;
}) {
  const motion = useRouteMotion();
  const identity = useContext(RouteContentIdentityContext);
  // Inherit the accepted page's source; never register a second active source.
  const { handoff } = useRoutePresentationSource();
  const approval = motion.titleArrival;
  const intent = motion.intent;
  const matches =
    enabled &&
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
    motion.enabled &&
    motion.current() &&
    arrival?.presentation === 'primary' &&
    identity &&
    (identity.rawRouteKey === arrival.sourceKey ||
      identity.rawRouteKey === arrival.destinationKey);
  const name = matches
    ? intent.name + '-content'
    : primary
      ? arrival.name
      : undefined;
  return (
    <ViewTransition
      default="none"
      update="none"
      name={name}
      share={name ? 'route-content' : 'none'}
      onShare={(instance) => {
        if (!name || instance.name !== name || !motion.current()) return;
        // Exact primary ownership is checked before acquiring an exit lease.
        // An older same-provider callback cannot affect a renewed source.
        if (!matches && !motion.finishPrimaryAfterSnapshot(instance)) return;
        const finish = handoff();
        motion.cancelIfInvalid();
        const cleanup = routeContentMotion(
          instance,
          motion.validNow,
          matches ? motion.rejectTitleSnapshot : undefined,
          !!matches,
        );
        if (matches) motion.finishPairedContentAfterSnapshot(instance);
        if (!cleanup && !finish) return;
        return () => {
          cleanup?.();
          finish?.();
        };
      }}
    >
      <div className="experience-paired-inventory-content">{children}</div>
    </ViewTransition>
  );
}
