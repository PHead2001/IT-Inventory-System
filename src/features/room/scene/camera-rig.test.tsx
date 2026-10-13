import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, render } from '@testing-library/react';
import { Activity, StrictMode } from 'react';
import { MathUtils, OrthographicCamera, Vector3 } from 'three';
import rawRoom from '../../../../data/rooms/it-closet.json';
import { roomSchema } from '../schema';
import { buildRoomBindings } from '../bindings';
import {
  createSpatialRevealController,
  type FocusRequest,
} from './spatial-reveal';
import { CameraRig } from './room-scene';
import { SceneSessionContext } from './scene-budget-provider';
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
import type { CameraView } from './camera-view';
import {
  LabelLayoutProvider,
  createRoomLabelRegistry,
} from './label-layout-runtime';

const mocks = vi.hoisted(() => ({
  reduced: undefined as boolean | undefined,
  state: null as unknown,
  frame: null as (() => void) | null,
  control: null as unknown,
  attach: null as ((control: unknown) => (() => void) | undefined) | null,
  orbit: null as {
    enabled: boolean;
    onStart: () => void;
    onChange: () => void;
    onEnd: () => void;
  } | null,
}));
vi.mock('@/components/experience/motion-preference', async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import('@/components/experience/motion-preference')
    >();
  return {
    ...actual,
    useEffectiveReducedMotion: () => {
      const reduced = actual.useEffectiveReducedMotion();
      return mocks.reduced ?? reduced;
    },
  };
});
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
    OrbitControls: forwardRef(function MockControls(props, ref) {
      mocks.orbit = props as NonNullable<typeof mocks.orbit>;
      mocks.attach = ref as typeof mocks.attach;
      const control = mocks.control;
      useImperativeHandle(ref, () => control, [control]);
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
  vi.restoreAllMocks();
  window.localStorage.clear();
  mocks.reduced = undefined;
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
  mocks.orbit = null;
  mocks.frame = null;
  mocks.attach = null;
});
afterEach(() => vi.restoreAllMocks());

