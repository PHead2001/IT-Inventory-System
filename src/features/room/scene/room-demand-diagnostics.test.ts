import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  bindRoomDemand,
  recordRoomDemand,
  recordRoomResize,
  ROOM_DEMAND_REASONS,
  ROOM_DEMAND_COUNTER_CAP,
  ROOM_DEMAND_MAX_BYTES,
} from './room-demand-diagnostics';
const enabled = () => {
  window.__roomLayoutDiagnosticsEnabled = true;
  return window;
};
const snapshot = (canvas: unknown) => window.__readRoomDemandSnapshot?.(canvas);
afterEach(() => {
  Reflect.deleteProperty(window, '__roomLayoutDiagnosticsEnabled');
  Reflect.deleteProperty(window, '__readRoomDemandSnapshot');
});
describe('bounded room demand observation', () => {
  it('is absent when disabled and never changes demand or reads resize data', () => {
    const canvas = document.createElement('canvas'),
      invalidate = vi.fn();
    const cleanup = bindRoomDemand(canvas, invalidate, {} as Window);
    recordRoomDemand(invalidate, 'camera-flight');
    recordRoomResize(
      canvas,
      {
        get contentRect() {
          throw Error('must not read');
        },
      } as unknown as ResizeObserverEntry,
      'canvas',
    );
    cleanup();
    expect(window.__readRoomDemandSnapshot).toBeUndefined();
    expect(invalidate).not.toHaveBeenCalled();
    expect(Object.keys(canvas)).not.toContain('__roomDemandSnapshot');
  });
  it('keeps independent immutable per-canvas snapshots, preserves reconnect counts and rejects stale cleanup', () => {
    const a = document.createElement('canvas'),
      b = document.createElement('canvas');
    const first = vi.fn(),
      second = vi.fn();
    const stale = bindRoomDemand(a, first, enabled());
    const other = bindRoomDemand(b, second, enabled());
    recordRoomDemand(first, 'camera-flight');
    const firstSnapshot = snapshot(a)!;
    expect(Object.isFrozen(firstSnapshot)).toBe(true);
    expect(Object.isFrozen(firstSnapshot.counters)).toBe(true);
    expect(snapshot(a)).toEqual(firstSnapshot); // reads do not increment
    const current = bindRoomDemand(a, first, enabled());
    stale();
    recordRoomDemand(first, 'camera-flight');
    expect(snapshot(a)).toMatchObject({
      bound: true,
      bindingCount: 2,
    });
    expect(snapshot(a)!.counters['camera-flight']).toBe(2);
    expect(firstSnapshot.counters['camera-flight']).toBe(1);
    expect(snapshot(b)!.counters['camera-flight']).toBe(0);
    current();
    other();
    expect(snapshot(a)).toBeNull();
    recordRoomDemand(first, 'camera-flight');
    const rebound = bindRoomDemand(a, first, enabled());
    expect(snapshot(a)!.counters['camera-flight']).toBe(2);
    rebound();
  });
  it('caps every fixed counter, flags overflow and excludes arbitrary data within 4 KiB', () => {
    const canvas = document.createElement('canvas');
    const cleanup = bindRoomDemand(canvas, undefined, enabled());
    // Include the binding counter in the fixed counter budget.
    expect(ROOM_DEMAND_REASONS.length + 1).toBeLessThanOrEqual(48);
    for (let i = 0; i <= ROOM_DEMAND_COUNTER_CAP; i++)
      recordRoomDemand(canvas, 'driver-schedule');
    recordRoomDemand(canvas, 'private arbitrary text' as never);
    const result = snapshot(canvas)!;
    expect(result.counters['driver-schedule']).toBe(ROOM_DEMAND_COUNTER_CAP);
    expect(result.overflow).toBe(true);
    expect(Object.keys(result.counters)).toEqual([...ROOM_DEMAND_REASONS]);
    expect(JSON.stringify(result)).not.toContain('private arbitrary text');
    const saturated = {
      ...result,
      counters: Object.fromEntries(
        ROOM_DEMAND_REASONS.map((key) => [key, ROOM_DEMAND_COUNTER_CAP]),
      ),
    };
    expect(JSON.stringify(saturated).length).toBeLessThanOrEqual(
      ROOM_DEMAND_MAX_BYTES,
    );
    cleanup();
  });
  it('makes preconnection omissions explicit and reads bad arguments or a withdrawn gate as unavailable', () => {
    const canvas = document.createElement('canvas'),
      invalidate = vi.fn();
    enabled();
    recordRoomDemand(invalidate, 'camera-update');
    const cleanup = bindRoomDemand(canvas, invalidate);
    expect(snapshot(canvas)).toMatchObject({
      bound: true,
      preconnectObserved: false,
      counters: { 'camera-update': 0 },
    });
    for (const value of [null, undefined, 1, 'canvas', {}, invalidate])
      expect(snapshot(value)).toBeNull();
    expect(
      Object.getOwnPropertyDescriptor(window, '__readRoomDemandSnapshot'),
    ).toMatchObject({
      writable: false,
      enumerable: false,
    });
    recordRoomDemand(invalidate, 'camera-update');
    window.__roomLayoutDiagnosticsEnabled = false;
    expect(snapshot(canvas)).toBeNull();
    recordRoomDemand(invalidate, 'camera-update');
    enabled();
    expect(snapshot(canvas)!.counters['camera-update']).toBe(1);
    cleanup();
  });
  it('remains nonthrowing if installation, gate, diagnostic input or cleanup is unavailable', () => {
    const canvas = document.createElement('canvas');
    const blocked = enabled();
    const targetWithBlockedReader = Object.create(blocked) as Window;
    Object.defineProperty(targetWithBlockedReader, '__readRoomDemandSnapshot', {
      value: null,
      configurable: false,
    });
    expect(() =>
      bindRoomDemand(canvas, vi.fn(), targetWithBlockedReader)(),
    ).not.toThrow();
    expect(() =>
      bindRoomDemand(null as never, vi.fn(), enabled())(),
    ).not.toThrow();
    const target = enabled(),
      second = document.createElement('canvas');
    const release = bindRoomDemand(second, undefined, target);
    Object.defineProperty(target, '__roomLayoutDiagnosticsEnabled', {
      get() {
        throw Error('private failure');
      },
    });
    expect(() => recordRoomDemand(second, 'anchor')).not.toThrow();
    expect(() =>
      recordRoomResize(second, null as never, 'label'),
    ).not.toThrow();
    expect(() => release()).not.toThrow();
  });
  it('classifies delivered dimensions by target identity without retaining raw geometry', () => {
    const canvas = document.createElement('canvas'),
      label = document.createElement('button');
    const release = bindRoomDemand(canvas, undefined, enabled());
    const record = (target: Element, width: number) =>
      ({ target, contentRect: { width, height: 44 } }) as ResizeObserverEntry;
    recordRoomResize(canvas, record(label, 80), 'label');
    recordRoomResize(canvas, record(label, 80), 'label');
    recordRoomResize(canvas, record(label, 81), 'label');
    recordRoomResize(canvas, record(canvas, 81), 'canvas');
    expect(snapshot(canvas)!.counters).toMatchObject({
      'resize-label': 3,
      'resize-canvas': 1,
      'resize-first': 2,
      'resize-identical': 1,
      'resize-changed': 1,
    });
    expect(JSON.stringify(snapshot(canvas))).not.toContain('width');
    release();
  });
});
