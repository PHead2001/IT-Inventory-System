import { act, render, waitFor } from '@testing-library/react';
import { useLayoutEffect, type ReactNode } from 'react';
import { expect, it, vi } from 'vitest';
import {
  BoxGeometry,
  Camera,
  Color,
  DirectionalLight,
  Group,
  Mesh,
  MeshBasicMaterial,
} from 'three';
import type { RoomDefinition } from '../schema';
import { SceneSessionContext } from './scene-budget-provider';
import { SceneEffectsProvider, useSceneEffects } from './scene-effects-context';
import { SceneEffectsOwner } from './scene-effects-owner';
import type { EffectsQuality, SceneEffectsStore } from './scene-effects-state';

const probe = vi.hoisted(() => {
  let resolve!: () => void;
  const pending = new Promise<void>((done) => {
    resolve = done;
  });
  return {
    pending,
    resolve,
    allocation: vi.fn(),
    overlay: vi.fn(),
    draw: vi.fn(),
    attach: vi.fn(),
    dispose: vi.fn(),
    frames: [] as Array<() => void>,
    canvas: null as unknown as HTMLCanvasElement,
    invalidate: vi.fn(),
  };
});
vi.mock('@react-three/fiber', () => ({
  useThree: () => ({
    gl: {
      domElement: probe.canvas,
      toneMapping: 0,
      toneMappingExposure: 1,
      outputColorSpace: '',
    },
    camera: new Camera(),
    scene: new Group(),
    invalidate: probe.invalidate,
  }),
  useFrame: (frame: () => void) => {
    probe.frames.push(frame);
  },
}));
vi.mock('./cached-contact-shadows', () => ({
  CachedContactShadows: () => null,
}));
vi.mock('./scene-palette', () => ({
  useScenePaletteRevision: () => 0,
  useScenePalette: () => ({ background: new Color('black') }),
}));
vi.mock('./scene-bloom', async (importOriginal) => {
  await probe.pending;
  return importOriginal();
});
vi.mock('@react-three/postprocessing', () => ({
  EffectComposer: ({ children }: { children: ReactNode }) => {
    probe.allocation();
    return children;
  },
  SelectiveBloom: () => null,
}));
vi.mock('./scene-bloom-runtime', () => ({
  captureRawSceneColor: () => ({
    toneMapping: 0,
    toneMappingExposure: 1,
    outputColorSpace: '',
  }),
  createBloomOverlay: () => {
    probe.overlay();
    return { draw: probe.draw, dispose: probe.dispose };
  },
  createSceneBloomFrames: () => ({ draw: probe.draw, attach: probe.attach }),
}));

const room = {
  roomId: 'room',
  dimensions: [100, 100, 96],
} as unknown as RoomDefinition;
function Registration({
  observe,
}: {
  observe: (store: SceneEffectsStore) => void;
}) {
  const store = useSceneEffects();
  useLayoutEffect(() => {
    const group = new Group();
    group.add(new Mesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial()));
    const remove = store.registerVisual('drawer', 'ITC-D01', group);
    store.setLight('key', new DirectionalLight());
    observe(store);
    return remove;
  }, [store, observe]);
  return null;
}
it('allocates nothing when a pending import resolves after revoke, A to B to A, lease preemption, unmount or quality change', async () => {
  probe.canvas = document.createElement('canvas');
  const cases = [
    'revoke',
    'A-B-A',
    'preempt',
    'unmount',
    'low',
    'off',
  ] as const;
  const views = [];
  for (const scenario of cases) {
    let permitted = true;
    const original = { current: () => permitted };
    let store!: SceneEffectsStore;
    const observe = (next: SceneEffectsStore) => {
      store = next;
    };
    const tree = (session = original, quality: EffectsQuality = 'standard') => (
      <SceneSessionContext value={session}>
        <SceneEffectsProvider room={room}>
          <Registration observe={observe} />
          <SceneEffectsOwner
            room={room}
            selectedCode="ITC-D01"
            highlightedCodes={[]}
            quality={quality}
          />
        </SceneEffectsProvider>
      </SceneSessionContext>
    );
    const view = render(tree());
    expect(store.getCasters()).toHaveLength(1);
    if (scenario === 'unmount') view.unmount();
    else if (scenario === 'low' || scenario === 'off')
      view.rerender(tree(original, scenario));
    else {
      permitted = false;
      if (scenario === 'A-B-A') {
        view.rerender(tree({ current: () => true }));
        view.rerender(tree({ current: () => true }));
      }
    }
    views.push({ view, store, scenario });
  }
  expect(probe.allocation).not.toHaveBeenCalled();
  expect(probe.overlay).not.toHaveBeenCalled();
  await act(async () => {
    probe.resolve();
    await probe.pending;
  });
  expect(probe.allocation).not.toHaveBeenCalled();
  expect(probe.overlay).not.toHaveBeenCalled();
  probe.invalidate.mockClear();
  probe.canvas.dataset.bloomStatus = 'retirement-sentinel';
  const snapshots = views.map(({ store }) => store.getSnapshot());
  act(() => {
    for (const frame of probe.frames) frame();
  });
  // Only quality-disabled but still authorized owners may report normal telemetry.
  for (let index = 0; index < 4; index++)
    expect(views[index].store.getSnapshot()).toBe(snapshots[index]);
  expect(probe.draw).not.toHaveBeenCalled();
  expect(probe.attach).not.toHaveBeenCalled();
  for (const { view } of views) view.unmount();
  let activeStore!: SceneEffectsStore;
  const observeActive = (store: SceneEffectsStore) => {
    activeStore = store;
  };
  const active = render(
    <SceneEffectsProvider room={room}>
      <Registration observe={observeActive} />
      <SceneEffectsOwner
        room={room}
        selectedCode="ITC-D01"
        highlightedCodes={[]}
      />
    </SceneEffectsProvider>,
  );
  await waitFor(() => expect(probe.allocation).toHaveBeenCalledOnce());
  await waitFor(() => expect(probe.overlay).toHaveBeenCalledOnce());
  const disposeStore = vi.spyOn(activeStore, 'dispose');
  active.unmount();
  await act(async () => {
    await Promise.resolve();
  });
  expect(probe.dispose).toHaveBeenCalledOnce();
  expect(disposeStore).toHaveBeenCalledOnce();
  probe.draw.mockClear();
  probe.invalidate.mockClear();
  const retired = activeStore.getSnapshot();
  act(() => {
    for (const frame of probe.frames) frame();
  });
  expect(probe.draw).not.toHaveBeenCalled();
  expect(probe.invalidate).not.toHaveBeenCalled();
  expect(activeStore.getSnapshot()).toBe(retired);
});
