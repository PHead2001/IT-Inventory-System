import { expect, it, vi } from 'vitest';
import type { APIResponse, Route } from '@playwright/test';
import { captureForwardedResponse } from '../e2e/capture-forwarded-response';

it('retains actual response bytes before document delivery evicts them', async () => {
  let delivered = false;
  const bytes = Buffer.from(
    JSON.stringify({ ok: true, value: 'Real upstream ✓' }),
  );
  const response = {
    status: () => 200,
    body: async () => {
      if (delivered)
        throw Error('Network.getResponseBody: resource no longer available');
      return bytes;
    },
  } as APIResponse;
  const route = {
    fetch: vi.fn().mockResolvedValue(response),
    fulfill: vi.fn(async (options) => {
      // Preserving the original APIResponse also retains actual Set-Cookie and
      // other response headers; this adapter fabricates no authentication data.
      expect(options.response).toBe(response);
      expect(options.body).toBe(bytes);
      delivered = true;
    }),
  } satisfies Pick<Route, 'fetch' | 'fulfill'>;
  const captured = await captureForwardedResponse(route);
  expect(route.fetch).toHaveBeenCalledOnce();
  expect(route.fulfill).toHaveBeenCalledOnce();
  expect(captured).toEqual({ status: 200, body: bytes });
  await expect(response.body()).rejects.toThrow('resource no longer available');
  expect(JSON.parse(captured.body.toString('utf8'))).toEqual({
    ok: true,
    value: 'Real upstream ✓',
  });
});

it.each(['fetch', 'body', 'fulfill'] as const)(
  'propagates a real %s failure without fabricating a successful receipt',
  async (stage) => {
    const error = Error('upstream ' + stage);
    const response = {
      status: () => 500,
      body: vi.fn().mockImplementation(async () => {
        if (stage === 'body') throw error;
        return Buffer.from('upstream failure');
      }),
    } as unknown as APIResponse;
    const route = {
      fetch: vi.fn().mockImplementation(async () => {
        if (stage === 'fetch') throw error;
        return response;
      }),
      fulfill: vi.fn().mockImplementation(async () => {
        throw error;
      }),
    } satisfies Pick<Route, 'fetch' | 'fulfill'>;
    await expect(captureForwardedResponse(route)).rejects.toBe(error);
    expect(route.fulfill).toHaveBeenCalledTimes(stage === 'fulfill' ? 1 : 0);
  },
);
