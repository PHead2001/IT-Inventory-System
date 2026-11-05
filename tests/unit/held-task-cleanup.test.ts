// @vitest-environment node
import { EventEmitter } from 'node:events';
import type { APIResponse, Page, Request, Route } from '@playwright/test';
import { afterEach, expect, it, vi } from 'vitest';
import { holdTaskCleanupRead } from '../e2e/held-task-cleanup';

afterEach(() => vi.useRealTimers());
async function fixture() {
  const clean =
    'http://localhost:3000/inventory/assets/a3010000-0000-4000-8000-0000000000ab';
  let href = clean;
  let handler!: Parameters<Page['route']>[1];
  const events = new EventEmitter();
  const frame = { url: () => href };
  const page = Object.assign(events, {
    url: () => href,
    mainFrame: () => frame,
    route: vi.fn(async (_pattern, value) => {
      handler = value;
    }),
    unroute: vi.fn(async () => {}),
  }) as unknown as Page;
  const held = await holdTaskCleanupRead(page, clean);
  const response = { ok: () => true } as APIResponse;
  const route = {
    fetch: vi.fn(async () => response),
    fulfill: vi.fn(async () => {}),
    fallback: vi.fn(async () => {}),
    abort: vi.fn(async () => {}),
  };
  const request = (overrides = {}) =>
    ({
      url: () => 'http://localhost:3000/api/auth/privacy-read',
      method: () => 'POST',
      postDataJSON: () => ({ operation: 'read-generation' }),
      frame: () => frame,
      // Production's no-referrer policy is preserved.
      headers: () => ({}),
      ...overrides,
    }) as unknown as Request;
  return {
    clean,
    events,
    held,
    route,
    request,
    navigate(value: string) {
      href = value;
      events.emit('framenavigated', frame);
    },
    async invoke(value: Request) {
      const routed = { ...route, request: () => value } as unknown as Route;
      await handler(routed, value);
    },
  };
}
it('holds only a read observed after exact task then cleanup navigation, and delivers its genuine response', async () => {
  const f = await fixture();
  const old = f.request();
  f.events.emit('request', old);
  f.navigate(f.clean + '?task=asset_move');
  f.navigate(f.clean);
  await f.invoke(old);
  expect(f.route.fetch).not.toHaveBeenCalled();
  const cleanup = f.request();
  f.events.emit('request', cleanup);
  const pending = f.invoke(cleanup);
  await f.held.arrival;
  expect(f.route.fulfill).not.toHaveBeenCalled();
  f.held.release();
  await f.held.delivery;
  await pending;
  await f.held.dispose();
  expect(f.route.fetch).toHaveBeenCalledOnce();
  expect(f.route.fulfill).toHaveBeenCalledWith({
    response: expect.any(Object),
  });
  expect(f.events.listenerCount('request')).toBe(0);
  expect(f.events.listenerCount('framenavigated')).toBe(0);
});
it.each([
  'missing-request-event',
  'source-still-task',
  'different-origin',
  'identity-read',
  'superseded-navigation',
])(
  'fails closed for %s rather than claiming an unrelated read',
  async (reason) => {
    const f = await fixture();
    try {
      f.navigate(f.clean + '?task=asset_move');
      if (reason !== 'source-still-task') f.navigate(f.clean);
      if (reason === 'superseded-navigation') {
        f.navigate('http://localhost:3000/inventory');
        f.navigate(f.clean);
      }
      const request = f.request(
        reason === 'different-origin'
          ? { url: () => 'https://other.example/api/auth/privacy-read' }
          : reason === 'identity-read'
            ? { postDataJSON: () => ({ operation: 'verify-identity' }) }
            : {},
      );
      if (reason !== 'missing-request-event') f.events.emit('request', request);
      await f.invoke(request);
      expect(f.route.fetch).not.toHaveBeenCalled();
      expect(f.route.fallback).toHaveBeenCalledOnce();
    } finally {
      await f.held.dispose();
    }
  },
);
it('times out an unobserved cleanup request and unregisters without deadlock', async () => {
  vi.useFakeTimers();
  const f = await fixture();
  const arrival = expect(f.held.arrival).rejects.toThrow('within its bound');
  const delivery = expect(f.held.delivery).rejects.toThrow('within its bound');
  await vi.advanceTimersByTimeAsync(7500);
  await arrival;
  await delivery;
  await f.held.dispose();
  expect(f.events.eventNames()).toEqual([]);
});
