'use client';

import { ViewTransition, useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { useRouteMotion } from './route-motion';
import { TransitionCaptureBoundary } from '@/components/forms/transition-capture-boundary';
import {
  RoutePresentationSourceContext,
  useRoutePresentationSource,
} from './route-presentation-source';

/** Exclude potential canvas routes before lazy chunks or observers initialize. */
export function canvasBearingRoute(pathname: string | null | undefined) {
  return (
    pathname === '/room' ||
    (/^\/inventory\/(assets|quantity)\/[^/]+$/.test(pathname ?? '') &&
      !pathname?.endsWith('/new')) ||
    /^\/locations\/[^/]+$/.test(pathname ?? '')
  );
}

/** Only use around conventional content with no canvas descendant. */
export function CanvasFreeRouteContent({
  children,
}: {
  children: React.ReactNode;
}) {
  const { arrivalEnabled, cancelIfInvalid, finishArrivalAfterSnapshot } =
    useRouteMotion();
  const { source, handoff } = useRoutePresentationSource();
  return (
    <RoutePresentationSourceContext value={source}>
      <ViewTransition
        default="none"
        enter={arrivalEnabled ? 'route-content' : 'none'}
        exit={arrivalEnabled ? 'route-content' : 'none'}
        onEnter={(instance) => {
          cancelIfInvalid();
          finishArrivalAfterSnapshot(instance);
        }}
        onExit={(instance) => {
          const finish = arrivalEnabled ? handoff() : undefined;
          cancelIfInvalid();
          finishArrivalAfterSnapshot(instance);
          return finish;
        }}
      >
        {children}
      </ViewTransition>
    </RoutePresentationSourceContext>
  );
}

/** Next owns the child/cache and server commit; route changes never key/remount it. */
export function PageArrival({
  children,
  pathname,
}: {
  children: React.ReactNode;
  pathname: string | null;
}) {
  const livePathname = usePathname();
  const {
    arrivalEnabled,
    arrival,
    listHref,
    finishArrival,
    cancelIfInvalid,
    finishArrivalAfterSnapshot,
  } = useRouteMotion();
  const [history, setHistory] = useState<{
    pathname: string | null;
    source: symbol;
    previous?: { pathname: string | null; source: symbol };
  }>(() => ({ pathname, source: Symbol() }));
  if (history.pathname !== pathname)
    setHistory({
      pathname,
      source: Symbol(),
      previous: { pathname: history.pathname, source: history.source },
    });
  const { source, handoff, previousHandoff } = useRoutePresentationSource(
    history.source,
    history.previous?.source,
  );
  useEffect(() => {
    const previous = history.previous;
    if (!previous) return;
    // React queues the original capture callbacks before passive effects. Clear
    // only this committed pair; their source descriptors remain bound through
    // native completion while later same-path updates have no outgoing source.
    // Reduced/unsupported commits have no onUpdate callback to retire the pair.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Synchronize one-shot history with the committed native transition, after capture.
    setHistory((current) =>
      current.pathname === history.pathname &&
      current.source === history.source &&
      current.previous?.pathname === previous.pathname &&
      current.previous.source === previous.source
        ? { pathname: current.pathname, source: current.source }
        : current,
    );
  }, [history]);
  useEffect(() => {
    // Retire only after the accepted destination commits, after React queued its
    // capture callbacks. A later native restore cannot reuse that approval, even
    // if Next's history listener commits before our popstate listener runs.
    if (pathname === livePathname) finishArrival();
  }, [arrival, listHref, pathname, livePathname, finishArrival]);
  const animate =
    arrivalEnabled &&
    !canvasBearingRoute(pathname) &&
    !canvasBearingRoute(livePathname) &&
    !canvasBearingRoute(history.previous?.pathname);
  const update =
    animate &&
    history.previous !== undefined &&
    !canvasBearingRoute(history.previous.pathname);
  return (
    <RoutePresentationSourceContext value={source}>
      <ViewTransition
        default="none"
        enter={animate ? 'route-content' : 'none'}
        exit={animate ? 'route-content' : 'none'}
        update={update ? 'route-content' : 'none'}
        onEnter={(instance) => {
          cancelIfInvalid();
          finishArrivalAfterSnapshot(instance);
        }}
        onExit={(instance) => {
          const finish = animate ? handoff() : undefined;
          cancelIfInvalid();
          finishArrivalAfterSnapshot(instance);
          return finish;
        }}
        onUpdate={(instance) => {
          const finish = update ? previousHandoff() : undefined;
          cancelIfInvalid();
          finishArrivalAfterSnapshot(instance);
          return finish;
        }}
      >
        <div
          className="experience-page-arrival"
          data-route-path={pathname ?? ''}
        >
          <ViewTransition default="none" update="none">
            <TransitionCaptureBoundary>{children}</TransitionCaptureBoundary>
          </ViewTransition>
        </div>
      </ViewTransition>
    </RoutePresentationSourceContext>
  );
}
