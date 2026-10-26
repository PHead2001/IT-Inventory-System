import { afterEach, expect, it, vi } from 'vitest';
import { createApplicationReturn } from './application-return';
import { createRouteReadiness } from './route-readiness';
import { createRoutePendingState } from './route-pending-state';
import { titleTarget, type HoldingIdentity } from './route-motion-state';
import { routeKey } from './route-key';
import { observeTransitionCapture } from '@/components/forms/transition-capture';

const scope = '/inventory?q=cable&type=quantity';
const returned = scope + '#inventory-row-2';
const record = { kind: 'quantity' as const, id: 'cable' };
const holding: HoldingIdentity = { domain: 'unplaced' };
const target = titleTarget(record, returned, holding, scope)!;
const detail =
  '/inventory/quantity/cable?' + new URLSearchParams({ returnTo: returned });
const disposals: Array<() => void> = [];
const originalScroll = HTMLElement.prototype.scrollIntoView;
afterEach(() => {
  for (const dispose of disposals.splice(0)) dispose();
  document.body.replaceChildren();
  history.replaceState(null, '', '/');
  vi.restoreAllMocks();
  if (originalScroll) HTMLElement.prototype.scrollIntoView = originalScroll;
  else Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView');
  Reflect.deleteProperty(window, 'navigation');
});

function fixture(
  scope = '/inventory?q=cable&type=quantity',
  forwardReturn = scope + '#inventory-row-2',
) {
  const returned = scope + '#inventory-row-2';
  const list = new URL(scope, location.origin);
  const canonicalScope = routeKey(list.pathname, list.searchParams);
  const target = titleTarget(record, returned, holding, canonicalScope)!;
  const detail =
    '/inventory/quantity/cable?' +
    new URLSearchParams({ returnTo: forwardReturn });
  history.replaceState(null, '', scope);
  const navigation = new EventTarget();
  Object.defineProperty(window, 'navigation', {
    configurable: true,
    value: navigation,
  });
  const scroll = vi.fn();
  let headingTop = -588;
  const forwardScroll = vi
    .spyOn(window, 'scrollBy')
    .mockImplementation((options: number | ScrollToOptions) => {
      if (typeof options === 'object') headingTop -= options.top ?? 0;
    });
  HTMLElement.prototype.scrollIntoView = scroll;
  vi.spyOn(HTMLElement.prototype, 'getClientRects').mockReturnValue([
    { width: 300, height: 200 },
  ] as unknown as DOMRectList);
  let permission: { key: string; ready: boolean } | null = {
    key: 'actor:original-grant',
    ready: true,
  };
  const readiness = createRouteReadiness(
    'actor',
    createRoutePendingState(),
    vi.fn(),
  );
  const controller = createApplicationReturn(readiness);
  controller.bindAuthority(() => permission);
  controller.attach();
  disposals.push(controller.dispose);
  let unregister: (() => void) | undefined;
  const unregisterSources: Array<() => void> = [];
  const withdraw = () => {
    for (const off of unregisterSources.splice(0)) off();
    unregister?.();
    unregister = undefined;
    document.body.replaceChildren();
  };
  const reveal = (
    options: {
      count?: number;
      wrongHolding?: boolean;
      wrongActor?: boolean;
      hidden?: boolean;
      duplicateAnchor?: boolean;
    } = {},
  ) => {
    withdraw();
    const root = document.createElement('div');
    const section = document.createElement('section');
    root.append(section);
    document.body.append(root);
    for (let i = 0; i < (options.count ?? 1); i++) {
      const row = document.createElement('li');
      row.id = 'inventory-row-2';
      const link = document.createElement('a');
      link.href = detail;
      link.textContent = 'Cable';
      if (options.hidden) row.hidden = true;
      row.append(link);
      section.append(row);
      const source = options.wrongHolding
        ? titleTarget(
            record,
            returned,
            {
              domain: 'storage',
              id: '00000000-0000-4000-8000-000000000001',
            },
            canonicalScope,
          )!
        : target;
      unregisterSources.push(controller.registerSource(source, link));
    }
    if (options.duplicateAnchor) {
      const duplicate = document.createElement('li');
      duplicate.id = 'inventory-row-2';
      section.append(duplicate);
    }
    unregister = readiness.register({
      actorId: options.wrongActor ? 'other-actor' : 'actor',
      routeKey: routeKey(
        location.pathname,
        new URLSearchParams(location.search),
      ),
      contentIdentity: 'authorized-primary',
      root,
    });
  };
  reveal();
  const navigateForward = (href = detail, staged = true) => {
    const close = controller.beginNavigation(href, 0);
    if (staged) controller.stageForward(target);
    controller.acceptNavigation(href, 0);
    close();
    withdraw();
    history.replaceState(null, '', href);
  };
  const revealDetail = (
    options: {
      count?: number;
      top?: number;
      hidden?: boolean;
      wrongActor?: boolean;
      key?: string;
    } = {},
  ) => {
    withdraw();
    headingTop = options.top ?? -588;
    const root = document.createElement('div');
    root.append(document.createElement('section'));
    for (let index = 0; index < (options.count ?? 1); index++) {
      const heading = document.createElement('h1');
      heading.textContent = 'Cable';
      heading.hidden = options.hidden ?? false;
      heading.getBoundingClientRect = () =>
        ({ top: headingTop, bottom: headingTop + 104 }) as DOMRect;
      root.append(heading);
    }
    document.body.append(root);
    unregister = readiness.register({
      actorId: options.wrongActor ? 'other-actor' : 'actor',
      routeKey:
        options.key ??
        routeKey(location.pathname, new URLSearchParams(location.search)),
      contentIdentity: 'authorized-detail-primary',
      root,
    });
    return root;
  };
  const back = () => {
    const close = controller.beginNavigation(returned, 0);
    controller.stageBack(record, returned);
    controller.acceptNavigation(returned, 0);
    close();
    history.replaceState(null, '', returned);
  };
  const event = (href: string, type = 'push') => {
    const signal = new AbortController();
    const event = new Event('navigate');
    Object.assign(event, {
      navigationType: type,
      destination: {
        url: new URL(href, location.origin).href,
        sameDocument: true,
      },
      signal: signal.signal,
    });
    navigation.dispatchEvent(event);
    return signal;
  };
  return {
    controller,
    readiness,
    scroll,
    forwardScroll,
    reveal,
    revealDetail,
    withdraw,
    navigateForward,
    back,
    event,
    detail,
    returned,
    permission: () => permission!,
    deny: () => {
      permission = null;
    },
  };
}

