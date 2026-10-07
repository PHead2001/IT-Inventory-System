import 'server-only';
import { z } from 'zod';
import type { createSupabaseServerClient } from '@/lib/supabase/server';
import type { CustodyReceipt } from './contracts';

const id = z.uuid();
const count = z.number().int().min(0).max(2147483647);
const event = z.object({
  quantity_event_id: id.nullable(),
  asset_event_id: id.nullable(),
  item_id: id.nullable(),
  asset_id: id.nullable(),
  kind: z.string(),
  actor_name: z.string(),
  created_at: z.string(),
  from_location_id: id.nullable(),
  to_location_id: id.nullable(),
  from_site_id: id.nullable(),
  to_site_id: id.nullable(),
  from_label: z.string().nullable(),
  to_label: z.string().nullable(),
  quantity: count.positive().nullable(),
  reference: z.string().nullable(),
  reason: z.string().nullable(),
});
const line = z
  .object({
    before_quantity: count,
    after_quantity: count,
    delta: z.number().int(),
  })
  .refine((row) => row.before_quantity + row.delta === row.after_quantity);
type Client = Awaited<ReturnType<typeof createSupabaseServerClient>>;

// Exact immutable event and lines, under the current caller's RLS. Never read
// current balances to reconstruct the result of a previously committed request.
export async function readCustodyReceipt(
  client: Client,
  kind: 'quantity' | 'asset',
  entityId: string,
  eventId: string,
): Promise<CustodyReceipt> {
  id.parse(entityId);
  id.parse(eventId);
  const result = await client
    .from('assignment_events')
    .select(
      'quantity_event_id,asset_event_id,item_id,asset_id,kind,actor_name,created_at,from_location_id,to_location_id,from_site_id,to_site_id,from_label,to_label,quantity,reference,reason',
    )
    .eq(kind === 'quantity' ? 'quantity_event_id' : 'asset_event_id', eventId)
    .eq(kind === 'quantity' ? 'item_id' : 'asset_id', entityId)
    .maybeSingle();
  if (result.error || !result.data)
    throw new Error('Custody receipt unavailable.');
  const row = event.parse(result.data);
  if (
    (kind === 'quantity' ? row.quantity_event_id : row.asset_event_id) !==
      eventId ||
    (kind === 'quantity' ? row.item_id : row.asset_id) !== entityId
  )
    throw new Error('Custody receipt mismatch.');
  const endpoint = (
    locationId: string | null,
    siteId: string | null,
    name: string | null,
  ) => {
    if (!locationId && !siteId) return null;
    if ((locationId && siteId) || !name)
      throw new Error('Custody endpoint unavailable.');
    return {
      id: (locationId ?? siteId)!,
      kind: locationId ? ('storage' as const) : ('site' as const),
      name,
    };
  };
  const source = endpoint(
    row.from_location_id,
    row.from_site_id,
    row.from_label,
  );
  const destination = endpoint(
    row.to_location_id,
    row.to_site_id,
    row.to_label,
  );
  const receipt: CustodyReceipt = {
    eventId,
    operation: row.kind,
    actorName: row.actor_name,
    createdAt: row.created_at,
    quantity: row.quantity,
    source,
    destination,
    reference: row.reference,
    reason: row.reason,
  };
  if (kind === 'quantity') {
    const endpoints = [source, destination].filter((value) => value !== null);
    await Promise.all(
      endpoints.map(async (value) => {
        const query =
          value.kind === 'storage'
            ? client
                .from('quantity_event_lines')
                .select('before_quantity,after_quantity,delta')
                .eq('event_id', eventId)
                .eq('location_id', value.id)
            : client
                .from('site_quantity_event_lines')
                .select('before_quantity,after_quantity,delta')
                .eq('event_id', eventId)
                .eq('site_id', value.id);
        const balance = await query.maybeSingle();
        if (balance.error || !balance.data)
          throw new Error('Custody balance unavailable.');
        const snapshot = line.parse(balance.data);
        Object.assign(value, {
          before: snapshot.before_quantity,
          delta: snapshot.delta,
          after: snapshot.after_quantity,
        });
      }),
    );
  }
  return receipt;
}
