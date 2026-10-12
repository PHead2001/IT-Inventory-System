'use client';
import { useCallback, useContext, useLayoutEffect, useState } from 'react';
import { SceneSessionContext } from './scene-budget-provider';
import type { SceneEffectsStore } from './scene-effects-state';

/** Captures the original renderer owner; a new context wrapper cannot revive it. */
export function useSceneCurrent(effects?: SceneEffectsStore | null) {
  const supplied = useContext(SceneSessionContext);
  const [owner] = useState(() => {
    let live = true;
    return {
      session: supplied,
      live: () => live,
      setLive: (value: boolean) => {
        live = value;
      },
    };
  });
  useLayoutEffect(() => {
    owner.setLive(true);
    return () => {
      owner.setLive(false);
    };
  }, [owner]);
  return useCallback(
    () =>
      owner.live() &&
      owner.session.current() &&
      (!effects || effects.isCurrent()),
    [owner, effects],
  );
}
