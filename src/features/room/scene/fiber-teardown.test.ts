import { act, createRoot } from '@react-three/fiber';
import { afterEach, expect, it, vi } from 'vitest';
import { teardownFailedCanvas } from './failed-canvas-teardown';
import { createSceneBudget } from './scene-budget';
afterEach(() => vi.useRealTimers());
it('the failed-configure adapter drains actual public Fiber teardown before granting the next lease', async () => {
  vi.useFakeTimers();
  const canvas = document.createElement('canvas');
  const root = createRoot(canvas);
  const created = vi.fn();
  const budget = createSceneBudget();
  const lease = budget.request(0, vi.fn(), vi.fn());
  lease.allocate();
  await expect(
    root.configure({
      onCreated: created,
      gl: async () => {
        throw new Error('renderer failed');
      },
    }),
  ).rejects.toThrow('renderer failed');
  const completed = vi.fn();
  const nextGrant = vi.fn();
  budget.request(2, nextGrant, vi.fn());
  await act(async () => {
    teardownFailedCanvas(root, canvas, () => {
      lease.complete();
      completed(canvas);
    });
  });
  expect(completed).not.toHaveBeenCalled();
  expect(nextGrant).not.toHaveBeenCalled();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(500);
  });
  expect(completed).toHaveBeenCalledWith(canvas);
  expect(nextGrant).toHaveBeenCalledOnce();
  expect(created).not.toHaveBeenCalled();
});
