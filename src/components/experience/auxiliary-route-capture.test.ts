import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  createAuxiliaryRouteCapture,
  type AuxiliaryParticipant,
} from './auxiliary-route-capture';
import { createRouteCaptureCompletion } from './route-capture-completion';
import { createRoutePresentationLifetime } from './route-presentation-lifetime';
import { routeContentMotion } from './route-content-motion';
import { registerRouteSnapshotClock } from './route-snapshot-clock';

vi.mock('./route-content-motion', () => ({ routeContentMotion: vi.fn() }));
vi.mock('./route-snapshot-clock', () => ({
  registerRouteSnapshotClock: vi.fn(() => vi.fn()),
}));
const flush = async () => {
  for (let n = 0; n < 6; n++) await Promise.resolve();
};
function deferred() {
  let resolve!: () => void, reject!: () => void;
  const promise = new Promise<void>((yes, no) => {
    resolve = yes;
    reject = () => no(new Error('native rejection'));
  });
  return { promise, resolve, reject };
}
let restore: Document['startViewTransition'];
let dispose: () => void;
let handles: ReturnType<typeof nativeHandle>[];
let sourceRoot: HTMLElement;
let current: boolean;
let admitted: boolean;
let controller: ReturnType<typeof createAuxiliaryRouteCapture>;
let participate: ReturnType<typeof vi.fn<(name: string) => boolean>>;
let nativeCall: ReturnType<typeof vi.fn<Document['startViewTransition']>>;
let effects: Array<{
  effect: { pseudoElement: string };
  finished: Promise<void>;
  cancel: ReturnType<typeof vi.fn>;
}>;
function nativeHandle() {
  const ready = deferred(),
    finished = deferred(),
    update = deferred();
  const value = {
    ready: ready.promise,
    finished: finished.promise,
    updateCallbackDone: update.promise,
    skipTransition: vi.fn(),
  } as unknown as ViewTransition;
  return { ready, finished, update, value };
}
function participant(
  routeKey: string,
  region: AuxiliaryParticipant['region'] = 'header',
  top = 10,
) {
  const root = document.createElement('section');
  sourceRoot.append(root);
  root.getBoundingClientRect = () =>
    ({
      x: 0,
      y: top,
      width: 100,
      height: 40,
      top,
      bottom: top + 40,
      left: 0,
      right: 100,
    }) as DOMRect;
  const entry: AuxiliaryParticipant = {
    root,
    routeKey,
    region,
    source: Symbol(),
    current: () => current,
  };
  return entry;
}
function arm(
  token: object = {},
  handoff: () => (() => void) | undefined = () => undefined,
) {
  return controller.arm({
    token,
    base: 'route-owned',
    sourceKey: '/source',
    destinationKey: '/destination',
    sourceRoot,
    handoff,
    current: () => current,
    admitted: () => admitted && current,
    participate,
  });
}
function effect(name: string, side = 'new', finished = Promise.resolve()) {
  return {
    effect: { pseudoElement: `::view-transition-${side}(${name})` },
    finished,
    cancel: vi.fn(),
  };
}
beforeEach(() => {
  restore = document.startViewTransition;
  handles = [];
  effects = [];
  current = true;
  admitted = true;
  participate = vi.fn(() => true);
  sourceRoot = document.createElement('div');
  document.body.append(sourceRoot);
  nativeCall = vi.fn(() => {
    const handle = nativeHandle();
    handles.push(handle);
    return handle.value;
  });
  document.startViewTransition = nativeCall;
  Object.defineProperty(document, 'getAnimations', {
    configurable: true,
    value: () => effects,
  });
  controller = createAuxiliaryRouteCapture();
  dispose = controller.attach(document);
});
afterEach(async () => {
  controller.withdraw();
  for (const handle of handles) {
    handle.update.resolve();
    handle.ready.resolve();
    handle.finished.resolve();
  }
  await flush();
  dispose();
  document.startViewTransition = restore;
  Reflect.deleteProperty(document, 'getAnimations');
  sourceRoot.remove();
  vi.restoreAllMocks();
});

it('pins only the exact ready root/key/source and stale source registration cleanup cannot clear a newer token', () => {
  const first = Symbol(),
    next = Symbol();
  const oldCleanup = controller.registerSource(sourceRoot, '/source', first);
  expect(controller.source(sourceRoot, '/different')).toBeUndefined();
  expect(
    controller.source(document.createElement('div'), '/source'),
  ).toBeUndefined();
  const nextCleanup = controller.registerSource(sourceRoot, '/source', next);
  oldCleanup();
  expect(controller.source(sourceRoot, '/source')).toBe(next);
  nextCleanup();
  expect(controller.source(sourceRoot, '/source')).toBeUndefined();
});

