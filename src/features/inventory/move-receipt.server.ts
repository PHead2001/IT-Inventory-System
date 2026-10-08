import 'server-only';
import { z } from 'zod';
import type { createSupabaseServerClient } from '@/lib/supabase/server';
import type { MoveReceipt } from './contracts';

const line = z
  .object({
    location_id: z.uuid(),
    delta: z
      .number()
      .int()
      .min(-2147483647)
      .max(2147483647)
      .refine((n) => n !== 0),
    before_quantity: z.number().int().min(0).max(2147483647),
    after_quantity: z.number().int().min(0).max(2147483647),
  })
  .refine((l) => l.before_quantity + l.delta === l.after_quantity);
const event = z.object({
  id: z.uuid(),
  entity_id: z.uuid(),
  kind: z.literal('quantity'),
  event_type: z.literal('moved'),
  entity_name: z.string().min(1),
  created_at: z.iso.datetime({ offset: true }),
  lines: z.array(line).length(2),
});
type Client = Awaited<ReturnType<typeof createSupabaseServerClient>>;

// This invoker view exposes immutable event lines under the current caller's RLS.
export async function readMoveReceipt(
  supabase: Client,
  entityId: string,
  eventId: string,
): Promise<MoveReceipt> {
  const { data, error } = await supabase
    .from('inventory_history_rows')
    .select('id,entity_id,kind,event_type,entity_name,created_at,lines')
    .eq('id', eventId)
    .eq('entity_id', entityId)
    .eq('kind', 'quantity')
    .eq('event_type', 'moved')
    .maybeSingle();
  if (error || !data) throw new Error('Move receipt unavailable.');
  const parsed = event.parse(data);
  if (parsed.id !== eventId || parsed.entity_id !== entityId)
    throw new Error('Move receipt mismatch.');
  const source = parsed.lines.find((l) => l.delta < 0);
  const destination = parsed.lines.find((l) => l.delta > 0);
  if (
    !source ||
    !destination ||
    source.location_id === destination.location_id ||
    source.delta + destination.delta !== 0
  )
    throw new Error('Move receipt invalid.');
  const names = await supabase
    .from('inventory_locations')
    .select('id,name')
    .in('id', [source.location_id, destination.location_id]);
  if (names.error) throw new Error('Move locations unavailable.');
  const locations = z
    .array(z.object({ id: z.uuid(), name: z.string().min(1) }))
    .length(2)
    .parse(names.data);
  const sourceName = locations.find((l) => l.id === source.location_id)?.name;
  const destinationName = locations.find(
    (l) => l.id === destination.location_id,
  )?.name;
  if (!sourceName || !destinationName)
    throw new Error('Move locations unavailable.');
  return {
    createdAt: parsed.created_at,
    itemName: parsed.entity_name,
    quantity: destination.delta,
    source: {
      id: source.location_id,
      name: sourceName,
      after: source.after_quantity,
    },
    destination: {
      id: destination.location_id,
      name: destinationName,
      after: destination.after_quantity,
    },
  };
}
