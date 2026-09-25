-- Keep the original inventory-history column prefix and caller-invoker RLS.
-- Assignment events have unique links to their operational events. Their
-- persisted endpoint labels record what was known when custody changed.
create or replace view public.inventory_history_rows with (security_invoker = true) as
select e.id, 'quantity'::text as kind, e.item_id as entity_id,
 i.name as entity_name, e.kind as event_type, e.created_at, e.actor_name, e.reason,
 case when e.before_metadata is null then null else e.before_metadata-'custom_values' end as before_metadata,
 case when e.after_metadata is null then null else e.after_metadata-'custom_values' end as after_metadata,
 null::uuid as from_location_id, null::uuid as to_location_id,
 coalesce((select jsonb_agg(jsonb_build_object(
   'location_id', x.location_id, 'delta', x.delta,
   'before_quantity', x.before_quantity, 'after_quantity', x.after_quantity
 ) order by x.location_id) from public.quantity_event_lines x where x.event_id = e.id), '[]'::jsonb) as lines,
 array(select v.location_id from (
   select x.location_id from public.quantity_event_lines x where x.event_id = e.id
   union select ae.from_location_id where ae.from_location_id is not null
   union select ae.to_location_id where ae.to_location_id is not null
 ) v order by v.location_id) as location_ids,
 (coalesce(e.before_metadata->'custom_values','{}'::jsonb)<>'{}'::jsonb or
   coalesce(e.after_metadata->'custom_values','{}'::jsonb)<>'{}'::jsonb) as custom_present,
 (coalesce(e.before_metadata->'custom_values','{}'::jsonb) is distinct from
   coalesce(e.after_metadata->'custom_values','{}'::jsonb)) as custom_changed,
 ae.id as assignment_event_id, ae.kind as assignment_kind,
 ae.from_location_id as assignment_from_location_id,
 ae.to_location_id as assignment_to_location_id,
 ae.from_site_id as assignment_from_site_id,
 ae.to_site_id as assignment_to_site_id,
 ae.from_label as assignment_from_label,
 ae.to_label as assignment_to_label,
 ae.quantity as assignment_quantity,
 ae.reference as assignment_reference
from public.quantity_events e join public.quantity_items i on i.id = e.item_id
left join public.assignment_events ae on ae.quantity_event_id = e.id
union all
select e.id, 'asset', e.asset_id, a.name, e.kind, e.created_at, e.actor_name, e.reason,
 case when e.before_metadata is null then null else e.before_metadata-'custom_values' end,
 case when e.after_metadata is null then null else e.after_metadata-'custom_values' end,
 case when e.kind='metadata_updated' then null::uuid else e.from_location_id end,
 case when e.kind='metadata_updated' then null::uuid else e.to_location_id end,
 '[]'::jsonb,
 case when e.kind='metadata_updated' then '{}'::uuid[] else
   array(select distinct v.location_id from unnest(array[
     e.from_location_id,e.to_location_id,ae.from_location_id,ae.to_location_id
   ]) v(location_id) where v.location_id is not null order by v.location_id) end,
 (coalesce(e.before_metadata->'custom_values','{}'::jsonb)<>'{}'::jsonb or
   coalesce(e.after_metadata->'custom_values','{}'::jsonb)<>'{}'::jsonb),
 (coalesce(e.before_metadata->'custom_values','{}'::jsonb) is distinct from
   coalesce(e.after_metadata->'custom_values','{}'::jsonb)),
 ae.id,ae.kind,ae.from_location_id,ae.to_location_id,
 ae.from_site_id,ae.to_site_id,ae.from_label,ae.to_label,ae.quantity,ae.reference
from public.asset_events e join public.serialized_assets a on a.id = e.asset_id
left join public.assignment_events ae on ae.asset_event_id = e.id;

revoke all on public.inventory_history_rows from public,anon,authenticated;
grant select on public.inventory_history_rows to authenticated,service_role;
