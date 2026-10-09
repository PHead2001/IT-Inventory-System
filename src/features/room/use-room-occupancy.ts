'use client';
import { useEffect, useState } from 'react';
import { z } from 'zod';
import { roomContentsFilter } from './contents-contract';

const snapshot = z.strictObject({
  identity: z.strictObject({
    userId: z.string(),
    environment: z.string(),
    spaceId: z.string(),
    filter: z.literal(roomContentsFilter),
  }),
  counts: z
    .record(z.string(), z.string().regex(/^(0|[1-9][0-9]*)$/))
    .refine((counts) => Object.keys(counts).length <= 100),
});

/** Component-owned, uncached snapshot; old counts disappear during every refresh. */
export function useRoomOccupancy(
  enabled: boolean,
  userId: string,
  spaceId: string,
  refreshKey: string,
) {
  const key = JSON.stringify([enabled, userId, spaceId, refreshKey]);
  const [state, setState] = useState<{
    key: string;
    counts?: Record<string, string>;
    error?: boolean;
  } | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    const controller = new AbortController();
    fetch('/api/room/occupancy?' + new URLSearchParams({ space: spaceId }), {
      cache: 'no-store',
      credentials: 'same-origin',
      signal: controller.signal,
    })
      .then(async (response) => {
        if (
          !response.ok ||
          !response.headers.get('content-type')?.includes('application/json')
        )
          throw new Error('Counts unavailable');
        const data = snapshot.parse(await response.json());
        if (
          data.identity.userId !== userId ||
          data.identity.spaceId !== spaceId ||
          data.identity.environment !== window.location.origin
        )
          throw new Error('Counts identity mismatch');
        if (active) setState({ key, counts: data.counts });
      })
      .catch(() => {
        if (active && !controller.signal.aborted)
          setState({ key, error: true });
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [enabled, userId, spaceId, key]);
  return {
    counts: enabled && state?.key === key ? state.counts : undefined,
    status: !enabled
      ? 'off'
      : state?.key !== key
        ? 'loading'
        : state.error
          ? 'error'
          : 'ready',
  };
}
