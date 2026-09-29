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
      <p className="experience-eyebrow">Locations / Spatial inventory</p>
      <h1 className="experience-heading mt-3">Spaces &amp; maps</h1>
      <p className="experience-muted mt-3 max-w-2xl text-sm leading-6">
        Find inventory by physical location. Explore the measured IT Closet map
        or browse logical locations in spaces without a map.
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
