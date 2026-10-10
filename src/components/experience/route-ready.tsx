'use client';

import { createContext, useContext, useLayoutEffect, useRef } from 'react';
import type { createRouteReadiness } from './route-readiness';

export const RouteReadyContext = createContext<ReturnType<
  typeof createRouteReadiness
> | null>(null);
export function RouteReady({
  actorId,
  routeKey,
  contentIdentity,
  children,
  ready = true,
}: {
  actorId: string;
  routeKey: string;
  contentIdentity: string;
  children: React.ReactNode;
  ready?: boolean;
}) {
  const readiness = useContext(RouteReadyContext);
  const root = useRef<HTMLDivElement>(null);
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
    <div ref={root} data-route-ready="true" style={{ display: 'contents' }}>
      {children}
    </div>
  );
}
