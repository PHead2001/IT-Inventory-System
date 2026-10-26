import { afterEach, expect, it, vi } from 'vitest';
import { createRouteReadiness } from './route-readiness';
import { createRoutePendingState } from './route-pending-state';
import { routeKey } from './route-key';
import { titleTarget } from './route-motion-state';
import { inventoryFilterParams } from '@/features/inventory/scope-presentation';
import { readFilters } from '@/features/inventory/read-model';

const source = '/inventory?q=cable&type=quantity';
const returned = source + '#inventory-row-2';
const record = {
  kind: 'quantity' as const,
  id: '11111111-1111-4111-8111-111111111111',
};
const disposals: Array<() => void> = [];
afterEach(() => {
  for (const dispose of disposals.splice(0)) dispose();
  document.body.replaceChildren();
  document.documentElement.style.scrollPaddingTop = '';
  delete document.documentElement.dataset.motion;
  delete document.documentElement.dataset.theme;
  history.replaceState(null, '', '/');
  vi.restoreAllMocks();
  Reflect.deleteProperty(window, 'navigation');
});

async function fixture(
  options: {
    href?: string;
    type?: string;
    originalHref?: string;
    navigation?: boolean;
    deferAttach?: boolean;
    registeredRawRoute?: string;
  } = {},
) {
  history.replaceState(null, '', options.href ?? returned);
  const rawRoute = routeKey(
    location.pathname,
    new URLSearchParams(location.search),
  );
  const registeredRawRoute = options.registeredRawRoute ?? rawRoute;
  // InventoryPage supplies the canonical filter return path and separately
  // registers the exact raw readiness key, including defaults/ignored params.
  const query = new URLSearchParams(location.search);
  // InventoryPage takes the first value of each repeated search parameter.
  const params = Object.fromEntries(
    [...new Set(query.keys())].map((key) => [key, query.get(key) ?? undefined]),
  );
  const canonicalParams = inventoryFilterParams(params);
  if (params.page)
    canonicalParams.set('page', String(readFilters(params).page));
  const canonicalReturn =
    '/inventory' +
    (canonicalParams.size ? '?' + canonicalParams : '') +
    '#inventory-row-2';
  vi.spyOn(performance, 'getEntriesByType').mockReturnValue([
    {
      name: new URL(
        options.originalHref ?? options.href ?? returned,
        location.origin,
      ).href,
      type: options.type ?? 'reload',
    },
  ] as unknown as PerformanceEntryList);
  vi.resetModules();
  const { createApplicationReturn } = await import('./application-return');
  const navigation = new EventTarget();
  if (options.navigation !== false)
    Object.defineProperty(window, 'navigation', {
      configurable: true,
      value: navigation,
    });
  vi.spyOn(HTMLElement.prototype, 'getClientRects').mockReturnValue([
    { width: 300, height: 200 },
  ] as unknown as DOMRectList);
  vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(900);
  vi.spyOn(document.documentElement, 'scrollHeight', 'get').mockReturnValue(
    1134,
  );
  const position = { x: 0, y: 0, rowTop: 833.421875 };
  vi.spyOn(window, 'scrollY', 'get').mockImplementation(() => position.y);
  vi.spyOn(window, 'scrollX', 'get').mockImplementation(() => position.x);
  const scroll = vi
    .spyOn(window, 'scrollTo')
    .mockImplementation((value: number | ScrollToOptions) => {
      if (typeof value === 'object') position.y = value.top ?? 0;
      window.dispatchEvent(new Event('scroll'));
    });
  let permission: { key: string; ready: boolean } | null = null;
  const readiness = createRouteReadiness(
    'actor',
    createRoutePendingState(),
    vi.fn(),
  );
  const controller = createApplicationReturn(readiness, 'actor');
  controller.bindAuthority(() => permission);
  if (!options.deferAttach) controller.attach();
  disposals.push(controller.dispose);
  let unready = () => {};
  const unregister: Array<() => void> = [];
  let row: HTMLLIElement;
  const reveal = (
    options: {
      missing?: boolean;
      duplicate?: boolean;
      hidden?: boolean;
      wrongActor?: boolean;
      wrongScope?: boolean;
      unregistered?: boolean;
      outsidePrimary?: boolean;
    } = {},
    owner = controller,
  ) => {
    unready();
    for (const off of unregister.splice(0)) off();
    document.body.replaceChildren();
    const root = document.createElement('div'),
      section = document.createElement('section');
    root.append(section);
    document.body.append(root);
    if (!options.missing) {
      row = document.createElement('li');
      row.id = 'inventory-row-2';
      row.hidden = options.hidden ?? false;
      row.getBoundingClientRect = () =>
        ({
          top: position.rowTop - position.y,
          bottom: position.rowTop + 187.25 - position.y,
        }) as DOMRect;
      const link = document.createElement('a');
      link.href =
        '/inventory/quantity/' +
        record.id +
        '?' +
        new URLSearchParams({ returnTo: returned });
      link.textContent = 'Synthetic cable';
      row.append(link);
      section.append(row);
      const target = titleTarget(
        record,
        options.wrongScope
          ? '/inventory?q=other#inventory-row-2'
          : canonicalReturn,
        { domain: 'unplaced' },
        options.wrongScope ? '/inventory?q=other' : registeredRawRoute,
      )!;
      if (!options.unregistered)
        unregister.push(owner.registerSource(target, link));
      if (options.duplicate) {
        const duplicate = row.cloneNode(true);
        section.append(duplicate);
      }
      if (options.outsidePrimary) document.body.append(row);
    }
    unready = readiness.register({
      actorId: options.wrongActor ? 'other' : 'actor',
      routeKey: routeKey(
        location.pathname,
        new URLSearchParams(location.search),
      ),
      contentIdentity: 'real-primary',
      root,
    });
    return root;
  };
  return {
    controller,
    readiness,
    reveal,
    position,
    scroll,
    navigation,
    canonicalReturn,
    row: () => row,
    setAuthority: (value: typeof permission) => {
      permission = value;
      controller.reconcile();
    },
    authorize: (key = 'actor:grant') => {
      permission = { key, ready: true };
      controller.reconcile();
    },
    pause: () => {
      if (permission) permission.ready = false;
      controller.reconcile();
    },
    revoke: () => {
      permission = null;
      controller.invalidate();
    },
    async remount() {
      controller.dispose();
      const next = createApplicationReturn(readiness, 'actor');
      next.bindAuthority(() => permission);
      next.attach();
      disposals.push(next.dispose);
      reveal({}, next);
      next.reconcile();
      await Promise.resolve();
      return next;
    },
  };
}