it('restores names and releases the pinned source lease while preserving an original native throw', () => {
  const release = vi.fn();
  const old = participant('/source');
  controller.register(old);
  arm({}, () => release);
  const error = new TypeError('native error identity');
  nativeCall.mockImplementationOnce(() => {
    throw error;
  });
  expect(() => document.startViewTransition()).toThrow(error);
  expect(old.root.style.viewTransitionName).toBe('');
  expect(release).toHaveBeenCalledOnce();
});

it.each(['header', 'body'] as const)(
  'pins one %s name before native capture, keeps it through delayed commit/updateCallbackDone, and clears only after an incoming ref or ready',
  async (region) => {
    const name = region === 'body' ? 'route-owned' : 'route-owned-header';
    const old = participant('/source', region);
    const unregister = controller.register(old);
    arm();
    expect(old.root.style.viewTransitionName).toBe('');
    const native = document.startViewTransition();
    expect(native).toBe(handles[0].value);
    expect(old.root.style.viewTransitionName).toBe(name);
    unregister(); // Ref cleanup cannot release the captured name or source lease.
    handles[0].update.resolve();
    await flush();
    expect(old.root.style.viewTransitionName).toBe(name);
    const next = participant('/destination', region);
    controller.register(next);
    expect(old.root.style.viewTransitionName).toBe('');
    expect(next.root.style.viewTransitionName).toBe(name);
    expect(
      [old, next].filter(
        (entry) => entry.root.style.viewTransitionName === name,
      ),
    ).toHaveLength(1);
    handles[0].ready.resolve();
    await flush();
    expect(next.root.style.viewTransitionName).toBe('');
    expect(next.root.style.getPropertyValue('view-transition-class')).toBe('');
  },
);

it('never assigns offscreen/hidden/canvas ancestors and refuses capture-time visible duplicates', () => {
  const offscreen = participant(
    '/source',
    'task-launcher',
    window.innerHeight + 20,
  );
  const hidden = participant('/source', 'preview-link');
  hidden.root.hidden = true;
  const canvas = participant('/source', 'preview-location');
  canvas.root.append(document.createElement('canvas'));
  [offscreen, hidden, canvas].forEach((p) => controller.register(p));
  arm();
  document.startViewTransition();
  for (const p of [offscreen, hidden, canvas])
    expect(p.root.style.viewTransitionName).toBe('');
  controller.withdraw();
  const one = participant('/source'),
    two = participant('/source');
  two.root.hidden = true;
  controller.register(one);
  controller.register(two);
  arm();
  two.root.hidden = false;
  document.startViewTransition();
  expect(one.root.style.viewTransitionName).toBe('');
  expect(two.root.style.viewTransitionName).toBe('');
  expect(handles.at(-1)!.value.skipTransition).toHaveBeenCalled();
});

it('an auxiliary-only visible capture enters the actual-name receipt before seal and waits for its effect', async () => {
  const receipts = createRouteCaptureCompletion(),
    approval = {};
  const finish = deferred(),
    complete = vi.fn(),
    missing = vi.fn();
  participate.mockImplementation((name) =>
    receipts.capture({
      approval,
      name,
      current: () => current,
      captured: vi.fn(),
      complete,
      missing,
      body: () => true,
    }),
  );
  const old = participant('/source');
  controller.register(old);
  arm();
  document.startViewTransition();
  effects = [effect('route-owned-header', 'old', finish.promise)];
  handles[0].ready.resolve();
  await flush();
  expect(participate).toHaveBeenCalledWith('route-owned-header');
  expect(registerRouteSnapshotClock).toHaveBeenCalledWith(
    effects,
    expect.any(Function),
    expect.any(Function),
  );
  expect(receipts.available(approval)).toBe(false);
  expect(missing).not.toHaveBeenCalled();
  expect(complete).not.toHaveBeenCalled();
  finish.resolve();
  await flush();
  expect(complete).toHaveBeenCalledOnce();
});

it('returned-handle ready registration joins React callbacks before receipt seal in native promise reaction order', async () => {
  const receipts = createRouteCaptureCompletion(),
    approval = {},
    captured = vi.fn(),
    complete = vi.fn(),
    missing = vi.fn();
  const capture = (name: string) =>
    receipts.capture({
      approval,
      name,
      current: () => current,
      captured,
      complete,
      missing,
      body: (name) => name !== 'title',
    });
  participate.mockImplementation(capture);
  controller.register(participant('/source'));
  arm();
  const native = document.startViewTransition();
  const auxDone = deferred(),
    titleDone = deferred();
  effects = [
    effect('route-owned-header', 'old', auxDone.promise),
    effect('title', 'new', titleDone.promise),
  ];
  // React attaches its ready handler only after the exact native handle returns.
  void native.ready.then(() => {
    expect(receipts.available(approval)).toBe(true);
    expect(capture('title')).toBe(true);
  });
  handles[0].ready.resolve();
  await flush();
  expect(captured).toHaveBeenCalledOnce();
  expect(receipts.available(approval)).toBe(false);
  auxDone.resolve();
  await flush();
  expect(complete).not.toHaveBeenCalled();
  titleDone.resolve();
  await flush();
  expect(complete).toHaveBeenCalledOnce();
  expect(missing).not.toHaveBeenCalled();
});

