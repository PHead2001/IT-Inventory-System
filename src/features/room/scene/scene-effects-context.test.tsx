import { Activity, StrictMode, useEffect } from 'react';
import { act, render } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import {
  BoxGeometry,
  DirectionalLight,
  Group,
  Mesh,
  MeshBasicMaterial,
} from 'three';
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

it('cancels immediate StrictMode rehearsal retirement, then irreversibly disposes on real unmount', async () => {
  const observed: SceneEffectsStore[] = [];
  const observe = (store: SceneEffectsStore) => observed.push(store);
  const view = render(
    <StrictMode>
      <SceneEffectsProvider room={room}>
        <Probe observe={observe} />
      </SceneEffectsProvider>
    </StrictMode>,
  );
  expect(observed).toHaveLength(2);
  const original = observed[0];
  expect(observed[1]).toBe(original);
  const dispose = vi.spyOn(original, 'dispose');
  await flushRetirement();
  register(original);
  expect(dispose).not.toHaveBeenCalled();
  expect(original.getCasters()).toHaveLength(1);
  view.unmount();
  await flushRetirement();
  expect(dispose).toHaveBeenCalledTimes(1);
  register(original);
  expect(original.getCasters()).toEqual([]);
  expect(original.getLights()).toEqual([]);
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
