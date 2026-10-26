import { afterEach, expect, it, vi } from 'vitest';
import { createRoutePendingState } from './route-pending-state';
import { createRouteReadiness } from './route-readiness';
import { routeKey } from './route-key';
import { createRouteMotionState } from './route-motion-state';

afterEach(() => {
  document.body.replaceChildren();
  history.replaceState(null, '', '/');
  vi.useRealTimers();
});
function root() {
  const element = document.createElement('div');
  const heading = document.createElement('h1');
  element.append(heading);
  document.body.append(element);
  // jsdom has no layout. This supplies geometry, not a readiness signal.
  vi.spyOn(heading, 'getClientRects').mockReturnValue([
    { width: 20, height: 10 },
  ] as unknown as DOMRectList);
  return element;
}
it('canonical query keys preserve repeated values while sorting distinct keys', () => {
  expect(routeKey('/history', new URLSearchParams('z=1&a=2&a=3'))).toBe(
    '/history?a=2&a=3&z=1',
  );
  expect(routeKey('/history', { z: '1', a: ['2', '3'] })).toBe(
    '/history?a=2&a=3&z=1',
  );
});
it('only a connected visible matching actor and full-query content closes native history work', () => {
  history.replaceState(null, '', '/inventory?q=x&q=y');
  const pending = createRoutePendingState();
  const committed = vi.fn();
  const readiness = createRouteReadiness('actor', pending, committed);
  readiness.history();
  const element = root();
  const content = {
    actorId: 'actor',
    routeKey: '/inventory?q=x&q=y',
    contentIdentity: 'primary',
    root: element,
  };
  readiness.register({ ...content, actorId: 'other' })();
  readiness.register({ ...content, routeKey: '/inventory?q=y&q=x' })();
  element.hidden = true;
  readiness.register(content)();
  element.hidden = false;
  element.remove();
  readiness.register(content)();
  expect(pending.snapshot().pending).toBe(true);
  expect(committed).not.toHaveBeenCalled();
  document.body.append(element);
  readiness.register(content);
  expect(pending.snapshot().pending).toBe(false);
  expect(committed).toHaveBeenCalledExactlyOnceWith(content.routeKey);
});
it('cached/hash-only matching content settles history immediately but cannot finish a same-URL refresh', () => {
  history.replaceState(null, '', '/inventory#inventory-row-2');
  const pending = createRoutePendingState();
  const readiness = createRouteReadiness('actor', pending, vi.fn());
  readiness.register({
    actorId: 'actor',
    routeKey: '/inventory',
    contentIdentity: 'primary',
    root: root(),
  });
  const refresh = pending.register();
  readiness.history();
  expect(pending.snapshot().pending).toBe(true);
  refresh();
  expect(pending.snapshot().pending).toBe(false);
});
it('an epoch change does not fabricate a content commit; reactivation must register a live matching root', () => {
  history.replaceState(null, '', '/inventory');
  const pending = createRoutePendingState();
  const committed = vi.fn();
  const readiness = createRouteReadiness('actor', pending, committed);
  const element = root();
  const withdraw = readiness.register({
    actorId: 'actor',
    routeKey: '/inventory',
    contentIdentity: 'primary',
    root: element,
  });
  withdraw();
  element.remove();
  pending.cancel();
  history.replaceState(null, '', '/history');
  readiness.history();
  pending.cancel();
  expect(committed).toHaveBeenCalledTimes(1);
  readiness.history();
  history.replaceState(null, '', '/inventory');
  expect(pending.snapshot().pending).toBe(true);
  document.body.append(element);
  readiness.register({
    actorId: 'actor',
    routeKey: '/inventory',
    contentIdentity: 'primary',
    root: element,
  });
  withdraw();
  expect(pending.snapshot().pending).toBe(false);
});

it('primary observation reuses eligibility without acknowledging a commit or finishing pending owners', () => {
  history.replaceState(null, '', '/inventory?q=x');
  const pending = createRoutePendingState();
  const committed = vi.fn();
  const readiness = createRouteReadiness('actor', pending, committed);
  const element = root();
  const content = {
    actorId: 'actor',
    routeKey: '/inventory?q=x',
    contentIdentity: 'primary',
    root: element,
  };
  readiness.register(content);
  committed.mockClear();
  pending.register();
  const epoch = pending.snapshot().epoch;
  const notification = vi.fn(() => readiness.currentPrimary());
  const unsubscribe = readiness.subscribePrimary(notification);
  expect(readiness.currentPrimary()).toBe(content);
  element.hidden = true;
  expect(readiness.currentPrimary()).toBeNull();
  element.hidden = false;
  element.setAttribute('inert', '');
  expect(readiness.currentPrimary()).toBeNull();
  element.removeAttribute('inert');
  readiness.suspend();
  expect(readiness.currentPrimary()).toBeNull();
  readiness.resume();
  expect(notification).toHaveBeenCalledTimes(2);
  expect(notification).toHaveLastReturnedWith(content);
  expect(committed).not.toHaveBeenCalled();
  expect(pending.snapshot()).toMatchObject({ epoch, pending: true });
  unsubscribe();
  readiness.close();
  expect(readiness.currentPrimary()).toBeNull();
  expect(notification).toHaveBeenCalledTimes(2);
});

it('observes immutable actual primary only after canonical actor/raw-key/visible checks and before normal commit', () => {
  history.replaceState(null, '', '/history?type=quantity');
  const pending = createRoutePendingState();
  const order: string[] = [];
  const committed = vi.fn(() => order.push('commit'));
  const observed = vi.fn((primary) => {
    expect(Object.isFrozen(primary)).toBe(true);
    order.push('observe');
  });
  const readiness = createRouteReadiness('actor', pending, committed, observed);
  const element = root();
  const content = {
    actorId: 'actor',
    routeKey: '/history?type=quantity',
    contentIdentity: 'unavailable',
    root: element,
    conventionalPrimary: false,
  };
  readiness.register({ ...content, actorId: 'other' })();
  readiness.register({ ...content, routeKey: '/history' })();
  element.hidden = true;
  readiness.register(content)();
  element.hidden = false;
  expect(observed).not.toHaveBeenCalled();
  const business = pending.register();
  readiness.register(content);
  expect(order).toEqual(['observe', 'commit']);
  expect(observed).toHaveBeenCalledOnce();
  expect(pending.snapshot().pending).toBe(true);
  business();
});

it('a late unavailable observation of an old exact loading arrival cannot retire a newer repeated arrival', () => {
  history.replaceState(null, '', '/history');
  const pending = createRoutePendingState(),
    state = createRouteMotionState();
  state.supportArrival(true);
  state.acceptArrival('/history', '/inventory', 0, location.origin, 'primary');
  const old = state.arrivalSnapshot()!;
  state.acceptArrival('/history', '/inventory', 0, location.origin, 'primary');
  const newer = state.arrivalSnapshot()!;
  const readiness = createRouteReadiness(
    'actor',
    pending,
    vi.fn(),
    (primary) => {
      expect(primary.conventionalPrimary).toBe(false);
      state.finishArrival(old);
    },
  );
  readiness.register({
    actorId: 'actor',
    routeKey: '/history',
    contentIdentity: 'old-unavailable',
    root: root(),
    conventionalPrimary: false,
  });
  expect(state.arrivalSnapshot()).toBe(newer);
});