it('waits for original-actor fresh authorization and a real matching primary before the clamped fragment repair', async () => {
  const f = await fixture();
  f.reveal();
  await Promise.resolve();
  expect(f.scroll).not.toHaveBeenCalled();
  f.authorize();
  expect(f.scroll).not.toHaveBeenCalled();
  await Promise.resolve();
  expect(f.scroll).toHaveBeenCalledExactlyOnceWith({
    left: 0,
    top: 234,
    behavior: 'instant',
  });
  expect(document.activeElement).toBe(document.body);
  f.controller.reconcile();
  f.reveal();
  await Promise.resolve();
  expect(f.scroll).toHaveBeenCalledTimes(1);
});

it('authorization before primary waits without manufacturing readiness', async () => {
  const f = await fixture();
  f.authorize();
  await Promise.resolve();
  expect(f.scroll).not.toHaveBeenCalled();
  f.reveal({ wrongActor: true });
  await Promise.resolve();
  expect(f.scroll).not.toHaveBeenCalled();
  f.reveal();
  await Promise.resolve();
  expect(f.scroll).toHaveBeenCalledTimes(1);
});

// Match readAuthority's [actor, generation, revocation revision, assignment
// epoch] lifecycle: a non-null provisional value precedes fresh verification.
const privacyKey = (generation: string, actor = 'actor') =>
  JSON.stringify([actor, generation, 0, 0]);
