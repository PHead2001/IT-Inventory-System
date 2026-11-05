import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createRoomLabelRegistry } from './label-layout-runtime';

let frames: Map<number, FrameRequestCallback>;
let serial: number;
let observed: Element[], unobserved: Element[];
let mutations: MutationCallback;
let resize: ResizeObserverCallback;
let fonts: EventTarget & { ready: Promise<void> };
const cleanups = new Set<() => void>();
const originalFonts = Object.getOwnPropertyDescriptor(document, 'fonts');
const flush = () => {
  const pending = [...frames.values()];
  frames.clear();
  pending.forEach((callback) => callback(0));
};
function mutation(target: Node, added: Node[] = [], removed: Node[] = []) {
  mutations(
    [
      {
        type: 'childList',
        target,
        addedNodes: added,
        removedNodes: removed,
      } as unknown as MutationRecord,
    ],
    {} as MutationObserver,
  );
}
function resizeEntry(target: Element): ResizeObserverEntry {
  return {
    target,
    contentRect: target.getBoundingClientRect(),
    borderBoxSize: [],
    contentBoxSize: [],
    devicePixelContentBoxSize: [],
  };
}
beforeEach(() => {
  window.__roomLayoutDiagnosticsEnabled = true;
  frames = new Map();
  serial = 0;
  observed = [];
  unobserved = [];
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.set(++serial, callback);
    return serial;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
  vi.stubGlobal(
    'MutationObserver',
    class {
      constructor(callback: MutationCallback) {
        mutations = callback;
      }
      observe() {}
      disconnect() {}
    },
  );
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(callback: ResizeObserverCallback) {
        resize = callback;
      }
      observe(target: Element) {
        observed.push(target);
      }
      unobserve(target: Element) {
        unobserved.push(target);
      }
      disconnect() {}
    },
  );
  fonts = Object.assign(new EventTarget(), { ready: Promise.resolve() });
  Object.defineProperty(document, 'fonts', {
    configurable: true,
    value: fonts,
  });
});
afterEach(() => {
  for (const cleanup of cleanups) cleanup();
  cleanups.clear();
  Reflect.deleteProperty(window, '__roomLayoutDiagnosticsEnabled');
  if (originalFonts) Object.defineProperty(document, 'fonts', originalFonts);
  else Reflect.deleteProperty(document, 'fonts');
  document.body.replaceChildren();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
async function fixture() {
  const surface = document.createElement('div'),
    host = document.createElement('div'),
    canvas = document.createElement('canvas');
  surface.dataset.roomSurface = 'true';
  host.append(canvas);
  surface.append(host);
  document.body.append(surface);
  vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue(
    new DOMRect(0, 0, 1280, 720),
  );
  const element = document.createElement('button'),
    leader = document.createElement('span');
  element.textContent = 'Drawer 7 · 3 units';
  host.append(element, leader);
  let anchorX = 400,
    width = 120;
  vi.spyOn(element, 'getBoundingClientRect').mockImplementation(
    () =>
      new DOMRect(
        anchorX + Number(element.dataset.labelDx ?? 0),
        200 + Number(element.dataset.labelDy ?? 0),
        width,
        44,
      ),
  );
  const camera = {},
    projection = [1, 0, 0, 1],
    world = [1, 0, 0, 1];
  const demand = vi.fn();
  // Real registry/solver; deterministic clock removes host-speed noise only.
  // The production16ms/work/candidate/four-pass limits are unchanged.
  const registry = createRoomLabelRegistry(vi.fn(), undefined, undefined, {
    clock: () => 0,
  });
  cleanups.add(
    registry.connect(canvas, demand, () => ({
      camera,
      projection: [...projection],
      world: [...world],
    })),
  );
  let unregister = registry.register('D07', element, leader, {
    priority: 4,
    locationCode: 'ITC-D07',
  });
  await fonts.ready;
  await Promise.resolve();
  flush();
  expect(canvas.dataset.labelLayoutStatus).toBe('complete');
  expect(canvas.dataset.labelLayoutPending).toBe('false');
  expect(element.dataset.labelSuppressed).toBe('false');
  demand.mockClear();
  return {
    surface,
    host,
    canvas,
    element,
    registry,
    demand,
    projection,
    world,
    reregister: () => {
      unregister();
      unregister = registry.register('D07', element, leader, {
        priority: 4,
        locationCode: 'ITC-D07',
      });
    },
    move: () => {
      anchorX += 20;
    },
    text: () => {
      element.textContent = 'Drawer 7 · 4 units';
      width += 20;
    },
  };
}
it('settles label-only first observations and real text resizes without feeding scene demand back into registration', async () => {
  const f = await fixture();
  for (let index = 0; index < 6; index++) {
    const revision = Number(f.canvas.dataset.labelLayoutRevision);
    f.reregister(); // React option cleanup/re-registration observes the same DOM again.
    resize([resizeEntry(f.element)], {} as ResizeObserver);
    expect(f.canvas.dataset.labelLayoutPending).toBe('true');
    flush();
    expect(Number(f.canvas.dataset.labelLayoutRevision)).toBeGreaterThan(
      revision,
    );
    expect(f.canvas.dataset.labelLayoutPending).toBe('false');
    expect(f.canvas.dataset.labelLayoutStatus).toBe('complete');
    expect(frames.size).toBe(0);
  }
  const revision = Number(f.canvas.dataset.labelLayoutRevision);
  f.text();
  resize([resizeEntry(f.element)], {} as ResizeObserver);
  flush();
  expect(Number(f.canvas.dataset.labelLayoutRevision)).toBeGreaterThan(
    revision,
  );
  expect(f.element).toHaveTextContent('Drawer 7 · 4 units');
  expect(f.element.dataset.labelSuppressed).toBe('false');
  expect(f.demand).not.toHaveBeenCalled();
});
it('keeps canvas, obstruction and mixed resize deliveries authoritative for scene geometry', async () => {
  const f = await fixture();
  const panel = document.createElement('div');
  panel.dataset.roomObstruction = 'true';
  f.surface.append(panel);
  mutation(f.surface, [panel]);
  flush();
  for (const targets of [
    [f.canvas],
    [panel],
    [f.element, f.canvas],
    [f.element, panel],
  ]) {
    const revision = Number(f.canvas.dataset.labelLayoutRevision);
    f.demand.mockClear();
    resize(targets.map(resizeEntry), {} as ResizeObserver);
    expect(f.demand).toHaveBeenCalledOnce();
    flush();
    expect(Number(f.canvas.dataset.labelLayoutRevision)).toBeGreaterThan(
      revision,
    );
    expect(f.canvas.dataset.labelLayoutPending).toBe('false');
  }
});
it('does not turn unrelated descendant child-list churn into scene demand or new settled revisions at fixed camera/anchors', async () => {
  const f = await fixture(),
    revision = f.canvas.dataset.labelLayoutRevision;
  const projection = [...f.projection],
    world = [...f.world];
  f.element.focus();
  const observations = observed.length;
  for (let index = 0; index < 6; index++) {
    const child = document.createTextNode(String(index));
    f.host.append(child);
    mutation(f.host, [child]);
    flush();
  }
  expect(f.projection).toEqual(projection);
  expect(f.world).toEqual(world);
  expect(f.demand).not.toHaveBeenCalled();
  expect(observed).toHaveLength(observations);
  expect(f.canvas.dataset.labelLayoutRevision).toBe(revision);
  expect(frames.size).toBe(0);
  expect(f.element).toHaveFocus();
});
it('retains scene demand and placement for actual obstruction add, reparent, content mutation and removal', async () => {
  const f = await fixture(),
    panel = document.createElement('div');
  panel.dataset.roomObstruction = 'true';
  vi.spyOn(panel, 'getBoundingClientRect').mockReturnValue(
    new DOMRect(10, 10, 100, 50),
  );
  vi.spyOn(panel, 'getClientRects').mockReturnValue([
    new DOMRect(10, 10, 100, 50),
  ] as unknown as DOMRectList);
  const changed = (work: () => void) => {
    const revision = Number(f.canvas.dataset.labelLayoutRevision);
    f.demand.mockClear();
    work();
    expect(f.demand).toHaveBeenCalled();
    flush();
    expect(Number(f.canvas.dataset.labelLayoutRevision)).toBeGreaterThan(
      revision,
    );
    expect(f.canvas.dataset.labelLayoutStatus).toBe('complete');
  };
  changed(() => {
    f.surface.append(panel);
    mutation(f.surface, [panel]);
  });
  changed(() => {
    f.host.append(panel);
    mutation(f.host, [panel], [panel]);
  });
  changed(() => {
    const content = document.createTextNode('Updated controls');
    panel.append(content);
    mutation(panel, [content]);
  });
  changed(() => {
    panel.remove();
    mutation(f.host, [], [panel]);
  });
  expect(observed.filter((target) => target === panel)).toHaveLength(1);
  expect(unobserved).toEqual([panel]);
});
it('retains unchanged-camera anchor/text, obstruction resize, font and viewport invalidation', async () => {
  const f = await fixture();
  let revision = Number(f.canvas.dataset.labelLayoutRevision);
  f.move();
  f.registry.schedule();
  flush();
  expect(Number(f.canvas.dataset.labelLayoutRevision)).toBeGreaterThan(
    revision,
  );
  revision = Number(f.canvas.dataset.labelLayoutRevision);
  f.text();
  resize([resizeEntry(f.element)], {} as ResizeObserver);
  flush();
  expect(Number(f.canvas.dataset.labelLayoutRevision)).toBeGreaterThan(
    revision,
  );
  const panel = document.createElement('div');
  panel.dataset.roomObstruction = 'true';
  f.surface.append(panel);
  mutation(f.surface, [panel]);
  flush();
  revision = Number(f.canvas.dataset.labelLayoutRevision);
  f.demand.mockClear();
  resize([resizeEntry(panel)], {} as ResizeObserver);
  expect(f.demand).toHaveBeenCalled();
  flush();
  expect(Number(f.canvas.dataset.labelLayoutRevision)).toBeGreaterThan(
    revision,
  );
  for (const event of [
    () => fonts.dispatchEvent(new Event('loadingdone')),
    () => window.dispatchEvent(new Event('resize')),
    () => window.dispatchEvent(new Event('scroll')),
  ]) {
    revision = Number(f.canvas.dataset.labelLayoutRevision);
    f.demand.mockClear();
    event();
    expect(f.demand).toHaveBeenCalled();
    flush();
    expect(Number(f.canvas.dataset.labelLayoutRevision)).toBeGreaterThan(
      revision,
    );
  }
});
it('detects an existing obstruction translated by unrelated sibling flow without a resize or camera change', async () => {
  const f = await fixture(),
    panel = document.createElement('div');
  panel.dataset.roomObstruction = 'true';
  let top = 10;
  vi.spyOn(panel, 'getClientRects').mockReturnValue([
    new DOMRect(10, 10, 100, 50),
  ] as unknown as DOMRectList);
  vi.spyOn(panel, 'getBoundingClientRect').mockImplementation(
    () => new DOMRect(10, top, 100, 50),
  );
  f.surface.append(panel);
  mutation(f.surface, [panel]);
  flush();
  const revision = Number(f.canvas.dataset.labelLayoutRevision);
  f.demand.mockClear();
  const sibling = document.createElement('div');
  f.surface.prepend(sibling);
  top = 60; // Same size; normal sibling flow moved the existing obstruction.
  mutation(f.surface, [sibling]); // No ResizeObserver/scroll/camera notification.
  expect(f.demand).toHaveBeenCalled();
  flush();
  expect(Number(f.canvas.dataset.labelLayoutRevision)).toBeGreaterThan(
    revision,
  );
});

it('detects canvas translation caused by unrelated sibling flow without obstruction or camera notification', async () => {
  const f = await fixture(),
    revision = Number(f.canvas.dataset.labelLayoutRevision);
  vi.mocked(f.canvas.getBoundingClientRect).mockReturnValue(
    new DOMRect(0, 30, 1280, 720),
  );
  const sibling = document.createElement('div');
  f.surface.prepend(sibling);
  mutation(f.surface, [sibling]);
  expect(f.demand).toHaveBeenCalledOnce();
  flush();
  expect(Number(f.canvas.dataset.labelLayoutRevision)).toBeGreaterThan(
    revision,
  );
});
it('never accepts repeated unmeasurable canvas geometry as an unchanged signature', async () => {
  const f = await fixture();
  vi.mocked(f.canvas.getBoundingClientRect).mockReturnValue(
    new DOMRect(0, 0, 0, 0),
  );
  mutation(f.host, [document.createTextNode('one')]);
  mutation(f.host, [document.createTextNode('two')]);
  expect(f.demand).toHaveBeenCalledTimes(2);
});

it('attributes label resize work separately from scene, mutation and viewport demand', async () => {
  const f = await fixture();
  const before = window.__readRoomDemandSnapshot!(f.canvas)!;
  const callback = () => resize([resizeEntry(f.element)], {} as ResizeObserver);
  callback();
  callback();
  f.text();
  callback();
  expect(f.demand).not.toHaveBeenCalled();
  const resized = window.__readRoomDemandSnapshot!(f.canvas)!;
  expect(
    resized.counters['resize-scene'] - before.counters['resize-scene'],
  ).toBe(0);
  expect(
    resized.counters['resize-label'] - before.counters['resize-label'],
  ).toBe(3);
  expect(
    resized.counters['resize-first'] - before.counters['resize-first'],
  ).toBe(1);
  expect(
    resized.counters['resize-identical'] - before.counters['resize-identical'],
  ).toBe(1);
  expect(
    resized.counters['resize-changed'] - before.counters['resize-changed'],
  ).toBe(1);
  flush();
  f.demand.mockClear();
  const ignored = window.__readRoomDemandSnapshot!(f.canvas)!;
  mutation(f.host, [document.createTextNode('unrelated status')]);
  expect(f.demand).not.toHaveBeenCalled();
  expect(
    window.__readRoomDemandSnapshot!(f.canvas)!.counters['mutation-ignored'],
  ).toBe(ignored.counters['mutation-ignored'] + 1);
  const callbacks = [
    ['font-loaded', () => fonts.dispatchEvent(new Event('loadingdone'))],
    ['window-scroll', () => window.dispatchEvent(new Event('scroll'))],
    ['window-resize', () => window.dispatchEvent(new Event('resize'))],
  ] as const;
  for (const [key, callback] of callbacks) {
    const before = window.__readRoomDemandSnapshot!(f.canvas)!.counters[key];
    f.demand.mockClear();
    callback();
    expect(f.demand).toHaveBeenCalledOnce();
    expect(window.__readRoomDemandSnapshot!(f.canvas)!.counters[key]).toBe(
      before + 1,
    );
  }
});

it('preserves callback demand and scheduled work when diagnostics are disabled or enabled', async () => {
  const run = async (enabled: boolean) => {
    window.__roomLayoutDiagnosticsEnabled = enabled;
    const f = await fixture();
    const results: { calls: number; frames: number }[] = [];
    for (const callback of [
      () => resize([resizeEntry(f.canvas)], {} as ResizeObserver),
      () => resize([resizeEntry(f.element)], {} as ResizeObserver),
      () => mutation(f.host, [document.createTextNode('status')]),
      () => fonts.dispatchEvent(new Event('loadingdone')),
      () => window.dispatchEvent(new Event('resize')),
    ]) {
      f.demand.mockClear();
      callback();
      results.push({ calls: f.demand.mock.calls.length, frames: frames.size });
      flush();
    }
    const revision = f.canvas.dataset.labelLayoutRevision;
    for (const cleanup of cleanups) cleanup();
    cleanups.clear();
    document.body.replaceChildren();
    return { results, revision };
  };
  expect(await run(true)).toEqual(await run(false));
});
