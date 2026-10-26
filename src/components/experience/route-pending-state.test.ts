import { afterEach, expect, it, vi } from 'vitest';
import { createRoutePendingState } from './route-pending-state';

afterEach(() => vi.useRealTimers());

it('reveals only actual slow work and never completes it on a timer', () => {
  vi.useFakeTimers();
  const state = createRoutePendingState();
  const fast = state.register();
  vi.advanceTimersByTime(149);
  expect(state.snapshot()).toMatchObject({ pending: true, delayed: false });
  fast();
  vi.advanceTimersByTime(1000);
  expect(state.snapshot()).toMatchObject({ pending: false, delayed: false });
  const slow = state.register();
  vi.advanceTimersByTime(150);
  expect(state.snapshot()).toMatchObject({ pending: true, delayed: true });
  vi.advanceTimersByTime(60_000);
  expect(state.snapshot().pending).toBe(true);
  slow();
  expect(state.snapshot().pending).toBe(false);
});

it('keeps overlap until every current source settles; cleanup is idempotent', () => {
  vi.useFakeTimers();
  const state = createRoutePendingState();
  const first = state.register();
  vi.advanceTimersByTime(80);
  const second = state.register();
  first();
  first();
  vi.advanceTimersByTime(70);
  expect(state.snapshot()).toMatchObject({ pending: true, delayed: true });
  second();
  second();
  expect(state.snapshot()).toMatchObject({ pending: false, delayed: false });
});

it('Back/cancellation retires old timers, registrations and callbacks without retiring the new route', () => {
  vi.useFakeTimers();
  const state = createRoutePendingState();
  const epoch = state.snapshot().epoch;
  const old = state.register();
  state.cancel();
  const current = state.register();
  old();
  state.register(epoch)();
  expect(state.current(epoch)).toBe(false);
  vi.advanceTimersByTime(150);
  expect(state.snapshot()).toMatchObject({ pending: true, delayed: true });
  current();
  state.cancel(true);
  state.register()();
  expect(state.snapshot()).toMatchObject({ pending: false, delayed: false });
});
