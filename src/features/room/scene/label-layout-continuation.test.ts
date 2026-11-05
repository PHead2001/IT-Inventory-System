import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import * as packing from './label-layout';
import { createRoomLabelRegistry } from './label-layout-runtime';

let frames: Map<number, FrameRequestCallback>;
let nextFrame: number;
let observerCallbacks: ResizeObserverCallback[];
function flush() {
  const current = [...frames.values()];
  frames.clear();
  current.forEach((callback) => callback(0));
}
beforeEach(() => {
  frames = new Map();
  nextFrame = 0;
  observerCallbacks = [];
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.set(++nextFrame, callback);
    return nextFrame;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(callback: ResizeObserverCallback) {
        observerCallbacks.push(callback);
      }
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  window.__roomLayoutDiagnosticsEnabled = true;
});
afterEach(() => {
  document.body.replaceChildren();
  Reflect.deleteProperty(window, '__roomLayoutDiagnosticsEnabled');
  Reflect.deleteProperty(window, '__roomLabelLayoutSnapshot');
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function fixture(maxOperations?: number) {
  let now = 0;
  let reads = 0;
  let persistentSlow = false;
  let firstSlow = true;
  let anchor = 50;
  let viewportLeft = 0;
  let blocked = false;
  let camera = {};
  const surface = document.createElement('div');
  surface.dataset.roomSurface = 'true';
  const host = document.createElement('div');
  const canvas = document.createElement('canvas');
  const element = document.createElement('button');
  const leader = document.createElement('span');
  const obstruction = document.createElement('div');
  obstruction.dataset.roomObstruction = 'true';
  host.append(canvas, element, leader);
  surface.append(host, obstruction);
  document.body.append(surface);
  const rect = (left: number, top: number, width: number, height: number) => ({
    x: left,
    y: top,
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
    toJSON() {
      return {
        x: left,
        y: top,
        left,
        top,
        width,
        height,
        right: left + width,
        bottom: top + height,
      };
    },
  });
  vi.spyOn(canvas, 'getBoundingClientRect').mockImplementation(() =>
    rect(viewportLeft, 0, 160, 100),
  );
  vi.spyOn(obstruction, 'getClientRects').mockReturnValue([
    {},
  ] as unknown as DOMRectList);
  vi.spyOn(obstruction, 'getBoundingClientRect').mockImplementation(() =>
    blocked ? rect(45, 25, 60, 30) : rect(120, 0, 10, 10),
  );
  vi.spyOn(element, 'getBoundingClientRect').mockImplementation(() => {
    reads++;
    if (reads > 1 && persistentSlow) now += 20;
    else if (reads === 2 && firstSlow) now += 2;
    return rect(
      anchor + Number(element.dataset.labelDx ?? 0),
      30 + Number(element.dataset.labelDy ?? 0),
      45,
      18,
    );
  });
  let solverCalls = 0;
  const solver = vi
    .spyOn(packing, 'layoutLabelsDetailed')
    .mockImplementation((labels) => {
      const elapsed = ++solverCalls === 1 ? 15 : 1;
      now += elapsed;
      return {
        status: 'complete',
        placements: labels.map(({ id }) => ({
          id,
          visible: true,
          compact: false,
          dx: blocked ? 60 : 0,
          dy: 0,
        })),
        stats: {
          operations: 1,
          candidates: 1,
          nodes: 1,
          backtracks: 0,
          elapsedMs: elapsed,
          greedyComplete: true,
        },
      };
    });
  const notify = vi.fn();
  const registry = createRoomLabelRegistry(notify, undefined, undefined, {
    clock: () => now,
    ...(maxOperations === undefined ? {} : { limits: { maxOperations } }),
  });
  const invalidateScene = vi.fn();
  const cleanup = registry.connect(canvas, invalidateScene, () => ({
    camera,
    projection: [1],
    world: [1],
  }));
  registry.register('shelf-1a', element, leader, {
    priority: 4,
    mandatory: true,
    locationCode: 'ITC-S1A',
  });
  return {
    canvas,
    element,
    registry,
    solver,
    notify,
    cleanup,
    invalidateScene,
    ownResize() {
      const entry: ResizeObserverEntry = {
        target: element,
        contentRect: rect(0, 0, 45, 18),
        borderBoxSize: [{ inlineSize: 45, blockSize: 18 }],
        contentBoxSize: [{ inlineSize: 45, blockSize: 18 }],
        devicePixelContentBoxSize: [{ inlineSize: 45, blockSize: 18 }],
      };
      observerCallbacks.at(-1)!([entry], {
        observe() {},
        unobserve() {},
        disconnect() {},
      });
    },
    frame(at: number) {
      now = at;
      flush();
    },
    slow(value: boolean) {
      persistentSlow = value;
      firstSlow = value;
    },
    change(kind: string) {
      if (kind === 'camera') camera = {};
      if (kind === 'viewport') viewportLeft = 10;
      if (kind === 'obstruction') blocked = true;
      if (kind === 'anchor') anchor = 55;
    },
  };
}

it('keeps a successful solver proposal suppressed through the exhausted frame and publishes only a whole fresh validation', () => {
  const f = fixture();
  f.frame(0);
  expect(f.canvas.dataset.labelLayoutPending).toBe('true');
  expect(f.canvas.dataset.labelLayoutRevision).toBeUndefined();
  expect(f.element).toHaveAttribute('aria-hidden', 'true');
  expect(f.element.tabIndex).toBe(-1);
  expect(f.element.style.pointerEvents).toBe('none');
  expect(f.notify).not.toHaveBeenCalled();
  expect(f.solver).toHaveBeenCalledOnce();
  f.invalidateScene.mockClear();
  const demandBefore = window.__readRoomDemandSnapshot!(f.canvas)!;
  f.ownResize();
  expect(f.invalidateScene).not.toHaveBeenCalled();
  expect(
    window.__readRoomDemandSnapshot!(f.canvas)!.counters['resize-continuation'],
  ).toBe(demandBefore.counters['resize-continuation'] + 1);
  expect(
    window.__readRoomDemandSnapshot!(f.canvas)!.counters['resize-scene'],
  ).toBe(demandBefore.counters['resize-scene']);
  f.frame(40);
  expect(f.canvas.dataset.labelLayoutPending).toBe('false');
  expect(f.canvas.dataset.labelLayoutRevision).toBe('1');
  expect(f.canvas.dataset.labelLayoutError).toBeUndefined();
  expect(f.element).not.toHaveAttribute('aria-hidden');
  expect(f.element.tabIndex).toBe(0);
  expect(f.notify).toHaveBeenCalledOnce();
  expect(f.solver).toHaveBeenCalledOnce();
  expect(frames.size).toBe(0);
  expect(window.__roomLabelLayoutSnapshot!.runtime!.timing).toMatchObject({
    elapsedMs: 40,
    chargedElapsedMs: 17,
    maxFrameElapsedMs: 17,
    frameCount: 2,
    continuationFrames: 1,
  });
  f.cleanup();
});

it('never publishes an old proposal after silent camera, viewport, obstruction or anchor changes', () => {
  for (const kind of ['camera', 'viewport', 'obstruction', 'anchor']) {
    const f = fixture();
    f.frame(0);
    expect(f.canvas.dataset.labelLayoutPending).toBe('true');
    f.change(kind);
    f.frame(40);
    if (frames.size) {
      expect(f.canvas.dataset.labelLayoutRevision).toBeUndefined();
      expect(f.element).toHaveAttribute('aria-hidden', 'true');
      f.frame(80);
    }
    expect(f.solver).toHaveBeenCalledTimes(2);
    if (kind === 'anchor') {
      expect(f.solver.mock.lastCall![0][0].left).toBe(55);
      const first = f.solver.mock.calls[0][3]!;
      const second = f.solver.mock.calls[1][3]!;
      for (const key of ['maxOperations', 'maxCandidates', 'maxNodes'] as const)
        expect(second[key]).toBeLessThan(first[key]!);
    }
    if (kind === 'viewport') expect(f.solver.mock.lastCall![1].left).toBe(10);
    if (kind === 'obstruction') expect(f.element.dataset.labelDx).toBe('60');
    expect(f.canvas.dataset.labelLayoutRevision).toBe('1');
    expect(f.element).not.toHaveAttribute('aria-hidden');
    f.cleanup();
    f.solver.mockRestore();
  }
});

it('fails closed after four whole-pass continuations and does not cache transient time exhaustion', () => {
  const f = fixture();
  f.slow(true);
  f.frame(0);
  for (let frame = 1; frame <= 4; frame++) f.frame(frame * 100);
  expect(frames.size).toBe(0);
  expect(f.canvas.dataset.labelLayoutPending).toBe('false');
  expect(f.canvas.dataset.labelLayoutRevision).toBeUndefined();
  expect(f.canvas.dataset.labelLayoutError).toMatch(
    /remeasurement work budget/,
  );
  expect(f.element).toHaveAttribute('aria-hidden', 'true');
  expect(f.solver).toHaveBeenCalledOnce();
  expect(window.__roomLabelLayoutSnapshot!.runtime!.timing).toMatchObject({
    frameCount: 5,
    continuationFrames: 4,
  });
  f.slow(false);
  f.registry.schedule();
  f.frame(500);
  expect(f.solver).toHaveBeenCalledTimes(2);
  expect(f.canvas.dataset.labelLayoutError).toBeUndefined();
  expect(f.canvas.dataset.labelLayoutRevision).toBe('1');
  expect(f.element).not.toHaveAttribute('aria-hidden');
  f.cleanup();
  f.solver.mockRestore();
  const capped = fixture(10);
  capped.frame(0);
  capped.frame(40);
  expect(capped.canvas.dataset.labelLayoutRevision).toBeUndefined();
  expect(capped.element).toHaveAttribute('aria-hidden', 'true');
  expect(capped.solver).toHaveBeenCalledOnce();
  expect(frames.size).toBe(0);
  capped.cleanup();
});

it('retires a retained selected-button proposal when the same logical location becomes a passive marker before validation', () => {
  const f = fixture();
  f.frame(0);
  expect(f.canvas.dataset.labelLayoutPending).toBe('true');
  const marker = document.createElement('span'),
    leader = document.createElement('span');
  marker.style.visibility = 'hidden';
  f.element.parentElement!.append(marker, leader);
  f.element.remove();
  vi.spyOn(marker, 'getBoundingClientRect').mockImplementation(() => {
    const left = 50 + Number(marker.dataset.labelDx ?? 0),
      top = 30 + Number(marker.dataset.labelDy ?? 0);
    return {
      x: left,
      y: top,
      left,
      top,
      width: 24,
      height: 24,
      right: left + 24,
      bottom: top + 24,
      toJSON() {
        return {
          left,
          top,
          right: left + 24,
          bottom: top + 24,
          width: 24,
          height: 24,
        };
      },
    };
  });
  const unregister = f.registry.register('shelf-1a', marker, leader, {
    priority: 3,
    mandatory: true,
    locationCode: 'ITC-S1A',
    presentation: 'occupied-marker',
  });
  f.frame(40);
  expect(f.canvas.dataset.labelLayoutRevision).toBeUndefined();
  expect(marker.style.visibility).toBe('hidden');
  f.frame(80);
  expect(f.solver).toHaveBeenCalledTimes(2);
  expect(f.solver.mock.lastCall![0]).toMatchObject([
    {
      id: 'shelf-1a',
      presentation: 'occupied-marker',
      width: 24,
      height: 24,
      compact: { width: 24, height: 24 },
      selected: false,
    },
  ]);
  expect(f.canvas.dataset.labelLayoutRevision).toBe('1');
  expect(marker.style.visibility).toBe('visible');
  expect(marker.style.pointerEvents).toBe('none');
  expect(marker.tabIndex).toBe(-1);
  expect(f.element.isConnected).toBe(false);
  unregister();
  f.cleanup();
});
