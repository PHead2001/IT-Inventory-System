'use client';

import { useSyncExternalStore } from 'react';

const subscribe = () => () => {};
/** Wait for hydration to resolve the conservative server motion preference. */
export function useMotionReady() {
  return useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
}
