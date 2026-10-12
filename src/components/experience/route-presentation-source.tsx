'use client';

import { createContext, useContext, useLayoutEffect, useState } from 'react';
import type {
  createRoutePresentationLifetime,
  PresentationExitDescriptor,
} from './route-presentation-lifetime';

export const RoutePresentationSourceContext = createContext<symbol | undefined>(
  undefined,
);
export const RoutePresentationLifetimeContext = createContext<ReturnType<
  typeof createRoutePresentationLifetime
> | null>(null);

/** Mounted inside privacy's accepted node; live URL changes cannot replace it. */
export function useRoutePresentationSource(
  sourceOverride?: symbol,
  previous?: symbol,
) {
  const lifetime = useContext(RoutePresentationLifetimeContext);
  const inherited = useContext(RoutePresentationSourceContext);
  const [ownSource] = useState(() => Symbol());
  const source = sourceOverride ?? inherited ?? ownSource;
  useLayoutEffect(
    () => (inherited && !sourceOverride ? undefined : lifetime?.mount(source)),
    [lifetime, source, inherited, sourceOverride],
  );
  const currentExit: PresentationExitDescriptor = Object.freeze({});
  const previousExit: PresentationExitDescriptor = Object.freeze({});
  useLayoutEffect(() => {
    lifetime?.bindExit(currentExit, source);
    if (previous) lifetime?.bindExit(previousExit, previous);
  });
  return {
    source,
    handoff: () => lifetime?.handoff(currentExit),
    previousHandoff: () => lifetime?.handoff(previousExit),
  };
}
