import { act, createRoot } from '@react-three/fiber';
import { expect, it, vi } from 'vitest';
import type { WebGLRenderer } from 'three';
import { teardownFailedCanvas } from './failed-canvas-teardown';
import { createSceneBudget } from './scene-budget';

function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (reason: Error) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}
function setup() {
  const canvas = document.createElement('canvas');
  const root = createRoot(canvas);
  const budget = createSceneBudget();
  const lease = budget.request(0, vi.fn(), vi.fn());
  lease.allocate();
  const order: string[] = [];
  const completed = vi.fn(() => {
    order.push('complete');
    lease.complete();
  });
  const nextGrant = vi.fn(() => order.push('grant'));
  return { canvas, root, budget, lease, order, completed, nextGrant };
}
function ownedRenderer(order: string[]) {
  const disposal = deferred<void>();
  const renderer = {
    render: vi.fn(),
    xr: { enabled: false },
    dispose: vi.fn(() => {
      order.push('dispose');
      return disposal.promise;
    }),
    forceContextLoss: vi.fn(() => order.push('context-loss')),
  } as unknown as WebGLRenderer;
  return { renderer, disposal };
}
const failingConfiguration = () => ({
  get near(): number {
    throw new Error('configuration failed after renderer acquisition');
  },
});
it('drains actual public Fiber teardown after a factory rejection before granting the next lease', async () => {
  const state = setup();
  const created = vi.fn();
  await expect(
    state.root.configure({
      onCreated: created,
      gl: async () => {
        throw new Error('renderer failed');
      },
    }),
  ).rejects.toThrow('renderer failed');
  state.budget.request(2, state.nextGrant, vi.fn());
  await act(async () => {
    teardownFailedCanvas(state.root, state.canvas, state.completed);
    // The reconciler has not completed its teardown commit at this point.
    expect(state.completed).not.toHaveBeenCalled();
    expect(state.nextGrant).not.toHaveBeenCalled();
  });
  expect(state.completed).toHaveBeenCalledOnce();
  expect(state.nextGrant).toHaveBeenCalledOnce();
  expect(created).not.toHaveBeenCalled();
  expect(state.order).toEqual(['complete', 'grant']);
});
it('retains the slot through factory-owned async disposal after a later configuration failure', async () => {
  const state = setup();
  const { renderer, disposal } = ownedRenderer(state.order);
  const created = vi.fn();
  await expect(
    state.root.configure({
      gl: () => renderer,
      raycaster: failingConfiguration(),
      onCreated: created,
    }),
  ).rejects.toThrow('configuration failed after renderer acquisition');
  state.budget.request(2, state.nextGrant, vi.fn());
  await act(async () => {
    teardownFailedCanvas(state.root, state.canvas, state.completed);
  });
  expect(renderer.dispose).toHaveBeenCalledOnce();
  expect(renderer.forceContextLoss).not.toHaveBeenCalled();
  expect(state.completed).not.toHaveBeenCalled();
  expect(state.nextGrant).not.toHaveBeenCalled();
  await act(async () => {
    disposal.resolve();
    await disposal.promise;
  });
  expect(renderer.forceContextLoss).toHaveBeenCalledOnce();
  expect(state.completed).toHaveBeenCalledOnce();
  expect(state.nextGrant).toHaveBeenCalledOnce();
  expect(created).not.toHaveBeenCalled();
  expect(state.order).toEqual(['dispose', 'context-loss', 'complete', 'grant']);
});
it.each(['reject', 'return'] as const)(
  'waits for a pending factory to %s before disposing and releasing its slot',
  async (outcome) => {
    const state = setup();
    const factory = deferred<WebGLRenderer>();
    const { renderer, disposal } = ownedRenderer(state.order);
    const created = vi.fn();
    const configured = state.root.configure({
      gl: () => factory.promise,
      raycaster: failingConfiguration(),
      onCreated: created,
    });
    // Observe the rejection before resuming the async factory, avoiding an unhandled promise.
    const rejected = expect(configured).rejects.toThrow(
      outcome === 'reject'
        ? 'pending renderer failed'
        : 'configuration failed after renderer acquisition',
    );
    state.budget.request(2, state.nextGrant, vi.fn());
    await act(async () => {
      teardownFailedCanvas(state.root, state.canvas, state.completed);
    });
    expect(renderer.dispose).not.toHaveBeenCalled();
    expect(state.completed).not.toHaveBeenCalled();
    expect(state.nextGrant).not.toHaveBeenCalled();
    await act(async () => {
      if (outcome === 'reject')
        factory.reject(new Error('pending renderer failed'));
      else factory.resolve(renderer);
      await rejected;
    });
    if (outcome === 'return') {
      expect(renderer.dispose).toHaveBeenCalledOnce();
      expect(state.completed).not.toHaveBeenCalled();
      expect(state.nextGrant).not.toHaveBeenCalled();
      await act(async () => {
        disposal.resolve();
        await disposal.promise;
      });
      expect(state.order).toEqual([
        'dispose',
        'context-loss',
        'complete',
        'grant',
      ]);
    } else {
      expect(renderer.dispose).not.toHaveBeenCalled();
      expect(state.order).toEqual(['complete', 'grant']);
    }
    expect(state.completed).toHaveBeenCalledOnce();
    expect(state.nextGrant).toHaveBeenCalledOnce();
    expect(created).not.toHaveBeenCalled();
  },
);
