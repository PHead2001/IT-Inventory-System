import 'server-only';
import { z } from 'zod';
import { requireMember } from '@/lib/auth/session.server';

const countRows = z
  .array(
    z.strictObject({
      location_code: z.string().min(1).max(100),
      entry_count: z.string().regex(/^(0|[1-9][0-9]*)$/),
    }),
  )
  .max(100);

/** One caller-scoped snapshot. Missing codes remain unknown, never zero.
 * Decimal strings preserve aggregate precision; format with BigInt at display.
 */
export async function getLocationEntryCounts(
  locationCodes: string[],
): Promise<Record<string, string>> {
  const requested = new Set(locationCodes);
  if (
    requested.size !== locationCodes.length ||
    locationCodes.length > 100 ||
    locationCodes.some((code) => !code.length || code.length > 100) ||
    Buffer.byteLength(JSON.stringify(locationCodes), 'utf8') > 16384
  )
    throw new Error('Invalid location count request.');
  const { supabase } = await requireMember();
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
