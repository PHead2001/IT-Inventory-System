-- A site-held asset has no storage location. Resolve labels by immutable
-- inventory identity, then describe its current storage or site endpoint.
-- Only three holding paths are concatenated; the count is computed separately.
-- A displayed path is at most 160 Unicode characters including its ellipsis.
create function public.inventory_label_context(p_kind text,p_entity_id uuid)
returns text language plpgsql stable security invoker set search_path='' as $$
declare context_value text; holding_count bigint;
begin
 if p_kind='asset' then
  select case
   when h.status='retired' and h.breadcrumb is not null then
    'Last recorded storage: '||case when char_length(h.breadcrumb)>160
      then left(h.breadcrumb,159)||'…' else h.breadcrumb end
   when h.site_id is not null then
    case when char_length(h.site_name||' ['||h.site_code||']')>160
      then left(h.site_name||' ['||h.site_code||']',159)||'…'
      else h.site_name||' ['||h.site_code||']' end||' · assigned site'
   when h.breadcrumb is not null then
    case when char_length(h.breadcrumb)>160
      then left(h.breadcrumb,159)||'…' else h.breadcrumb end
   else 'No current storage or site' end into context_value
  from public.inventory_search_rows h
  where h.kind='asset' and h.entity_id=p_entity_id limit 1;
  return coalesce(context_value,'No current storage or site');
 end if;
 if p_kind<>'quantity' then return null; end if;
 select count(*) into holding_count from public.inventory_search_rows h
  where h.kind='quantity' and h.entity_id=p_entity_id and h.quantity>0;
 if holding_count=0 then return 'No positive stock'; end if;
 select string_agg(
  case when selected.site_id is not null then 'Site ' else '' end||
  case when char_length(selected.path)>160 then left(selected.path,159)||'…'
    else selected.path end||': '||selected.quantity::text,
  '; ' order by selected.location_code,selected.site_code,selected.endpoint_id)
 into context_value from (
  select h.site_id,h.quantity,
   coalesce(h.location_code,'') as location_code,
   coalesce(h.site_code,'') as site_code,
   coalesce(h.location_id,h.site_id) as endpoint_id,
   case when h.site_id is not null then h.site_name||' ['||h.site_code||']'
    else h.breadcrumb end as path
  from public.inventory_search_rows h
  where h.kind='quantity' and h.entity_id=p_entity_id and h.quantity>0
  order by coalesce(h.location_code,''),coalesce(h.site_code,''),
   coalesce(h.location_id,h.site_id) limit 3
 ) selected;
 return context_value||case when holding_count>3 then
  ' + '||(holding_count-3)::text||' more; see item details' else '' end;
end;
$$;
revoke all on function public.inventory_label_context(text,uuid)
 from public,anon,authenticated,service_role;
grant execute on function public.inventory_label_context(text,uuid) to authenticated;

create or replace function public.inventory_label_search(
 p_query text default '', p_type text default 'all', p_status text default 'active',
 p_category_id uuid default null, p_location_code text default null,
 p_page integer default 1, p_page_size integer default 25
) returns jsonb language sql stable security invoker set search_path='' as $$
 with matches as materialized (
  select distinct on (r.kind,r.entity_id)
   r.kind,r.entity_id,r.name,r.category_name,r.status,
   r.asset_tag,r.serial_number,r.manufacturer,r.model
  from public.inventory_search_rows r
  where (p_type='all' or r.kind=p_type)
   and (p_status='all' or (p_status='active' and r.status='active')
    or (p_status='historical' and r.status<>'active'))
   and (p_category_id is null or r.category_id=p_category_id)
   and (p_location_code is null or p_location_code=any(r.ancestor_codes))
   and strpos(lower(concat_ws(' ',r.name,r.serial_number,r.asset_tag,
    r.category_name,r.manufacturer,r.model,r.site_code,r.site_name,r.entity_id::text)),
    lower(coalesce(p_query,'')))>0
  order by r.kind,r.entity_id
 ), page as (
  select * from matches order by lower(name),kind,entity_id
  limit greatest(1,least(coalesce(p_page_size,25),50))
  offset (greatest(1,least(coalesce(p_page,1),100000))::bigint-1)
    * greatest(1,least(coalesce(p_page_size,25),50))
 )
 select jsonb_build_object(
  'rows',coalesce((select jsonb_agg(
   to_jsonb(p)||jsonb_build_object('holding_context',
    public.inventory_label_context(p.kind,p.entity_id))
   order by lower(p.name),p.kind,p.entity_id) from page p),'[]'::jsonb),
  'total',(select count(*) from matches));
$$;

-- Re-resolve a bounded explicit queue in one statement snapshot. Every row
-- still uses its original location code or inventory UUID as the QR key.
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
   case when l.active then 'active' else 'inactive' end::text as state,
   null::text as tag,null::text as category_name
  from requested r join public.inventory_locations l
   on r.kind='location' and l.code=r.key
  union all
  select r.ordinality,'quantity',q.id::text,q.name,
   concat_ws(' / ',c.name,public.inventory_label_context('quantity',q.id)),
   case when q.archived then 'archived' else 'active' end,
   null::text,c.name
  from requested r join public.quantity_items q
   on r.kind='quantity' and q.id::text=r.key
  join public.categories c on c.id=q.category_id
  union all
  select r.ordinality,'asset',a.id::text,a.name,
   concat_ws(' / ',c.name,public.inventory_label_context('asset',a.id)),
   a.status,a.asset_tag,c.name
  from requested r join public.serialized_assets a
   on r.kind='asset' and a.id::text=r.key
  join public.categories c on c.id=a.category_id
 )
 select coalesce(jsonb_agg(to_jsonb(resolved)-'ordinality' order by ordinality),'[]'::jsonb)
 into v_result from resolved;
 return v_result;
end;
$$;
