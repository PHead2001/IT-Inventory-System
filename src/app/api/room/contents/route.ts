import { NextRequest, NextResponse } from 'next/server';
import { createInventoryReadScope } from '@/features/inventory/queries.server';
import { parseRoomLocation } from '@/features/room/navigation';
import { resolveSpace, spaceLocations } from '@/features/room/spaces';
import { roomContentsFilter } from '@/features/room/contents-contract';

export const dynamic = 'force-dynamic';
export async function GET(request: NextRequest) {
  const scope = await createInventoryReadScope();
  const { member } = scope;
  const code = parseRoomLocation(
    request.nextUrl.searchParams.get('location') ?? undefined,
  );
  const locations = await scope.getLocations();
  const space = resolveSpace(
    locations,
    request.nextUrl.searchParams.get('space'),
    code,
  );
  if (!space || !code)
    return NextResponse.json(
      { error: 'Location unavailable' },
      { status: 404, headers: { 'Cache-Control': 'private, no-store' } },
    );
  if (
    !spaceLocations(locations, space).some((location) => location.code === code)
  )
    return NextResponse.json(
      { error: 'Location unavailable' },
      { status: 404, headers: { 'Cache-Control': 'private, no-store' } },
    );
  try {
    const result = await scope.getInventory({
      location: code,
      page: request.nextUrl.searchParams.get('page') ?? undefined,
    });
    return NextResponse.json(
      {
        identity: {
          userId: member.user_id,
          environment: request.nextUrl.origin,
          spaceId: space.id,
          locationCode: code,
          filter: roomContentsFilter,
          page: result.page,
        },
        result,
      },
      {
        headers: { 'Cache-Control': 'private, no-store' },
      },
    );
  } catch {
    return NextResponse.json(
      { error: 'Inventory could not be loaded.' },
      { status: 500, headers: { 'Cache-Control': 'private, no-store' } },
    );
  }
}
