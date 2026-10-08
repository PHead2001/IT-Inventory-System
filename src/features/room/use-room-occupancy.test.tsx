import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useRoomOccupancy } from './use-room-occupancy';

function response(counts: Record<string, string>, userId = 'member') {
  return {
    ok: true,
    headers: new Headers({ 'content-type': 'application/json' }),
    json: async () => ({
      identity: {
        userId,
        environment: window.location.origin,
        spaceId: 'it-closet',
        filter: 'type=all;status=active',
      },
      counts,
    }),
  };
}
afterEach(() => vi.unstubAllGlobals());

it('is off by default, uses one private snapshot and preserves unknown and exact counts', async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValue(
      response({ 'ITC-D01': '9007199254740993', 'ITC-D02': '0' }),
    );
  vi.stubGlobal('fetch', fetcher);
  const view = renderHook(
    ({ enabled }) => useRoomOccupancy(enabled, 'member', 'it-closet', '1'),
    { initialProps: { enabled: false } },
  );
  expect(fetcher).not.toHaveBeenCalled();
  view.rerender({ enabled: true });
  expect(view.result.current.counts).toBeUndefined();
  await waitFor(() => expect(view.result.current.status).toBe('ready'));
  expect(view.result.current.counts).toEqual({
    'ITC-D01': '9007199254740993',
    'ITC-D02': '0',
  });
  expect(fetcher).toHaveBeenCalledOnce();
  expect(fetcher).toHaveBeenCalledWith(
    '/api/room/occupancy?space=it-closet',
    expect.objectContaining({ cache: 'no-store', credentials: 'same-origin' }),
  );
});

it('drops old counts during refresh and rejects stale completion, identity mismatch and failed refresh', async () => {
  let resolveOld!: (value: ReturnType<typeof response>) => void;
  const fetcher = vi
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveOld = resolve;
        }),
    )
    .mockResolvedValueOnce(response({ 'ITC-D01': '2' }))
    .mockResolvedValueOnce(response({ 'ITC-D01': '99' }, 'other-member'))
    .mockRejectedValueOnce(new Error('offline'));
  vi.stubGlobal('fetch', fetcher);
  const view = renderHook(
    ({ revision }) => useRoomOccupancy(true, 'member', 'it-closet', revision),
    { initialProps: { revision: '1' } },
  );
  view.rerender({ revision: '2' });
  await waitFor(() =>
    expect(view.result.current.counts?.['ITC-D01']).toBe('2'),
  );
  await act(async () => resolveOld(response({ 'ITC-D01': '1' })));
  expect(view.result.current.counts?.['ITC-D01']).toBe('2');
  expect(fetcher.mock.calls[0][1].signal.aborted).toBe(true);
  view.rerender({ revision: '3' });
  expect(view.result.current.counts).toBeUndefined();
  await waitFor(() => expect(view.result.current.status).toBe('error'));
  view.rerender({ revision: '4' });
  await waitFor(() => expect(view.result.current.status).toBe('error'));
  expect(view.result.current.counts).toBeUndefined();
});
