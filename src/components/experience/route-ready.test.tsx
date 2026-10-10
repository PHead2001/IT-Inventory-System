import { Activity } from 'react';
import { act, render } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { RouteReady, RouteReadyContext } from './route-ready';
import { createRouteReadiness } from './route-readiness';
import { createRoutePendingState } from './route-pending-state';

afterEach(() => {
  vi.restoreAllMocks();
  history.replaceState(null, '', '/');
});
it('actual Activity layout reactivation acknowledges matching history without an epoch-derived marker', () => {
  // jsdom geometry only; the real readiness provider/marker are never mocked.
  vi.spyOn(HTMLElement.prototype, 'getClientRects').mockReturnValue([
    { width: 30, height: 20 },
  ] as unknown as DOMRectList);
  history.replaceState(null, '', '/inventory?type=quantity');
  const pending = createRoutePendingState();
  const committed = vi.fn();
  const readiness = createRouteReadiness('actor', pending, committed);
  const page = (mode: 'visible' | 'hidden') => (
    <RouteReadyContext.Provider value={readiness}>
      <Activity mode={mode}>
        <RouteReady
          actorId="actor"
          routeKey="/inventory?type=quantity"
          contentIdentity="primary"
        >
          <h1>Inventory</h1>
        </RouteReady>
      </Activity>
    </RouteReadyContext.Provider>
  );
  const view = render(page('visible'));
  expect(committed).toHaveBeenCalledTimes(1);
  view.rerender(page('hidden'));
  act(() => {
    pending.cancel();
    readiness.history();
  });
  expect(pending.snapshot().pending).toBe(true);
  expect(committed).toHaveBeenCalledTimes(1);
  view.rerender(page('visible'));
  expect(pending.snapshot().pending).toBe(false);
  expect(committed).toHaveBeenCalledTimes(2);
});
it('a committed ready marker closes history but cannot release another owner’s same-URL refresh', () => {
  vi.spyOn(HTMLElement.prototype, 'getClientRects').mockReturnValue([
    { width: 30, height: 20 },
  ] as unknown as DOMRectList);
  history.replaceState(null, '', '/inventory');
  const pending = createRoutePendingState();
  const readiness = createRouteReadiness('actor', pending, vi.fn());
  const refresh = pending.register();
  readiness.history();
  render(
    <RouteReadyContext.Provider value={readiness}>
      <RouteReady
        actorId="actor"
        routeKey="/inventory"
        contentIdentity="unchanged"
      >
        <h1>Inventory</h1>
      </RouteReady>
    </RouteReadyContext.Provider>,
  );
  expect(pending.snapshot().pending).toBe(true);
  act(refresh);
  expect(pending.snapshot().pending).toBe(false);
});