it.each(['absent', '11111111-1111-4111-8111-111111111111'])(
  'binds only the first fresh privacy grant after provisional generation becomes %s',
  async (generation) => {
    const f = await fixture();
    f.setAuthority({ key: privacyKey(''), ready: false });
    f.reveal();
    await Promise.resolve();
    expect(f.scroll).not.toHaveBeenCalled();
    f.setAuthority({ key: privacyKey(generation), ready: true });
    await Promise.resolve();
    expect(f.scroll).toHaveBeenCalledExactlyOnceWith({
      left: 0,
      top: 234,
      behavior: 'instant',
    });
    f.controller.reconcile();
    f.reveal();
    await Promise.resolve();
    expect(f.scroll).toHaveBeenCalledTimes(1);
  },
);

it('explicit revocation while provisional is terminal before the first grant', async () => {
  const f = await fixture();
  f.setAuthority({ key: privacyKey(''), ready: false });
  f.reveal();
  f.revoke();
  f.setAuthority({ key: privacyKey('absent'), ready: true });
  f.reveal();
  await Promise.resolve();
  expect(f.scroll).not.toHaveBeenCalled();
  await f.remount();
  expect(f.scroll).not.toHaveBeenCalled();
});

it.each(['null', 'generation', 'actor'])(
  'retires a bound grant after %s replacement even when the replacement is not ready',
  async (replacement) => {
    const f = await fixture();
    const key = privacyKey('absent');
    f.setAuthority({ key, ready: true });
    f.reveal();
    f.setAuthority(
      replacement === 'null'
        ? null
        : {
            key: privacyKey(
              replacement === 'generation' ? 'new-generation' : 'absent',
              replacement === 'actor' ? 'other-actor' : 'actor',
            ),
            ready: false,
          },
    );
    f.setAuthority({ key, ready: true });
    await Promise.resolve();
    expect(f.scroll).not.toHaveBeenCalled();
  },
);

it('retains a bound same-authority pause while a queued repair waits for a fresh grant', async () => {
  const f = await fixture();
  const key = privacyKey('absent');
  f.setAuthority({ key, ready: true });
  f.reveal();
  f.setAuthority({ key, ready: false });
  await Promise.resolve();
  expect(f.scroll).not.toHaveBeenCalled();
  f.setAuthority({ key, ready: true });
  await Promise.resolve();
  expect(f.scroll).toHaveBeenCalledExactlyOnceWith({
    left: 0,
    top: 234,
    behavior: 'instant',
  });
});

it.each([
  ['/inventory', '/inventory'],
  ['/inventory?type=all', '/inventory'],
  ['/inventory?status=active', '/inventory'],
  ['/inventory?scopeAdjusted=true', '/inventory'],
  ['/inventory?type=all&status=active&scopeAdjusted=true', '/inventory'],
  ['/inventory?q=cable&q=adapter&type=all', '/inventory?q=cable'],
])(
  'restores the canonical registered row from its exact raw readiness route %s',
  async (rawRoute, canonicalRoute) => {
    const f = await fixture({ href: rawRoute + '#inventory-row-2' });
    expect(f.canonicalReturn).toBe(canonicalRoute + '#inventory-row-2');
    f.authorize();
    f.reveal();
    await Promise.resolve();
    expect(f.scroll).toHaveBeenCalledExactlyOnceWith({
      left: 0,
      top: 234,
      behavior: 'instant',
    });
  },
);

it.each([
  ['/inventory?type=all', '/inventory?status=active'],
  ['/inventory?q=cable&q=adapter', '/inventory?q=adapter&q=cable'],
  ['/inventory?q=cable&type=all', '/inventory?q=adapter&type=all'],
])(
  'rejects a registered raw source %s when readiness belongs to %s',
  async (registeredRawRoute, rawRoute) => {
    const f = await fixture({
      href: rawRoute + '#inventory-row-2',
      registeredRawRoute,
    });
    f.authorize();
    f.reveal();
    await Promise.resolve();
    expect(f.scroll).not.toHaveBeenCalled();
  },
);

