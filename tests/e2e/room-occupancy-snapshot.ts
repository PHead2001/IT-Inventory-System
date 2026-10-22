import { z } from 'zod';
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
  counts: z.record(z.string(), locationOccupancySchema),
});

/** Oracle for the response the selected committed render actually adopted. */
export function roomSelectionOccupancy(input: {
  requestUrl: string;
  response: unknown;
  origin: string;
  spaceId: string;
  code: string;
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
    snapshot.identity.environment !== input.origin ||
    !Object.hasOwn(snapshot.counts, input.code)
  )
    throw new Error('Room occupancy did not match this selection request.');
  return { generation, counts: snapshot.counts[input.code] };
}
