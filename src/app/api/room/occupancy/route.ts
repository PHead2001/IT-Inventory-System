import { NextRequest, NextResponse } from 'next/server';
import { createInventoryReadScope } from '@/features/inventory/queries.server';
import {
  availableSpaces,
  spaceRoom,
  spaceLocations,
} from '@/features/room/spaces';
import { buildRoomBindings } from '@/features/room/bindings';
import { roomContentsFilter } from '@/features/room/contents-contract';
import { supabaseConfig } from '@/lib/supabase/config';
import { z } from 'zod';

export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'private, no-store' };
export async function GET(request: NextRequest) {
  const scope = await createInventoryReadScope();
  const generation = z
    .uuid()
    .safeParse(request.nextUrl.searchParams.get('generation'));
  if (!generation.success)
    return NextResponse.json(
      { error: 'Invalid count request.' },
      { status: 400, headers },
    );
  const locations = await scope.getLocations();
  const space = availableSpaces(locations).find(
    (entry) => entry.id === request.nextUrl.searchParams.get('space'),
  );
  const room = space ? spaceRoom(space) : null;
  if (!space || !room)
    return NextResponse.json(
      { error: 'Map unavailable.' },
      { status: 404, headers },
    );
  const modeled = new Set(
    buildRoomBindings(room).map((binding) => binding.code),
  );
  const codes = spaceLocations(locations, space)
    .filter(
      (entry) =>
        entry.active &&
        entry.can_hold_inventory &&
        modeled.has(entry.code) &&
        !locations.some((child) => child.parentId === entry.id),
    )
    .map((entry) => entry.code);
  try {
    const counts = await scope.getLocationOccupancy(codes, request.signal);
    return NextResponse.json(
      {
        identity: {
          userId: scope.member.user_id,
          environment: request.nextUrl.origin,
          backend: new URL(supabaseConfig().url).origin,
          generation: generation.data,
          spaceId: space.id,
          filter: roomContentsFilter,
        },
        counts,
      },
      { headers },
    );
  } catch {
    return NextResponse.json(
      { error: 'Item counts could not be loaded.' },
      { status: 500, headers },
    );
  }
}