const savedPose: CameraView = {
  position: [210, 260, 360],
  target: [20, 30, -40],
  zoom: 2,
  mode: 'free',
};
function restorationHarness() {
  const registry = createRoomLabelRegistry(vi.fn());
  const complete = vi.fn();
  const onReady = vi.fn();
  const bindings = buildRoomBindings(room);
  let snapshot: ReturnType<typeof useRoomCameraSnapshot>;
  function Scene({
    mounted,
    selected,
    pan = false,
  }: {
    mounted: boolean;
    selected: boolean;
    pan?: boolean;
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
          onReady={onReady}
          onFailure={vi.fn()}
          command={pan ? { id: 1, kind: 'right' } : { id: 0, kind: 'fit' }}
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
    onReady,
    snapshot: () => snapshot,
    ui: (
      ready: boolean,
      mounted: boolean,
      selected = false,
      generation = 'generation',
      routeMounted = true,
      pan = false,
      activity: 'visible' | 'hidden' = 'visible',
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
          <Activity mode={activity}>
            {routeMounted && (
              <Scene mounted={mounted} selected={selected} pan={pan} />
            )}
          </Activity>
        </RoomCameraSnapshotProvider>
      </PrivacyReadinessContext>
    ),
  };
}
it.each([false, true])(
  'restores a pan through StrictMode and rejects stale controls-ref cleanup (reduced=%s)',
  (reduced) => {
    mocks.reduced = reduced;
    size.width = 390;
    size.height = 400;
    const rig = restorationHarness();
    const view = render(<StrictMode>{rig.ui(true, true)}</StrictMode>);
    view.rerender(
      <StrictMode>
        {rig.ui(true, true, false, 'generation', true, true)}
      </StrictMode>,
    );
    const panned = rig.snapshot().view!;
    let oldDetach!: () => void;
    act(() => {
      oldDetach = mocks.attach!(control)!;
    });
    control = { ...control, target: new Vector3() };
    mocks.control = control;
    view.rerender(
      <StrictMode>
        {rig.ui(true, true, false, 'generation', true, true)}
      </StrictMode>,
    );
    act(() => oldDetach());
    expect(camera.position.toArray()).toEqual(panned.position);
    expect(control.target.toArray()).toEqual(panned.target);
    camera.zoom += 0.2;
    act(() => mocks.orbit!.onEnd());
    expect(rig.snapshot().view!.zoom).toBe(camera.zoom);
  },
);
it.each([false, true])(
  'preserves a commanded pan when Activity retires and restores the camera effects (reduced=%s)',
  (reduced) => {
    mocks.reduced = reduced;
    size.width = 390;
    size.height = 400;
    const rig = restorationHarness();
    const view = render(rig.ui(true, true));
    view.rerender(rig.ui(true, true, false, 'generation', true, true));
    const panned = rig.snapshot().view!;
    view.rerender(
      rig.ui(true, true, false, 'generation', true, true, 'hidden'),
    );
    view.rerender(rig.ui(true, true));
    expect(camera.position.toArray()).toEqual(panned.position);
    expect(control.target.toArray()).toEqual(panned.target);
    expect(rig.snapshot().view).toEqual(panned);
  },
);
it.each([
  [false, 'camera'],
  [true, 'camera'],
  [false, 'controls'],
  [true, 'controls'],
] as const)(
  'restores the saved pan when a retained rig receives replacement %s/%s resources without replaying Pan right',
  (reduced, replacement) => {
    mocks.reduced = reduced;
    size.width = 390;
    size.height = 400;
    const rig = restorationHarness();
    const view = render(rig.ui(true, true));
    view.rerender(rig.ui(true, true, false, 'generation', true, true));
    const panned = rig.snapshot().view!;
    // The old resource may already be changed during disposal. Its cleanup
    // must not publish through the current writer or the replacement controls.
    const outgoingOrbit = mocks.orbit!;
    camera.position.set(901, 902, 903);
    if (replacement === 'camera') {
      camera = new OrthographicCamera(-1, 1, 1, -1, 0.1, 3000);
      camera.position.set(200, 300, 300);
    } else {
      control = { ...control, target: new Vector3() };
      mocks.control = control;
    }
    mocks.state = { ...(mocks.state as object), camera };
    // Retained RoomScene command state still holds the consumed pan ID.
    view.rerender(rig.ui(true, true, false, 'generation', true, true));
    expect(camera.position.toArray()).toEqual(panned.position);
    expect(control.target.toArray()).toEqual(panned.target);
    expect(rig.snapshot().view).toEqual(panned);
    camera.zoom += 0.2;
    act(() => outgoingOrbit.onEnd());
    expect(rig.snapshot().view).toEqual(panned);
    act(() => mocks.orbit!.onEnd());
    expect(rig.snapshot().view!.zoom).toBe(camera.zoom);
  },
);
it.each([false, true])(
  'withholds replacement resource initialization until its saved-view grant is ready (reduced=%s)',
  (reduced) => {
    mocks.reduced = reduced;
    size.width = 390;
    size.height = 400;
    const rig = restorationHarness();
    const view = render(rig.ui(true, true));
    view.rerender(rig.ui(true, true, false, 'generation', true, true));
    const panned = rig.snapshot().view!;
    const retiredWrite = rig.snapshot().write;
    camera = new OrthographicCamera(-1, 1, 1, -1, 0.1, 3000);
    camera.position.set(200, 300, 300);
    mocks.state = { ...(mocks.state as object), camera };
    view.rerender(rig.ui(false, true));
    expect(camera.position.toArray()).toEqual([200, 300, 300]);
    act(() => expect(retiredWrite(savedPose)).toBe(false));
    view.rerender(rig.ui(true, true));
    expect(camera.position.toArray()).toEqual(panned.position);
    expect(control.target.toArray()).toEqual(panned.target);
    expect(rig.snapshot().view).toEqual(panned);
    act(() => expect(retiredWrite(savedPose)).toBe(false));
  },
);
it.each([false, true])(
  'applies explicit selection focus over the restored replacement-camera baseline (reduced=%s)',
  (reduced) => {
    mocks.reduced = reduced;
    size.width = 390;
    size.height = 400;
    const rig = restorationHarness();
    const view = render(rig.ui(true, true));
    view.rerender(rig.ui(true, true, false, 'generation', true, true));
    const panned = rig.snapshot().view!;
    camera = new OrthographicCamera(-1, 1, 1, -1, 0.1, 3000);
    camera.position.set(200, 300, 300);
    mocks.state = { ...(mocks.state as object), camera };
    view.rerender(rig.ui(true, true, true));
    act(() => mocks.frame!());
    act(() => mocks.frame!());
    if (!reduced) {
      vi.spyOn(performance, 'now').mockReturnValue(performance.now() + 1000);
      act(() => mocks.frame!());
    }
    expect(control.target.toArray()).toEqual([8, 80.5, -18]);
    const expectedOffset = new Vector3(...panned.position).sub(
      new Vector3(...panned.target),
    );
    expect(
      camera.position.clone().sub(control.target).distanceTo(expectedOffset),
    ).toBeLessThan(1e-8);
    expect(rig.complete).toHaveBeenLastCalledWith(
      'ITC-S1A',
      expect.objectContaining({ code: 'ITC-S1A' }),
    );
    expect(rig.snapshot().view!.target).toEqual([8, 80.5, -18]);
  },
);
it.each([false, true])(
  'preserves a commanded pan through an ordinary route unmount and return (reduced=%s)',
  (reduced) => {
    mocks.reduced = reduced;
    size.width = 390;
    size.height = 400;
    const rig = restorationHarness();
    const view = render(rig.ui(true, true));
    view.rerender(rig.ui(true, true, false, 'generation', true, true));
    const panned = rig.snapshot().view;
    expect(panned).not.toBeNull();
    expect(panned!.position).toEqual(camera.position.toArray());
    const departedWrite = rig.snapshot().write;
    view.rerender(rig.ui(true, false, false, 'generation', false));
    camera.position.set(200, 250, 350);
    control.target.set(0, 0, 0);
    view.rerender(rig.ui(true, true));
    expect(camera.position.toArray()).toEqual(panned!.position);
    expect(control.target.toArray()).toEqual(panned!.target);
    expect(rig.snapshot().view).toEqual(panned);
    act(() => expect(departedWrite(savedPose)).toBe(false));
  },
);
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
    act(() => {
      mocks.frame!();
      mocks.frame!();
    });
    expect(rig.onReady).not.toHaveBeenCalled();
    expect(rig.complete).not.toHaveBeenCalled();
    view.rerender(rig.ui(true, true, selected));
    expect(camera.position.toArray()).toEqual(savedPose.position);
    expect(control.target.toArray()).toEqual(savedPose.target);
    expect(rig.onReady).not.toHaveBeenCalled();
    expect(rig.complete).not.toHaveBeenCalled();
    act(() => mocks.frame!());
    expect(rig.onReady).not.toHaveBeenCalled();
    act(() => mocks.frame!());
    expect(rig.onReady).toHaveBeenCalledOnce();
    if (selected) {
      const target = [8, 80.5, -18];
      expect(control.target.toArray()).toEqual(target);
      expect(camera.position.clone().sub(control.target).toArray()).toEqual([
        190, 230, 400,
      ]);
      expect(rig.complete).toHaveBeenLastCalledWith(
        'ITC-S1A',
        expect.objectContaining({ code: 'ITC-S1A', requestId: 1 }),
      );
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
it('keeps a snapshot-withheld rig unready and does not revive its retired renderer session', () => {
  size.width = 375;
  size.height = 400;
  const rig = restorationHarness();
  let current = true;
  const session = { current: () => current };
  const wrap = (ready: boolean, mounted: boolean, owner = session) => (
    <SceneSessionContext value={owner}>
      {rig.ui(ready, mounted, true)}
    </SceneSessionContext>
  );
  const view = render(wrap(true, false));
  act(() => {
    expect(rig.snapshot().write(savedPose)).toBe(true);
  });
  view.rerender(wrap(false, true));
  const capturedFrame = mocks.frame!;
  const capturedEnd = mocks.orbit!.onEnd;
  act(() => {
    capturedFrame();
    capturedFrame();
    capturedEnd();
  });
  expect(rig.onReady).not.toHaveBeenCalled();
  expect(control.update).not.toHaveBeenCalled();
  current = false;
  view.rerender(wrap(true, true, { current: () => true }));
  expect(camera.position.toArray()).toEqual([200, 250, 350]);
  expect(control.update).not.toHaveBeenCalled();
  act(() => {
    mocks.frame!();
    mocks.frame!();
    capturedEnd();
  });
  expect(rig.onReady).not.toHaveBeenCalled();
  expect(rig.complete).not.toHaveBeenCalled();
  expect(rig.snapshot().view).toEqual(savedPose);
});
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
function harness(onViewChange = vi.fn()) {
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
    onViewChange,
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
it('allows captured camera publication after a same-session pause but blocks the retired session after replacement A/B/A', () => {
  size.width = 375;
  size.height = 400;
  const publish = vi.fn();
  const ui = harness(publish);
  let ready = true;
  let retired = false;
  const original = { current: () => ready && !retired };
  const replacement = { current: () => true };
  const wrap = (session = original) => (
    <SceneSessionContext value={session}>{ui(0)}</SceneSessionContext>
  );
  const view = render(wrap());
  const capturedEnd = mocks.orbit!.onEnd;
  publish.mockClear();
  ready = false;
  act(() => capturedEnd());
  expect(publish).not.toHaveBeenCalled();
  ready = true;
  act(() => capturedEnd());
  expect(publish).toHaveBeenCalledOnce();
  retired = true;
  view.rerender(wrap(replacement));
  view.rerender(wrap({ current: () => true }));
  publish.mockClear();
  act(() => capturedEnd());
  expect(publish).not.toHaveBeenCalled();
  view.unmount();
});
it('keeps a consumed Pan command from replaying over Reduced selection after a retained visible recheck', () => {
  mocks.reduced = true;
  size.width = 390;
  size.height = 400;
  const rig = restorationHarness();
  const session = { current: () => true };
  const ui = (ready: boolean, selected: boolean, pan: boolean) => (
    <SceneSessionContext value={session}>
      {rig.ui(ready, true, selected, 'generation', true, pan)}
    </SceneSessionContext>
  );
  const view = render(ui(true, false, false));
  act(() => {
    mocks.frame!();
    mocks.frame!();
  });
  const originalTarget = control.target.toArray();
  view.rerender(ui(true, false, true));
  expect(control.target.toArray()).not.toEqual(originalTarget);
  view.rerender(ui(false, true, true));
  expect(control.target.toArray()).toEqual([8, 80.5, -18]);
  view.rerender(ui(true, true, true));
  expect(control.target.toArray()).toEqual([8, 80.5, -18]);
  expect(rig.complete).toHaveBeenLastCalledWith(
    'ITC-S1A',
    expect.objectContaining({ code: 'ITC-S1A', requestId: 1 }),
  );
  const selectedPosition = camera.position.toArray();
  view.rerender(ui(false, true, true));
  view.rerender(ui(true, true, true));
  expect(control.target.toArray()).toEqual([8, 80.5, -18]);
  expect(camera.position.toArray()).toEqual(selectedPosition);
});
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
it.each(['camera', 'controls'] as const)(
  'controls attachment and replacement %s preserve the reveal lifetime and reject an outgoing frame',
  (replacement) => {
    mocks.reduced = false;
    let now = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    const { ui, reveal, complete } = spatialHarness();
    const dispose = vi.spyOn(reveal, 'dispose');
    const view = render(ui(spatialRequest('ITC-D01', 1)));
    expect(dispose).not.toHaveBeenCalled();
    act(() => mocks.frame!());
    act(() => mocks.frame!());
    now = 200;
    act(() => mocks.frame!());
    const oldFrame = mocks.frame!;
    expect(reveal.getSnapshot().phase).toBe('flying');
    if (replacement === 'camera') {
      camera = new OrthographicCamera(-1, 1, 1, -1, 0.1, 3000);
      camera.position.set(200, 300, 300);
      mocks.state = { ...(mocks.state as object), camera };
    } else {
      control = { ...control, target: new Vector3() };
      mocks.control = control;
    }
    view.rerender(ui(spatialRequest('ITC-D07', 2)));
    expect(dispose).not.toHaveBeenCalled();
    expect(complete).not.toHaveBeenCalled();
    act(() => mocks.frame!());
    expect(complete).not.toHaveBeenCalled();
    act(() => mocks.frame!());
    expect(reveal.getSnapshot().phase).toBe('flying');
    now = 1000;
    act(() => oldFrame());
    expect(reveal.getSnapshot().phase).toBe('flying');
    expect(complete).not.toHaveBeenCalled();
    act(() => mocks.frame!());
    expect(complete).toHaveBeenCalledOnce();
    expect(complete).toHaveBeenCalledWith(
      'ITC-D07',
      expect.objectContaining({ generation: 2 }),
    );
    expect(reveal.getSnapshot().phase).toBe('revealing');
    expect(dispose).not.toHaveBeenCalled();
    view.unmount();
    expect(dispose).toHaveBeenCalledOnce();
  },
);
it.each(['idle', 'flight'])(
  'same-owner provider wrapper churn preserves the %s controller until actual unmount',
  (phase) => {
    let now = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    const { ui, reveal, complete } = spatialHarness();
    const dispose = vi.spyOn(reveal, 'dispose');
    const request = spatialRequest(phase === 'flight' ? 'ITC-D01' : null, 1);
    const wrap = () => (
      <SceneSessionContext value={{ current: () => true }}>
        {ui(request)}
      </SceneSessionContext>
    );
    const view = render(wrap());
    act(() => mocks.frame!());
    act(() => mocks.frame!());
    now = 200;
    act(() => mocks.frame!());
    expect(reveal.getSnapshot().phase).toBe(
      phase === 'flight' ? 'flying' : 'idle',
    );
    view.rerender(wrap());
    view.rerender(wrap());
    expect(dispose).not.toHaveBeenCalled();
    expect(reveal.getSnapshot().phase).toBe(
      phase === 'flight' ? 'flying' : 'idle',
    );
    if (phase === 'flight') {
      now = 751;
      act(() => mocks.frame!());
      expect(complete).toHaveBeenCalledWith(
        'ITC-D01',
        expect.objectContaining({ generation: 1 }),
      );
      expect(reveal.getSnapshot().phase).toBe('revealing');
    }
    view.unmount();
    expect(dispose).toHaveBeenCalledOnce();
  },
);
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
