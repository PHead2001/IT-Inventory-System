import { afterEach, expect, it, vi } from 'vitest';
import { createNativeScrollRestoration } from './native-scroll-restoration';
import { createRouteReadiness } from './route-readiness';
import { createRoutePendingState } from './route-pending-state';
import { routeKey } from './route-key';

const disposals: Array<() => void> = [];
afterEach(() => {
  for (const dispose of disposals.splice(0)) dispose();
  document.body.replaceChildren();
  history.replaceState(null, '', '/');
  vi.restoreAllMocks();
  Reflect.deleteProperty(window, 'navigation');
});

function fixture() {
  const navigation = Object.assign(new EventTarget(), {
    currentEntry: {
      key: 'list-one',
      url: location.origin + '/inventory?q=x#row',
    },
  });
  Object.defineProperty(window, 'navigation', {
    configurable: true,
    value: navigation,
  });
  history.replaceState(null, '', '/inventory?q=x#row');
  const scroll = { x: 0, y: 0, max: Infinity };
  vi.spyOn(window, 'scrollX', 'get').mockImplementation(() => scroll.x);
  vi.spyOn(window, 'scrollY', 'get').mockImplementation(() => scroll.y);
  const scrollTo = vi
    .spyOn(window, 'scrollTo')
    .mockImplementation((options: number | ScrollToOptions) => {
      if (typeof options === 'object') {
        scroll.x = options.left ?? 0;
        scroll.y = Math.min(options.top ?? 0, scroll.max);
      }
      window.dispatchEvent(new Event('scroll'));
    });
  const permission = { key: 'actor:generation:revocation:epoch', ready: true };
  let denied = false;
  const readiness = createRouteReadiness(
    'actor',
    createRoutePendingState(),
    vi.fn(),
  );
  const coordinator = createNativeScrollRestoration(readiness, () =>
    denied ? null : permission,
  );
  disposals.push(coordinator.dispose);
  let withdraw = () => {};
  let primary: HTMLElement;
  function reveal(
    url = location.href,
    options?: {
      actor?: string;
      hidden?: boolean;
      inert?: boolean;
      geometry?: boolean;
    },
  ) {
    withdraw();
    primary?.remove();
    primary = document.createElement('div');
    const body = document.createElement('section');
    primary.append(body);
    primary.hidden = options?.hidden ?? false;
    if (options?.inert) primary.setAttribute('inert', '');
    document.body.append(primary);
    vi.spyOn(body, 'getClientRects').mockReturnValue(
      (options?.geometry === false
        ? []
        : [{ width: 300, height: 200 }]) as unknown as DOMRectList,
    );
    const target = new URL(url, location.origin);
    withdraw = readiness.register({
      actorId: options?.actor ?? 'actor',
      routeKey: routeKey(target.pathname, target.searchParams),
      contentIdentity: 'primary',
      root: primary,
    });
  }
  function move(key: string, url: string, type = 'push') {
    navigate(key, url, type);
    commit(key, url);
  }
  function navigate(key: string, url: string, type = 'traverse') {
    const event = new Event('navigate');
    Object.assign(event, {
      navigationType: type,
      destination: { key, url: location.origin + url },
    });
    navigation.dispatchEvent(event);
    return event;
  }
  function commit(key: string, url: string) {
    history.replaceState(null, '', url);
    navigation.currentEntry = { key, url: location.origin + url };
    navigation.dispatchEvent(new Event('currententrychange'));
  }
  function offset(y: number, x = 0) {
    scroll.x = x;
    scroll.y = y;
    window.dispatchEvent(new Event('scroll'));
  }
  function collapse() {
    permission.ready = false;
    primary.hidden = true;
    withdraw();
    offset(0);
    coordinator.reconcile();
  }
  reveal();
  coordinator.attach();
  return {
    navigation,
    coordinator,
    readiness,
    permission,
    scroll,
    scrollTo,
    reveal,
    move,
    navigate,
    commit,
    offset,
    collapse,
    deny: () => {
      denied = true;
      coordinator.reconcile();
    },
  };
}
function detail(f: ReturnType<typeof fixture>, y = 728) {
  f.offset(y);
  f.move('detail', '/inventory/assets/a');
  f.reveal();
  f.offset(0);
}