it.each(['full', 'reduced'])(
  'reveals an offscreen accepted forward heading once after its real primary in %s motion',
  async (mode) => {
    const f = fixture();
    document.documentElement.dataset.motion = mode;
    f.navigateForward();
    f.controller.reconcile();
    await Promise.resolve();
    expect(f.forwardScroll).not.toHaveBeenCalled();
    const primary = f.revealDetail();
    expect(f.forwardScroll).not.toHaveBeenCalled();
    await Promise.resolve();
    expect(f.forwardScroll).toHaveBeenCalledExactlyOnceWith({
      top: -588,
      behavior: 'instant',
    });
    expect(primary.querySelector('h1')!.getBoundingClientRect().top).toBe(0);
    expect(document.activeElement).toBe(document.body);
    expect(location.pathname + location.search).toBe(f.detail);
    f.controller.reconcile();
    f.revealDetail();
    await Promise.resolve();
    expect(f.forwardScroll).toHaveBeenCalledTimes(1);
    f.back();
    f.reveal();
    await Promise.resolve();
    expect(f.scroll).toHaveBeenCalledExactlyOnceWith({
      block: 'start',
      inline: 'nearest',
      behavior: 'instant',
    });
    expect(location.pathname + location.search + location.hash).toBe(
      f.returned,
    );
  },
);

it('leaves an already visible Full heading untouched after the pre-capture reveal', async () => {
  const f = fixture();
  f.navigateForward();
  f.revealDetail({ top: 120 });
  await Promise.resolve();
  expect(f.forwardScroll).not.toHaveBeenCalled();
});

it('places a fresh heading below a fixed header and its scroll margin without changing focus', async () => {
  const f = fixture();
  f.navigateForward();
  const root = f.revealDetail();
  root.querySelector('h1')!.style.scrollMarginTop = '12px';
  const header = document.createElement('header');
  header.className = 'experience-header';
  header.style.position = 'fixed';
  header.getBoundingClientRect = () => ({ bottom: 72 }) as DOMRect;
  document.body.append(header);
  await Promise.resolve();
  expect(f.forwardScroll).toHaveBeenCalledExactlyOnceWith({
    top: -672,
    behavior: 'instant',
  });
  expect(root.querySelector('h1')!.getBoundingClientRect().top).toBe(84);
  expect(document.activeElement).toBe(document.body);
});

