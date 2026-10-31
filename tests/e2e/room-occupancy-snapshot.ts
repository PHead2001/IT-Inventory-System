import { z } from 'zod';
import type { Page } from '@playwright/test';
import { roomContentsFilter } from '../../src/features/room/contents-contract';
import { locationOccupancySchema } from '../../src/features/room/occupancy-contract';

const snapshotSchema = z.strictObject({
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

/** Oracle for the response the committed render actually adopted. */
export function roomAdoptedOccupancy(input: {
  requestUrl: string;
  response: unknown;
  origin: string;
  spaceId: string;
  acceptedGeneration: string;
  previousGeneration: string | null;
}) {
  const url = new URL(input.requestUrl);
  const generation = z.uuid().parse(url.searchParams.get('generation'));
  const snapshot = snapshotSchema.parse(input.response);
  if (
    url.origin !== input.origin ||
    url.pathname !== '/api/room/occupancy' ||
    url.searchParams.getAll('generation').length !== 1 ||
    url.searchParams.getAll('space').length !== 1 ||
    url.searchParams.get('space') !== input.spaceId ||
    generation === input.previousGeneration ||
    generation !== input.acceptedGeneration ||
    snapshot.identity.generation !== generation ||
    snapshot.identity.spaceId !== input.spaceId ||
    snapshot.identity.environment !== input.origin
  )
    throw new Error('Room occupancy did not match this selection request.');
  return { generation, counts: snapshot.counts };
}

export function roomSelectionOccupancy(
  input: Parameters<typeof roomAdoptedOccupancy>[0] & { code: string },
) {
  const snapshot = roomAdoptedOccupancy(input);
  if (!Object.hasOwn(snapshot.counts, input.code))
    throw new Error('Room occupancy did not contain the selected code.');
  return {
    generation: snapshot.generation,
    counts: snapshot.counts[input.code],
  };
}

type OccupancyResponse = {
  ok(): boolean;
  url(): string;
  request(): { url(): string };
  headers(): Record<string, string>;
  json(): Promise<unknown>;
};
type Captured =
  | {
      kind: 'readable';
      requestUrl: string;
      response: unknown;
      cacheControl: string | null;
    }
  | { kind: 'unavailable' };
export const MAX_ROOM_OCCUPANCY_RESPONSES = 128;

/** Begin body consumption at the response event, before selection can retire it.
 * Unreadable retired responses are recorded, never substituted for adopted ones. */
export function createRoomOccupancyCapture(origin: string, spaceId: string) {
  const captures = new Map<string, Promise<Captured>>();
  const duplicates = new Set<string>();
  let overflow = false,
    disposed = false;
  function observe(response: OccupancyResponse) {
    if (disposed || !response.ok()) return;
    let url: URL;
    try {
      url = new URL(response.url());
    } catch {
      return;
    }
    const generation = url.searchParams.get('generation');
    if (
      url.origin !== origin ||
      url.pathname !== '/api/room/occupancy' ||
      url.searchParams.getAll('space').length !== 1 ||
      url.searchParams.get('space') !== spaceId ||
      url.searchParams.getAll('generation').length !== 1 ||
      !z.uuid().safeParse(generation).success
    )
      return;
    if (captures.has(generation!)) {
      duplicates.add(generation!);
      return;
    }
    if (captures.size >= MAX_ROOM_OCCUPANCY_RESPONSES) {
      overflow = true;
      return;
    }
    const requestUrl = response.request().url();
    const cacheControl = response.headers()['cache-control'] ?? null;
    let captured: Promise<Captured>;
    try {
      // Calling json now is intentional; moving it into read() recreates the CI failure.
      captured = response.json().then(
        (payload): Captured => ({
          kind: 'readable',
          requestUrl,
          response: payload,
          cacheControl,
        }),
        (): Captured => ({ kind: 'unavailable' }),
      );
    } catch {
      captured = Promise.resolve({ kind: 'unavailable' });
    }
    captures.set(generation!, captured);
  }
  return {
    observe,
    async read(generation: string) {
      if (disposed || overflow || duplicates.has(generation))
        throw new Error(
          'Room occupancy capture is disposed, bounded out or ambiguous.',
        );
      const captured = captures.get(z.uuid().parse(generation));
      if (!captured)
        throw new Error(
          'No captured response for the adopted room generation.',
        );
      const outcome = await captured;
      if (disposed || overflow || duplicates.has(generation))
        throw new Error(
          'Room occupancy capture is disposed, bounded out or ambiguous.',
        );
      if (outcome.kind !== 'readable')
        throw new Error('Adopted room occupancy response is unreadable.');
      return outcome;
    },
    dispose() {
      disposed = true;
      captures.clear();
      duplicates.clear();
    },
  };
}
export type RoomOccupancyCapture = ReturnType<
  typeof createRoomOccupancyCapture
>;

export function observeRoomOccupancy(
  page: Page,
  origin: string,
  spaceId: string,
) {
  const capture = createRoomOccupancyCapture(origin, spaceId);
  const dispose = () => {
    page.off('response', capture.observe);
    page.off('close', dispose);
    capture.dispose();
  };
  page.on('response', capture.observe);
  page.once('close', dispose);
  return { ...capture, dispose };
}
export type RoomOccupancyCommit = {
  code: string;
  status: string;
  generation: string;
};

/** Reacquire only when a legitimate refresh invalidates the observation window.
 * No body/identity/assertion error is caught or replaced with another payload. */
export async function readCommittedRoomOccupancy<T>(input: {
  capture: RoomOccupancyCapture;
  origin: string;
  spaceId: string;
  code?: string;
  previousGeneration: string | null;
  readCommit(): Promise<RoomOccupancyCommit>;
  observe(
    counts: ReturnType<typeof roomAdoptedOccupancy>['counts'],
  ): Promise<T>;
}) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const before = await input.readCommit();
    if (
      before.status !== 'ready' ||
      (input.code !== undefined && before.code !== input.code)
    )
      throw new Error('Room occupancy is not adopted by the selected render.');
    const captured = await input.capture.read(before.generation);
    const snapshot = roomAdoptedOccupancy({
      ...captured,
      origin: input.origin,
      spaceId: input.spaceId,
      acceptedGeneration: before.generation,
      previousGeneration: input.previousGeneration,
    });
    if (input.code !== undefined && !Object.hasOwn(snapshot.counts, input.code))
      throw new Error('Room occupancy did not contain the selected code.');
    const observation = await input.observe(snapshot.counts);
    const after = await input.readCommit();
    if (
      after.status !== 'ready' ||
      after.generation !== before.generation ||
      after.code !== before.code
    )
      continue;
    return { ...snapshot, observation, cacheControl: captured.cacheControl };
  }
  throw new Error(
    'Room occupancy changed across every bounded observation window.',
  );
}