it.each([728, 390])(
  'restores a collapsed/revealed native list once at viewport case %i',
  (offset) => {
    const f = fixture();
    detail(f, offset);
    f.navigate('list-one', '/inventory?q=x#row');
    f.collapse();
    f.commit('list-one', '/inventory?q=x#row');
    f.reveal();
    expect(f.scrollTo).not.toHaveBeenCalled();
    f.permission.ready = true;
    f.coordinator.reconcile();
    expect(f.scrollTo).toHaveBeenCalledExactlyOnceWith({
      left: 0,
      top: offset,
      behavior: 'instant',
    });
    f.coordinator.reconcile();
    f.offset(offset);
    expect(f.scrollTo).toHaveBeenCalledTimes(1);
  },
);

it.each(['readiness-first', 'privacy-first'])(
  'reconciles %s effect ordering without inventing readiness',
  (order) => {
    const f = fixture();
    detail(f);
    f.navigate('list-one', '/inventory?q=x#row');
    f.collapse();
    f.commit('list-one', '/inventory?q=x#row');
    if (order === 'readiness-first') f.reveal();
    f.permission.ready = true;
    f.coordinator.reconcile();
    if (order === 'privacy-first') {
      expect(f.scrollTo).not.toHaveBeenCalled();
      f.reveal();
    }
    expect(f.scrollTo).toHaveBeenCalledTimes(1);
  },
);

it.each(['Next first', 'provider first'])(
  'post-pop reconciliation waits for exact-query admission with %s listener ordering',
  (order) => {
    const f = fixture();
    detail(f);
    f.navigate('list-one', '/inventory?q=x#row');
    if (order === 'provider first') f.coordinator.reconcile();
    f.commit('list-one', '/inventory?q=x#row');
    // The still-visible detail is not the destination primary.
    if (order === 'Next first') f.coordinator.reconcile();
    expect(f.scrollTo).not.toHaveBeenCalled();
    f.collapse();
    f.reveal();
    f.coordinator.reconcile();
    expect(f.scrollTo).not.toHaveBeenCalled();
    f.permission.ready = true;
    f.coordinator.reconcile();
    expect(f.scrollTo).toHaveBeenCalledExactlyOnceWith({
      left: 0,
      top: 728,
      behavior: 'instant',
    });
    f.coordinator.reconcile();
    expect(f.scrollTo).toHaveBeenCalledTimes(1);
  },
);

it.each(['/inventory?q=x#row', '/inventory?q=x#second-anchor'])(
  'post-pop restores an already-authorized primary without a new readiness effect from %s',
  (secondURL) => {
    const f = fixture();
    const subscribe = vi.spyOn(f.readiness, 'register');
    f.offset(728);
    f.move('list-two', secondURL);
    f.offset(310);
    f.navigate('list-one', '/inventory?q=x#row');
    f.commit('list-one', '/inventory?q=x#row');
    f.coordinator.reconcile();
    expect(subscribe).not.toHaveBeenCalled();
    expect(f.scrollTo).toHaveBeenCalledExactlyOnceWith({
      left: 0,
      top: 728,
      behavior: 'instant',
    });
    f.coordinator.reconcile();
    expect(f.scrollTo).toHaveBeenCalledTimes(1);
    f.navigate('list-two', secondURL);
    f.commit('list-two', secondURL);
    f.coordinator.reconcile();
    expect(f.scrollTo).toHaveBeenLastCalledWith({
      left: 0,
      top: 310,
      behavior: 'instant',
    });
  },
);

it('separates repeated exact URLs by browser entry key and offset', () => {
  const f = fixture();
  f.offset(728, 12);
  f.move('list-two', '/inventory?q=x#row');
  f.reveal();
  f.offset(410, 3);
  detail(f, 410);
  f.navigate('list-one', '/inventory?q=x#row');
  f.collapse();
  f.commit('list-one', '/inventory?q=x#row');
  f.permission.ready = true;
  f.reveal();
  expect(f.scrollTo).toHaveBeenLastCalledWith({
    left: 12,
    top: 728,
    behavior: 'instant',
  });
  f.navigate('list-two', '/inventory?q=x#row');
  f.collapse();
  f.commit('list-two', '/inventory?q=x#row');
  f.permission.ready = true;
  f.reveal();
  expect(f.scrollTo).toHaveBeenLastCalledWith({
    left: 0,
    top: 410,
    behavior: 'instant',
  });
});

it.each([
  '/inventory?q=y#row',
  '/inventory?q=x#other',
  '/inventory?q=x&q=x#row',
])('rejects a checkpoint with exact URL mismatch %s', (url) => {
  const f = fixture();
  detail(f);
  f.navigate('list-one', url);
  f.collapse();
  f.commit('list-one', url);
  f.permission.ready = true;
  f.reveal();
  expect(f.scrollTo).not.toHaveBeenCalled();
});

