'use client';

import {
  createContext,
  useContext,
  useCallback,
  useInsertionEffect,
  useLayoutEffect,
  useRef,
  type ReactElement,
  type ReactNode,
} from 'react';
import { Slot } from '@radix-ui/react-slot';
import { PairedInventoryContent } from './paired-inventory-content';
import { AuxiliaryRouteCaptureContext } from './auxiliary-route-context';
import type { AuxiliaryParticipant } from './auxiliary-route-capture';
import { RouteContentIdentityContext } from './route-content-identity';
import { useRouteMotion } from './route-motion';
import { RoutePresentationSourceContext } from './route-presentation-source';

import type { InventoryCaptureRegionId } from './inventory-capture-regions';

/** Explicit page capability. It never supplies readiness or discovers DOM. */
export const InventoryCaptureRegionsContext = createContext<{
  enabled: boolean;
  pairedInventory: boolean;
  conventionalPrimary: boolean;
} | null>(null);

function AuxiliaryCaptureRegion({
  region,
  children,
}: {
  region: InventoryCaptureRegionId;
  children: ReactElement;
}) {
  const registry = useContext(AuxiliaryRouteCaptureContext)!;
  const capability = useContext(InventoryCaptureRegionsContext);
  const identity = useContext(RouteContentIdentityContext);
  const motion = useRouteMotion();
  const source = useContext(RoutePresentationSourceContext);
  const latest = useRef({ capability, identity, motion, source });
  useInsertionEffect(() => {
    latest.current = { capability, identity, motion, source };
  });
  const root = useRef<HTMLElement | null>(null);
  const participant = useRef<AuxiliaryParticipant | null>(null);
  const register = useCallback(
    (node: HTMLElement) => {
      const value = latest.current;
      const routeKey = value.identity?.rawRouteKey;
      if (!routeKey || !value.source) return;
      let owned = participant.current;
      if (!owned || owned.root !== node) {
        owned = {
          root: node,
          region,
          routeKey,
          source: value.source,
          current: () => {
            const current = latest.current;
            return (
              current.capability?.enabled === true &&
              (current.capability.pairedInventory ||
                current.capability.conventionalPrimary) &&
              current.identity?.rawRouteKey === owned!.routeKey &&
              current.source === owned!.source &&
              current.motion.validNow() &&
              current.motion.captureAvailable !== false
            );
          },
        };
        participant.current = owned;
      }
      owned.routeKey = routeKey;
      owned.source = value.source;
      return registry.register(owned);
    },
    [registry, region],
  );
  const bind = useCallback(
    (node: HTMLElement | null) => {
      root.current = node;
      const unregister = node ? register(node) : undefined;
      if (!node) return;
      return () => {
        unregister?.();
        if (root.current === node) root.current = null;
      };
    },
    [register],
  );
  useLayoutEffect(() => (root.current ? register(root.current) : undefined));
  // Existing Slot composes the authored child's ref/cleanup without a DOM host.
  return (
    <Slot ref={bind} data-route-capture-region={region}>
      {children}
    </Slot>
  );
}

/** One conventional DOM root only. Maps and their cold slots must be siblings. */
export function InventoryCaptureRegion({
  region,
  children,
}: {
  region: InventoryCaptureRegionId;
  children: ReactElement;
}) {
  const capability = useContext(InventoryCaptureRegionsContext);
  const auxiliary = useContext(AuxiliaryRouteCaptureContext);
  if (!capability) return children;
  // Keep React's primary initiator mounted even when title pairs use authored
  // auxiliary refs. The two owners never name the same region in one capture.
  if (auxiliary)
    return (
      <PairedInventoryContent
        enabled={capability.enabled}
        conventionalPrimary={capability.conventionalPrimary}
        pairedInventory={false}
        region={region}
        wrap={false}
      >
        <AuxiliaryCaptureRegion region={region}>
          {children}
        </AuxiliaryCaptureRegion>
      </PairedInventoryContent>
    );
  return (
    <PairedInventoryContent
      enabled={capability?.enabled === true}
      conventionalPrimary={capability?.conventionalPrimary}
      pairedInventory={capability?.pairedInventory}
      region={region}
      wrap={false}
    >
      {children}
    </PairedInventoryContent>
  );
}

/** Group conventional siblings only on pages with the explicit region capability.
 * Ordinary form/list DOM stays unchanged. Region names never change this tree. */
export function InventoryCaptureGroup({
  region,
  className,
  children,
}: {
  region: InventoryCaptureRegionId;
  className?: string;
  children: ReactNode;
}) {
  const capability = useContext(InventoryCaptureRegionsContext);
  if (!capability) return children;
  return (
    <InventoryCaptureRegion region={region}>
      <div className={className}>{children}</div>
    </InventoryCaptureRegion>
  );
}
