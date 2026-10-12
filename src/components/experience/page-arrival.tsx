'use client';

import { ViewTransition, useState } from 'react';
import { usePathname } from 'next/navigation';
import { useRouteMotion } from './route-motion';
import {
  RoutePresentationSourceContext,
  useRoutePresentationSource,
} from './route-presentation-source';

/** Only use around conventional content with no canvas descendant. */
export function CanvasFreeRouteContent({
  children,
}: {
  children: React.ReactNode;
}) {
  const { enabled, cancelIfInvalid, finishAfterSnapshot } = useRouteMotion();
  const { source, handoff } = useRoutePresentationSource();
  return (
    <RoutePresentationSourceContext value={source}>
      <ViewTransition
        default="none"
        enter={enabled ? 'route-content' : 'none'}
        exit={enabled ? 'route-content' : 'none'}
        onEnter={(instance) => {
          cancelIfInvalid();
          finishAfterSnapshot(instance);
        }}
        onExit={(instance) => {
          const finish = enabled ? handoff() : undefined;
          cancelIfInvalid();
          finishAfterSnapshot(instance);
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
  const { enabled, cancelIfInvalid, finishAfterSnapshot } = useRouteMotion();
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
  const animate = enabled && pathname !== '/room' && livePathname !== '/room';
  const update =
    animate &&
    history.previous !== undefined &&
    history.previous.pathname !== '/room';
  return (
    <RoutePresentationSourceContext value={source}>
      <ViewTransition
        default="none"
        enter={animate ? 'route-content' : 'none'}
        exit={animate ? 'route-content' : 'none'}
        update={update ? 'route-content' : 'none'}
        onEnter={(instance) => {
          cancelIfInvalid();
          finishAfterSnapshot(instance);
        }}
        onExit={(instance) => {
          const finish = animate ? handoff() : undefined;
          cancelIfInvalid();
          finishAfterSnapshot(instance);
          return finish;
        }}
        onUpdate={(instance) => {
          const finish = update ? previousHandoff() : undefined;
          cancelIfInvalid();
          finishAfterSnapshot(instance);
          return finish;
        }}
      >
        <div
          className="experience-page-arrival"
          data-route-path={pathname ?? ''}
        >
          <ViewTransition default="none" update="none">
            {children}
          </ViewTransition>
        </div>
      </ViewTransition>
    </RoutePresentationSourceContext>
  );
}