it('requires matching current-entry and location as well as the canonical primary full query', () => {
  const f = fixture();
  detail(f);
  f.navigate('list-one', '/inventory?q=x#row');
  f.collapse();
  f.commit('list-one', '/inventory?q=x#row');
  f.permission.ready = true;
  f.reveal('/inventory?q=y');
  expect(f.scrollTo).not.toHaveBeenCalled();
  history.replaceState(null, '', '/inventory?q=x#other');
  f.reveal('/inventory?q=x');
  expect(f.scrollTo).not.toHaveBeenCalled();
  history.replaceState(null, '', '/inventory?q=x#row');
  f.coordinator.reconcile();
  expect(f.scrollTo).toHaveBeenCalledTimes(1);
});

it('freezes plain router filter departure and preserves only an exact internal same-entry replace', () => {
  const f = fixture();
  f.offset(728);
  f.navigate('', '/inventory?q=y', 'replace');
  f.offset(0);
  f.commit('list-one', '/inventory?q=y');
  f.reveal();
  f.offset(310);
  f.move('detail', '/inventory/assets/a');
  f.reveal();
  f.navigate('list-one', '/inventory?q=y');
  f.collapse();
  f.commit('list-one', '/inventory?q=y');
  f.navigate('', '/inventory?q=y', 'replace');
  f.permission.ready = true;
  f.reveal();
  expect(f.scrollTo).toHaveBeenCalledExactlyOnceWith({
    left: 0,
    top: 310,
    behavior: 'instant',
  });
});

it('does not preserve a restore for a new entry with the same URL', () => {
  const f = fixture();
  detail(f);
  f.navigate('list-one', '/inventory?q=x#row');
  f.collapse();
  f.commit('coincidental-new', '/inventory?q=x#row');
  f.navigate('', '/inventory?q=x#row', 'replace');
  f.permission.ready = true;
  f.reveal();
  expect(f.scrollTo).not.toHaveBeenCalled();
});

it.each([
  'revocation',
  'new actor',
  'new generation',
  'denial',
  'provider replacement',
])('clears pending/checkpoints on %s', (change) => {
  const f = fixture();
  detail(f);
  f.navigate('list-one', '/inventory?q=x#row');
  f.collapse();
  if (change === 'denial') f.deny();
  else if (change === 'provider replacement') f.coordinator.dispose();
  else f.permission.key = change;
  f.commit('list-one', '/inventory?q=x#row');
  f.permission.ready = true;
  f.reveal();
  f.coordinator.reconcile();
  expect(f.scrollTo).not.toHaveBeenCalled();
});

it.each(['wheel', 'touchstart', 'keydown'])(
  'cancels restoration on user %s without preventing browser behavior',
  (type) => {
    const f = fixture();
    detail(f);
    f.navigate('list-one', '/inventory?q=x#row');
    f.collapse();
    const event =
      type === 'keydown'
        ? new KeyboardEvent(type, { key: 'PageDown', cancelable: true })
        : new Event(type, { cancelable: true });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
    f.commit('list-one', '/inventory?q=x#row');
    f.permission.ready = true;
    f.reveal();
    expect(f.scrollTo).not.toHaveBeenCalled();
  },
);

it('rapid traversal supersedes the pending destination and ignores stale readiness', () => {
  const f = fixture();
  detail(f);
  f.navigate('list-one', '/inventory?q=x#row');
  f.collapse();
  f.commit('list-one', '/inventory?q=x#row');
  f.navigate('detail', '/inventory/assets/a');
  f.commit('detail', '/inventory/assets/a');
  f.permission.ready = true;
  f.reveal('/inventory?q=x#row');
  expect(f.scrollTo).not.toHaveBeenCalled();
  f.reveal();
  expect(f.scrollTo).toHaveBeenCalledExactlyOnceWith({
    left: 0,
    top: 0,
    behavior: 'instant',
  });
});

it('allows a shorter final page to clamp once without retrying', () => {
  const f = fixture();
  detail(f);
  f.navigate('list-one', '/inventory?q=x#row');
  f.collapse();
  f.commit('list-one', '/inventory?q=x#row');
  f.scroll.max = 120;
  f.permission.ready = true;
  f.reveal();
  expect(f.scroll.y).toBe(120);
  f.coordinator.reconcile();
  expect(f.scrollTo).toHaveBeenCalledTimes(1);
});

