import 'server-only';
import { z } from 'zod';
import { requireMember } from '@/lib/auth/session.server';
import { getCategories, getLocations } from './queries.server';
import { historyRow, mapHistory } from './read-model';

export async function getHistoryEvent(kind: string, eventId: string) {
  const { supabase } = await requireMember();
  if (
    !z.enum(['quantity', 'asset']).safeParse(kind).success ||
    !z.uuid().safeParse(eventId).success
  )
    return null;
  const canonicalEventId = eventId.toLowerCase();
  // Exact immutable event identity, independent of newer inserts or pagination.
  // This is the same caller-invoker view used by committed move receipts.
  const { data, error } = await supabase
    .from('inventory_history_rows')
    .select(
      'id,kind,entity_id,entity_name,event_type,created_at,actor_name,reason,before_metadata,after_metadata,custom_present,custom_changed,assignment_event_id,assignment_kind,assignment_from_location_id,assignment_to_location_id,assignment_from_site_id,assignment_to_site_id,assignment_from_label,assignment_to_label,assignment_quantity,assignment_reference,from_location_id,to_location_id,lines',
    )
    .eq('kind', kind)
    .eq('id', canonicalEventId)
    .limit(2)
    .maybeSingle();
  if (error) throw new Error('History event could not be loaded.');
  if (!data) return null;
  const event = historyRow.parse(data);
  if (event.id !== canonicalEventId || event.kind !== kind)
    throw new Error('History event identity could not be verified.');
  const [locations, categories] = await Promise.all([
    getLocations(),
    getCategories(),
  ]);
  return mapHistory(event, locations, categories);
}
