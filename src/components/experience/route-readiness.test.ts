import { createNativeTaskHandoff, type TaskSource } from './route-task-handoff';
import { afterEach, expect, it, vi } from 'vitest';
import { createRoutePendingState } from './route-pending-state';
import { createRouteReadiness } from './route-readiness';
import { routeKey, canonicalRecordPath } from './route-key';
import { createRouteMotionState } from './route-motion-state';
it('canonicalizes only UUID identity case on known record paths and retains query authority', () => {
  const upper = '/inventory/assets/A3010000-0000-4000-8000-0000000000AB';
  expect(canonicalRecordPath(upper)).toBe(upper.toLowerCase());
  for (const path of [
    '/locations/ITC-A',
    '/sites/SITE-A',
    '/INVENTORY/assets/A3010000-0000-4000-8000-0000000000AB',
    '/inventory/assets/CaseSensitive',
  ])
    expect(canonicalRecordPath(path)).toBe(path);
  const key = routeKey(
    upper,
    new URLSearchParams('task=asset_move&keep=Case&keep=Other'),
  );
  expect(key).toBe(
    upper.toLowerCase() + '?keep=Case&keep=Other&task=asset_move',
  );
  history.replaceState({}, '', upper + '?task=asset_move&keep=Case');
  const readiness = createRouteReadiness(
    'actor',
    createRoutePendingState(),
    () => {},
  );
  const element = root();
  const sourceKey = routeKey(upper, new URLSearchParams(location.search));
  readiness.register({
    actorId: 'actor',
    routeKey: sourceKey,
    contentIdentity: 'asset',
    root: element,
  });
  expect(
    readiness.consumeTask(
      element,
      sourceKey,
      upper.toLowerCase(),
      'asset_move',
      (href) => history.replaceState({}, '', href),
    ),
  ).toEqual({ sourceKey, destinationKey: upper.toLowerCase() + '?keep=Case' });
  expect(location.pathname).toBe(upper);
});

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

it('hands off only the exact consumed task on the same authoritative primary, preserving unrelated query/hash/state without a new receipt', () => {
  history.replaceState(
    { next: 'retained' },
    '',
    '/inventory/quantity/record?other=a&other=b&task=quantity_move#tasks',
  );
  const pending = createRoutePendingState();
  const committed = vi.fn();
  const readiness = createRouteReadiness('actor', pending, committed);
  const element = root();
  readiness.register({
    actorId: 'actor',
    routeKey: routeKey(location.pathname, new URLSearchParams(location.search)),
    contentIdentity: 'record',
    root: element,
  });
  const prior = readiness.currentPrimary();
  committed.mockClear();
  const notify = vi.fn();
  readiness.subscribePrimary(notify);
  const pop = vi.fn();
  window.addEventListener('popstate', pop);
  try {
    const handoff = readiness.consumeTask(
      element,
      prior!.routeKey,
      '/inventory/quantity/record',
      'quantity_move',
      (href) => history.replaceState(history.state, '', href),
    );
    expect(handoff).toEqual({
      sourceKey:
        '/inventory/quantity/record?other=a&other=b&task=quantity_move',
      destinationKey: '/inventory/quantity/record?other=a&other=b',
    });
    expect(readiness.currentPrimary()).toBe(prior);
    expect(location.search).toBe('?other=a&other=b');
    expect(location.hash).toBe('#tasks');
    expect(history.state).toEqual({ next: 'retained' });
    expect(notify).toHaveBeenCalledOnce();
    expect(committed).not.toHaveBeenCalled();
    expect(pop).not.toHaveBeenCalled();
    expect(pending.snapshot().pending).toBe(false);
    const hidden = document.createElement('div');
    document.body.append(hidden);
    hidden.hidden = true;
    hidden.append(element);
    expect(readiness.currentPrimary()).toBeNull();
    hidden.hidden = false;
    readiness.history();
    expect(readiness.currentPrimary()).toBe(prior);
    expect(pending.snapshot().pending).toBe(false);
  } finally {
    window.removeEventListener('popstate', pop);
  }
});
it.each([
  'hidden',
  'other-primary',
  'wrong-task',
  'wrong-record',
  'duplicate-task',
  'replace-error',
  'replace-noop',
] as const)(
  'refuses consumed-task handoff for %s and retains the original registration',
  (reason) => {
    history.replaceState(
      {},
      '',
      '/inventory/quantity/record?task=quantity_move' +
        (reason === 'duplicate-task' ? '&task=quantity_move' : ''),
    );
    const pending = createRoutePendingState(),
      readiness = createRouteReadiness('actor', pending, () => {});
    const element = root();
    const key = routeKey(
      location.pathname,
      new URLSearchParams(location.search),
    );
    if (reason === 'other-primary')
      readiness.register({
        actorId: 'actor',
        routeKey: key,
        contentIdentity: 'first',
        root: root(),
      });
    readiness.register({
      actorId: 'actor',
      routeKey: key,
      contentIdentity: 'record',
      root: element,
    });
    if (reason === 'hidden') element.hidden = true;
    const apply = vi.fn((href: string) => {
      if (reason === 'replace-error') throw Error('blocked');
      if (reason !== 'replace-noop')
        history.replaceState(history.state, '', href);
    });
    expect(
      readiness.consumeTask(
        element,
        key,
        reason === 'wrong-record'
          ? '/inventory/quantity/other'
          : '/inventory/quantity/record',
        reason === 'wrong-task' ? 'asset_move' : 'quantity_move',
        apply,
      ),
    ).toBeNull();
    expect(location.search).toContain('task=quantity_move');
    if (reason !== 'hidden')
      expect(readiness.currentPrimary()?.routeKey).toBe(key);
    expect(pending.snapshot().pending).toBe(false);
  },
);
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

