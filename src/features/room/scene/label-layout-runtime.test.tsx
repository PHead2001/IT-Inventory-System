import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
  document.body.replaceChildren();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
describe('unified room label registry', () => {
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
    expect(occluded.element.dataset.labelSuppressed).toBeUndefined();
    cleanup();
  });
});
