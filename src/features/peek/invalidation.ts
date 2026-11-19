'use client';
import type { PeekTarget } from './contracts';

export const peekInvalidationEvent = 'inventory-peek-invalidated';
/** Invoke only after a confirmed commit, or known authorization loss. */
export function invalidatePeeks(target?: PeekTarget) {
  if (typeof window !== 'undefined')
    window.dispatchEvent(
      new CustomEvent(peekInvalidationEvent, { detail: target ?? null }),
    );
}
