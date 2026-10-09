import { afterEach, expect, it, vi } from 'vitest';
import {
  relativeTimeLabel,
  subscribeRelativeClock,
  relativeClockSnapshot,
  relativeClockServerSnapshot,
} from './relative-clock';
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});
it('uses one bounded timer across subscribers and stops at final unmount', () => {
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-07T12:00:00Z'));
  const first = vi.fn();
  const second = vi.fn();
  const unsubscribe = subscribeRelativeClock(first);
  const unsubscribeOther = subscribeRelativeClock(second);
  expect(vi.getTimerCount()).toBe(1);
  expect(relativeClockServerSnapshot()).toBeNull();
  vi.advanceTimersByTime(30_000);
  expect(relativeClockSnapshot()).toBe(Date.parse('2026-10-07T12:00:30Z'));
  expect(second).toHaveBeenCalledTimes(2);
  unsubscribe();
  expect(vi.getTimerCount()).toBe(1);
  unsubscribeOther();
  expect(vi.getTimerCount()).toBe(0);
  expect(relativeClockSnapshot()).toBeNull();
});
it('refreshes an already subscribed clock when a newly committed event mounts', () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-07T12:00:00Z'));
  const first = vi.fn();
  const unsubscribe = subscribeRelativeClock(first);
  vi.setSystemTime(new Date('2026-10-07T12:00:20Z'));
  const other = subscribeRelativeClock(vi.fn());
  expect(relativeClockSnapshot()).toBe(Date.parse('2026-10-07T12:00:20Z'));
  expect(first).toHaveBeenCalledTimes(2);
  expect(vi.getTimerCount()).toBe(1);
  other();
  unsubscribe();
});
it('tolerates up to two minutes of server clock skew without hiding genuinely future instants', () => {
  const now = Date.parse('2026-10-07T12:00:00Z');
  for (const value of [
    '2026-10-07T12:00:01Z',
    '2026-10-07T12:01:59Z',
    '2026-10-07T12:02:00Z',
  ])
    expect(relativeTimeLabel(value, now)).toBe('Just now');
  expect(relativeTimeLabel('2026-10-07T12:02:01Z', now)).toBe('In 2 min');
});
it('pauses the shared clock while hidden and refreshes once on return', () => {
  vi.useFakeTimers();
  const visibility = vi
    .spyOn(document, 'visibilityState', 'get')
    .mockReturnValue('visible');
  const changed = vi.fn();
  const unsubscribe = subscribeRelativeClock(changed);
  visibility.mockReturnValue('hidden');
  document.dispatchEvent(new Event('visibilitychange'));
  expect(vi.getTimerCount()).toBe(0);
  visibility.mockReturnValue('visible');
  document.dispatchEvent(new Event('visibilitychange'));
  expect(vi.getTimerCount()).toBe(1);
  expect(changed).toHaveBeenCalledTimes(2);
  unsubscribe();
});
it('keeps hydration exact, formats past/future values, and rejects invalid instants', () => {
  const now = Date.parse('2026-10-07T12:00:00Z');
  expect(relativeTimeLabel('2026-10-07T11:58:00Z', null)).toBeNull();
  expect(relativeTimeLabel('2026-10-07T11:58:00Z', now)).toBe('2 min ago');
  expect(relativeTimeLabel('2026-10-07T13:00:00Z', now)).toBe('In 1 hr');
  expect(relativeTimeLabel('invalid', now)).toBeNull();
});