it('a canonically equivalent or repeated-query full URL change before execution still cancels first arrival', async () => {
  for (const [original, changed] of [
    ['/inventory?type=all', '/inventory'],
    ['/inventory?q=cable&q=adapter&type=all', '/inventory?q=cable&type=all'],
  ]) {
    const f = await fixture({ href: original + '#inventory-row-2' });
    f.authorize();
    f.reveal();
    history.replaceState(null, '', changed + '#inventory-row-2');
    await Promise.resolve();
    expect(f.scroll).not.toHaveBeenCalled();
    history.replaceState(null, '', original + '#inventory-row-2');
    f.controller.reconcile();
    await Promise.resolve();
    expect(f.scroll).not.toHaveBeenCalled();
    f.controller.dispose();
  }
});

it.each(['invalidate', 'accepted-navigation'])(
  'retains %s retirement before passive attach',
  async (mode) => {
    const f = await fixture({ deferAttach: true });
    if (mode === 'invalidate') f.controller.invalidate();
    else f.controller.acceptNavigation('/history', 0);
    f.controller.attach();
    f.authorize();
    f.reveal();
    await Promise.resolve();
    expect(f.scroll).not.toHaveBeenCalled();
    await f.remount();
    expect(f.scroll).not.toHaveBeenCalled();
  },
);

it.each(['navigate', 'reload'])(
  'supports initial %s without the Navigation API and waits through a same-authority check',
  async (type) => {
    const f = await fixture({ type, navigation: false });
    f.authorize();
    f.pause();
    f.reveal();
    await Promise.resolve();
    expect(f.scroll).not.toHaveBeenCalled();
    f.authorize();
    await Promise.resolve();
    expect(f.scroll).toHaveBeenCalledExactlyOnceWith({
      left: 0,
      top: 234,
      behavior: 'instant',
    });
  },
);

it.each([
  'missing',
  'duplicate',
  'hidden',
  'wrongScope',
  'unregistered',
  'outsidePrimary',
] as const)(
  'rejects a %s source at the admitted primary and never guesses later',
  async (reason) => {
    const f = await fixture();
    f.authorize();
    f.reveal({ [reason]: true });
    await Promise.resolve();
    expect(f.scroll).not.toHaveBeenCalled();
    f.reveal();
    f.controller.reconcile();
    await Promise.resolve();
    expect(f.scroll).not.toHaveBeenCalled();
  },
);

it.each(['#technical', '#inventory-row-0', '#inventory-row-1000', ''])(
  'rejects unsupported first-document hash %s',
  async (hash) => {
    const f = await fixture({ href: source + hash });
    f.authorize();
    f.reveal();
    await Promise.resolve();
    expect(f.scroll).not.toHaveBeenCalled();
  },
);

it.each([
  'scroll',
  'wheel',
  'touchstart',
  'pointerdown',
  'mousedown',
  'popstate',
  'hashchange',
  'pagehide',
])(
  'permanently cancels first arrival after %s before readiness',
  async (type) => {
    const f = await fixture();
    window.dispatchEvent(new Event(type));
    f.authorize();
    f.reveal();
    await Promise.resolve();
    expect(f.scroll).not.toHaveBeenCalled();
  },
);

it('cancels navigation even when the URL later returns to the original value', async () => {
  const f = await fixture();
  f.navigation.dispatchEvent(new Event('navigate'));
  history.replaceState(null, '', '/history');
  history.replaceState(null, '', returned);
  f.authorize();
  f.reveal();
  await Promise.resolve();
  expect(f.scroll).not.toHaveBeenCalled();
});