it('preserves native Back and Forward without replaying a fresh forward repair', async () => {
  const f = fixture();
  f.navigateForward();
  f.event(f.returned, 'traverse');
  history.replaceState(null, '', f.returned);
  window.dispatchEvent(new PopStateEvent('popstate'));
  f.reveal();
  f.event(f.detail, 'traverse');
  history.replaceState(null, '', f.detail);
  window.dispatchEvent(new PopStateEvent('popstate'));
  f.revealDetail();
  await Promise.resolve();
  expect(f.forwardScroll).not.toHaveBeenCalled();
  expect(f.scroll).not.toHaveBeenCalled();
  f.back();
  f.reveal();
  await Promise.resolve();
  expect(f.scroll).toHaveBeenCalledTimes(1);
});

it.each([
  'wheel',
  'pointerdown',
  'touchstart',
  'Tab',
  'new-navigation',
  'abort',
  'grant-change',
  'denial',
  'dispose',
  'invalidate',
  'query-drift',
  'target-replaced',
])('does not replay a queued forward repair after %s', async (change) => {
  const f = fixture();
  f.navigateForward();
  const attempt = f.event(f.detail);
  f.revealDetail();
  if (['wheel', 'pointerdown', 'touchstart'].includes(change))
    window.dispatchEvent(new Event(change));
  if (change === 'Tab')
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab' }));
  if (change === 'new-navigation') {
    const close = f.controller.beginNavigation('/history', 0);
    f.controller.acceptNavigation('/history', 0);
    close();
  }
  if (change === 'abort') attempt.abort();
  if (change === 'grant-change') f.permission().key = 'new-authority';
  if (change === 'denial') f.deny();
  if (change === 'dispose') f.controller.dispose();
  if (change === 'invalidate') f.controller.invalidate();
  if (change === 'query-drift')
    history.replaceState(null, '', f.detail + '&other=1');
  if (change === 'target-replaced') f.revealDetail();
  await Promise.resolve();
  expect(f.forwardScroll).not.toHaveBeenCalled();
  history.replaceState(null, '', f.detail);
  f.revealDetail();
  f.controller.reconcile();
  await Promise.resolve();
  expect(f.forwardScroll).not.toHaveBeenCalled();
});

it('waits for the same authority and canonical destination primary before the forward repair', async () => {
  const f = fixture();
  f.navigateForward();
  f.revealDetail({ wrongActor: true });
  await Promise.resolve();
  f.revealDetail({ key: '/inventory/quantity/cable?other=1' });
  await Promise.resolve();
  expect(f.forwardScroll).not.toHaveBeenCalled();
  f.permission().ready = false;
  f.revealDetail();
  await Promise.resolve();
  expect(f.forwardScroll).not.toHaveBeenCalled();
  f.permission().ready = true;
  f.controller.reconcile();
  await Promise.resolve();
  expect(f.forwardScroll).toHaveBeenCalledTimes(1);
});

it.each([{ count: 0 }, { count: 2 }, { hidden: true }])(
  'retires a missing or ambiguous forward heading without guessing: %j',
  async (options) => {
    const f = fixture();
    f.navigateForward();
    f.revealDetail(options);
    await Promise.resolve();
    f.revealDetail();
    await Promise.resolve();
    expect(f.forwardScroll).not.toHaveBeenCalled();
  },
);

it.each([false, true])(
  'waits for actual capture release before a forward repair (cancelled: %s)',
  async (cancelled) => {
    const f = fixture();
    f.navigateForward();
    let release!: () => void;
    const capturing = new Promise<void>((resolve) => {
      release = resolve;
    });
    const original = document.startViewTransition;
    Object.defineProperty(document, 'startViewTransition', {
      configurable: true,
      writable: true,
      value: () => ({ updateCallbackDone: capturing }),
    });
    const stop = observeTransitionCapture(document, () => {});
    try {
      f.revealDetail();
      document.startViewTransition(() => {});
      await Promise.resolve();
      expect(f.forwardScroll).not.toHaveBeenCalled();
      if (cancelled) window.dispatchEvent(new Event('wheel'));
      release();
      await capturing;
      expect(f.forwardScroll).toHaveBeenCalledTimes(cancelled ? 0 : 1);
    } finally {
      stop();
      if (original)
        Object.defineProperty(document, 'startViewTransition', {
          configurable: true,
          writable: true,
          value: original,
        });
      else Reflect.deleteProperty(document, 'startViewTransition');
    }
  },
);

