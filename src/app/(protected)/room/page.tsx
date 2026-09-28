import { requireMember } from '@/lib/auth/session.server';
import { getLocations } from '@/features/inventory/queries.server';
import { parseRoomLocation } from '@/features/room/navigation';
import {
  availableSpaces,
  resolveSpace,
  spaceLocations,
} from '@/features/room/spaces';
import { SpacesWorkspace } from '@/features/room/spaces-workspace';

export default async function RoomPage({
  searchParams,
}: {
  searchParams: Promise<{
    space?: string;
    location?: string | string[];
    page?: string;
  }>;
}) {
  const [{ member }, params, locations] = await Promise.all([
    requireMember(),
    searchParams,
    getLocations(),
  ]);
  const code = parseRoomLocation(params.location);
  const space = resolveSpace(locations, params.space ?? null, code);
  if (!space) return <p>No active spaces are available.</p>;
  const selectedCode = spaceLocations(locations, space).some(
    (location) => location.code === code,
  )
    ? code
    : null;
  const page = Number(params.page);
  const fallbackNotice =
    params.space &&
    !availableSpaces(locations).some((entry) => entry.id === params.space)
      ? 'The requested space is unavailable. Showing ' +
        space.name +
        ' instead.'
      : params.location && !selectedCode
        ? 'The requested location is unavailable in this space. Choose a location below.'
        : null;
  return (
    <>
      <p className="text-xs font-semibold uppercase tracking-widest text-cyan-300">
        Spatial inventory
      </p>
      <h1 className="mt-3 text-3xl font-semibold">Spaces &amp; maps</h1>
      <p className="mt-3 max-w-2xl text-slate-300">
        Explore the modeled IT Closet and inventory-only IT Office by physical
        location.
      </p>
      <SpacesWorkspace
        locations={locations}
        userId={member.user_id}
        initialSpace={space}
        initialCode={selectedCode}
        initialNotice={fallbackNotice}
        initialPage={
          Number.isSafeInteger(page) && page > 0 ? Math.min(page, 100000) : 1
        }
      />
    </>
  );
}
