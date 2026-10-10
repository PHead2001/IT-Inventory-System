'use client';

type PresentationScope = {
  invalidate: () => void;
  track?: (action: PromiseLike<unknown>) => void;
  capture?: () => () => boolean;
};
let currentScope: PresentationScope | undefined;

/** The mounted protected provider owns this ephemeral presentation scope. */
export function bindRouteActionResults(
  invalidate: () => void,
  track?: PresentationScope['track'],
  capture?: PresentationScope['capture'],
) {
  const scope = { invalidate, track, capture };
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
) {
  const scope = currentScope;
  let current: (() => boolean) | undefined;
  try {
    current = scope?.capture?.();
    scope?.track?.(action);
  } catch {
    /* Presentation never changes requests/results. */
  }
  const result = await action;
  if (scope && currentScope === scope && deniesActorOrAccess(result)) {
    try {
      if (current?.() !== false && ownerCurrent?.() !== false)
        scope.invalidate();
    } catch {
      // Presentation failure must not turn an authoritative denial into a
      // transport failure or alter the caller's recovery/retry semantics.
    }
  }
  return result;
}