it.each(['unpaired', 'hash'])(
  'retains ordinary Next scroll ownership for an %s detail link',
  async (mode) => {
    const f = fixture();
    f.navigateForward(
      f.detail + (mode === 'hash' ? '#technical' : ''),
      mode !== 'unpaired',
    );
    f.revealDetail();
    await Promise.resolve();
    expect(f.forwardScroll).not.toHaveBeenCalled();
  },
);

it.each([false, true])(
  'retains an unsorted complete return query through an accepted forward and application Back (native round trip: %s)',
  async (nativeRoundTrip) => {
    const f = fixture('/inventory?q=cable&type=quantity&status=all');
    f.navigateForward();
    if (nativeRoundTrip) {
      f.event(f.returned, 'traverse');
      history.replaceState(null, '', f.returned);
      window.dispatchEvent(new PopStateEvent('popstate'));
      f.reveal();
      await Promise.resolve();
      expect(f.scroll).not.toHaveBeenCalled();
      f.event(f.detail, 'traverse');
      f.withdraw();
      history.replaceState(null, '', f.detail);
      window.dispatchEvent(new PopStateEvent('popstate'));
    }
    f.back();
    f.reveal();
    expect(f.scroll).not.toHaveBeenCalled();
    await Promise.resolve();
    expect(f.scroll).toHaveBeenCalledExactlyOnceWith({
      behavior: 'instant',
      block: 'start',
      inline: 'nearest',
    });
    expect(f.scroll.mock.instances[0]).toBe(
      document.getElementById('inventory-row-2'),
    );
    expect(document.activeElement).toBe(document.body);
    expect(location.pathname + location.search + location.hash).toBe(
      f.returned,
    );
    f.controller.reconcile();
    await Promise.resolve();
    expect(f.scroll).toHaveBeenCalledTimes(1);
  },
);

it('accepts equivalent validated query order without changing the accepted source URL', async () => {
  const f = fixture(
    '/inventory?q=cable&type=quantity&status=all',
    '/inventory?status=all&type=quantity&q=cable#inventory-row-2',
  );
  f.navigateForward();
  f.back();
  f.reveal();
  await Promise.resolve();
  expect(f.scroll).toHaveBeenCalledTimes(1);
  expect(location.pathname + location.search + location.hash).toBe(f.returned);
});

it.each([
  '/inventory?q=other&type=quantity&status=all#inventory-row-2',
  '/inventory?q=cable&type=asset&status=all#inventory-row-2',
  '/inventory?q=cable&type=quantity&status=active#inventory-row-2',
  '/inventory?q=cable&type=quantity&status=all#inventory-row-1',
  '/history?type=quantity#inventory-row-2',
  '//other.invalid/inventory?q=cable&type=quantity&status=all#inventory-row-2',
  'https://other.invalid/inventory?q=cable&type=quantity&status=all#inventory-row-2',
  '/inventory?q=%zz&type=quantity&status=all#inventory-row-2',
  '/inventory\\?q=cable&type=quantity&status=all#inventory-row-2',
])(
  'does not retain a mismatched or unsafe forward return origin: %s',
  async (forwardReturn) => {
    const f = fixture(
      '/inventory?q=cable&type=quantity&status=all',
      forwardReturn,
    );
    f.navigateForward();
    f.back();
    f.reveal();
    await Promise.resolve();
    expect(f.scroll).not.toHaveBeenCalled();
  },
);

it('replays the accepted Back anchor once after a Reduced fallback reveals its real primary, leaving focus unchanged', async () => {
  const f = fixture();
  document.documentElement.dataset.motion = 'reduced';
  f.navigateForward();
  f.back();
  f.controller.reconcile();
  await Promise.resolve();
  expect(f.scroll).not.toHaveBeenCalled();
  expect(document.activeElement).toBe(document.body);
  f.reveal();
  await Promise.resolve();
  expect(f.scroll).toHaveBeenCalledExactlyOnceWith({
    behavior: 'instant',
    block: 'start',
    inline: 'nearest',
  });
  expect(f.scroll.mock.instances[0]).toBe(
    document.getElementById('inventory-row-2'),
  );
  expect(document.activeElement).toBe(document.body);
  f.controller.reconcile();
  await Promise.resolve();
  f.reveal();
  await Promise.resolve();
  expect(f.scroll).toHaveBeenCalledTimes(1);
});

