import { act, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { RootState } from '@react-three/fiber';
import {
  ACESFilmicToneMapping,
  NoToneMapping,
  SRGBColorSpace,
  BoxGeometry,
  Camera,
  Color,
  DirectionalLight,
  Group,
  Mesh,
  MeshBasicMaterial,
} from 'three';
import type { RoomDefinition } from '../schema';
import {
  createSceneEffectsStore,
  SCENE_EFFECTS,
  type SceneEffectsStore,
} from './scene-effects-state';
import { SceneEffectsOwner } from './scene-effects-owner';

const probe = vi.hoisted(() => ({
  store: null as unknown as SceneEffectsStore,
  canvas: null as unknown as HTMLCanvasElement,
  camera: null as unknown as Camera,
  bloom: vi.fn(),
  invalidate: vi.fn(),
  frame: null as ((state: RootState, delta: number) => void) | null,
  afterFrames: new Set<() => void>(),
  tails: new Set<() => void>(),
  root: null as unknown as RootState,
  color: { toneMapping: 0, toneMappingExposure: 0, outputColorSpace: '' },
}));
vi.mock('@react-three/fiber', () => ({
  useThree: () => ({
    gl: { domElement: probe.canvas, ...probe.color },
    camera: probe.camera,
    invalidate: probe.invalidate,
  }),
  useFrame: (callback: (state: RootState, delta: number) => void) => {
    probe.frame = callback;
  },
  addAfterEffect: (callback: () => void) => {
    probe.afterFrames.add(callback);
    return () => probe.afterFrames.delete(callback);
  },
  addTail: (callback: () => void) => {
    probe.tails.add(callback);
    return () => probe.tails.delete(callback);
  },
}));
vi.mock('./scene-effects-context', () => ({
  useSceneEffects: () => probe.store,
}));
vi.mock('./scene-palette', () => ({ useScenePaletteRevision: () => 0 }));
vi.mock('./cached-contact-shadows', () => ({
  CachedContactShadows: () => null,
}));
vi.mock('./scene-bloom', () => ({
  default: (props: unknown) => {
    probe.bloom(props);
    return null;
  },
}));

function setup() {
  probe.store = createSceneEffectsStore('scene:1');
  probe.canvas = document.createElement('canvas');
  probe.camera = new Camera();
  probe.bloom.mockReset();
  probe.invalidate.mockReset();
  probe.frame = null;
  probe.root = {
    frameloop: 'demand',
    internal: { active: true, frames: 0 },
  } as RootState;
  probe.color = {
    toneMapping: ACESFilmicToneMapping,
    toneMappingExposure: 1.25,
    outputColorSpace: SRGBColorSpace,
  };
  const mesh = new Mesh(
    new BoxGeometry(2, 2, 2),
    new MeshBasicMaterial({ color: new Color('red') }),
  );
  const group = new Group();
  group.add(mesh);
  probe.store.registerVisual('container', 'ITC-RED', group);
  probe.store.setLight('key', new DirectionalLight());
  return mesh;
}
const room = {
  roomId: 'test',
  dimensions: [100, 100, 96],
} as unknown as RoomDefinition;
afterEach(() => vi.restoreAllMocks());

function samplingOwner() {
  setup();
  const view = render(
    <SceneEffectsOwner room={room} selectedCode={null} highlightedCodes={[]} />,
  );
  samplingFrame(5000);
  samplingFrame(5000);
  return view;
}

function samplingFrame(
  ms: number,
  moved = false,
  captured = false,
  successorScheduled = true,
) {
  act(() => {
    if (moved) probe.camera.matrixWorld.elements[12]++;
    if (captured) probe.store.recordCapture(1);
    probe.root.internal.frames = successorScheduled ? 2 : 1;
    probe.frame!(probe.root, ms / 1000);
    // Fiber 9.8.1 decrements the rendered root before global after effects.
    probe.root.internal.frames--;
    for (const afterFrame of probe.afterFrames) afterFrame();
  });
}

function samplingBurst(samples: number, ms = 30) {
  // The first active frame starts a new burst and excludes the demand gap.
  samplingFrame(5000, true);
  for (let i = 0; i < samples; i++) samplingFrame(ms, true);
  samplingFrame(5000);
}

function finishSamplingWarmup(windows = 0) {
  samplingBurst(SCENE_EFFECTS.startupActiveFrames, 5000);
  expect(probe.store.quality.evidence()).toMatchObject({
    windows,
    pending: 0,
    disabled: false,
  });
}

it('accumulates eligible short bursts across idle frames and latches two bad windows without invalidating more frames', () => {
  samplingOwner();
  finishSamplingWarmup();
  probe.invalidate.mockClear();
  for (let burst = 0; burst < 3; burst++) samplingBurst(20);
  expect(probe.store.quality.evidence()).toMatchObject({
    windows: 1,
    lastP95: 30,
    badWindows: 1,
    disabled: false,
    pending: 0,
  });
  expect(probe.invalidate).not.toHaveBeenCalled();
  for (let burst = 0; burst < 3; burst++) samplingBurst(20);
  expect(probe.store.quality.evidence()).toMatchObject({
    windows: 2,
    lastP95: 30,
    badWindows: 2,
    disabled: true,
  });
  expect(probe.store.getSnapshot().bloomFailure).toBe('sustained-frame-time');
  // Publishing the fallback can invalidate once; sampling itself schedules none.
  expect(probe.invalidate).toHaveBeenCalledTimes(1);
});

it('retains partial samples while rejecting idle gaps, first resumed frames and capture intervals', () => {
  samplingOwner();
  finishSamplingWarmup();
  samplingBurst(3);
  expect(probe.store.quality.evidence().pending).toBe(3);
  samplingFrame(5000);
  samplingFrame(5000, true);
  expect(probe.store.quality.evidence().pending).toBe(3);
  samplingFrame(30, true);
  expect(probe.store.quality.evidence().pending).toBe(4);
  samplingFrame(5000, true, true);
  samplingFrame(5000, true);
  expect(probe.store.quality.evidence().pending).toBe(4);
  samplingFrame(30, true);
  expect(probe.store.quality.evidence()).toMatchObject({
    windows: 0,
    pending: 5,
    disabled: false,
  });
});

it('uses completed good burst windows to reset consecutive degradation', () => {
  samplingOwner();
  finishSamplingWarmup();
  for (let burst = 0; burst < 3; burst++) samplingBurst(20);
  for (let burst = 0; burst < 3; burst++) samplingBurst(20, 10);
  expect(probe.store.quality.evidence()).toMatchObject({
    windows: 2,
    lastP95: 10,
    badWindows: 0,
    disabled: false,
  });
  for (let burst = 0; burst < 3; burst++) samplingBurst(20);
  expect(probe.store.quality.evidence()).toMatchObject({
    windows: 3,
    badWindows: 1,
    disabled: false,
  });
});

it('clears partial progress for composer warmup while retaining completed degradation evidence', () => {
  samplingOwner();
  finishSamplingWarmup();
  for (let burst = 0; burst < 3; burst++) samplingBurst(20);
  samplingBurst(20);
  expect(probe.store.quality.evidence().pending).toBe(20);
  probe.store.quality.restartWarmup();
  finishSamplingWarmup(1);
  expect(probe.store.quality.evidence()).toMatchObject({
    windows: 1,
    lastP95: 30,
    badWindows: 1,
    pending: 0,
    disabled: false,
  });
  for (let burst = 0; burst < 3; burst++) samplingBurst(20);
  expect(probe.store.quality.evidence().disabled).toBe(true);
});

it('ignores retained owner callbacks after unmount or effects retirement', () => {
  const view = samplingOwner();
  finishSamplingWarmup();
  samplingBurst(20);
  const retainedFrame = probe.frame!;
  const evidence = probe.store.quality.evidence();
  const telemetry = probe.canvas.dataset.effectsQualityEvidence;
  view.unmount();
  expect(probe.afterFrames.size).toBe(0);
  expect(probe.tails.size).toBe(0);
  for (let i = 0; i < 150; i++) {
    probe.camera.matrixWorld.elements[12]++;
    retainedFrame({} as RootState, 0.03);
  }
  expect(probe.store.quality.evidence()).toEqual(evidence);
  expect(probe.store.getSnapshot().bloomFailure).toBeNull();
  expect(probe.canvas.dataset.effectsQualityEvidence).toBe(telemetry);

  samplingOwner();
  const retiredFrame = probe.frame!;
  probe.store.dispose();
  const retiredEvidence = probe.store.quality.evidence();
  for (let i = 0; i < 150; i++) {
    probe.camera.matrixWorld.elements[12]++;
    retiredFrame({} as RootState, 0.03);
  }
  expect(probe.store.quality.evidence()).toEqual(retiredEvidence);
  expect(probe.store.getSnapshot().bloomFailure).toBeNull();
});

it('does not turn isolated camera changes into eligible samples across idle frames', () => {
  samplingOwner();
  for (let i = 0; i < 200; i++) {
    samplingFrame(5000, true);
    samplingFrame(5000);
  }
  expect(probe.store.quality.evidence()).toMatchObject({
    windows: 0,
    lastP95: null,
    badWindows: 0,
    pending: 0,
    disabled: false,
  });
  finishSamplingWarmup();
});

it('rejects an active resume after its own last frame had no scheduled successor', () => {
  samplingOwner();
  finishSamplingWarmup();
  samplingFrame(5000, true);
  samplingFrame(30, true, false, false);
  expect(probe.store.quality.evidence().pending).toBe(1);
  samplingFrame(5000, true);
  expect(probe.store.quality.evidence().pending).toBe(1);
  samplingFrame(30, true);
  expect(probe.store.quality.evidence().pending).toBe(2);
});

it('cannot obtain continuity from another root rendering or invalidating after this root stopped', () => {
  samplingOwner();
  finishSamplingWarmup();
  samplingFrame(5000, true);
  samplingFrame(30, true, false, false);
  // Other roots keep the global loop alive. This root was not rendered, and a
  // later input may even have queued its next frame before a global after tick.
  probe.root.internal.frames = 1;
  for (let tick = 0; tick < 5; tick++)
    for (const afterFrame of probe.afterFrames) afterFrame();
  samplingFrame(5000, true);
  expect(probe.store.quality.evidence().pending).toBe(1);
  samplingFrame(30, true);
  expect(probe.store.quality.evidence().pending).toBe(2);
});

it('clears a promised successor when only another root renders the next global frame', () => {
  samplingOwner();
  finishSamplingWarmup();
  samplingFrame(5000, true);
  samplingFrame(30, true);
  expect(probe.store.quality.evidence().pending).toBe(1);
  // The queued successor is withheld, while an unrelated canvas renders.
  // Its global after tick carries no frame from this owner.
  for (const afterFrame of probe.afterFrames) afterFrame();
  samplingFrame(5000, true);
  expect(probe.store.quality.evidence().pending).toBe(1);
  samplingFrame(30, true);
  expect(probe.store.quality.evidence().pending).toBe(2);
});

it('retains continuity for an actually rendered always root but not an inactive root', () => {
  samplingOwner();
  finishSamplingWarmup();
  samplingFrame(5000, true);
  probe.root.frameloop = 'always';
  samplingFrame(30, true, false, false);
  samplingFrame(30, true, false, false);
  expect(probe.store.quality.evidence().pending).toBe(2);
  probe.root.internal.active = false;
  samplingFrame(30, true, false, false);
  probe.root.internal.active = true;
  samplingFrame(5000, true);
  expect(probe.store.quality.evidence().pending).toBe(3);
});

it('clears continuation when a late after effect queues frames but the global loop stops', () => {
  samplingOwner();
  finishSamplingWarmup();
  samplingFrame(5000, true);
  act(() => {
    probe.camera.matrixWorld.elements[12]++;
    probe.root.internal.frames = 1;
    probe.frame!(probe.root, 0.03);
    probe.root.internal.frames--;
    // A preceding global after effect invalidates after repeat was computed.
    probe.root.internal.frames = 1;
    for (const afterFrame of probe.afterFrames) afterFrame();
    for (const tail of probe.tails) tail();
  });
  samplingFrame(5000, true);
  expect(probe.store.quality.evidence().pending).toBe(1);
  samplingFrame(30, true);
  expect(probe.store.quality.evidence().pending).toBe(2);
});

it('measures genuinely slow continuous frames without applying a duration cutoff', () => {
  samplingOwner();
  finishSamplingWarmup();
  samplingBurst(SCENE_EFFECTS.qualityWindow, 5000);
  expect(probe.store.quality.evidence()).toMatchObject({
    windows: 1,
    lastP95: 5000,
    badWindows: 1,
    pending: 0,
    disabled: false,
  });
});

it('verifies the pinned Fiber loop decrements each root after subscribers and before global after effects', async () => {
  const fiber =
    await vi.importActual<typeof import('@react-three/fiber')>(
      '@react-three/fiber',
    );
  let scheduled: FrameRequestCallback | null = null;
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    scheduled = callback;
    return 1;
  });
  vi.stubGlobal('cancelAnimationFrame', () => {});
  const canvas = document.createElement('canvas');
  const observed: Array<{ phase: string; frames: number }> = [];
  let continueRoot = false;
  const root: RootState = {
    frameloop: 'demand',
    clock: { getDelta: () => 0.03 },
    gl: { xr: { isPresenting: false } },
    internal: {
      active: true,
      frames: 0,
      priority: 1,
      subscribers: [
        {
          ref: {
            current: () => {
              observed.push({
                phase: 'subscriber',
                frames: root.internal.frames,
              });
              if (continueRoot) fiber.invalidate(root);
            },
          },
          store: { getState: () => root },
        },
      ],
    },
  } as unknown as RootState;
  const unsubscribe = fiber.addAfterEffect(() => {
    observed.push({ phase: 'after', frames: root.internal.frames });
  });
  let invalidateLate = false;
  const unsubscribeLate = fiber.addAfterEffect(() => {
    if (invalidateLate) fiber.invalidate(root);
  });
  const unsubscribeTail = fiber.addTail(() => {
    observed.push({ phase: 'tail', frames: root.internal.frames });
  });
  fiber._roots.set(canvas, {
    store: { getState: () => root },
  } as Parameters<typeof fiber._roots.set>[1]);
  const runScheduled = (timestamp: number) => {
    expect(scheduled).not.toBeNull();
    scheduled!(timestamp);
  };
  try {
    fiber.invalidate(root);
    runScheduled(10);
    expect(observed).toEqual([
      { phase: 'subscriber', frames: 1 },
      { phase: 'after', frames: 0 },
      { phase: 'tail', frames: 0 },
    ]);
    observed.length = 0;
    continueRoot = true;
    fiber.invalidate(root);
    runScheduled(20);
    expect(observed).toEqual([
      { phase: 'subscriber', frames: 1 },
      { phase: 'after', frames: 1 },
    ]);
    observed.length = 0;
    continueRoot = false;
    invalidateLate = true;
    runScheduled(30);
    expect(observed).toEqual([
      { phase: 'subscriber', frames: 1 },
      { phase: 'after', frames: 0 },
      { phase: 'tail', frames: 1 },
    ]);
  } finally {
    unsubscribe();
    unsubscribeLate();
    unsubscribeTail();
    fiber._roots.delete(canvas);
    // Let the owned loop see no roots and release its scheduled continuation.
    runScheduled(30);
    vi.unstubAllGlobals();
  }
});

