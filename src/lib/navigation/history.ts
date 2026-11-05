'use client';

export function replaceAppHistoryUrl(url: string) {
  const prior: unknown = window.history.state;
  const state: Record<string, unknown> =
    prior && typeof prior === 'object' ? { ...prior } : {};
  // Next's supported native-history wrapper copies its own router state. Passing
  // its bypass markers back into the wrapper would skip useSearchParams updates.
  delete state.__NA;
  delete state._N;
  window.history.replaceState(state, '', url);
}
