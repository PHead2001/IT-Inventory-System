-- Search labelable records, not holdings. The security-invoker view preserves
-- member RLS and the DISTINCT happens before counting, ordering, and paging.
create function public.inventory_label_search(
 p_query text default '', p_type text default 'all', p_status text default 'active',
 p_category_id uuid default null, p_location_code text default null,
 p_page integer default 1, p_page_size integer default 25
) returns jsonb language sql stable security invoker set search_path = '' as $$
 with matches as materialized (
  select distinct on (r.kind, r.entity_id)
   r.kind, r.entity_id, r.name, r.category_name, r.status,
   r.asset_tag, r.serial_number, r.manufacturer, r.model
  from public.inventory_search_rows r
  where (p_type = 'all' or r.kind = p_type)
   and (p_status = 'all' or (p_status = 'active' and r.status = 'active')
    or (p_status = 'historical' and r.status <> 'active'))
   and (p_category_id is null or r.category_id = p_category_id)
   and (p_location_code is null or p_location_code = any(r.ancestor_codes))
   and strpos(lower(concat_ws(' ', r.name, r.serial_number, r.asset_tag,
    r.category_name, r.manufacturer, r.model, r.entity_id::text)),
    lower(coalesce(p_query,''))) > 0
  order by r.kind, r.entity_id
 ), page as (
  select * from matches order by lower(name),kind,entity_id
  limit greatest(1,least(coalesce(p_page_size,25),50))
  offset (greatest(1,least(coalesce(p_page,1),100000))::bigint-1)
    * greatest(1,least(coalesce(p_page_size,25),50))
 )
 select jsonb_build_object(
  'rows',coalesce((select jsonb_agg(
   to_jsonb(p) || jsonb_build_object('holding_context',
    case when p.kind='asset' then (
      select max(h.breadcrumb) from public.inventory_search_rows h
      where h.kind='asset' and h.entity_id=p.entity_id
    ) else coalesce((
      select string_agg(h.location_code || ': ' || h.quantity::text,
        '; ' order by h.location_code)
      from public.inventory_search_rows h
      where h.kind='quantity' and h.entity_id=p.entity_id and h.quantity>0
    ),'No positive stock') end)
   order by lower(p.name),p.kind,p.entity_id) from page p),'[]'::jsonb),
  'total',(select count(*) from matches));
$$;
revoke all on function public.inventory_label_search(text,text,text,uuid,text,integer,integer)
 from public, anon, authenticated, service_role;
grant execute on function public.inventory_label_search(text,text,text,uuid,text,integer,integer)
 to authenticated;

-- Re-resolve an explicit queue in one statement snapshot. The invoker's RLS
-- applies to every source relation. Missing rows are intentionally omitted.
create function public.inventory_label_resolve(p_selection jsonb)
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare v_result jsonb;
begin
 if p_selection is null or jsonb_typeof(p_selection) <> 'array' then
  raise exception using errcode='22023', message='invalid_label_selection';
 end if;
 if jsonb_array_length(p_selection) > 200 then
  raise exception using errcode='22023', message='invalid_label_selection';
 end if;
 if exists (
  select 1 from jsonb_array_elements(p_selection) as e(value)
  where jsonb_typeof(e.value) <> 'object'
   or coalesce(e.value->>'kind','') not in ('location','asset','quantity')
   or coalesce(e.value->>'key','') = ''
   or char_length(e.value->>'key') > 256
 ) then
  raise exception using errcode='22023', message='invalid_label_selection';
 end if;
 with requested as materialized (
  select e.value->>'kind' as kind, e.value->>'key' as key, e.ordinality
  from jsonb_array_elements(p_selection) with ordinality as e(value,ordinality)
 ), resolved as (
  select r.ordinality,'location'::text as kind,l.code as key,l.name,
   l.breadcrumb as context,
   case when l.active then 'active' else 'inactive' end::text as state,
   null::text as tag,null::text as category_name
  from requested r join public.inventory_locations l
   on r.kind='location' and l.code=r.key
  union all
  select r.ordinality,'quantity',q.id::text,q.name,
   concat_ws(' / ',c.name,coalesce(holds.context,'No positive stock')),
   case when q.archived then 'archived' else 'active' end,
   null::text,c.name
  from requested r join public.quantity_items q
   on r.kind='quantity' and q.id::text=r.key
  join public.categories c on c.id=q.category_id
  left join lateral (
   select string_agg(l.code || ': ' || b.quantity::text,
     '; ' order by l.code) as context
   from public.stock_balances b join public.inventory_locations l on l.id=b.location_id
   where b.item_id=q.id and b.quantity>0
  ) holds on true
  union all
  select r.ordinality,'asset',a.id::text,a.name,
   concat_ws(' / ',c.name,l.breadcrumb),a.status,a.asset_tag,c.name
  from requested r join public.serialized_assets a
   on r.kind='asset' and a.id::text=r.key
  join public.categories c on c.id=a.category_id
  join public.inventory_locations l on l.id=a.location_id
 )
 select coalesce(jsonb_agg(to_jsonb(resolved) - 'ordinality' order by ordinality),'[]'::jsonb)
 into v_result from resolved;
 return v_result;
end;
$$;
revoke all on function public.inventory_label_resolve(jsonb)
 from public, anon, authenticated, service_role;
grant execute on function public.inventory_label_resolve(jsonb) to authenticated;
