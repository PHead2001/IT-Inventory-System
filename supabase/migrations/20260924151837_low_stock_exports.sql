-- Item-wide monitoring reads current balances, including inactive locations.
alter table public.quantity_items
 add column reorder_threshold integer check (reorder_threshold >= 0);

create function private.inventory_threshold(p jsonb) returns integer
language plpgsql set search_path = '' as $$
declare v numeric;
begin
 if p->'reorder_threshold' = 'null'::jsonb then return null; end if;
 if jsonb_typeof(p->'reorder_threshold') <> 'number' then
  raise exception using errcode='P1012', message='invalid_input';
 end if;
 v := (p->>'reorder_threshold')::numeric;
 if v <> trunc(v) or v < 0 or v > 2147483647 then
  raise exception using errcode='P1012', message='invalid_input';
 end if;
 return v::integer;
end;
$$;
revoke all on function private.inventory_threshold(jsonb) from public, anon, authenticated, service_role;

-- The original seven-argument RPC remains callable during an application rollout.
-- Existing columns retain their order; new columns are appended.
create or replace view public.inventory_search_rows with (security_invoker = true) as
select 'quantity'::text as kind, i.id as entity_id, i.name, i.description,
 i.manufacturer, i.model, i.category_id, c.name as category_name,
 case when i.archived then 'archived' else 'active' end as status,
 l.id as location_id, l.code as location_code, l.name as location_name,
 l.breadcrumb, l.ancestor_codes, b.quantity,
 null::text as asset_tag, null::text as serial_number,
 i.reorder_threshold, totals.recorded_total,
 case when i.archived then 'archived'
      when i.reorder_threshold is null then 'disabled'
      when totals.recorded_total = 0 then 'out_of_stock'
      when totals.recorded_total <= i.reorder_threshold then 'needs_restocking'
      else 'in_stock' end::text as stock_state
from public.quantity_items i join public.categories c on c.id = i.category_id
cross join lateral (
 select coalesce(sum(s.quantity),0)::bigint as recorded_total
 from public.stock_balances s where s.item_id=i.id
) totals
left join public.stock_balances b on b.item_id = i.id and b.quantity > 0
left join public.inventory_locations l on l.id = b.location_id
union all
select 'asset', a.id, a.name, a.description, a.manufacturer, a.model,
 a.category_id, c.name, a.status, l.id, l.code, l.name,
 l.breadcrumb, l.ancestor_codes, null::integer, a.asset_tag, a.serial_number,
 null::integer, null::bigint, null::text
from public.serialized_assets a join public.categories c on c.id = a.category_id
join public.inventory_locations l on l.id = a.location_id;

