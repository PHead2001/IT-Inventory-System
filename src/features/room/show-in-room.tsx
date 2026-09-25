import Link from 'next/link';
import { roomHref } from './navigation';
import { buildRoomBindings } from './bindings';
import { loadItCloset } from './load';

const room = loadItCloset();
const modeledCodes = new Set([
  room.locationCode,
  ...buildRoomBindings(room).map((binding) => binding.code),
]);

export function ShowInRoom({ code }: { code: string }) {
  if (!modeledCodes.has(code))
    return (
      <span className="text-xs text-slate-400">
        No room model for this location
      </span>
    );
  return (
    <Link
      className="inline-flex min-h-11 items-center py-2 text-sm text-cyan-300 underline"
      href={roomHref(code)}
      aria-label={'Show ' + code + ' in room'}
    >
      Show in room
    </Link>
  );
}
