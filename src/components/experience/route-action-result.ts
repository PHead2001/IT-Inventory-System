'use client';

import type { PresentationDenialTicket } from './route-presentation-lifetime';

type PresentationScope = {
  invalidate: () => void;
  track?: (action: PromiseLike<unknown>) => void;
  capture?: () => () => boolean;
  captureDenial?: (
    ownerCurrent: () => boolean,
    source: symbol,
  ) => PresentationDenialTicket | undefined;
};
let currentScope: PresentationScope | undefined;

/** The mounted protected provider owns this ephemeral presentation scope. */
export function bindRouteActionResults(
  invalidate: () => void,
  track?: PresentationScope['track'],
  capture?: PresentationScope['capture'],
  captureDenial?: PresentationScope['captureDenial'],
) {
  const scope = { invalidate, track, capture, captureDenial };
  currentScope = scope;
  return () => {
    if (currentScope === scope) currentScope = undefined;
  };
}

function deniesActorOrAccess(result: unknown) {
  if (!result || typeof result !== 'object') return false;
  const outcome = result as { ok?: unknown; code?: unknown };
  return (
    outcome.ok === false &&
    (outcome.code === 'forbidden' ||
      outcome.code === 'actor_changed' ||
      outcome.code === 'P1001' ||
      outcome.code === '42501')
  );
}

/**
 * Preserve the exact action result and rejection. Explicit permission denial
 * suppresses presentation only; it does not prove membership revocation.
 */
export async function observeRouteActionResult<T>(
  action: PromiseLike<T>,
  ownerCurrent?: () => boolean,
  source?: symbol,
) {
  const scope = currentScope;
  let current: (() => boolean) | undefined;
  let denial: PresentationDenialTicket | undefined;
  try {
    current = scope?.capture?.();
    if (source && ownerCurrent)
      denial = scope?.captureDenial?.(ownerCurrent, source);
    scope?.track?.(action);
  } catch {
    /* Presentation never changes requests/results. */
  }
  try {
    const result = await action;
    if (scope && currentScope === scope && deniesActorOrAccess(result)) {
      try {
        if (
          denial
            ? denial.current()
            : current?.() !== false && ownerCurrent?.() !== false
        )
          scope.invalidate();
      } catch {
        // Presentation failure must not turn an authoritative denial into a
        // transport failure or alter the caller's recovery/retry semantics.
      }
    }
    return result;
  } finally {
    try {
      denial?.release();
    } catch {
      /* Exact business outcome is unchanged. */
    }
  }
}
