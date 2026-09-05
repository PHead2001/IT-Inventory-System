import Link from 'next/link';
import { requireMember } from '@/lib/auth/session.server';
import { loadItCloset } from '@/features/room/load';
import { RoomWorkspace } from '@/features/room/room-workspace';
import { parseRoomLocation } from '@/features/room/navigation';
import {
  getLocations,
  getInventory,
} from '@/features/inventory/queries.server';
import {
  InventoryRows,
  Pagination,
} from '@/features/inventory/components/read-ui';

export default async function RoomPage({
  searchParams,
}: {
  searchParams: Promise<{ location?: string | string[]; page?: string }>;
}) {
  await requireMember();
  const params = await searchParams;
  const selectedCode = parseRoomLocation(params.location);
  const locations = await getLocations();
  const selected = locations.find((location) => location.code === selectedCode);
  const result = selected
    ? await getInventory({ location: selected.code, page: params.page })
    : null;
  return (
    <>
      <p className="text-xs font-semibold uppercase tracking-widest text-cyan-300">
        IT Closet
      </p>
      <h1 className="mt-3 text-3xl font-semibold">Room navigation</h1>
      <p className="mt-3 max-w-2xl text-slate-400">
        Find stock by its physical location. Select storage in the room or use
        the location picker.
      </p>
      <RoomWorkspace
        room={loadItCloset()}
        locations={locations}
        selectedCode={selectedCode}
      >
        {selected && result ? (
          <>
            <h2 className="text-xl font-semibold">
              {selected.name} ({selected.code})
            </h2>
            <p className="break-words text-sm text-slate-400">
              {selected.breadcrumb}
              {!selected.can_hold_inventory
                ? ' · Includes inventory in descendant locations'
                : ''}
            </p>
            <Link
              className="inline-flex min-h-11 items-center text-cyan-300 underline"
              href={'/locations/' + encodeURIComponent(selected.code)}
            >
              Location details and history
            </Link>
            <InventoryRows rows={result.rows} />
            <Pagination
              result={result}
              base="/room"
              params={{ location: selected.code }}
            />
          </>
        ) : (
          <p className="text-slate-400">
            {params.location
              ? 'This location could not be found. Choose an available location or browse inventory.'
              : 'Choose a location to view its inventory.'}
          </p>
        )}
      </RoomWorkspace>
    </>
  );
}
