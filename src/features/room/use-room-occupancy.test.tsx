import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useRoomOccupancy } from './use-room-occupancy';
const backend = 'https://backend.example';
const counts = (value: string) => ({
  X: {
    quantity_product_count: '1',
    quantity_unit_count: value,
    asset_count: '0',
  },
});
function response(
  url: string,
  value: string,
  identity: Record<string, string> = {},
) {
  const params = new URL(url, window.location.origin).searchParams;
  return {
    ok: true,
    headers: new Headers({ 'content-type': 'application/json' }),
    json: async () => ({
      identity: {
        userId: 'member',
        environment: window.location.origin,
        backend,
        generation: params.get('generation'),
        spaceId: params.get('space'),
        filter: 'type=all;status=active',
        ...identity,
      },
      counts: counts(value),
    }),
  };
}
function deferredFetch() {
  const requests: {
    url: string;
    signal: AbortSignal;
    resolve: (value: ReturnType<typeof response>) => void;
  }[] = [];
  const fetcher = vi.fn(
    (url: string, options: RequestInit) =>
      new Promise((resolve) => {
        requests.push({ url, signal: options.signal as AbortSignal, resolve });
      }),
  );
  vi.stubGlobal('fetch', fetcher);
  return {
    requests,
    fetcher,
    finish: async (
      index: number,
      value: string,
      identity?: Record<string, string>,
    ) => {
      await act(async () =>
        requests[index].resolve(response(requests[index].url, value, identity)),
      );
    },
  };
}
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
it('is off by default and retains exact counts in a private request', async () => {
  const request = deferredFetch();
  const view = renderHook(
    ({ enabled }) =>
      useRoomOccupancy(enabled, 'member', 'it-closet', '1', backend),
    { initialProps: { enabled: false } },
  );
  expect(request.fetcher).not.toHaveBeenCalled();
  view.rerender({ enabled: true });
  expect(view.result.current.status).toBe('loading');
  await request.finish(0, '9007199254740993');
  expect(view.result.current.counts).toEqual(counts('9007199254740993'));
  expect(request.fetcher).toHaveBeenCalledWith(
    expect.stringContaining('generation='),
    expect.objectContaining({ cache: 'no-store', credentials: 'same-origin' }),
  );
});
it('never resurrects a ready snapshot on hide/show before a new deferred response', async () => {
  const request = deferredFetch();
  const view = renderHook(
    ({ enabled }) =>
      useRoomOccupancy(enabled, 'member', 'it-closet', '1', backend),
    { initialProps: { enabled: true } },
  );
  await request.finish(0, '31');
  view.rerender({ enabled: false });
  expect(view.result.current.counts).toBeUndefined();
  view.rerender({ enabled: true });
  expect(view.result.current.counts).toBeUndefined();
  expect(view.result.current.status).toBe('loading');
  expect(request.requests[0].url).not.toBe(request.requests[1].url);
  await request.finish(1, '32');
  expect(view.result.current.counts).toEqual(counts('32'));
});
it('rejects old completions after A -> B -> A, even after A was ready', async () => {
  const request = deferredFetch();
  const view = renderHook(
    ({ space }) => useRoomOccupancy(true, 'member', space, '1', backend),
    { initialProps: { space: 'A' } },
  );
  await request.finish(0, '31');
  view.rerender({ space: 'B' });
  view.rerender({ space: 'A' });
  expect(view.result.current.counts).toBeUndefined();
  expect(request.requests[1].signal.aborted).toBe(true);
  await request.finish(1, '99');
  expect(view.result.current.status).toBe('loading');
  await request.finish(2, '32');
  expect(view.result.current.counts).toEqual(counts('32'));
});
it('publishes only an adopted successful generation and clears it immediately on a selection key transition', async () => {
  const request = deferredFetch();
  const view = renderHook(
    ({ selection, enabled }) =>
      useRoomOccupancy(enabled, 'member', 'it-closet', selection, backend),
    { initialProps: { selection: 'A', enabled: true } },
  );
  expect(view.result.current.acceptedGeneration).toBeNull();
  await request.finish(0, '31');
  const first = new URL(
    request.requests[0].url,
    location.origin,
  ).searchParams.get('generation');
  expect(view.result.current.acceptedGeneration).toBe(first);
  view.rerender({ selection: 'B', enabled: true });
  expect(view.result.current.status).toBe('loading');
  expect(view.result.current.counts).toBeUndefined();
  expect(view.result.current.acceptedGeneration).toBeNull();
  await request.finish(1, '99', { generation: first! });
  expect(view.result.current.status).toBe('error');
  expect(view.result.current.acceptedGeneration).toBeNull();
  view.rerender({ selection: 'C', enabled: true });
  await request.finish(2, '32');
  const current = new URL(
    request.requests[2].url,
    location.origin,
  ).searchParams.get('generation');
  expect(current).not.toBe(first);
  expect(view.result.current.acceptedGeneration).toBe(current);
  view.rerender({ selection: 'C', enabled: false });
  expect(view.result.current.acceptedGeneration).toBeNull();
});
it('isolates same-origin backend changes and rejects actor, origin, backend and generation mismatches', async () => {
  const request = deferredFetch();
  const view = renderHook(
    ({ scope, revision }) =>
      useRoomOccupancy(true, 'member', 'it-closet', revision, scope),
    { initialProps: { scope: backend, revision: '1' } },
  );
  view.rerender({ scope: 'https://second.example', revision: '1' });
  await request.finish(0, '31');
  expect(view.result.current.counts).toBeUndefined();
  await request.finish(1, '32', { backend: 'https://second.example' });
  expect(view.result.current.status).toBe('ready');
  const identities: Record<string, string>[] = [
    { userId: 'other' },
    { environment: 'https://other.example' },
    { backend },
    { generation: '00000000-0000-4000-8000-000000000001' },
  ];
  for (let i = 0; i < identities.length; i++) {
    view.rerender({ scope: 'https://second.example', revision: String(i + 2) });
    expect(view.result.current.counts).toBeUndefined();
    await request.finish(i + 2, '99', identities[i]);
    await waitFor(() => expect(view.result.current.status).toBe('error'));
  }
});
it('marks a stalled fetch unavailable at eight seconds and ignores its late completion', async () => {
  vi.useFakeTimers();
  const request = deferredFetch();
  const view = renderHook(() =>
    useRoomOccupancy(true, 'member', 'it-closet', '1', backend),
  );
  await act(async () => vi.advanceTimersByTimeAsync(8000));
  expect(view.result.current.status).toBe('error');
  expect(view.result.current.counts).toBeUndefined();
  expect(request.requests[0].signal.aborted).toBe(true);
  await request.finish(0, '31');
  expect(view.result.current.status).toBe('error');
});
it('keeps cleanup abort quiet and cancels its deadline', async () => {
  vi.useFakeTimers();
  const request = deferredFetch();
  const view = renderHook(
    ({ enabled }) =>
      useRoomOccupancy(enabled, 'member', 'it-closet', '1', backend),
    { initialProps: { enabled: true } },
  );
  view.rerender({ enabled: false });
  await act(async () => vi.advanceTimersByTimeAsync(8000));
  expect(view.result.current.status).toBe('off');
  expect(request.requests[0].signal.aborted).toBe(true);
});
