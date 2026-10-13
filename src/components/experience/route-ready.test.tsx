import { Activity, useContext } from 'react';
import { act, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { RouteReady, RouteReadyContext } from './route-ready';
import { createRouteReadiness } from './route-readiness';
import { createRoutePendingState } from './route-pending-state';
import { RouteContentIdentityContext } from './route-content-identity';
import { routeKey } from './route-key';
import { holdTransitionCapture } from '../../../tests/helpers/transition-capture';
import { TransitionCaptureBoundary } from '../forms/transition-capture-boundary';

afterEach(() => {
  vi.restoreAllMocks();
  history.replaceState(null, '', '/');
});

function PresentationIdentity() {
  const identity = useContext(RouteContentIdentityContext);
  return <p>{identity?.listHref}</p>;
}
it.each(['release', 'unmount', 'withdraw'])(
  'registers a revealed primary after capture and cancels registration on %s',
  async (outcome) => {
    vi.spyOn(HTMLElement.prototype, 'getClientRects').mockReturnValue([
      { width: 30, height: 20 },
    ] as unknown as DOMRectList);
    history.replaceState(null, '', '/inventory');
    const pending = createRoutePendingState();
    const committed = vi.fn();
    const readiness = createRouteReadiness('actor', pending, committed);
    readiness.history();
    const capture = holdTransitionCapture();
    const page = (ready: boolean) => (
      <RouteReadyContext value={readiness}>
        <TransitionCaptureBoundary>
          <RouteReady
            actorId="actor"
            routeKey="/inventory"
            contentIdentity="primary"
            ready={ready}
          >
            <h1>Inventory</h1>
          </RouteReady>
        </TransitionCaptureBoundary>
      </RouteReadyContext>
    );
    const view = render(page(true));
    try {
      expect(committed).not.toHaveBeenCalled();
      expect(pending.snapshot().pending).toBe(true);
      if (outcome === 'unmount') view.unmount();
      if (outcome === 'withdraw') view.rerender(page(false));
      await act(capture.release);
      expect(committed).toHaveBeenCalledTimes(outcome === 'release' ? 1 : 0);
      expect(pending.snapshot().pending).toBe(outcome !== 'release');
    } finally {
      view.unmount();
      await act(capture.release);
      capture.dispose();
    }
  },
);
it('uses canonical pairing presentation while readiness still requires the exact raw query', () => {
  vi.spyOn(HTMLElement.prototype, 'getClientRects').mockReturnValue([
    { width: 30, height: 20 },
  ] as unknown as DOMRectList);
  const raw = '/inventory?type=all&status=active&q=++USB++&scopeAdjusted=true';
  const rawURL = new URL(raw, location.origin);
  const rawKey = routeKey(rawURL.pathname, rawURL.searchParams);
  history.replaceState(null, '', raw);
  const pending = createRoutePendingState();
  const committed = vi.fn();
  const readiness = createRouteReadiness('actor', pending, committed);
  const page = () => (
    <RouteReadyContext value={readiness}>
      <RouteReady
        actorId="actor"
        routeKey={rawKey}
        contentIdentity="primary"
        pairingHref="/inventory?q=USB"
      >
        <PresentationIdentity />
      </RouteReady>
    </RouteReadyContext>
  );
  const view = render(page());
  expect(screen.getByText('/inventory?q=USB')).toBeVisible();
  expect(committed).toHaveBeenLastCalledWith(rawKey);
  committed.mockClear();
  history.replaceState(null, '', '/inventory?q=USB');
  act(() => readiness.history());
  view.rerender(page());
  expect(committed).not.toHaveBeenCalled();
  expect(pending.snapshot().pending).toBe(true);
  history.replaceState(null, '', raw);
  view.rerender(page());
  expect(committed).toHaveBeenLastCalledWith(rawKey);
  expect(pending.snapshot().pending).toBe(false);
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

it('primary identity alone cannot acknowledge a pending or mismatched-actor primary', () => {
  vi.spyOn(HTMLElement.prototype, 'getClientRects').mockReturnValue([
    { width: 30, height: 20 },
  ] as unknown as DOMRectList);
  history.replaceState(null, '', '/inventory');
  const pending = createRoutePendingState();
  const committed = vi.fn();
  const readiness = createRouteReadiness('actor', pending, committed);
  readiness.history();
  const content = (ready: boolean, actorId = 'actor') => (
    <RouteReadyContext value={readiness}>
      <RouteReady
        actorId={actorId}
        routeKey="/inventory"
        contentIdentity="primary"
        ready={ready}
      >
        <h1>Inventory</h1>
      </RouteReady>
    </RouteReadyContext>
  );
  const page = render(content(false));
  expect(committed).not.toHaveBeenCalled();
  expect(pending.snapshot().pending).toBe(true);
  page.rerender(content(true, 'other'));
  expect(committed).not.toHaveBeenCalled();
  expect(pending.snapshot().pending).toBe(true);
  page.rerender(content(true));
  expect(committed).toHaveBeenCalledTimes(1);
  expect(pending.snapshot().pending).toBe(false);
});
