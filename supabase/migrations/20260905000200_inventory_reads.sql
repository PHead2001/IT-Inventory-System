-- Read models deliberately retain caller RLS; no privileged read bypass.
create view public.inventory_locations with (security_invoker = true) as
with recursive tree as (
 select l.*, l.name as breadcrumb, array[l.code] as ancestor_codes
 from public.locations l where l.parent_id is null
 union all
 select l.*, t.breadcrumb || ' / ' || l.name, t.ancestor_codes || l.code
 from public.locations l join tree t on l.parent_id = t.id
)
select * from tree;

create view public.inventory_search_rows with (security_invoker = true) as
select 'quantity'::text as kind, i.id as entity_id, i.name, i.description,
 i.manufacturer, i.model, i.category_id, c.name as category_name,
 case when i.archived then 'archived' else 'active' end as status,
 l.id as location_id, l.code as location_code, l.name as location_name,
 l.breadcrumb, l.ancestor_codes, b.quantity,
 null::text as asset_tag, null::text as serial_number
from public.quantity_items i join public.categories c on c.id = i.category_id
left join public.stock_balances b on b.item_id = i.id and b.quantity > 0
left join public.inventory_locations l on l.id = b.location_id
union all
select 'asset', a.id, a.name, a.description, a.manufacturer, a.model,
 a.category_id, c.name, a.status, l.id, l.code, l.name,
 l.breadcrumb, l.ancestor_codes, null::integer, a.asset_tag, a.serial_number
from public.serialized_assets a join public.categories c on c.id = a.category_id
join public.inventory_locations l on l.id = a.location_id;

create view public.inventory_history_rows with (security_invoker = true) as
select e.id, 'quantity'::text as kind, e.item_id as entity_id,
 i.name as entity_name, e.kind as event_type, e.created_at, e.actor_name, e.reason,
 e.before_metadata, e.after_metadata,
 null::uuid as from_location_id, null::uuid as to_location_id,
 coalesce((select jsonb_agg(jsonb_build_object(
   'location_id', x.location_id, 'delta', x.delta,
   'before_quantity', x.before_quantity, 'after_quantity', x.after_quantity
 ) order by x.location_id) from public.quantity_event_lines x where x.event_id = e.id), '[]'::jsonb) as lines,
 array(select x.location_id from public.quantity_event_lines x where x.event_id = e.id) as location_ids
from public.quantity_events e join public.quantity_items i on i.id = e.item_id
union all
select e.id, 'asset', e.asset_id, a.name, e.kind, e.created_at, e.actor_name, e.reason,
 e.before_metadata, e.after_metadata, e.from_location_id, e.to_location_id, '[]'::jsonb,
 array_remove(array[e.from_location_id, e.to_location_id], null)
from public.asset_events e join public.serialized_assets a on a.id = e.asset_id;

-- strpos treats percent/underscore/backslash as literal search characters.
create function public.inventory_search(
 p_query text default '', p_type text default 'all', p_status text default 'active',
 p_category_id uuid default null, p_location_code text default null,
 p_page integer default 1, p_page_size integer default 25
) returns jsonb language sql stable security invoker set search_path = '' as $$
 with matches as materialized (
  select r.* from public.inventory_search_rows r
  where (p_type = 'all' or r.kind = p_type)
   and (p_status = 'all' or (p_status = 'active' and r.status = 'active')
    or (p_status = 'historical' and r.status <> 'active'))
   and (p_category_id is null or r.category_id = p_category_id)
   and (p_location_code is null or p_location_code = any(r.ancestor_codes))
   and strpos(lower(concat_ws(' ', r.name, r.description, r.manufacturer, r.model,
    r.category_name, r.location_code, r.location_name, r.breadcrumb, r.asset_tag, r.serial_number)),
    lower(coalesce(p_query, ''))) > 0
 ), page as (
  select * from matches order by lower(name), kind, entity_id, coalesce(location_code, '')
  limit greatest(1, least(coalesce(p_page_size,25),100))
  offset (greatest(1, least(coalesce(p_page,1),100000))::bigint - 1)
    * greatest(1, least(coalesce(p_page_size,25),100))
 )
 select jsonb_build_object(
  'rows', coalesce((select jsonb_agg(to_jsonb(p) order by lower(p.name), p.kind, p.entity_id, coalesce(p.location_code, '')) from page p), '[]'::jsonb),
  'total', (select count(*) from matches));
$$;

create function public.inventory_history(
 p_type text default 'all', p_entity_id uuid default null,
 p_location_code text default null, p_page integer default 1, p_page_size integer default 25
) returns jsonb language sql stable security invoker set search_path = '' as $$
 with matches as materialized (
  select r.* from public.inventory_history_rows r
  where (p_type = 'all' or r.kind = p_type)
   and (p_entity_id is null or r.entity_id = p_entity_id)
   and (p_location_code is null or exists (
    select 1 from public.inventory_locations l
    where l.id = any(r.location_ids) and p_location_code = any(l.ancestor_codes)
   ))
 ), page as (
  select * from matches order by created_at desc, kind, id
  limit greatest(1, least(coalesce(p_page_size,25),100))
  offset (greatest(1, least(coalesce(p_page,1),100000))::bigint - 1)
    * greatest(1, least(coalesce(p_page_size,25),100))
 )
 select jsonb_build_object(
  'rows', coalesce((select jsonb_agg(to_jsonb(p) order by p.created_at desc,p.kind,p.id) from page p), '[]'::jsonb),
  'total', (select count(*) from matches));
$$;

revoke all on public.inventory_locations, public.inventory_search_rows, public.inventory_history_rows from public, anon, authenticated;
grant select on public.inventory_locations, public.inventory_search_rows, public.inventory_history_rows to authenticated, service_role;
revoke all on function public.inventory_search(text,text,text,uuid,text,integer,integer),
 public.inventory_history(text,uuid,text,integer,integer) from public, anon, service_role;
grant execute on function public.inventory_search(text,text,text,uuid,text,integer,integer),
 public.inventory_history(text,uuid,text,integer,integer) to authenticated;

create function public.inventory_serial_matches(p_serial text, p_exclude_id uuid default null)
returns table(id uuid,name text,asset_tag text,status text)
language sql stable security invoker set search_path = '' as $$
 select a.id,a.name,a.asset_tag,a.status from public.serialized_assets a
 where nullif(regexp_replace(p_serial,'^\s+|\s+$','','g'),'') is not null
 and lower(a.serial_number)=lower(regexp_replace(p_serial,'^\s+|\s+$','','g'))
 and (p_exclude_id is null or a.id<>p_exclude_id)
 order by lower(a.name),a.id limit 20;
$$;
revoke all on function public.inventory_serial_matches(text,uuid) from public,anon,service_role;
grant execute on function public.inventory_serial_matches(text,uuid) to authenticated;
