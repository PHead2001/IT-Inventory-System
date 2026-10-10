import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, render } from '@testing-library/react';
import { OrthographicCamera, Vector3 } from 'three';
import rawRoom from '../../../../data/rooms/it-closet.json';
import { roomSchema } from '../schema';
import { buildRoomBindings } from '../bindings';
import {
  createSpatialRevealController,
  type FocusRequest,
} from './spatial-reveal';
import { CameraRig } from './room-scene';
import {
  LabelLayoutProvider,
  createRoomLabelRegistry,
} from './label-layout-runtime';

const mocks = vi.hoisted(() => ({
  state: null as unknown,
  control: null as unknown,
  frame: null as (() => void) | null,
}));
vi.mock('@react-three/fiber', () => ({
  useThree: () => mocks.state,
  useFrame: (callback: () => void) => {
    mocks.frame = callback;
  },
}));
vi.mock('./safe-canvas', () => ({ SafeCanvas: () => null }));
vi.mock('@react-three/drei', async () => {
  const { forwardRef, useImperativeHandle } = await import('react');
  return {
    OrbitControls: forwardRef(function MockControls(_props, ref) {
      useImperativeHandle(ref, () => mocks.control);
      return null;
    }),
  };
});
const room = roomSchema.parse(rawRoom);
let camera: OrthographicCamera;
let size: { width: number; height: number };
let control: {
  target: Vector3;
  update: ReturnType<typeof vi.fn>;
  minZoom: number;
  maxZoom: number;
};
beforeEach(() => {
  window.localStorage.clear();
  camera = new OrthographicCamera(-1, 1, 1, -1, 0.1, 3000);
  camera.position.set(200, 250, 350);
  camera.zoom = 3;
  size = { width: 0, height: 0 };
  control = {
    target: new Vector3(),
    update: vi.fn(),
    minZoom: 0.1,
    maxZoom: 100,
  };
  mocks.state = {
    camera,
    size,
    gl: {
      domElement: document.createElement('canvas'),
      info: { render: { calls: 1 } },
    },
    invalidate: vi.fn(),
  };
  mocks.control = control;
});
afterEach(() => vi.restoreAllMocks());
function harness() {
  const registry = createRoomLabelRegistry(vi.fn());
  const props = {
    room,
    bindings: [],
    focusRequest: {
      code: null,
      requestId: 0,
      scope: 'camera-test',
      generation: 0,
    },
    onFocusComplete: vi.fn(),
    onReady: vi.fn(),
    onFailure: vi.fn(),
    orbitMode: 'free' as const,
    manualGesture: { current: { active: false, lastMotionAt: 0 } },
    active: false,
    selectionGesture: { current: { suppressSelection: false } },
    onDraggingChange: vi.fn(),
    onPassiveDrag: vi.fn(),
  };
  const initialView = {
    position: [210, 260, 360] as [number, number, number],
    target: [20, 30, -40] as [number, number, number],
    zoom: 2,
    mode: 'free' as const,
  };
  return function CameraRigHarness(
    id: number,
    kind: 'fit' | 'zoom-in' = 'fit',
    restored = false,
  ) {
    return (
      <LabelLayoutProvider registry={registry}>
        <CameraRig
          {...props}
          command={{ id, kind }}
          initialView={restored ? initialView : undefined}
        />
      </LabelLayoutProvider>
    );
  };
}
it('defers the newest Fit command until measurement without consuming it or poisoning camera state', () => {
  const ui = harness(),
    view = render(ui(1));
  expect(camera.zoom).toBe(3);
  expect(control.update).not.toHaveBeenCalled();
  view.rerender(ui(2));
  expect(camera.zoom).toBe(3);
  size.width = 375;
  size.height = 400;
  view.rerender(ui(2));
  expect(camera.zoom).toBeGreaterThan(0);
  expect(Number.isFinite(camera.zoom)).toBe(true);
  const fitted = camera.zoom,
    count = control.update.mock.calls.length;
  view.rerender(ui(2));
  expect(camera.zoom).toBe(fitted);
  expect(control.update).toHaveBeenCalledTimes(count);
  // A consumed command cannot repeat or refit over later manual intent.
  camera.zoom = fitted * 1.4;
  size.width = 400;
  view.rerender(ui(2));
  expect(camera.zoom).toBeCloseTo(fitted * 1.4);
});
it.each([NaN, Infinity, -1])(
  'waits through invalid width %s and executes the newest command once over restored state',
  (width) => {
    size.width = width;
    size.height = 400;
    const ui = harness(),
      view = render(ui(1, 'fit', true));
    expect(camera.zoom).toBe(3);
    size.width = 375;
    view.rerender(ui(2, 'zoom-in', true));
    expect(camera.zoom).toBeCloseTo(2 * 1.2);
    const count = control.update.mock.calls.length;
    view.rerender(ui(2, 'zoom-in', true));
    expect(camera.zoom).toBeCloseTo(2 * 1.2);
    expect(control.update).toHaveBeenCalledTimes(count);
  },
);

