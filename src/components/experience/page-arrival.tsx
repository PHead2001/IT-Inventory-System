'use client';

import { ViewTransition } from 'react';
import { usePathname } from 'next/navigation';
import { useRouteMotion } from './route-motion';

/** Only use around conventional content with no canvas descendant. */
export function CanvasFreeRouteContent({
  children,
}: {
  children: React.ReactNode;
}) {
  const { enabled, cancelIfInvalid, finishAfterSnapshot } = useRouteMotion();
  return (
    <ViewTransition
      default="none"
      enter={enabled ? 'route-content' : 'none'}
      exit={enabled ? 'route-content' : 'none'}
      onEnter={(instance) => {
        cancelIfInvalid();
        finishAfterSnapshot(instance);
      }}
      onExit={(instance) => {
        cancelIfInvalid();
        finishAfterSnapshot(instance);
      }}
    >
      {children}
    </ViewTransition>
  );
}

/** Next owns the transition and server commit; never retain outgoing children. */
export function PageArrival({
  children,
  pathname,
}: {
  children: React.ReactNode;
  pathname: string | null;
}) {
  const livePathname = usePathname();
  const { enabled, cancelIfInvalid, finishAfterSnapshot } = useRouteMotion();
  // Omitting the WHOLE ancestor boundary is necessary: naming the canvas `none`
  // would still include its pixels in an ancestor's snapshot.
  const animate = enabled && pathname !== '/room' && livePathname !== '/room';
  return (
    <ViewTransition
      key={pathname}
      default="none"
      enter={animate ? 'route-content' : 'none'}
      exit={animate ? 'route-content' : 'none'}
      onEnter={(instance) => {
        cancelIfInvalid();
        finishAfterSnapshot(instance);
      }}
      onExit={(instance) => {
        cancelIfInvalid();
        finishAfterSnapshot(instance);
      }}
    >
      <div className="experience-page-arrival">{children}</div>
    </ViewTransition>
  );
}
