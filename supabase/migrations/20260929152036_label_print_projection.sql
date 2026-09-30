-- Keep current holdings for the queue while exposing only record-owned fields
-- for permanent printed identification. The resolver remains invoker-scoped.
create or replace function public.inventory_label_resolve(p_selection jsonb)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare v_result jsonb;
begin
 if p_selection is null or jsonb_typeof(p_selection)<>'array' then
  raise exception using errcode='22023',message='invalid_label_selection';
 end if;
 if jsonb_array_length(p_selection)>200 then
  raise exception using errcode='22023',message='invalid_label_selection';
 end if;
 if exists (
  select 1 from jsonb_array_elements(p_selection) as e(value)
  where jsonb_typeof(e.value)<>'object'
   or coalesce(e.value->>'kind','') not in ('location','asset','quantity')
   or coalesce(e.value->>'key','')=''
   or char_length(e.value->>'key')>256
 ) then
  raise exception using errcode='22023',message='invalid_label_selection';
 end if;
 with requested as materialized (
  select e.value->>'kind' as kind,e.value->>'key' as key,e.ordinality
  from jsonb_array_elements(p_selection) with ordinality as e(value,ordinality)
 ), resolved as (
  select r.ordinality,'location'::text as kind,l.code as key,l.name,
   case when char_length(l.breadcrumb)>160 then left(l.breadcrumb,159)||'…'
    else l.breadcrumb end as context,
   l.breadcrumb as holding_context,
   l.breadcrumb as location_hierarchy,
   case when l.active then 'active' else 'inactive' end::text as state,
   null::text as tag,null::text as category_name,null::text as item_code,
   null::text as manufacturer,null::text as model,null::text as serial_number
  from requested r join public.inventory_locations l
   on r.kind='location' and l.code=r.key
  union all
  select r.ordinality,'quantity',q.id::text,q.name,
   concat_ws(' / ',c.name,holding.value),holding.value,
   null::text,
   case when q.archived then 'archived' else 'active' end,
   null::text,c.name,q.item_code,q.manufacturer,q.model,null::text
  from requested r join public.quantity_items q
   on r.kind='quantity' and q.id::text=r.key
  join public.categories c on c.id=q.category_id
  cross join lateral (select public.inventory_label_context('quantity',q.id) as value) holding
  union all
  select r.ordinality,'asset',a.id::text,a.name,
   concat_ws(' / ',c.name,holding.value),holding.value,
   null::text,
   a.status,a.asset_tag,c.name,null::text,a.manufacturer,a.model,a.serial_number
  from requested r join public.serialized_assets a
   on r.kind='asset' and a.id::text=r.key
  join public.categories c on c.id=a.category_id
  cross join lateral (select public.inventory_label_context('asset',a.id) as value) holding
 )
 select coalesce(jsonb_agg(to_jsonb(resolved)-'ordinality' order by ordinality),'[]'::jsonb)
 into v_result from resolved;
 return v_result;
end;
$$;