it('withdraws a single-sided snapshot when its presentation clock cannot register', async () => {
  controller.register(participant('/source'));
  arm();
  document.startViewTransition();
  effects = [effect('route-owned-header', 'old')];
  vi.mocked(registerRouteSnapshotClock).mockImplementationOnce(() => {
    throw new Error('Unsupported native clock');
  });
  handles[0].ready.resolve();
  await flush();
  expect(handles[0].value.skipTransition).toHaveBeenCalledOnce();
  expect(participate).not.toHaveBeenCalled();
});

it.each(['finished', 'rejected', 'withdrawn'] as const)(
  'holds exact outgoing source lease through ref unmount until native %s',
  async (kind) => {
    const lifetime = createRoutePresentationLifetime(),
      source = Symbol();
    const unmount = lifetime.mount(source);
    const ticket = lifetime.capture(
      source,
      () => true,
      () => current,
    )!;
    const old = participant('/source');
    old.source = source;
    const unregister = controller.register(old);
    unregister(); // No outgoing auxiliary refs exist at native capture time.
    arm({}, lifetime.exitCallback(source));
    document.startViewTransition();
    unmount();
    sourceRoot.remove();
    const incoming = participant('/destination');
    document.body.append(incoming.root);
    const unregisterIncoming = controller.register(incoming);
    expect(incoming.root.style.viewTransitionName).toBe('route-owned-header');
    expect(ticket.current()).toBe(true);
    const unmountNext = lifetime.mount(source);
    const nextTicket = lifetime.capture(
      source,
      () => true,
      () => current,
    )!;
    const nextFinish = lifetime.exitCallback(source)()!;
    if (kind === 'withdrawn') controller.withdraw();
    else if (kind === 'rejected') handles[0].finished.reject();
    else handles[0].finished.resolve();
    await flush();
    expect(ticket.current()).toBe(false);
    expect(nextTicket.current()).toBe(true);
    nextFinish();
    expect(nextTicket.current()).toBe(false);
    nextTicket.release();
    unmountNext();
    unregisterIncoming();
    incoming.root.remove();
    ticket.release();
  },
);

it.each(['privacy', 'reduced', 'supersession'] as const)(
  'withdraws names synchronously on %s without letting old terminal callbacks clear newer names',
  async () => {
    const old = participant('/source');
    controller.register(old);
    const first = {};
    arm(first);
    document.startViewTransition();
    current = false;
    controller.reconcile();
    expect(old.root.style.viewTransitionName).toBe('');
    expect(handles[0].value.skipTransition).toHaveBeenCalledOnce();
    current = true;
    const next = {};
    arm(next);
    document.startViewTransition();
    expect(old.root.style.viewTransitionName).toBe('route-owned-header');
    controller.withdraw(first);
    handles[0].ready.resolve();
    handles[0].finished.resolve();
    await flush();
    expect(old.root.style.viewTransitionName).toBe('route-owned-header');
  },
);

it('consumes one approval/handle and an old rearm cannot withdraw newer claims; sealed or ordinary commits cannot acquire new names', async () => {
  const old = participant('/source');
  controller.register(old);
  const first = {};
  arm(first);
  document.startViewTransition();
  document.startViewTransition();
  expect(old.root.style.viewTransitionName).toBe('');
  expect(handles[0].value.skipTransition).toHaveBeenCalled();
  expect(arm(first)).toBe(false);
  arm();
  document.startViewTransition();
  expect(old.root.style.viewTransitionName).toBe('route-owned-header');
  expect(arm(first)).toBe(false);
  expect(old.root.style.viewTransitionName).toBe('route-owned-header');
  handles[2].ready.resolve();
  await flush();
  controller.register(participant('/destination', 'task-launcher'));
  expect(participate).not.toHaveBeenCalled();
  arm();
  controller.ordinaryCommit('/destination');
  document.startViewTransition();
  expect(old.root.style.viewTransitionName).toBe('');
});

it.each(['header', 'body'] as const)(
  'uses the shared scroll-correct %s geometry replacement only when both auxiliary images actually exist',
  async (region) => {
    const cleanup = vi.fn();
    vi.mocked(routeContentMotion).mockReturnValueOnce(cleanup);
    controller.register(participant('/source', region));
    arm();
    document.startViewTransition();
    controller.register(participant('/destination', region));
    const name = region === 'body' ? 'route-owned' : 'route-owned-header';
    effects = [effect(name, 'old'), effect(name, 'new')];
    handles[0].ready.resolve();
    await flush();
    expect(routeContentMotion).toHaveBeenCalledWith(
      { name },
      expect.any(Function),
      expect.any(Function),
      region === 'body',
    );
    expect(participate).toHaveBeenCalledOnce();
    handles[0].finished.resolve();
    await flush();
    expect(cleanup).toHaveBeenCalledOnce();
  },
);
