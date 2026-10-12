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
}: {
  actorId: string;
  routeKey: string;
  contentIdentity: string;
  /** Canonical result scope for title pairing only; never readiness authority. */
  pairingHref?: string;
  children: React.ReactNode;
  ready?: boolean;
}) {
  const readiness = useContext(RouteReadyContext);
  const root = useRef<HTMLDivElement>(null);
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
    if (ready && root.current)
      return readiness?.register({
        actorId,
        routeKey,
        contentIdentity,
        root: root.current,
      });
  });
  return (
    <RouteContentIdentityContext value={identity}>
      <div ref={root} data-route-ready="true" style={{ display: 'contents' }}>
        {children}
      </div>
    </RouteContentIdentityContext>
  );
}