create function public.inventory_search_v2(
 p_query text default '', p_type text default 'all', p_status text default 'active',
 p_category_id uuid default null, p_location_code text default null,
 p_page integer default 1, p_page_size integer default 25,
 p_low_stock boolean default false
) returns jsonb language sql stable security invoker set search_path = '' as $$
 with matches as materialized (
  select r.* from public.inventory_search_rows r
  where (p_type = 'all' or r.kind = p_type)
   and (p_status = 'all' or (p_status = 'active' and r.status = 'active')
    or (p_status = 'historical' and r.status <> 'active'))
   and (p_category_id is null or r.category_id = p_category_id)
   and (p_location_code is null or p_location_code = any(r.ancestor_codes))
   and (not coalesce(p_low_stock,false) or r.stock_state in ('needs_restocking','out_of_stock'))
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
revoke all on function public.inventory_search_v2(text,text,text,uuid,text,integer,integer,boolean)
 from public, anon, authenticated, service_role;
grant execute on function public.inventory_search_v2(text,text,text,uuid,text,integer,integer,boolean)
 to authenticated;

create or replace function public.inventory_search(
 p_query text default '', p_type text default 'all', p_status text default 'active',
 p_category_id uuid default null, p_location_code text default null,
 p_page integer default 1, p_page_size integer default 25
) returns jsonb language sql stable security invoker set search_path = '' as $$
 select public.inventory_search_v2(p_query,p_type,p_status,p_category_id,p_location_code,p_page,p_page_size,false);
$$;

create function public.low_stock_dashboard(
 p_page integer default 1, p_page_size integer default 25
) returns jsonb language sql stable security invoker set search_path = '' as $$
 with items as materialized (
  select distinct on (entity_id) entity_id,name,category_name,recorded_total,
   reorder_threshold,stock_state
  from public.inventory_search_rows
  where kind='quantity' and status='active' and reorder_threshold is not null
  order by entity_id
 ), attention as materialized (
  select * from items where stock_state in ('needs_restocking','out_of_stock')
 ), page as (
  select * from attention order by lower(name), entity_id
  limit greatest(1,least(coalesce(p_page_size,25),100))
  offset (greatest(1,least(coalesce(p_page,1),100000))::bigint-1)
    * greatest(1,least(coalesce(p_page_size,25),100))
 )
 select jsonb_build_object(
  'configured_count',(select count(*) from items),
  'needs_restocking_count',(select count(*) from attention),
  'out_of_stock_count',(select count(*) from attention where stock_state='out_of_stock'),
  'total',(select count(*) from attention),
  'rows',coalesce((select jsonb_agg(to_jsonb(p) order by lower(p.name),p.entity_id) from page p),'[]'::jsonb));
$$;
revoke all on function public.low_stock_dashboard(integer,integer)
 from public, anon, authenticated, service_role;
grant execute on function public.low_stock_dashboard(integer,integer) to authenticated;

-- One SELECT per file gives one statement snapshot. The sentinel row fails closed.
create function public.inventory_export_snapshot(
 p_query text default '', p_type text default 'all', p_status text default 'active',
 p_category_id uuid default null, p_location_code text default null,
 p_low_stock boolean default false, p_export_type text default 'inventory'
) returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare v_result jsonb; v_count bigint;
begin
 if p_export_type not in ('inventory','low_stock') or p_export_type is null then
  raise exception using errcode='P1012',message='invalid_input';
 end if;
 if p_export_type='inventory' then
  with matches as materialized (
   select r.* from public.inventory_search_rows r
   where (p_type='all' or r.kind=p_type)
    and (p_status='all' or (p_status='active' and r.status='active')
     or (p_status='historical' and r.status<>'active'))
    and (p_category_id is null or r.category_id=p_category_id)
    and (p_location_code is null or p_location_code=any(r.ancestor_codes))
    and (not coalesce(p_low_stock,false) or r.stock_state in ('needs_restocking','out_of_stock'))
    and strpos(lower(concat_ws(' ',r.name,r.description,r.manufacturer,r.model,
     r.category_name,r.location_code,r.location_name,r.breadcrumb,r.asset_tag,r.serial_number)),
     lower(coalesce(p_query,'')))>0
  ), capped as materialized (
   select * from matches order by lower(name),kind,entity_id,coalesce(location_code,'')
   limit 10001
  )
  select count(*),coalesce(jsonb_agg(to_jsonb(c) - 'recorded_total' - 'reorder_threshold' - 'stock_state'
   order by lower(c.name),c.kind,c.entity_id,coalesce(c.location_code,'')),'[]'::jsonb)
  into v_count,v_result from capped c;
 else
  with matches as materialized (
   select r.* from public.inventory_search_rows r
   where r.kind='quantity' and r.status='active'
    and r.stock_state in ('needs_restocking','out_of_stock')
    and (p_type='all' or p_type='quantity')
    and (p_status='all' or p_status='active')
    and (p_category_id is null or r.category_id=p_category_id)
    and (p_location_code is null or p_location_code=any(r.ancestor_codes))
    and strpos(lower(concat_ws(' ',r.name,r.description,r.manufacturer,r.model,
     r.category_name,r.location_code,r.location_name,r.breadcrumb,r.asset_tag,r.serial_number)),
     lower(coalesce(p_query,'')))>0
  ), selected as materialized (
   select distinct entity_id from matches
  ), grouped as materialized (
   select r.entity_id,'quantity'::text as kind,r.name,r.description,r.manufacturer,r.model,
    r.category_id,r.category_name,r.status,r.reorder_threshold,r.recorded_total,r.stock_state,
    coalesce(string_agg(r.breadcrumb || ' [' || r.location_code || ']: ' || r.quantity::text,
     '; ' order by r.location_code) filter(where r.location_code is not null),'') as holding_context
   from public.inventory_search_rows r join selected s on s.entity_id=r.entity_id
   where r.kind='quantity'
   group by r.entity_id,r.name,r.description,r.manufacturer,r.model,r.category_id,r.category_name,
    r.status,r.reorder_threshold,r.recorded_total,r.stock_state
  ), capped as materialized (
   select * from grouped order by lower(name),entity_id limit 10001
  )
  select count(*),coalesce(jsonb_agg(to_jsonb(c) order by lower(c.name),c.entity_id),'[]'::jsonb)
  into v_count,v_result from capped c;
 end if;
 if v_count>10000 then
  raise exception using errcode='P1013',message='export_too_large';
 end if;
 return jsonb_build_object('rows',v_result,'total',v_count,'exported_at',statement_timestamp());
end;
$$;
revoke all on function public.inventory_export_snapshot(text,text,text,uuid,text,boolean,text)
 from public, anon, authenticated, service_role;
grant execute on function public.inventory_export_snapshot(text,text,text,uuid,text,boolean,text)
 to authenticated;

-- Existing privileged mutations retain their staff checks, locks, receipt contract and event behavior.
create or replace function public.quantity_create(p_request_id uuid,p_payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
 v_actor uuid; v_actor_name text; v_payload jsonb; v_result jsonb;
 v_id uuid; v_version integer; v_event uuid:=gen_random_uuid();
 v_name text; v_description text; v_category uuid; v_manufacturer text; v_model text; v_threshold integer;
 v_reason text; v_location uuid; v_source uuid; v_destination uuid;
 v_quantity integer; v_before integer; v_after bigint; v_delta integer; v_move_all boolean;
 v_tag text; v_serial text;
 v_item public.quantity_items%rowtype; v_asset public.serialized_assets%rowtype;
begin
 v_actor:=auth.uid();
 if v_actor is null then raise exception using errcode='P1001',message='forbidden'; end if;
 select display_name into v_actor_name from public.app_members
 where user_id=v_actor and active and role='staff' for share;
 if not found then raise exception using errcode='P1001',message='forbidden'; end if;
 perform private.inventory_payload(p_payload,array['name','description','category_id','manufacturer','model','initial_location_id','initial_quantity','reorder_threshold']);

 v_name:=private.inventory_text(p_payload,'name',200,true);
 v_description:=private.inventory_text(p_payload,'description',4000);
 v_category:=private.inventory_uuid(p_payload,'category_id');
 v_manufacturer:=private.inventory_text(p_payload,'manufacturer',200);
 v_model:=private.inventory_text(p_payload,'model',200);
 if p_payload ? 'reorder_threshold' then v_threshold:=private.inventory_threshold(p_payload); end if;

 v_location:=private.inventory_uuid(p_payload,'initial_location_id',false);
 v_quantity:=private.inventory_integer(p_payload,'initial_quantity',0,0);
 if v_quantity>0 and v_location is null then raise exception using errcode='P1012',message='invalid_input'; end if;
 v_payload:=jsonb_build_object('name',v_name,'description',v_description,'category_id',v_category,'manufacturer',v_manufacturer,'model',v_model,'initial_location_id',v_location,'initial_quantity',v_quantity);

 if p_payload ? 'reorder_threshold' then v_payload:=v_payload || jsonb_build_object('reorder_threshold',v_threshold); end if;
 v_result:=private.inventory_receipt(v_actor,p_request_id,'quantity_create',v_payload);
 if v_result is not null then return v_result; end if;

 perform private.inventory_category(v_category);
 if v_location is not null then perform private.inventory_destination(v_location); end if;
 insert into public.quantity_items(name,description,category_id,manufacturer,model,reorder_threshold)
 values(v_name,v_description,v_category,v_manufacturer,v_model,v_threshold) returning id,version into v_id,v_version;
 insert into public.quantity_events(id,item_id,kind,actor_id,actor_name,reason,before_metadata,after_metadata,version) values(v_event,v_id,'created',v_actor,v_actor_name,v_reason,null,jsonb_build_object('name',v_name,'description',v_description,'category_id',v_category,'manufacturer',v_manufacturer,'model',v_model,'reorder_threshold',v_threshold),v_version);
 if v_quantity>0 then
 insert into public.stock_balances values(v_id,v_location,v_quantity);
 insert into public.quantity_event_lines values(v_event,v_location,v_quantity,0,v_quantity);
 end if;
 v_result:=jsonb_build_object('entity_id',v_id,'version',v_version,'event_id',v_event,'changed',true);

 update private.mutation_requests set result=v_result where actor_id=v_actor and request_id=p_request_id;
 return v_result;
exception when unique_violation then raise exception using errcode='P1007',message='identifier_conflict';
end;
$$;

create or replace function public.quantity_update(p_request_id uuid,p_payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
 v_actor uuid; v_actor_name text; v_payload jsonb; v_result jsonb;
 v_id uuid; v_version integer; v_event uuid:=gen_random_uuid();
 v_name text; v_description text; v_category uuid; v_manufacturer text; v_model text; v_threshold integer;
 v_reason text; v_location uuid; v_source uuid; v_destination uuid;
 v_quantity integer; v_before integer; v_after bigint; v_delta integer; v_move_all boolean;
 v_tag text; v_serial text;
 v_item public.quantity_items%rowtype; v_asset public.serialized_assets%rowtype;
begin
 v_actor:=auth.uid();
 if v_actor is null then raise exception using errcode='P1001',message='forbidden'; end if;
 select display_name into v_actor_name from public.app_members
 where user_id=v_actor and active and role='staff' for share;
 if not found then raise exception using errcode='P1001',message='forbidden'; end if;
 perform private.inventory_payload(p_payload,array['item_id','expected_version','name','description','category_id','manufacturer','model','reorder_threshold']);
 v_id:=private.inventory_uuid(p_payload,'item_id'); v_version:=private.inventory_integer(p_payload,'expected_version',1);
 v_name:=private.inventory_text(p_payload,'name',200,true);
 v_description:=private.inventory_text(p_payload,'description',4000);
 v_category:=private.inventory_uuid(p_payload,'category_id');
 v_manufacturer:=private.inventory_text(p_payload,'manufacturer',200);
 v_model:=private.inventory_text(p_payload,'model',200);
 if p_payload ? 'reorder_threshold' then v_threshold:=private.inventory_threshold(p_payload); end if;

 v_payload:=jsonb_build_object('item_id',v_id,'expected_version',v_version,'name',v_name,'description',v_description,'category_id',v_category,'manufacturer',v_manufacturer,'model',v_model);

 if p_payload ? 'reorder_threshold' then v_payload:=v_payload || jsonb_build_object('reorder_threshold',v_threshold); end if;
 v_result:=private.inventory_receipt(v_actor,p_request_id,'quantity_update',v_payload);
 if v_result is not null then return v_result; end if;


 select * into v_item from public.quantity_items where id=v_id for update;
 if not found then raise exception using errcode='P1010',message='not_found'; end if;
 if v_item.version<>v_version then raise exception using errcode='P1002',message='stale_version'; end if;
 if v_item.archived then raise exception using errcode='P1008',message='invalid_transition'; end if;
 if not(p_payload ? 'reorder_threshold') then v_threshold:=v_item.reorder_threshold; end if;
 perform private.inventory_category(v_category,v_item.category_id);
 update public.quantity_items set name=v_name,description=v_description,category_id=v_category,manufacturer=v_manufacturer,model=v_model,reorder_threshold=v_threshold where id=v_id;
 if v_item.version=2147483647 then raise exception using errcode='P1008',message='invalid_transition'; end if;
 v_version:=v_item.version+1; update public.quantity_items set version=v_version,updated_at=now() where id=v_id; insert into public.quantity_events(id,item_id,kind,actor_id,actor_name,reason,before_metadata,after_metadata,version) values(v_event,v_id,'metadata_updated',v_actor,v_actor_name,v_reason,jsonb_build_object('name',v_item.name,'description',v_item.description,'category_id',v_item.category_id,'manufacturer',v_item.manufacturer,'model',v_item.model,'reorder_threshold',v_item.reorder_threshold),jsonb_build_object('name',v_name,'description',v_description,'category_id',v_category,'manufacturer',v_manufacturer,'model',v_model,'reorder_threshold',v_threshold),v_version);
 v_result:=jsonb_build_object('entity_id',v_id,'version',v_version,'event_id',v_event,'changed',true);

 update private.mutation_requests set result=v_result where actor_id=v_actor and request_id=p_request_id;
 return v_result;
exception when unique_violation then raise exception using errcode='P1007',message='identifier_conflict';
end;
$$;
