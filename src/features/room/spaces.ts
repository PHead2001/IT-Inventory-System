import type { LocationRef } from '../inventory/contracts-ui';
import { z } from 'zod';
import registry from '../../../data/rooms/spaces.json';
import { loadItCloset } from './load';
import type { RoomDefinition } from './schema';

const geometryLoaders: Record<string, () => RoomDefinition> = {
  'it-closet': loadItCloset,
};

const spaceSchema = z
  .object({
    id: z.string().min(1),
    rootCode: z.string().regex(/^[A-Z][A-Z0-9-]*$/),
    name: z.string().min(1),
    kind: z.enum(['modeled', 'inventory']),
    geometryId: z.string().min(1).nullable(),
  })
  .superRefine((space, context) => {
    if ((space.kind === 'modeled') !== (space.geometryId !== null))
      context.addIssue({
        code: 'custom',
        message: 'Modeled spaces require a geometry definition.',
      });
  });
const parsed = z
  .object({
    schemaVersion: z.literal(1),
    defaultSpaceId: z.string(),
    spaces: z.array(spaceSchema).min(1),
  })
  .parse(registry);
if (
  !parsed.spaces.some((space) => space.id === parsed.defaultSpaceId) ||
  new Set(parsed.spaces.map((space) => space.id)).size !==
    parsed.spaces.length ||
  new Set(parsed.spaces.map((space) => space.rootCode)).size !==
    parsed.spaces.length ||
  parsed.spaces.some(
    (space) => space.geometryId && !geometryLoaders[space.geometryId],
  )
)
  throw new Error('Invalid room spaces registry.');
export const spaces = parsed.spaces;
export type Space = (typeof spaces)[number];
export const defaultSpaceId = parsed.defaultSpaceId;

export function availableSpaces(locations: LocationRef[]) {
  return spaces.flatMap((space) => {
    const location = locations.find(
      (entry) => entry.code === space.rootCode && entry.active,
    );
    return location ? [{ ...space, name: location.name }] : [];
  });
}

export function containingSpace(locations: LocationRef[], code: string | null) {
  const byId = new Map(locations.map((location) => [location.id, location]));
  let location = locations.find((entry) => entry.code === code);
  const seen = new Set<string>();
  while (location && !seen.has(location.id)) {
    const space = spaces.find((entry) => entry.rootCode === location?.code);
    if (space) return { ...space, name: location.name };
    seen.add(location.id);
    location = location.parentId ? byId.get(location.parentId) : undefined;
  }
  return null;
}

export function resolveSpace(
  locations: LocationRef[],
  requested: string | null,
  selectedCode: string | null,
) {
  const available = availableSpaces(locations);
  return (
    available.find((space) => space.id === requested) ??
    available.find(
      (space) => space.id === containingSpace(locations, selectedCode)?.id,
    ) ??
    available.find((space) => space.id === defaultSpaceId) ??
    available[0] ??
    null
  );
}

export function spaceLocations(locations: LocationRef[], space: Space) {
  return locations.filter(
    (location) => containingSpace(locations, location.code)?.id === space.id,
  );
}

export function spaceRoom(space: Space) {
  return space.geometryId ? geometryLoaders[space.geometryId]() : null;
}
