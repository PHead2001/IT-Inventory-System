import {
  Activity,
  StrictMode,
  useEffect,
  useLayoutEffect,
  useCallback,
  useState,
} from 'react';
import { act, render } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import {
  BoxGeometry,
  DirectionalLight,
  Group,
  Mesh,
  MeshBasicMaterial,
} from 'three';
import { SceneSessionContext } from './scene-budget-provider';
import type { RoomDefinition } from '../schema';
import { SceneEffectsProvider, useSceneEffects } from './scene-effects-context';
import type { SceneEffectsStore } from './scene-effects-state';

const room = {
  roomId: 'original',
  dimensions: [100, 100, 96],
} as unknown as RoomDefinition;

function Probe({ observe }: { observe: (store: SceneEffectsStore) => void }) {
  const store = useSceneEffects();
  useEffect(() => {
    observe(store);
  }, [store, observe]);
  return null;
}
function register(store: SceneEffectsStore) {
  const root = new Group();
  root.add(new Mesh(new BoxGeometry(2, 2, 2), new MeshBasicMaterial()));
  const cleanup = store.registerVisual('drawer', 'ITC-D01', root);
  store.setLight('key', new DirectionalLight());
  return cleanup;
}
async function flushRetirement() {
  await act(async () => {
    await Promise.resolve();
  });
}

it('preserves the committed store across benign renders and disposes it on real unmount', async () => {
  const observed: SceneEffectsStore[] = [];
  const observe = (store: SceneEffectsStore) => observed.push(store);
  const view = render(
    <SceneEffectsProvider room={room}>
      <Probe observe={observe} />
    </SceneEffectsProvider>,
  );
  const original = observed[0];
  const dispose = vi.spyOn(original, 'dispose');
  register(original);
  view.rerender(
    <SceneEffectsProvider room={room}>
      <Probe observe={observe} />
      <span>Benign presentation update</span>
    </SceneEffectsProvider>,
  );
  await flushRetirement();
  expect(observed).toEqual([original]);
  expect(dispose).not.toHaveBeenCalled();
  expect(original.getCasters()).toHaveLength(1);
  view.unmount();
  await flushRetirement();
  expect(dispose).toHaveBeenCalledTimes(1);
  expect(original.getCasters()).toEqual([]);
  expect(original.getLights()).toEqual([]);
});

it('disposes a replaced same-size room without allowing old cleanup to remove successor registrations', async () => {
  const observed: SceneEffectsStore[] = [];
  const observe = (store: SceneEffectsStore) => observed.push(store);
  const view = render(
    <SceneEffectsProvider room={room}>
      <Probe observe={observe} />
    </SceneEffectsProvider>,
  );
  const original = observed[0];
  const cleanup = register(original);
  const dispose = vi.spyOn(original, 'dispose');
  view.rerender(
    <SceneEffectsProvider room={{ ...room, roomId: 'successor' }}>
      <Probe observe={observe} />
    </SceneEffectsProvider>,
  );
  const successor = observed.at(-1)!;
  register(successor);
  await flushRetirement();
  cleanup();
  register(original);
  expect(dispose).toHaveBeenCalledTimes(1);
  expect(original.getCasters()).toEqual([]);
  expect(original.getLights()).toEqual([]);
  expect(successor).not.toBe(original);
  expect(successor.sceneGeneration).not.toBe(original.sceneGeneration);
  expect(successor.getCasters()).toHaveLength(1);
  expect(successor.getLights()).toHaveLength(1);
  view.unmount();
  await flushRetirement();
  expect(successor.getCasters()).toEqual([]);
});

it('replaces a StrictMode rehearsal store with one fresh generation and never revives its callbacks', async () => {
  const observed: SceneEffectsStore[] = [];
  const observe = (store: SceneEffectsStore) => observed.push(store);
  const view = render(
    <StrictMode>
      <SceneEffectsProvider room={room}>
        <Probe observe={observe} />
      </SceneEffectsProvider>
    </StrictMode>,
  );
  await flushRetirement();
  const original = observed[0];
  const restored = observed.at(-1)!;
  expect(new Set(observed).size).toBe(2);
  expect(original.isDisposed()).toBe(true);
  expect(restored).not.toBe(original);
  expect(restored.isDisposed()).toBe(false);
  const dispose = vi.spyOn(original, 'dispose');
  const snapshot = original.getSnapshot();
  register(original);
  original.invalidateHover();
  original.recordCapture(1);
  expect(original.getSnapshot()).toBe(snapshot);
  expect(original.getCasters()).toEqual([]);
  expect(original.getLights()).toEqual([]);
  view.unmount();
  expect(restored.isDisposed()).toBe(true);
  await flushRetirement();
  expect(dispose).not.toHaveBeenCalled();
});

