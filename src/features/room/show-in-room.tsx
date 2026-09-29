import Link from 'next/link';
import { roomHref } from './navigation';
import { buildRoomBindings } from './bindings';
import { spaceRoom, spaces } from './spaces';
import type { LocationRef } from '../inventory/contracts-ui';

const modeledCodes = new Set(
  spaces.flatMap((space) => {
    const room = spaceRoom(space);
    return room
      ? [
          room.locationCode,
          ...buildRoomBindings(room).map((binding) => binding.code),
        ]
      : [];
  }),
);

export function ShowInRoom({
  location,
}: {
  location: Pick<LocationRef, 'code' | 'spaceRootCode'>;
}) {
  const { code } = location;
  const hasModel = modeledCodes.has(code);
  const knownSpace = spaces.some(
    (space) => space.rootCode === location.spaceRootCode,
  );
  if (!hasModel && !knownSpace)
    return (
      <span className="text-xs text-slate-400">
        No room model for this location
      </span>
    );
  return (
    <Link
      className="inline-flex min-h-11 items-center py-2 text-sm text-cyan-300 underline"
      href={roomHref(code)}
      aria-label={'Show ' + code + (hasModel ? ' in room' : ' in Spaces')}
    >
      {hasModel ? 'Show in room' : 'Open in Spaces'}
    </Link>
  );
}
