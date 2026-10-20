'use client';

import {
  createContext,
  useContext,
  useLayoutEffect,
  useMemo,
  useRef,
} from 'react';
import type { createRouteReadiness } from './route-readiness';
import { RouteContentIdentityContext } from './route-content-identity';
import { afterTransitionCapture } from '@/components/forms/transition-capture';
import { PairedInventoryContent } from './paired-inventory-content';
import {
  InventoryCaptureGroup,
  InventoryCaptureRegionsContext,
} from './inventory-capture-region';
import { AuxiliaryRouteCaptureContext } from './auxiliary-route-context';
import { RoutePresentationSourceContext } from './route-presentation-source';

export const RouteReadyContext = createContext<ReturnType<
  typeof createRouteReadiness
> | null>(null);
export function RouteReady({
  actorId,
  routeKey,
  contentIdentity,
  pairingHref,
  children,
  ready = true,
  pairedInventory = false,
  conventionalPrimary = false,
  capture = 'body',
}: {
  actorId: string;
  routeKey: string;
  contentIdentity: string;
  /** Canonical result scope for title pairing only; never readiness authority. */
  pairingHref?: string;
  children: React.ReactNode;
  ready?: boolean;
  /** Explicit opt-in for successful list/quantity/asset primaries, never fallback. */
  pairedInventory?: boolean;
  /** Successful conventional primary capability, never canvas/loading/error. */
  conventionalPrimary?: boolean;
  /** Explicit canvas-free sibling regions under this one canonical owner. */
  capture?: 'body' | 'regions';
}) {
  const readiness = useContext(RouteReadyContext);
  const root = useRef<HTMLDivElement>(null);
  const auxiliary = useContext(AuxiliaryRouteCaptureContext);
  const source = useContext(RoutePresentationSourceContext);
  useLayoutEffect(() => {
    if (
      !ready ||
      !(pairedInventory || conventionalPrimary) ||
      !root.current ||
      !source ||
      !auxiliary
    )
      return;
    // Identity only. The existing canonical readiness owner still decides which
    // root is accepted; no new presentation source or acknowledgment is created.
    return auxiliary.registerSource(root.current, routeKey, source);
  }, [
    auxiliary,
    source,
    routeKey,
    ready,
    pairedInventory,
    conventionalPrimary,
  ]);
  // This identity travels with the server primary. Next's opaque layout slot
  // can replace its children before an outer accepted pathname catches up.
  const identity = useMemo(
    () => ({
      pathname: routeKey.split('?')[0],
      listHref: pairingHref ?? routeKey,
      rawRouteKey: routeKey,
    }),
    [routeKey, pairingHref],
  );
  // Runs for actual mount/update/Activity reactivation. Presentation generation
  // changes alone neither rerender this content nor acknowledge readiness.
  useLayoutEffect(() => {
    if (!ready || !root.current || !readiness) return;
    const committedRoot = root.current;
    let unregister: (() => void) | undefined;
    const cancel = afterTransitionCapture(committedRoot.ownerDocument, () => {
      unregister = readiness.register({
        actorId,
        routeKey,
        contentIdentity,
        root: committedRoot,
        conventionalPrimary,
      });
    });
    return () => {
      cancel();
      unregister?.();
    };
  });
  return (
    <RouteContentIdentityContext value={identity}>
      <div ref={root} data-route-ready="true" style={{ display: 'contents' }}>
        {capture === 'regions' ||
        (auxiliary && (pairedInventory || conventionalPrimary)) ? (
          <InventoryCaptureRegionsContext
            value={{ enabled: ready, pairedInventory, conventionalPrimary }}
          >
            {capture === 'regions' ? (
              children
            ) : (
              <InventoryCaptureGroup
                region="body"
                className="experience-paired-inventory-content"
              >
                {children}
              </InventoryCaptureGroup>
            )}
          </InventoryCaptureRegionsContext>
        ) : pairedInventory || conventionalPrimary ? (
          <PairedInventoryContent
            enabled={ready}
            conventionalPrimary={conventionalPrimary}
          >
            {children}
          </PairedInventoryContent>
        ) : (
          children
        )}
      </div>
    </RouteContentIdentityContext>
  );
}