it('waits through a same-authority privacy recheck and resumes only with fresh admission', async () => {
  const f = fixture();
  f.navigateForward();
  f.back();
  f.permission().ready = false;
  f.reveal();
  await Promise.resolve();
  expect(f.scroll).not.toHaveBeenCalled();
  f.permission().ready = true;
  f.controller.reconcile();
  await Promise.resolve();
  expect(f.scroll).toHaveBeenCalledTimes(1);
});

it.each([
  'wheel',
  'new-navigation',
  'authority',
  'unmount',
  'row-replaced',
  'destination',
] as const)(
  'retires the queued post-commit repair after %s',
  async (change) => {
    const f = fixture();
    f.navigateForward();
    f.back();
    f.reveal();
    expect(f.scroll).not.toHaveBeenCalled();
    if (change === 'wheel') window.dispatchEvent(new Event('wheel'));
    if (change === 'new-navigation') {
      const close = f.controller.beginNavigation('/history', 0);
      f.controller.acceptNavigation('/history', 0);
      close();
    }
    if (change === 'authority') f.permission().key = 'new-authority';
    if (change === 'unmount') f.withdraw();
    if (change === 'row-replaced') f.reveal();
    if (change === 'destination') history.replaceState(null, '', '/history');
    await Promise.resolve();
    expect(f.scroll).not.toHaveBeenCalled();
    history.replaceState(null, '', returned);
    f.reveal();
    f.controller.reconcile();
    await Promise.resolve();
    expect(f.scroll).not.toHaveBeenCalled();
  },
);

it('a post-commit verification pause retains only the same authority and source for fresh admission', async () => {
  const f = fixture();
  f.navigateForward();
  f.back();
  f.reveal();
  f.permission().ready = false;
  await Promise.resolve();
  expect(f.scroll).not.toHaveBeenCalled();
  f.permission().ready = true;
  f.controller.reconcile();
  await Promise.resolve();
  expect(f.scroll).toHaveBeenCalledTimes(1);
  f.controller.reconcile();
  await Promise.resolve();
  expect(f.scroll).toHaveBeenCalledTimes(1);
});

it.each([false, true])(
  'observes a capture started during the commit before repairing (cancelled: %s)',
  async (cancelled) => {
    const f = fixture();
    f.navigateForward();
    f.back();
    let release!: () => void;
    const capturing = new Promise<void>((resolve) => {
      release = resolve;
    });
    const original = document.startViewTransition;
    Object.defineProperty(document, 'startViewTransition', {
      configurable: true,
      writable: true,
      value: () => ({ updateCallbackDone: capturing }),
    });
    const stop = observeTransitionCapture(document, () => {});
    try {
      f.reveal();
      // An ancestor can start capture after the child's readiness notification.
      document.startViewTransition(() => {});
      await Promise.resolve();
      expect(f.scroll).not.toHaveBeenCalled();
      if (cancelled) window.dispatchEvent(new Event('wheel'));
      release();
      await capturing;
      expect(f.scroll).toHaveBeenCalledTimes(cancelled ? 0 : 1);
    } finally {
      stop();
      if (original)
        Object.defineProperty(document, 'startViewTransition', {
          configurable: true,
          writable: true,
          value: original,
        });
      else Reflect.deleteProperty(document, 'startViewTransition');
    }
  },
);

it.each(['grant-change', 'denial', 'dispose', 'invalidate'])(
  'cannot apply a stale Back repair after %s',
  async (change) => {
    const f = fixture();
    f.navigateForward();
    f.back();
    if (change === 'grant-change') f.permission().key = 'new-authority';
    if (change === 'denial') f.deny();
    if (change === 'dispose') f.controller.dispose();
    if (change === 'invalidate') f.controller.invalidate();
    f.reveal();
    await Promise.resolve();
    f.controller.reconcile();
    await Promise.resolve();
    expect(f.scroll).not.toHaveBeenCalled();
  },
);

it.each([
  { count: 0 },
  { count: 2 },
  { wrongHolding: true },
  { hidden: true },
  { duplicateAnchor: true },
])(
  'retires a missing/changed/ambiguous source without guessing or retrying: %j',
  async (options) => {
    const f = fixture();
    f.navigateForward();
    f.back();
    f.reveal(options);
    await Promise.resolve();
    expect(f.scroll).not.toHaveBeenCalled();
    f.reveal();
    await Promise.resolve();
    expect(f.scroll).not.toHaveBeenCalled();
  },
);