it('quality and missing model keep normal presentation without loading bloom, while actual selected refs reach the isolated effect', async () => {
  const mesh = setup();
  const view = render(
    <SceneEffectsOwner
      room={room}
      selectedCode="ITC-RED"
      highlightedCodes={[]}
      quality="low"
    />,
  );
  expect(probe.bloom).not.toHaveBeenCalled();
  expect(probe.canvas.dataset.bloomStatus).toBe('quality-off');
  view.rerender(
    <SceneEffectsOwner
      room={room}
      selectedCode="UNKNOWN"
      highlightedCodes={[]}
    />,
  );
  expect(probe.bloom).not.toHaveBeenCalled();
  probe.color.toneMapping = NoToneMapping;
  view.rerender(
    <SceneEffectsOwner
      room={room}
      selectedCode="ITC-RED"
      highlightedCodes={[]}
    />,
  );
  await act(async () => {
    await Promise.resolve();
  });
  expect(probe.bloom).toHaveBeenCalledWith(
    expect.objectContaining({
      selection: [mesh],
      lights: probe.store.getLights(),
      rawColor: {
        toneMapping: ACESFilmicToneMapping,
        toneMappingExposure: 1.25,
        outputColorSpace: SRGBColorSpace,
      },
    }),
  );
});

it('isolates a throwing lazy effect, retains ordinary controls and latches failure across selection changes', async () => {
  setup();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  probe.bloom.mockImplementation(() => {
    throw new Error('Allocation failed');
  });
  const view = render(
    <>
      <button>Select location</button>
      <SceneEffectsOwner
        room={room}
        selectedCode="ITC-RED"
        highlightedCodes={[]}
      />
    </>,
  );
  await act(async () => {
    await Promise.resolve();
  });
  expect(screen.getByRole('button', { name: 'Select location' })).toBeEnabled();
  expect(probe.store.getSnapshot().bloomFailure).toBe('import-or-allocation');
  const failedCalls = probe.bloom.mock.calls.length;
  view.rerender(
    <>
      <button>Select location</button>
      <SceneEffectsOwner
        room={room}
        selectedCode={null}
        highlightedCodes={[]}
      />
    </>,
  );
  view.rerender(
    <>
      <button>Select location</button>
      <SceneEffectsOwner
        room={room}
        selectedCode="ITC-RED"
        highlightedCodes={[]}
      />
    </>,
  );
  expect(probe.bloom).toHaveBeenCalledTimes(failedCalls);
  expect(probe.store.selectedMeshes('ITC-RED', new Set())).toHaveLength(1);
});