it('restores a working effects store after Activity reconnects while retired callbacks stay inert', async () => {
  const observed: SceneEffectsStore[] = [];
  const observe = (store: SceneEffectsStore) => {
    observed.push(store);
    register(store);
  };
  const scene = (mode: 'visible' | 'hidden') => (
    <Activity mode={mode}>
      <SceneEffectsProvider room={room}>
        <Probe observe={observe} />
      </SceneEffectsProvider>
    </Activity>
  );
  const view = render(scene('visible'));
  const original = observed[0];
  expect(original.getCasters()).toHaveLength(1);
  view.rerender(scene('hidden'));
  await flushRetirement();
  expect(original.getCasters()).toEqual([]);
  register(original);
  expect(original.getCasters()).toEqual([]);
  view.rerender(scene('visible'));
  await flushRetirement();
  const restored = observed.at(-1)!;
  expect(restored).not.toBe(original);
  expect(restored.sceneGeneration).not.toBe(original.sceneGeneration);
  expect(restored.isDisposed()).toBe(false);
  expect(restored.getCasters()).toHaveLength(1);
  expect(restored.getLights()).toHaveLength(1);
  register(original);
  expect(original.getCasters()).toEqual([]);
  view.unmount();
  await flushRetirement();
});

it('reconnects a replacement room without letting a retired setup replace its current store', async () => {
  const observed: SceneEffectsStore[] = [];
  const observe = (store: SceneEffectsStore) => {
    observed.push(store);
    register(store);
  };
  const replacement = { ...room, roomId: 'replacement' };
  const scene = (mode: 'visible' | 'hidden', definition = room) => (
    <Activity mode={mode}>
      <SceneEffectsProvider room={definition}>
        <Probe observe={observe} />
      </SceneEffectsProvider>
    </Activity>
  );
  const view = render(scene('visible'));
  const original = observed[0];
  view.rerender(scene('hidden'));
  await flushRetirement();
  view.rerender(scene('visible', replacement));
  await flushRetirement();
  const restored = observed.at(-1)!;
  expect(original.isDisposed()).toBe(true);
  expect(restored).not.toBe(original);
  expect(restored.sceneGeneration).toContain(':replacement');
  expect(restored.isDisposed()).toBe(false);
  expect(restored.getCasters()).toHaveLength(1);
  register(original);
  expect(original.getCasters()).toEqual([]);
  view.unmount();
  await flushRetirement();
});

it('retires each Activity predecessor once and reconnects without duplicating subscriptions', async () => {
  const observed: SceneEffectsStore[] = [];
  const notifications = vi.fn();
  const disposals = new Map<SceneEffectsStore, ReturnType<typeof vi.spyOn>>();
  const observe = (store: SceneEffectsStore) => {
    observed.push(store);
    if (!disposals.has(store)) disposals.set(store, vi.spyOn(store, 'dispose'));
    register(store);
  };
  function Subscriber() {
    const store = useSceneEffects();
    useEffect(() => store.subscribe(notifications), [store]);
    return null;
  }
  const scene = (mode: 'visible' | 'hidden') => (
    <Activity mode={mode}>
      <SceneEffectsProvider room={room}>
        <Probe observe={observe} />
        <Subscriber />
      </SceneEffectsProvider>
    </Activity>
  );
  const view = render(scene('visible'));
  const predecessors: SceneEffectsStore[] = [];
  for (let cycle = 0; cycle < 3; cycle++) {
    const current = observed.at(-1)!;
    notifications.mockClear();
    current.invalidateHover();
    expect(notifications).toHaveBeenCalledTimes(1);
    predecessors.push(current);
    view.rerender(scene('hidden'));
    await flushRetirement();
    expect(current.isDisposed()).toBe(true);
    expect(disposals.get(current)).toHaveBeenCalledTimes(1);
    view.rerender(scene('visible'));
    await flushRetirement();
    const restored = observed.at(-1)!;
    expect(restored).not.toBe(current);
    expect(restored.isDisposed()).toBe(false);
    expect(restored.getCasters()).toHaveLength(1);
    notifications.mockClear();
    for (const retired of predecessors) {
      register(retired);
      retired.invalidateHover();
      expect(retired.getCasters()).toEqual([]);
      expect(disposals.get(retired)).toHaveBeenCalledTimes(1);
    }
    expect(notifications).not.toHaveBeenCalled();
    restored.invalidateHover();
    expect(notifications).toHaveBeenCalledTimes(1);
  }
  const final = observed.at(-1)!;
  view.unmount();
  await flushRetirement();
  expect(final.isDisposed()).toBe(true);
  expect(disposals.get(final)).toHaveBeenCalledTimes(1);
});