it.each([true, false])(
  'retains conventional-primary capability %s across a consumed task without a new observation, receipt or pending settlement',
  (conventionalPrimary) => {
    history.replaceState(
      { next: 'retained' },
      '',
      '/inventory/quantity/record?keep=a&keep=b&task=quantity_move#tasks',
    );
    const pending = createRoutePendingState();
    const committed = vi.fn();
    const observed = vi.fn();
    const readiness = createRouteReadiness(
      'actor',
      pending,
      committed,
      observed,
    );
    const element = root();
    const sourceKey = routeKey(
      location.pathname,
      new URLSearchParams(location.search),
    );
    readiness.register({
      actorId: 'actor',
      routeKey: sourceKey,
      contentIdentity: 'record',
      root: element,
      conventionalPrimary,
    });
    const primary = readiness.currentPrimary();
    const receipt = observed.mock.calls[0][0];
    expect(Object.isFrozen(receipt)).toBe(true);
    const finishBusiness = pending.register();
    committed.mockClear();
    observed.mockClear();

    const handoff = readiness.consumeTask(
      element,
      sourceKey,
      '/inventory/quantity/record',
      'quantity_move',
      (href) => history.replaceState(history.state, '', href),
    );
    expect(handoff).toEqual({
      sourceKey,
      destinationKey: '/inventory/quantity/record?keep=a&keep=b',
    });
    expect(readiness.currentPrimary()).toBe(primary);
    expect(primary).toMatchObject({
      routeKey: handoff!.destinationKey,
      contentIdentity: 'record',
      root: element,
      conventionalPrimary,
      consumedTask: handoff,
    });
    expect(receipt.routeKey).toBe(sourceKey);
    expect(receipt.conventionalPrimary).toBe(conventionalPrimary);
    expect(committed).not.toHaveBeenCalled();
    expect(observed).not.toHaveBeenCalled();
    expect(pending.snapshot().pending).toBe(true);
    expect(history.state).toEqual({ next: 'retained' });
    expect(location.hash).toBe('#tasks');
    finishBusiness();
    expect(pending.snapshot().pending).toBe(false);
  },
);

it('native task consumption rebases only the accepted mounted primary without acknowledging navigation or settling work', () => {
  const path = '/inventory/quantity/record';
  history.replaceState({ user: 'kept' }, '', path);
  const pending = createRoutePendingState();
  const committed = vi.fn(),
    observed = vi.fn();
  const readiness = createRouteReadiness('actor', pending, committed, observed);
  const element = root();
  readiness.register({
    actorId: 'actor',
    routeKey: path,
    contentIdentity: 'record',
    root: element,
  });
  const accepted = readiness.currentPrimary()!;
  const handoff = createNativeTaskHandoff();
  const source: TaskSource = {
    root: element,
    actorId: 'actor',
    contentIdentity: 'record',
    serverAnchor: path,
    cleanKey: path,
    navigationIdentity: 1,
    securityRevision: 'verified',
    pendingEpoch: pending.snapshot().epoch,
    committedKey: path,
    fresh: true,
    idle: true,
    visible: true,
  };
  handoff.observe(source, true);
  committed.mockClear();
  observed.mockClear();
  history.replaceState(
    history.state,
    '',
    path + '?returnTo=%2Finventory&task=quantity_move#tasks',
  );
  const result = readiness.consumeNativeTask(element, path, () =>
    handoff.consume(
      {
        ...source,
        committedKey: routeKey(
          location.pathname,
          new URLSearchParams(location.search),
        ),
      },
      path,
      'quantity_move',
      (href) => history.replaceState(history.state, '', href),
    ),
  );
  expect(result?.destinationKey).toBe(path + '?returnTo=%2Finventory');
  expect(readiness.currentPrimary()).toBe(accepted);
  expect(committed).not.toHaveBeenCalled();
  expect(observed).not.toHaveBeenCalled();
  expect(pending.snapshot().pending).toBe(false);
  expect(location.hash).toBe('#tasks');
  expect(history.state).toEqual({ user: 'kept' });
});
it.each([
  'refresh',
  'history',
  'suspended',
  'closed',
  'actor',
  'hidden',
  'unregistered',
  'other-primary',
] as const)('native task receipt cannot bypass %s readiness', (reason) => {
  const path = '/inventory/assets/record';
  history.replaceState({}, '', path);
  const pending = createRoutePendingState(),
    readiness = createRouteReadiness('actor', pending, vi.fn());
  const element = root();
  const stop = readiness.register({
    actorId: reason === 'actor' ? 'other' : 'actor',
    routeKey: path,
    contentIdentity: 'record',
    root: element,
  });
  history.replaceState({}, '', path + '?task=asset_move');
  if (reason === 'refresh') pending.register();
  if (reason === 'history') readiness.history();
  if (reason === 'suspended') readiness.suspend();
  if (reason === 'closed') readiness.close();
  if (reason === 'hidden') element.hidden = true;
  if (reason === 'unregistered') stop();
  if (reason === 'other-primary')
    readiness.register({
      actorId: 'actor',
      routeKey: path + '?task=asset_move',
      contentIdentity: 'new',
      root: root(),
    });
  const before = pending.snapshot();
  const consume = vi.fn(() => ({ sourceKey: path, destinationKey: path }));
  expect(readiness.consumeNativeTask(element, path, consume)).toBeNull();
  expect(consume).not.toHaveBeenCalled();
  expect(pending.snapshot()).toBe(before);
  expect(location.search).toBe('?task=asset_move');
});
