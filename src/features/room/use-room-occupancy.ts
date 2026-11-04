'use client';
import { useEffect, useState } from 'react';
import { z } from 'zod';
import type { usePrivacyReadiness } from '@/components/auth/privacy-readiness';
import { freshPresentationGrant } from '@/components/experience/presentation-privacy';
import {
  subscribeAssignmentInvalidation,
  subscribePrivacyRevocation,
} from '@/features/scan/assign-batch';
import { roomContentsFilter } from './contents-contract';
import {
  locationOccupancySchema,
  type RoomOccupancy,
} from './occupancy-contract';

const snapshot = z.strictObject({
  identity: z.strictObject({
    userId: z.string(),
    environment: z.string(),
    backend: z.string(),
    generation: z.uuid(),
    spaceId: z.string(),
    filter: z.literal(roomContentsFilter),
  }),
  counts: z
    .record(z.string(), locationOccupancySchema)
    .refine((counts) => Object.keys(counts).length <= 100),
});

/** Each transition owns a fresh request, even when a previous scope returns. */
export function useRoomOccupancy(
  enabled: boolean,
  userId: string,
  spaceId: string,
  refreshKey: string,
  backend: string,
  privacy?: ReturnType<typeof usePrivacyReadiness>,
) {
  const effectiveEnabled =
    enabled && (!privacy || freshPresentationGrant(privacy));
  const environment =
    typeof window === 'undefined' ? '' : window.location.origin;
  const key = JSON.stringify([
    effectiveEnabled,
    userId,
    environment,
    backend,
    spaceId,
    refreshKey,
    privacy?.generation,
    privacy?.revocationRevision,
    privacy?.verifiedEpoch,
  ]);
  const [attempt, setAttempt] = useState(() => ({
    key,
    generation: crypto.randomUUID(),
  }));
  const [state, setState] = useState<{
    generation: string;
    counts?: RoomOccupancy;
    error?: boolean;
  } | null>(null);
  // Adjusting this component's own state during render prevents an old snapshot
  // appearing for even one committed paint when A -> B -> A or off -> on.
  if (attempt.key !== key) setAttempt({ key, generation: crypto.randomUUID() });
  useEffect(() => {
    if (!effectiveEnabled || attempt.key !== key) return;
    let active = true;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      if (!active || (privacy && !freshPresentationGrant(privacy))) return;
      active = false;
      controller.abort();
      setState({ generation: attempt.generation, error: true });
    }, 8000);
    const retire = () => {
      active = false;
      clearTimeout(timer);
      controller.abort();
    };
    const unsubscribe = privacy
      ? [
          subscribePrivacyRevocation(retire),
          subscribeAssignmentInvalidation(retire),
        ]
      : [];
    fetch(
      '/api/room/occupancy?' +
        new URLSearchParams({ space: spaceId, generation: attempt.generation }),
      {
        cache: 'no-store',
        credentials: 'same-origin',
        signal: controller.signal,
      },
    )
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
          data.identity.environment !== window.location.origin ||
          data.identity.backend !== backend ||
          data.identity.generation !== attempt.generation
        )
          throw new Error('Counts identity mismatch');
        if (active && (!privacy || freshPresentationGrant(privacy)))
          setState({ generation: attempt.generation, counts: data.counts });
      })
      .catch(() => {
        if (active && (!privacy || freshPresentationGrant(privacy)))
          setState({ generation: attempt.generation, error: true });
      })
      .finally(() => clearTimeout(timer));
    return () => {
      unsubscribe.forEach((remove) => remove());
      retire();
    };
  }, [effectiveEnabled, userId, spaceId, backend, key, attempt, privacy]);
  const current =
    attempt.key === key && state?.generation === attempt.generation
      ? state
      : null;
  return {
    counts: effectiveEnabled ? current?.counts : undefined,
    // Diagnostic identity for successful counts adopted by this render. An
    // in-flight attempt, retired key or failed response is never accepted.
    acceptedGeneration:
      effectiveEnabled && current?.counts && !current.error
        ? current.generation
        : null,
    status: !effectiveEnabled
      ? 'off'
      : !current
        ? 'loading'
        : current.error
          ? 'error'
          : 'ready',
  };
}