it('does not admit another actor or a different complete query/hash', async () => {
  const f = fixture();
  f.navigateForward();
  f.back();
  f.reveal({ wrongActor: true });
  await Promise.resolve();
  expect(f.scroll).not.toHaveBeenCalled();
  history.replaceState(
    null,
    '',
    '/inventory?q=other&type=quantity#inventory-row-2',
  );
  f.reveal();
  await Promise.resolve();
  expect(f.scroll).not.toHaveBeenCalled();
  history.replaceState(null, '', scope + '#inventory-row-1');
  f.reveal();
  await Promise.resolve();
  expect(f.scroll).not.toHaveBeenCalled();
});

it.each(['wheel', 'pointerdown', 'touchstart', 'popstate', 'Tab', 'PageDown'])(
  'a fresh user/history intervention %s cancels the pending repair',
  async (type) => {
    const f = fixture();
    f.navigateForward();
    f.back();
    window.dispatchEvent(
      type === 'Tab' || type === 'PageDown'
        ? new KeyboardEvent('keydown', { key: type })
        : new Event(type),
    );
    f.reveal();
    await Promise.resolve();
    expect(f.scroll).not.toHaveBeenCalled();
  },
);

it.each(['other-navigation', 'native-traverse', 'abort'])(
  '%s cannot leave a replayable application Back repair',
  async (kind) => {
    const f = fixture();
    f.navigateForward();
    f.back();
    if (kind === 'other-navigation') f.event('/history');
    if (kind === 'native-traverse') f.event(returned, 'traverse');
    if (kind === 'abort') f.event(returned).abort();
    f.reveal();
    await Promise.resolve();
    expect(f.scroll).not.toHaveBeenCalled();
  },
);

it('a prevented or superseded Link transaction cannot acquire a return origin', async () => {
  const f = fixture();
  const close = f.controller.beginNavigation(detail, 0);
  f.controller.stageForward(target);
  close();
  history.replaceState(null, '', detail);
  f.withdraw();
  f.back();
  f.reveal();
  await Promise.resolve();
  expect(f.scroll).not.toHaveBeenCalled();
});

it.each(['none', 'cancelled', 'replaced', 'url', 'paused'] as const)(
  'capture release retains only the current source and authority: %s',
  async (change) => {
    const f = fixture();
    f.navigateForward();
    f.back();
    let release!: () => void;
    const capturing = new Promise<void>((resolve) => {
      release = resolve;
    });
    const original = document.startViewTransition;
    Object.defineProperty(document, 'startViewTransition', {
      configurable: true,
      writable: true,
      value: () => ({ updateCallbackDone: capturing }),
    });
    const stop = observeTransitionCapture(document, () => {});
    try {
      document.startViewTransition(() => {});
      f.reveal();
      await Promise.resolve();
      expect(f.scroll).not.toHaveBeenCalled();
      if (change === 'cancelled') window.dispatchEvent(new Event('wheel'));
      if (change === 'replaced') f.reveal();
      if (change === 'url') history.replaceState(null, '', '/inventory');
      if (change === 'paused') f.permission().ready = false;
      release();
      await capturing;
      expect(f.scroll).toHaveBeenCalledTimes(change === 'none' ? 1 : 0);
      if (change === 'url') history.replaceState(null, '', returned);
      if (change === 'paused') f.permission().ready = true;
      f.controller.reconcile();
      await Promise.resolve();
      f.reveal();
      await Promise.resolve();
      expect(f.scroll).toHaveBeenCalledTimes(
        change === 'none' || change === 'paused' ? 1 : 0,
      );
    } finally {
      stop();
      if (original)
        Object.defineProperty(document, 'startViewTransition', {
          configurable: true,
          writable: true,
          value: original,
        });
      else Reflect.deleteProperty(document, 'startViewTransition');
    }
  },
);

it('an older aborted native attempt cannot cancel the replacement attempt', async () => {
  const f = fixture();
  f.navigateForward();
  f.back();
  const old = f.event(returned);
  f.event(returned, 'replace');
  old.abort();
  f.reveal();
  await Promise.resolve();
  expect(f.scroll).toHaveBeenCalledTimes(1);
});

it('an unexpected committed router destination cancels repair even without Navigation API observation', async () => {
  const f = fixture();
  f.navigateForward();
  f.back();
  f.controller.routeChanged('/history');
  f.reveal();
  await Promise.resolve();
  expect(f.scroll).not.toHaveBeenCalled();
});
