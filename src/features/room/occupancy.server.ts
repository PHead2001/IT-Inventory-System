import 'server-only';
import { z } from 'zod';
import { requireMember } from '@/lib/auth/session.server';
import {
  locationOccupancySchema,
  type RoomOccupancy,
} from './occupancy-contract';

const countRows = z
  .array(
    z.strictObject({
      location_code: z.string().min(1).max(100),
      entry_count: z.string().regex(/^(0|[1-9][0-9]*)$/),
    }),
  )
  .max(100);

type MemberContext = Awaited<ReturnType<typeof requireMember>>;
function validateLocationCodes(locationCodes: string[]) {
  const requested = new Set(locationCodes);
  if (
    requested.size !== locationCodes.length ||
    locationCodes.length > 100 ||
    locationCodes.some((code) => !code.length || code.length > 100) ||
    Buffer.byteLength(JSON.stringify(locationCodes), 'utf8') > 16384
  )
    throw new Error('Invalid location count request.');
  return requested;
}

/** Internal read using the handler's already authorized caller context. */
export async function readLocationEntryCounts(
  { supabase }: MemberContext,
  locationCodes: string[],
): Promise<Record<string, string>> {
  const requested = validateLocationCodes(locationCodes);
  const { data, error } = await supabase.rpc(
    'inventory_location_entry_counts',
    {
      p_location_codes: locationCodes,
    },
  );
  if (error || !data)
    throw new Error('Location item counts could not be loaded.');
  const rows = countRows.parse(data);
  const result: Record<string, string> = {};
  for (const row of rows) {
    if (
      !requested.has(row.location_code) ||
      Object.hasOwn(result, row.location_code)
    )
      throw new Error(
        'Location item counts did not match the requested locations.',
      );
    result[row.location_code] = row.entry_count;
  }
  return result;
}

/** One caller-scoped snapshot. Missing codes remain unknown, never zero.
 * Decimal strings preserve aggregate precision; format with BigInt at display.
 */
export async function getLocationEntryCounts(
  locationCodes: string[],
): Promise<Record<string, string>> {
  validateLocationCodes(locationCodes);
  return readLocationEntryCounts(await requireMember(), locationCodes);
}

/** Additive occupancy contract. The legacy active-entry read stays unchanged. */
export async function readLocationOccupancy(
  { supabase }: MemberContext,
  locationCodes: string[],
  signal?: AbortSignal,
): Promise<RoomOccupancy> {
  const requested = validateLocationCodes(locationCodes);
  if (signal?.aborted) throw new Error('Location count request cancelled.');
  const controller = new AbortController();
  let rejectDeadline!: (reason: Error) => void;
  const deadline = new Promise<never>((_, reject) => {
    rejectDeadline = reject;
  });
  const cancel = () => {
    controller.abort();
    rejectDeadline(new Error('Location count request cancelled.'));
  };
  const timer = setTimeout(() => {
    controller.abort();
    rejectDeadline(new Error('Location count request timed out.'));
  }, 5000);
  signal?.addEventListener('abort', cancel, { once: true });
  let response;
  try {
    response = await Promise.race([
      supabase
        .rpc('inventory_location_occupancy', {
          p_location_codes: locationCodes,
        })
        .abortSignal(controller.signal),
      deadline,
    ]);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', cancel);
  }
  const { data, error } = response;
  if (error || !data) throw new Error('Location counts could not be loaded.');
  const rows = z
    .array(
      locationOccupancySchema.extend({
        location_code: z.string().min(1).max(100),
      }),
    )
    .max(100)
    .parse(data);
  const result: RoomOccupancy = {};
  for (const { location_code, ...counts } of rows) {
    if (!requested.has(location_code) || Object.hasOwn(result, location_code))
      throw new Error('Location counts did not match the requested locations.');
    result[location_code] = counts;
  }
  return result;
}

export async function getLocationOccupancy(locationCodes: string[]) {
  validateLocationCodes(locationCodes);
  return readLocationOccupancy(await requireMember(), locationCodes);
}
