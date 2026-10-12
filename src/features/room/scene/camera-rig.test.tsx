import { beforeEach, expect, it, vi } from 'vitest';
import { act, render } from '@testing-library/react';
import { MathUtils, OrthographicCamera, Vector3 } from 'three';
import rawRoom from '../../../../data/rooms/it-closet.json';
import { roomSchema } from '../schema';
import { CameraRig } from './room-scene';
import { PrivacyReadinessContext } from '@/components/auth/privacy-readiness';
import {
  assignmentEpoch,
  readPrivacyRevocationRevision,
  revokePrivatePresentation,
} from '@/features/scan/assign-batch';
import {
  RoomCameraSnapshotProvider,
  useRoomCameraSnapshot,
} from './camera-snapshot-provider';
import { buildRoomBindings } from '../bindings';
import type { CameraView } from './camera-view';
import {
  LabelLayoutProvider,
  createRoomLabelRegistry,
} from './label-layout-runtime';

const mocks = vi.hoisted(() => ({
  reduced: false,
  state: null as unknown,
  control: null as unknown,
  orbit: null as {
    enabled: boolean;
    onStart: () => void;
    onChange: () => void;
    onEnd: () => void;
  } | null,
}));
vi.mock('@/components/experience/motion-preference', () => ({
  useEffectiveReducedMotion: () => mocks.reduced,
}));
vi.mock('@react-three/fiber', () => ({
  useThree: () => mocks.state,
  useFrame: vi.fn(),
}));
vi.mock('./safe-canvas', () => ({ SafeCanvas: () => null }));
vi.mock('@react-three/drei', async () => {
  const { forwardRef, useImperativeHandle } = await import('react');
  return {
    OrbitControls: forwardRef(function MockControls(props, ref) {
      mocks.orbit = props as NonNullable<typeof mocks.orbit>;
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
  mocks.reduced = false;
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
    gl: { domElement: document.createElement('canvas') },
    invalidate: vi.fn(),
  };
  mocks.control = control;
  mocks.orbit = null;
});

const savedPose: CameraView = {
  position: [210, 260, 360],
  target: [20, 30, -40],
  zoom: 2,
  mode: 'free',
};
function restorationHarness() {
  const registry = createRoomLabelRegistry(vi.fn());
  const complete = vi.fn();
  const bindings = buildRoomBindings(room);
  let snapshot: ReturnType<typeof useRoomCameraSnapshot>;
  function Scene({
    mounted,
    selected,
  }: {
    mounted: boolean;
    selected: boolean;
  }) {
    snapshot = useRoomCameraSnapshot(
      'closet',
      'actor',
      'https://backend.example',
    );
    return mounted ? (
      <LabelLayoutProvider registry={registry}>
        <CameraRig
          room={room}
          bindings={bindings}
          initialView={snapshot.view}
          initialViewReady={snapshot.ready}
          onViewChange={snapshot.write}
          focusRequest={{
            code: selected ? 'ITC-S1A' : null,
            requestId: selected ? 1 : 0,
          }}
          focusOnRestore={selected}
          onFocusComplete={complete}
          onReady={vi.fn()}
          onFailure={vi.fn()}
          command={{ id: 0, kind: 'fit' }}
          orbitMode="free"
          manualGesture={{ current: { active: false, lastMotionAt: 0 } }}
          active={false}
          selectionGesture={{ current: { suppressSelection: false } }}
          onDraggingChange={vi.fn()}
          onPassiveDrag={vi.fn()}
        />
      </LabelLayoutProvider>
    ) : null;
  }
  return {
    complete,
    snapshot: () => snapshot,
    ui: (
      ready: boolean,
      mounted: boolean,
      selected = false,
      generation = 'generation',
    ) => (
      <PrivacyReadinessContext
        value={{
          ready,
          visible: true,
          generation,
          revocationRevision: readPrivacyRevocationRevision(),
          verifiedEpoch: ready ? assignmentEpoch() : undefined,
        }}
      >
        <RoomCameraSnapshotProvider
          actorId="actor"
          backend="https://backend.example"
        >
          <Scene mounted={mounted} selected={selected} />
        </RoomCameraSnapshotProvider>
      </PrivacyReadinessContext>
    ),
  };
}
it.each([false, true])(
  'waits for the provider restore grant before initializing a saved camera (selected=%s)',
  (selected) => {
    mocks.reduced = true;
    size.width = 375;
    size.height = 400;
    const rig = restorationHarness();
    const view = render(rig.ui(true, false));
    act(() => {
      expect(rig.snapshot().write(savedPose)).toBe(true);
    });
    view.rerender(rig.ui(false, true, selected));
    expect(camera.position.toArray()).toEqual([200, 250, 350]);
    expect(control.update).not.toHaveBeenCalled();
    expect(rig.complete).not.toHaveBeenCalled();
    view.rerender(rig.ui(true, true, selected));
    if (selected) {
      const target = [8, 80.5, -18];
      expect(control.target.toArray()).toEqual(target);
      expect(camera.position.clone().sub(control.target).toArray()).toEqual([
        190, 230, 400,
      ]);
      expect(rig.complete).toHaveBeenLastCalledWith('ITC-S1A');
      expect(rig.snapshot().view!.target).toEqual(target);
    } else {
      expect(camera.position.toArray()).toEqual(savedPose.position);
      expect(control.target.toArray()).toEqual(savedPose.target);
      expect(camera.zoom).toBe(savedPose.zoom);
      expect(rig.snapshot().view).toEqual(savedPose);
    }
    const initialized = camera.position.toArray();
    view.rerender(rig.ui(false, true, selected));
    expect(camera.position.toArray()).toEqual(initialized);
    view.rerender(rig.ui(true, true, selected));
    expect(camera.position.toArray()).toEqual(initialized);
  },
);
it.each(['empty', 'revoked', 'session'] as const)(
  'initializes an authorized canonical frame with %s saved state',
  (state) => {
    mocks.reduced = true;
    size.width = 375;
    size.height = 400;
    const rig = restorationHarness();
    const view = render(rig.ui(true, false));
    if (state !== 'empty')
      act(() => {
        rig.snapshot().write(savedPose);
      });
    const oldWrite = rig.snapshot().write;
    view.rerender(rig.ui(false, true));
    expect(control.update).not.toHaveBeenCalled();
    if (state === 'revoked') act(() => revokePrivatePresentation());
    view.rerender(
      rig.ui(
        true,
        true,
        false,
        state === 'session' ? 'next-session' : 'generation',
      ),
    );
    expectCanonicalFirstFrame();
    expect(camera.position.toArray()).not.toEqual(savedPose.position);
    expect(rig.snapshot().view!.position).toEqual(camera.position.toArray());
    act(() => {
      expect(oldWrite(savedPose)).toBe(false);
    });
  },
);
function harness() {
  const registry = createRoomLabelRegistry(vi.fn());
  const props = {
    room,
    bindings: [],
    focusRequest: { code: null, requestId: 0 },
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
    orbitMode: 'free' | 'guided' = 'free',
    active = false,
  ) {
    return (
      <LabelLayoutProvider registry={registry}>
        <CameraRig
          {...props}
          orbitMode={orbitMode}
          active={active}
          command={{ id, kind }}
          initialView={restored ? initialView : undefined}
        />
      </LabelLayoutProvider>
    );
  };
}
function expectCanonicalFirstFrame() {
  const offset = camera.position.clone().sub(control.target);
  expect(Math.atan2(offset.x, offset.z)).toBeCloseTo(
    MathUtils.degToRad(room.camera.azimuthDegrees),
  );
  expect(Math.asin(offset.y / offset.length())).toBeCloseTo(
    MathUtils.degToRad(room.camera.elevationDegrees),
  );
  expect(camera.zoom).toBeGreaterThan(0);
  expect(camera.zoom).not.toBe(3);
  expect(Number.isFinite(camera.zoom)).toBe(true);
}
it.each([0, NaN, Infinity])(
  'retains the latest orbit mode through width %s and fits the canonical first frame before applying it',
  (width) => {
    size.width = width;
    const ui = harness(),
      view = render(ui(0, 'fit', false, 'free'));
    const original = camera.position.clone();
    view.rerender(ui(0, 'fit', false, 'guided'));
    expect(camera.position).toEqual(original);
    expect(camera.zoom).toBe(3);
    expect(control.update).not.toHaveBeenCalled();
    expect(
      (mocks.state as { gl: { domElement: HTMLCanvasElement } }).gl.domElement
        .dataset.cameraView,
    ).toBeUndefined();
    size.width = 375;
    size.height = 400;
    view.rerender(ui(0, 'fit', false, 'guided'));
    expectCanonicalFirstFrame();
    const stored = JSON.parse(
      (mocks.state as { gl: { domElement: HTMLCanvasElement } }).gl.domElement
        .dataset.cameraView!,
    );
    expect(stored.mode).toBe('guided');
    const fitted = camera.zoom;
    camera.zoom *= 1.4;
    size.width = 400;
    view.rerender(ui(0, 'fit', false, 'guided'));
    expect(camera.zoom).toBeCloseTo(fitted * 1.4);
  },
);
it('ignores a gesture before measurement and preserves the first fit before later manual interaction', () => {
  const ui = harness(),
    view = render(ui(0, 'fit', false, 'free', true));
  expect(mocks.orbit!.enabled).toBe(false);
  act(() => {
    mocks.orbit!.onStart();
    mocks.orbit!.onChange();
    mocks.orbit!.onEnd();
  });
  expect(control.update).not.toHaveBeenCalled();
  expect(camera.zoom).toBe(3);
  size.width = 375;
  size.height = 400;
  view.rerender(ui(0, 'fit', false, 'free', true));
  expect(mocks.orbit!.enabled).toBe(true);
  expectCanonicalFirstFrame();
  const fitted = camera.zoom;
  act(() => {
    mocks.orbit!.onStart();
    camera.zoom *= 1.4;
    mocks.orbit!.onChange();
    mocks.orbit!.onEnd();
  });
  size.width = 400;
  view.rerender(ui(0, 'fit', false, 'free', true));
  expect(camera.zoom).toBeCloseTo(fitted * 1.4);
});
it('applies the newest pending zoom after the canonical first fit despite a pending mode change', () => {
  const ui = harness(),
    view = render(ui(1, 'fit', false, 'free'));
  view.rerender(ui(2, 'zoom-in', false, 'guided'));
  expect(camera.zoom).toBe(3);
  expect(control.update).not.toHaveBeenCalled();
  size.width = 375;
  size.height = 400;
  view.rerender(ui(2, 'zoom-in', false, 'guided'));
  expectCanonicalFirstFrame();
  const fitted = control.minZoom / room.camera.zoomLimits[0];
  expect(camera.zoom).toBeCloseTo(fitted * 1.2);
  const count = control.update.mock.calls.length;
  view.rerender(ui(2, 'zoom-in', false, 'guided'));
  expect(camera.zoom).toBeCloseTo(fitted * 1.2);
  expect(control.update).toHaveBeenCalledTimes(count);
});
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