it('cancels an accepted application navigation without the Navigation API', async () => {
  const f = await fixture();
  Reflect.deleteProperty(window, 'navigation');
  f.controller.acceptNavigation('/history', 0);
  f.authorize();
  f.reveal();
  await Promise.resolve();
  expect(f.scroll).not.toHaveBeenCalled();
});

it.each(['explicit-revocation', 'authority-replacement'])(
  'cancels queued first arrival after %s',
  async (mode) => {
    const f = await fixture();
    f.authorize();
    f.reveal();
    if (mode === 'explicit-revocation') f.revoke();
    else f.authorize('other-actor:grant');
    await Promise.resolve();
    expect(f.scroll).not.toHaveBeenCalled();
  },
);

it('temporary same-authority not-ready waits, and user scroll before it resumes wins', async () => {
  const f = await fixture();
  f.authorize();
  f.pause();
  f.reveal();
  await Promise.resolve();
  expect(f.scroll).not.toHaveBeenCalled();
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'PageDown' }));
  f.authorize();
  await Promise.resolve();
  expect(f.scroll).not.toHaveBeenCalled();
});

it('a replaced registered row invalidates the queued exact-element intent', async () => {
  const f = await fixture();
  f.authorize();
  f.reveal();
  f.reveal();
  await Promise.resolve();
  expect(f.scroll).not.toHaveBeenCalled();
});

it.each(['back_forward', 'prerender'])(
  'leaves initial navigation type %s to the browser',
  async (type) => {
    const f = await fixture({ type });
    f.authorize();
    f.reveal();
    await Promise.resolve();
    expect(f.scroll).not.toHaveBeenCalled();
  },
);

it('rejects a module first reached by SPA navigation from a different original document', async () => {
  const f = await fixture({ originalHref: '/login' });
  f.authorize();
  f.reveal();
  await Promise.resolve();
  expect(f.scroll).not.toHaveBeenCalled();
});

it.each(['consumed', 'cancelled'])(
  'provider remount cannot rearm the document after %s first arrival',
  async (mode) => {
    const f = await fixture();
    if (mode === 'cancelled') window.dispatchEvent(new Event('wheel'));
    f.authorize();
    f.reveal();
    await Promise.resolve();
    const before = f.scroll.mock.calls.length;
    f.position.y = 0;
    await f.remount();
    expect(f.scroll).toHaveBeenCalledTimes(before);
  },
);

it.each(['full', 'reduced'])(
  'restores instantly in %s motion without history, focus or animation work',
  async (mode) => {
    const f = await fixture();
    document.documentElement.dataset.motion = mode;
    document.documentElement.dataset.theme = 'dark';
    const replace = vi.spyOn(history, 'replaceState'),
      push = vi.spyOn(history, 'pushState');
    const transition = vi.fn();
    Object.defineProperty(document, 'startViewTransition', {
      configurable: true,
      value: transition,
    });
    f.authorize();
    f.reveal();
    await Promise.resolve();
    expect(f.scroll).toHaveBeenCalledExactlyOnceWith({
      left: 0,
      top: 234,
      behavior: 'instant',
    });
    expect(replace).not.toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
    expect(transition).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(document.body);
    Reflect.deleteProperty(document, 'startViewTransition');
  },
);

it('respects scroll margins/padding and consumes an already correct native fragment without another scroll', async () => {
  const f = await fixture();
  f.position.rowTop = 200;
  f.position.y = 180;
  document.documentElement.style.scrollPaddingTop = '8px';
  f.authorize();
  f.reveal();
  f.row().style.scrollMarginTop = '12px';
  await Promise.resolve();
  expect(f.scroll).not.toHaveBeenCalled();
  f.position.y = 0;
  f.controller.reconcile();
  await Promise.resolve();
  expect(f.scroll).not.toHaveBeenCalled();
});

it.each([false, true])(
  'defers beyond a capture started in the layout commit and rechecks cancellation (%s)',
  async (cancelled) => {
    const f = await fixture();
    const { observeTransitionCapture } =
      await import('@/components/forms/transition-capture');
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
      f.authorize();
      f.reveal();
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
