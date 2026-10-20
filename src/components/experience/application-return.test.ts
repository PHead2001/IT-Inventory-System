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

function fixture() {
  history.replaceState(null, '', scope);
  const navigation = new EventTarget();
  Object.defineProperty(window, 'navigation', {
    configurable: true,
    value: navigation,
  });
  const scroll = vi.fn();
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
            scope,
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
  const navigateForward = () => {
    const close = controller.beginNavigation(detail, 0);
    controller.stageForward(target);
    controller.acceptNavigation(detail, 0);
    close();
    withdraw();
    history.replaceState(null, '', detail);
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
    reveal,
    withdraw,
    navigateForward,
    back,
    event,
    permission: () => permission!,
    deny: () => {
      permission = null;
    },
  };
}

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