it('never adopts a replacement authority wrapper after the original session is revoked', async () => {
  let current = true;
  const originalSession = { current: () => current };
  const observed: SceneEffectsStore[] = [];
  const observe = (store: SceneEffectsStore) => {
    observed.push(store);
    register(store);
  };
  const scene = (
    mode: 'hidden' | 'visible',
    authority = originalSession,
    definition = room,
  ) => (
    <SceneSessionContext value={authority}>
      <Activity mode={mode}>
        <SceneEffectsProvider room={definition}>
          <Probe observe={observe} />
        </SceneEffectsProvider>
      </Activity>
    </SceneSessionContext>
  );
  const view = render(scene('visible'));
  const original = observed[0];
  const before = original.getSnapshot();
  current = false;
  original.recordCapture(1);
  original.invalidateHover();
  original.quality.sample(100, true);
  expect(original.getSnapshot()).toBe(before);
  expect(original.quality.evidence().pending).toBe(0);
  view.rerender(scene('hidden'));
  await flushRetirement();
  const dispose = vi.spyOn(original, 'dispose');
  view.rerender(scene('visible', { current: () => true }));
  await flushRetirement();
  expect(observed.at(-1)).toBe(original);
  expect(original.isDisposed()).toBe(true);
  expect(original.isCurrent()).toBe(false);
  view.rerender(
    scene('visible', { current: () => true }, { ...room, roomId: 'new' }),
  );
  const next = observed.at(-1)!;
  expect(next.isCurrent()).toBe(false);
  expect(next.getCasters()).toEqual([]);
  view.unmount();
  await flushRetirement();
  expect(dispose).not.toHaveBeenCalled();
});

function LayoutRegisteredCaster({
  observe,
}: {
  observe: (store: SceneEffectsStore) => void;
}) {
  const store = useSceneEffects();
  useLayoutEffect(() => {
    observe(store);
    const root = new Group();
    root.add(new Mesh(new BoxGeometry(2, 2, 2), new MeshBasicMaterial()));
    return store.registerVisual('drawer', 'ITC-D01', root);
  }, [store, observe]);
  const [light] = useState(() => new DirectionalLight());
  const attachLight = useCallback(
    (element: HTMLSpanElement | null) => {
      store.setLight('key', element ? light : null);
    },
    [store, light],
  );
  return <span ref={attachLight} />;
}

it.each(['StrictMode', 'Activity'] as const)(
  'keeps descendant layout caster registrations after %s reconnect',
  async (lifecycle) => {
    const observed: SceneEffectsStore[] = [];
    const observe = (store: SceneEffectsStore) => {
      observed.push(store);
    };
    const content = (
      <SceneEffectsProvider room={room}>
        <LayoutRegisteredCaster observe={observe} />
      </SceneEffectsProvider>
    );
    const scene = (mode: 'visible' | 'hidden') =>
      lifecycle === 'StrictMode' ? (
        <StrictMode>{content}</StrictMode>
      ) : (
        <Activity mode={mode}>{content}</Activity>
      );
    const view = render(scene('visible'));
    try {
      const original = observed[0];
      if (lifecycle === 'Activity') {
        view.rerender(scene('hidden'));
        await flushRetirement();
        expect(original.isDisposed()).toBe(true);
        view.rerender(scene('visible'));
      }
      await flushRetirement();
      const current = observed.at(-1)!;
      expect(current.isDisposed()).toBe(false);
      expect(current.isCurrent()).toBe(true);
      expect(current.getCasters()).toHaveLength(1);
      expect(current.getLights()).toHaveLength(1);
      expect(current).not.toBe(original);
      expect(new Set(observed).size).toBe(2);
      expect(observed.length).toBeLessThanOrEqual(4);
      const stale = original.getSnapshot();
      register(original);
      original.setBloomReady(true);
      original.invalidateHover();
      expect(original.getSnapshot()).toBe(stale);
      expect(original.getCasters()).toEqual([]);
      expect(original.getLights()).toEqual([]);
    } finally {
      view.unmount();
      await flushRetirement();
    }
  },
);
