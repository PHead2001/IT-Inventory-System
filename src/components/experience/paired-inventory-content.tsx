'use client';

import { ViewTransition, useContext } from 'react';
import { useRouteMotion } from './route-motion';
import { RouteContentIdentityContext } from './route-content-identity';
import { matchesTitleListRoute } from './route-motion-state';
import { useRoutePresentationSource } from './route-presentation-source';

/** Successful conventional inventory primaries only; no readiness authority. */
export function PairedInventoryContent({
  children,
  enabled,
}: {
  children: React.ReactNode;
  enabled: boolean;
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
  const name = matches ? intent.name + '-content' : undefined;
  return (
    <ViewTransition
      default="none"
      update="none"
      name={name}
      share={name ? 'route-content' : 'none'}
      onShare={(instance) => {
        if (!name || instance.name !== name || !motion.current()) return;
        const finish = handoff();
        motion.cancelIfInvalid();
        motion.finishPairedContentAfterSnapshot(instance);
        return finish;
      }}
    >
      <div className="experience-paired-inventory-content">{children}</div>
    </ViewTransition>
  );
}