function spatialHarness() {
  size.width = 800;
  size.height = 500;
  const registry = createRoomLabelRegistry(vi.fn());
  const reveal = createSpatialRevealController();
  const complete = vi.fn();
  const cancel = vi.fn();
  const props = {
    room,
    bindings: buildRoomBindings(room),
    onFocusComplete: complete,
    onFocusCancel: cancel,
    onReady: vi.fn(),
    onFailure: vi.fn(),
    orbitMode: 'free' as const,
    manualGesture: { current: { active: false, lastMotionAt: 0 } },
    active: false,
    selectionGesture: { current: { suppressSelection: false } },
    onDraggingChange: vi.fn(),
    onPassiveDrag: vi.fn(),
    revealController: reveal,
  };
  const ui = (request: FocusRequest, commandId = 0) => (
    <LabelLayoutProvider registry={registry}>
      <CameraRig
        {...props}
        focusRequest={request}
        command={{ id: commandId, kind: 'recenter' }}
      />
    </LabelLayoutProvider>
  );
  return { reveal, complete, cancel, ui };
}
const spatialRequest = (
  code: string | null,
  generation: number,
): FocusRequest =>
  Object.freeze({
    code,
    scope: 'actor|environment|closet',
    generation,
    requestId: 0,
  });
it.each([null, 'MISSING'])(
  'an in-flight camera cannot snap or complete after replacement with %s',
  (code) => {
    let now = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    const { ui, reveal, complete } = spatialHarness();
    const view = render(ui(spatialRequest('ITC-D01', 1)));
    act(() => mocks.frame!());
    act(() => mocks.frame!());
    now = 200;
    act(() => mocks.frame!());
    view.rerender(ui(spatialRequest(code, 2)));
    const heldPosition = camera.position.clone(),
      heldTarget = control.target.clone(),
      heldZoom = camera.zoom;
    now = 2000;
    act(() => mocks.frame!());
    expect(camera.position.toArray()).toEqual(heldPosition.toArray());
    expect(control.target.toArray()).toEqual(heldTarget.toArray());
    expect(camera.zoom).toBe(heldZoom);
    expect(complete.mock.calls.some(([value]) => value === 'ITC-D01')).toBe(
      false,
    );
    expect(reveal.getSnapshot().openCode).toBeNull();
  },
);
it('a command during flight cancels queued opening past the old deadline', () => {
  let now = 0;
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  const { ui, reveal, complete, cancel } = spatialHarness(),
    request = spatialRequest('ITC-D07', 1);
  const view = render(ui(request));
  act(() => mocks.frame!());
  act(() => mocks.frame!());
  now = 100;
  act(() => mocks.frame!());
  view.rerender(ui(request, 1));
  const held = camera.position.toArray();
  now = 2000;
  act(() => mocks.frame!());
  expect(camera.position.toArray()).toEqual(held);
  expect(complete).not.toHaveBeenCalled();
  expect(cancel).toHaveBeenCalledWith(
    expect.objectContaining({ code: 'ITC-D07', generation: 1 }),
  );
  expect(reveal.getSnapshot()).toMatchObject({
    phase: 'cancelled',
    openCode: null,
  });
});
it('camera completion carries the immutable current generation and only then reveals', () => {
  let now = 0;
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  const { ui, reveal, complete } = spatialHarness(),
    request = spatialRequest('ITC-CLEAR', 4);
  render(ui(request));
  act(() => mocks.frame!());
  act(() => mocks.frame!());
  expect(reveal.getSnapshot()).toMatchObject({
    phase: 'flying',
    openCode: null,
  });
  now = 751;
  act(() => mocks.frame!());
  expect(complete).toHaveBeenCalledWith(
    'ITC-CLEAR',
    expect.objectContaining({ generation: 4, scope: request.scope }),
  );
  expect(reveal.getSnapshot()).toMatchObject({
    phase: 'revealing',
    openCode: 'ITC-CLEAR',
  });
  now = 1152;
  act(() => mocks.frame!());
  expect(reveal.getSnapshot().phase).toBe('settled');
});
it.each([false, true])(
  'mid-flight Reduced motion completes only a valid token (cancelled=%s)',
  (cancelled) => {
    let now = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    const { ui, reveal, complete } = spatialHarness(),
      request = spatialRequest('ITC-D07', 1);
    const view = render(ui(request));
    act(() => mocks.frame!());
    act(() => mocks.frame!());
    now = 200;
    act(() => mocks.frame!());
    if (cancelled) view.rerender(ui(request, 1));
    const held = control.target.toArray();
    act(() => {
      window.localStorage.setItem('it-inventory-reduce-motion', 'true');
      window.dispatchEvent(new Event('it-inventory-motion-change'));
    });
    if (cancelled) {
      expect(control.target.toArray()).toEqual(held);
      expect(reveal.getSnapshot()).toMatchObject({
        phase: 'cancelled',
        openCode: null,
      });
      expect(complete).not.toHaveBeenCalled();
    } else {
      expect(control.target.toArray()).toEqual([76, 39.5, -98]);
      expect(reveal.getSnapshot()).toMatchObject({
        phase: 'settled',
        openCode: 'ITC-D07',
      });
      expect(complete).toHaveBeenCalledWith(
        'ITC-D07',
        expect.objectContaining({ generation: 1 }),
      );
    }
  },
);
