import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as placement from './label-layout';
import { createRoomLabelRegistry } from './label-layout-runtime';

const viewport = {
  x: 0,
  y: 0,
  left: 0,
  top: 0,
  right: 160,
  bottom: 100,
  width: 160,
  height: 100,
  toJSON() {},
};
let queue: FrameRequestCallback[];
let resize: ResizeObserverCallback;
function flush() {
  const pending = queue;
  queue = [];
  pending.forEach((callback) => callback(0));
}
function label(host: HTMLElement, tag: 'button' | 'span' = 'button') {
  const element = document.createElement(tag);
  const leader = document.createElement('span');
  host.append(element, leader);
  vi.spyOn(element, 'getBoundingClientRect').mockImplementation(() => {
    const [dx, dy] = element.style.transform
      .match(/-?\d+(?:\.\d+)?/g)
      ?.map(Number) ?? [0, 0];
    return {
      ...viewport,
      left: 50 + dx,
      top: 30 + dy,
      right: 95 + dx,
      bottom: 48 + dy,
      width: 45,
      height: 18,
    };
  });
  return { element, leader };
}
beforeEach(() => {
  queue = [];
  vi.stubGlobal(
    'requestAnimationFrame',
    vi.fn((callback: FrameRequestCallback) => {
      queue.push(callback);
      return queue.length;
    }),
  );
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(callback: ResizeObserverCallback) {
        resize = callback;
      }
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});
afterEach(() => {
  Reflect.deleteProperty(window, '__roomLayoutDiagnosticsEnabled');
  Reflect.deleteProperty(window, '__roomLabelLayoutSnapshot');
  document.body.replaceChildren();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
describe('unified room label registry', () => {
  it('observes exact inputs before placement without changing registry output or scheduling', () => {
    const original = placement.layoutLabels;
    let enabled = false;
    const spy = vi
      .spyOn(placement, 'layoutLabels')
      .mockImplementation((labels, bounds, reserved) => {
        if (enabled) {
          expect(window.__roomLabelLayoutSnapshot!.passes.at(-1)).toEqual({
            labels,
            viewport: {
              left: bounds.left,
              top: bounds.top,
              right: bounds.right,
              bottom: bounds.bottom,
            },
            reserved: reserved?.map((area) => ({
              left: area.left,
              top: area.top,
              right: area.right,
              bottom: area.bottom,
            })),
          });
        }
        return original(labels, bounds, reserved);
      });
    const run = () => {
      const host = document.createElement('div'),
        canvas = document.createElement('canvas');
      host.append(canvas);
      document.body.append(host);
      vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue(viewport);
      const item = label(host),
        suppression = vi.fn();
      const registry = createRoomLabelRegistry(suppression),
        cleanup = registry.connect(canvas);
      registry.register('shelf-1a', item.element, item.leader, {
        priority: 3,
        locationCode: 'ITC-S1A',
        mandatory: true,
        compact: true,
      });
      flush();
      const result = {
        html: item.element.outerHTML,
        leader: item.leader.outerHTML,
        pendingFrames: queue.length,
        calls: suppression.mock.calls,
      };
      cleanup();
      host.remove();
      return result;
    };
    const ordinary = run();
    expect(window.__roomLabelLayoutSnapshot).toBeUndefined();
    Object.defineProperty(window, '__roomLayoutDiagnosticsEnabled', {
      value: true,
      configurable: true,
    });
    enabled = true;
    expect(run()).toEqual(ordinary);
    expect(window.__roomLabelLayoutSnapshot).toMatchObject({
      complete: true,
      settled: true,
    });
    expect(spy).toHaveBeenCalled();
  });
  it('keeps placement pending through actual centered full/compact CSS measurement and preserves focused neighbors', () => {
    const host = document.createElement('div'),
      canvas = document.createElement('canvas');
    host.append(canvas);
    document.body.append(host);
    vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue(viewport);
    const measured: { compact: boolean; pending: string | undefined }[] = [];
    const make = (left: number) => {
      const item = label(host),
        full = document.createElement('span');
      full.dataset.roomLabelFull = 'true';
      item.element.append(full);
      vi.spyOn(full, 'getBoundingClientRect').mockReturnValue({
        ...viewport,
        width: 122,
        height: 32,
      });
      vi.mocked(item.element.getBoundingClientRect).mockImplementation(() => {
        const compact = item.element.dataset.labelCompact === 'true';
        measured.push({ compact, pending: canvas.dataset.labelLayoutPending });
        const width = compact ? 44 : 140,
          height = 44;
        const dx = Number(item.element.dataset.labelDx ?? 0),
          dy = Number(item.element.dataset.labelDy ?? 0);
        // Html center translates by half the changing button dimensions.
        const x = left + (140 - width) / 2 + dx,
          y = 28 + dy;
        return {
          ...viewport,
          left: x,
          right: x + width,
          top: y,
          bottom: y + height,
          width,
          height,
        };
      });
      return item;
    };
    const a = make(70),
      b = make(78),
      registry = createRoomLabelRegistry(vi.fn());
    const cleanup = registry.connect(canvas);
    const options = {
      priority: 3,
      mandatory: true,
      compact: true,
      locationCode: 'A',
    };
    const unregister = registry.register('a', a.element, a.leader, options);
    registry.register('b', b.element, b.leader, {
      ...options,
      locationCode: 'B',
    });
    a.element.focus();
    flush();
    expect(
      measured.every((measurement) => measurement.pending === 'true'),
    ).toBe(true);
    expect(measured.some((measurement) => measurement.compact)).toBe(true);
    expect(canvas.dataset.labelLayoutPending).toBe('false');
    const first = a.element.getBoundingClientRect(),
      neighbor = b.element.getBoundingClientRect();
    for (const rect of [first, neighbor]) {
      expect(rect.left).toBeGreaterThanOrEqual(2);
      expect(rect.right).toBeLessThanOrEqual(158);
      expect(rect.width).toBe(44);
    }
    expect(
      first.right + 3 <= neighbor.left ||
        neighbor.right + 3 <= first.left ||
        first.bottom + 3 <= neighbor.top ||
        neighbor.bottom + 3 <= first.top,
    ).toBe(true);
    unregister();
    registry.register('a', a.element, a.leader, {
      ...options,
      preferFull: true,
      inspection: 'focus',
    });
    flush();
    expect(a.element).toHaveFocus();
    expect(b.element.getBoundingClientRect()).toEqual(neighbor);
    expect(queue).toHaveLength(0);
    cleanup();
  });
  it('retains a displaced marker across effect cleanup and focus registration without moving its neighbor', () => {
    const host = document.createElement('div'),
      canvas = document.createElement('canvas');
    host.append(canvas);
    document.body.append(host);
    vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue(viewport);
    const a = label(host),
      b = label(host);
    const registry = createRoomLabelRegistry(vi.fn());
    const cleanup = registry.connect(canvas);
    registry.register('a', a.element, a.leader, {
      priority: 3,
      mandatory: true,
      compact: true,
      locationCode: 'A',
    });
    const options = {
      priority: 3,
      mandatory: true,
      compact: true,
      locationCode: 'B',
    };
    const unregister = registry.register('b', b.element, b.leader, options);
    flush();
    const displaced = b.element.dataset.labelDx;
    expect(displaced).not.toBe('0');
    // Camera geometry changes leave the previous B placement valid while its
    // old preferred pixel becomes free. Focus must still retain that placement.
    vi.mocked(a.element.getBoundingClientRect).mockReturnValue({
      ...viewport,
      left: 110,
      top: 30,
      right: 154,
      bottom: 74,
      width: 44,
      height: 44,
    });
    unregister();
    registry.register('b', b.element, b.leader, {
      ...options,
      preferFull: true,
      inspection: 'focus',
    });
    flush();
    expect(b.element.dataset.labelDx).toBe(displaced);
    expect(a.element.dataset.labelDx).toBe('0');
    expect(a.element.dataset.labelSuppressed).toBe('false');
    expect(b.element.dataset.labelSuppressed).toBe('false');
    cleanup();
  });
  it('supplies a quiet readable focused summary when full text would displace another occupied action', () => {
    const host = document.createElement('div');
    const canvas = document.createElement('canvas');
    host.append(canvas);
    document.body.append(host);
    vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue(viewport);
    const first = label(host),
      second = label(host);
    const full = document.createElement('span');
    full.dataset.roomLabelFull = 'true';
    first.element.append(full);
    vi.spyOn(full, 'getBoundingClientRect').mockReturnValue({
      ...viewport,
      width: 140,
      height: 44,
    });
    const summary = vi.fn();
    const registry = createRoomLabelRegistry(vi.fn(), summary);
    const cleanup = registry.connect(canvas);
    const text = 'Long drawer name (ITC-D01) · 1 product / 31 units / 2 assets';
    const options = {
      priority: 3,
      mandatory: true,
      compact: true,
      locationCode: 'ITC-D01',
      preferFull: true,
      inspection: 'focus' as const,
      readableSummary: text,
    };
    registry.register('first', first.element, first.leader, options);
    registry.register('second', second.element, second.leader, {
      priority: 3,
      mandatory: true,
      compact: true,
      locationCode: 'ITC-D02',
    });
    flush();
    expect(first.element.dataset.labelCompact).toBe('true');
    expect(second.element.dataset.labelSuppressed).toBe('false');
    expect(summary).toHaveBeenCalledExactlyOnceWith(text);
    registry.schedule();
    flush();
    expect(summary).toHaveBeenCalledOnce();
    registry.register('first', first.element, first.leader, {
      ...options,
      inspection: null,
      preferFull: false,
    });
    flush();
    expect(summary).toHaveBeenLastCalledWith(null);
    cleanup();
  });
  it('marks camera/layout work pending synchronously and settles one revision per bounded placement', () => {
    const host = document.createElement('div');
    const canvas = document.createElement('canvas');
    host.append(canvas);
    document.body.append(host);
    vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue(viewport);
    const registry = createRoomLabelRegistry(vi.fn());
    const cleanup = registry.connect(canvas);
    expect(canvas.dataset.labelLayoutPending).toBe('true');
    flush();
    expect(canvas.dataset.labelLayoutPending).toBe('false');
    expect(canvas.dataset.labelLayoutRevision).toBe('1');
    registry.schedule();
    registry.schedule();
    expect(canvas.dataset.labelLayoutPending).toBe('true');
    expect(queue).toHaveLength(1);
    flush();
    expect(canvas.dataset.labelLayoutRevision).toBe('2');
    expect(queue).toHaveLength(0);
    cleanup();
    expect(canvas.dataset.labelLayoutPending).toBeUndefined();
  });
  it('passes only a native-hit-confirmed pointer witness with the actual physical action bounds', () => {
    const host = document.createElement('div'),
      canvas = document.createElement('canvas');
    host.append(canvas);
    document.body.append(host);
    vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue(viewport);
    const item = label(host),
      child = document.createElement('span');
    item.element.append(child);
    const layout = vi.spyOn(placement, 'layoutLabels');
    const descriptor = Object.getOwnPropertyDescriptor(
      document,
      'elementFromPoint',
    );
    const hit = vi.fn(() => child as Element);
    Object.defineProperty(document, 'elementFromPoint', {
      configurable: true,
      value: hit,
    });
    const registry = createRoomLabelRegistry(vi.fn()),
      cleanup = registry.connect(canvas);
    try {
      registry.register('hover', item.element, item.leader, {
        priority: 3,
        mandatory: true,
        inspection: 'hover',
        pointer: () => ({ x: 60, y: 35 }),
      });
      flush();
      expect(layout.mock.lastCall?.[0][0].pointer).toEqual({
        x: 60,
        y: 35,
        bounds: { left: 50, top: 30, right: 95, bottom: 48 },
      });
      hit.mockReturnValue(document.body);
      registry.schedule();
      flush();
      expect(layout.mock.lastCall?.[0][0].pointer).toBeUndefined();
    } finally {
      cleanup();
      if (descriptor)
        Object.defineProperty(document, 'elementFromPoint', descriptor);
      else Reflect.deleteProperty(document, 'elementFromPoint');
    }
  });
  it('fits a selected occupied name and count row into its measured 44px action', () => {
    const host = document.createElement('div'),
      canvas = document.createElement('canvas');
    host.append(canvas);
    document.body.append(host);
    vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({
      ...viewport,
      height: 48,
      bottom: 48,
    });
    const item = label(host),
      full = document.createElement('span');
    full.dataset.roomLabelFull = 'true';
    item.element.dataset.roomOccupied = 'true';
    item.element.append(full);
    vi.spyOn(full, 'getBoundingClientRect').mockReturnValue({
      ...viewport,
      width: 122,
      height: 36,
    });
    const registry = createRoomLabelRegistry(vi.fn()),
      cleanup = registry.connect(canvas);
    registry.register('selected-occupied', item.element, item.leader, {
      priority: 4,
      mandatory: true,
    });
    flush();
    expect(item.element.dataset.labelSuppressed).toBe('false');
    expect(item.element.dataset.labelCompact).toBe('false');
    expect(canvas.dataset.labelLayoutPending).toBe('false');
    cleanup();
  });
  it.each([
    { dimension: 'width', delta: 3 / 65536, settles: true },
    { dimension: 'height', delta: 3 / 65536, settles: true },
    { dimension: 'width', delta: 0.01, settles: false },
    { dimension: 'height', delta: 18, settles: false },
  ] as const)(
    'bounds translation noise for $dimension delta $delta without accepting real reflow',
    ({ dimension, delta, settles }) => {
      const host = document.createElement('div'),
        canvas = document.createElement('canvas');
      host.append(canvas);
      document.body.append(host);
      vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue(viewport);
      const item = label(host),
        full = document.createElement('span');
      full.dataset.roomLabelFull = 'true';
      item.element.append(full);
      let reads = 0;
      vi.spyOn(full, 'getBoundingClientRect').mockImplementation(() => ({
        ...viewport,
        width: 40,
        height: 32,
        [dimension]:
          (dimension === 'width' ? 40 : 32) + (++reads % 2 ? delta : 0),
      }));
      const registry = createRoomLabelRegistry(vi.fn()),
        cleanup = registry.connect(canvas);
      registry.register('fractional', item.element, item.leader, {
        priority: 4,
        mandatory: true,
      });
      flush();
      expect(canvas.dataset.labelLayoutPending).toBe(String(!settles));
      expect(reads).toBe(settles ? 2 : 8);
      if (settles) expect(canvas.dataset.labelLayoutError).toBeUndefined();
      else
        expect(canvas.dataset.labelLayoutError).toMatch(
          /four placement passes/,
        );
      cleanup();
    },
  );
  it('fails explicitly at the synchronous remeasurement bound instead of publishing unstable placement', () => {
    const host = document.createElement('div'),
      canvas = document.createElement('canvas');
    host.append(canvas);
    document.body.append(host);
    vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue(viewport);
    const item = label(host),
      full = document.createElement('span');
    full.dataset.roomLabelFull = 'true';
    item.element.append(full);
    let reads = 0;
    vi.spyOn(full, 'getBoundingClientRect').mockImplementation(() => ({
      ...viewport,
      width: ++reads % 2 ? 40 : 41,
      height: 18,
    }));
    const notify = vi.fn(),
      registry = createRoomLabelRegistry(notify),
      cleanup = registry.connect(canvas);
    registry.register('unstable', item.element, item.leader, {
      priority: 4,
      mandatory: true,
    });
    flush();
    expect(reads).toBe(8);
    expect(canvas.dataset.labelLayoutPending).toBe('true');
    expect(canvas.dataset.labelLayoutError).toMatch(/four placement passes/);
    expect(canvas.dataset.labelLayoutRevision).toBeUndefined();
    expect(notify).not.toHaveBeenCalled();
    expect(queue).toHaveLength(0);
    vi.mocked(full.getBoundingClientRect).mockReturnValue({
      ...viewport,
      width: 40,
      height: 18,
    });
    registry.schedule();
    flush();
    expect(canvas.dataset.labelLayoutPending).toBe('false');
    expect(canvas.dataset.labelLayoutError).toBeUndefined();
    cleanup();
  });
  it('remeasures after font readiness and font changes, then removes that subscription', async () => {
    const previous = Object.getOwnPropertyDescriptor(document, 'fonts');
    const fonts = Object.assign(new EventTarget(), {
      ready: Promise.resolve(),
    });
    Object.defineProperty(document, 'fonts', {
      configurable: true,
      value: fonts,
    });
    try {
      const host = document.createElement('div');
      const canvas = document.createElement('canvas');
      host.append(canvas);
      document.body.append(host);
      vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue(viewport);
      const registry = createRoomLabelRegistry(vi.fn());
      const cleanup = registry.connect(canvas);
      flush();
      await Promise.resolve();
      expect(queue).toHaveLength(1);
      flush();
      fonts.dispatchEvent(new Event('loadingdone'));
      expect(queue).toHaveLength(1);
      flush();
      expect(queue).toHaveLength(0);
      cleanup();
      fonts.dispatchEvent(new Event('loadingdone'));
      expect(queue).toHaveLength(0);
    } finally {
      if (previous) Object.defineProperty(document, 'fonts', previous);
      else Reflect.deleteProperty(document, 'fonts');
    }
  });
  it('measures external hover and anchored text together, deduplicates and settles after resize', () => {
    const surface = document.createElement('div');
    surface.dataset.roomSurface = 'true';
    const host = document.createElement('div');
    const canvas = document.createElement('canvas');
    host.append(canvas);
    surface.append(host);
    document.body.append(surface);
    vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue(viewport);
    const anchored = label(host);
    const hover = label(surface);
    const decorative = label(host, 'span');
    const notify = vi.fn();
    const registry = createRoomLabelRegistry(notify);
    const cleanup = registry.connect(canvas);
    registry.register('anchored', anchored.element, anchored.leader, {
      priority: 1,
      locationCode: 'ITC-D01',
    });
    registry.register('hover', hover.element, hover.leader, {
      priority: 2,
      locationCode: 'ITC-D01',
    });
    registry.register('door', decorative.element, decorative.leader, {
      priority: 0,
      interactive: false,
    });
    registry.schedule();
    registry.schedule();
    expect(queue).toHaveLength(1);
    anchored.element.focus();
    flush();
    expect(anchored.element.dataset.labelSuppressed).toBe('false');
    expect(anchored.element).toHaveFocus();
    expect(hover.element.dataset.labelSuppressed).toBe('true');
    anchored.element.blur();
    registry.schedule();
    flush();
    expect(anchored.element.dataset.labelSuppressed).toBe('true');
    expect(anchored.element).toHaveAttribute('aria-hidden', 'true');
    expect(anchored.element.tabIndex).toBe(-1);
    expect(anchored.element.style.pointerEvents).toBe('none');
    expect(anchored.element).not.toHaveFocus();
    expect(hover.element.dataset.labelSuppressed).toBe('false');
    expect(decorative.element.tabIndex).toBe(-1);
    expect(decorative.leader.style.display).toBe('block');
    expect(queue).toHaveLength(0);
    resize([], {} as ResizeObserver);
    flush();
    expect(queue).toHaveLength(0);
    expect(notify).toHaveBeenCalledOnce();
    cleanup();
  });
  it('keeps occluded text unavailable and does not let an old ref cleanup remove its replacement', () => {
    const host = document.createElement('div');
    const canvas = document.createElement('canvas');
    host.append(canvas);
    document.body.append(host);
    vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue(viewport);
    const old = label(host);
    const current = label(host);
    const hidden = document.createElement('div');
    hidden.style.display = 'none';
    host.append(hidden);
    const occluded = label(hidden);
    const registry = createRoomLabelRegistry(vi.fn());
    const cleanup = registry.connect(canvas);
    const unregister = registry.register('location', old.element, old.leader, {
      priority: 1,
    });
    registry.register('location', current.element, current.leader, {
      priority: 3,
    });
    unregister();
    registry.register('hidden', occluded.element, occluded.leader, {
      priority: 3,
    });
    flush();
    expect(current.element.dataset.labelSuppressed).toBe('false');
    expect(occluded.element.dataset.labelSuppressed).toBe('true');
    expect(occluded.element.tabIndex).toBe(-1);
    expect(occluded.element).toHaveAttribute('aria-hidden', 'true');
    cleanup();
  });
});