it.each([
  { actor: 'other' },
  { hidden: true },
  { inert: true },
  { geometry: false },
])('rejects an ineligible canonical primary %j', (options) => {
  const f = fixture();
  detail(f);
  f.navigate('list-one', '/inventory?q=x#row');
  f.collapse();
  f.commit('list-one', '/inventory?q=x#row');
  f.permission.ready = true;
  f.reveal(undefined, options);
  expect(f.scrollTo).not.toHaveBeenCalled();
});

it('caps provider checkpoints at 50 entries and rejects nonfinite/negative offsets', () => {
  const f = fixture();
  for (let i = 0; i < 51; i++) {
    f.move(`entry-${i}`, `/inventory?q=${i}`);
    f.reveal();
    f.offset(i + 1);
  }
  f.move('detail', '/inventory/assets/a');
  f.reveal();
  f.move('entry-0', '/inventory?q=0', 'traverse');
  f.reveal();
  expect(f.scrollTo).not.toHaveBeenCalled();
  f.offset(240);
  f.offset(NaN);
  f.offset(-1);
  f.offset(10, Infinity);
  f.move('detail', '/inventory/assets/a');
  f.reveal();
  f.move('entry-0', '/inventory?q=0', 'traverse');
  f.reveal();
  expect(f.scrollTo).toHaveBeenCalledExactlyOnceWith({
    left: 0,
    top: 240,
    behavior: 'instant',
  });
});

it('retired callbacks and unsupported Navigation API never restore', () => {
  const f = fixture();
  detail(f);
  f.navigate('list-one', '/inventory?q=x#row');
  f.coordinator.dispose();
  f.commit('list-one', '/inventory?q=x#row');
  f.reveal();
  f.coordinator.reconcile();
  Reflect.deleteProperty(window, 'navigation');
  const unsupported = createNativeScrollRestoration(
    f.readiness,
    () => f.permission,
  );
  disposals.push(unsupported.dispose);
  unsupported.attach();
  unsupported.reconcile();
  expect(f.scrollTo).not.toHaveBeenCalled();
});

it('reattaches effects with fresh observer ownership and keeps old callbacks inert', () => {
  const f = fixture();
  f.coordinator.detach();
  const add = vi.spyOn(f.navigation, 'addEventListener');
  f.coordinator.attach();
  const oldNavigate = add.mock.calls.find(
    ([type]) => type === 'navigate',
  )![1] as EventListener;
  f.coordinator.detach();
  f.coordinator.attach();
  detail(f);
  const stale = new Event('navigate');
  Object.assign(stale, {
    navigationType: 'push',
    destination: { key: '', url: location.origin + '/other' },
  });
  f.navigate('list-one', '/inventory?q=x#row');
  oldNavigate(stale);
  f.collapse();
  f.commit('list-one', '/inventory?q=x#row');
  f.permission.ready = true;
  f.reveal();
  expect(f.scrollTo).toHaveBeenCalledExactlyOnceWith({
    left: 0,
    top: 728,
    behavior: 'instant',
  });
});

it('failed observer registration leaves fallback behavior and cleans partial listeners', () => {
  const f = fixture();
  f.coordinator.detach();
  const remove = vi.spyOn(f.navigation, 'removeEventListener');
  vi.spyOn(f.navigation, 'addEventListener').mockImplementation(() => {
    throw new Error('unavailable');
  });
  expect(() => f.coordinator.attach()).not.toThrow();
  detail(f);
  f.move('list-one', '/inventory?q=x#row', 'traverse');
  f.reveal();
  expect(remove).toHaveBeenCalledWith('navigate', expect.any(Function));
  expect(f.scrollTo).not.toHaveBeenCalled();
});

it('a failed scroll restore consumes its token without breaking readiness or retrying', () => {
  const f = fixture();
  detail(f);
  f.navigate('list-one', '/inventory?q=x#row');
  f.collapse();
  f.commit('list-one', '/inventory?q=x#row');
  f.permission.ready = true;
  f.scrollTo.mockImplementation(() => {
    throw new Error('unavailable scroll');
  });
  expect(() => f.reveal()).not.toThrow();
  expect(f.readiness.currentPrimary()).not.toBeNull();
  f.coordinator.reconcile();
  expect(f.scrollTo).toHaveBeenCalledTimes(1);
});
