import { afterEach, expect, it, vi } from 'vitest';
import { act, render } from '@testing-library/react';
import { OrthographicCamera } from 'three';
import {
  createRoomLabelRegistry,
  LabelLayoutDriver,
} from './label-layout-runtime';
import { recordRoomDemand } from './room-demand-diagnostics';

const fiber = vi.hoisted(() => ({
  state: {} as Record<string, unknown>,
  frame: () => {},
}));
vi.mock('@react-three/fiber', () => ({
  useThree: () => fiber.state,
  useFrame: (callback: () => void) => {
    fiber.frame = callback;
  },
}));

afterEach(() => {
  Reflect.deleteProperty(window, '__roomLayoutDiagnosticsEnabled');
  Reflect.deleteProperty(window, '__readRoomDemandSnapshot');
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it('binds the exact existing root invalidate and attributes connected driver frames without wrapping demand', () => {
  window.__roomLayoutDiagnosticsEnabled = true;
  vi.stubGlobal(
    'requestAnimationFrame',
    vi.fn(() => 1),
  );
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  const canvas = document.createElement('canvas'),
    invalidate = vi.fn();
  const camera = new OrthographicCamera();
  fiber.state = {
    gl: { domElement: canvas },
    invalidate,
    get: () => ({ camera }),
  };
  const registry = createRoomLabelRegistry(vi.fn());
  const connect = vi.spyOn(registry, 'connect'),
    schedule = vi.spyOn(registry, 'schedule');
  recordRoomDemand(invalidate, 'camera-update'); // mount work predating connect is explicitly uncovered
  const screen = render(<LabelLayoutDriver registry={registry} />);
  expect(connect.mock.calls[0][0]).toBe(canvas);
  expect(connect.mock.calls[0][1]).toBe(invalidate);
  expect(window.__readRoomDemandSnapshot?.(canvas)).toMatchObject({
    preconnectObserved: false,
    counters: { 'camera-update': 0 },
  });
  // The exact function shared by sibling useThree consumers maps to this root.
  recordRoomDemand(fiber.state.invalidate as () => void, 'camera-flight');
  recordRoomDemand(() => invalidate(), 'camera-flight');
  act(() => fiber.frame());
  expect(window.__readRoomDemandSnapshot?.(canvas)?.counters).toMatchObject({
    'camera-flight': 1,
    'driver-schedule': 1,
  });
  expect(schedule).toHaveBeenCalledOnce();
  expect(invalidate).not.toHaveBeenCalled();
  screen.unmount();
  expect(window.__readRoomDemandSnapshot?.(canvas)).toBeNull();
});
