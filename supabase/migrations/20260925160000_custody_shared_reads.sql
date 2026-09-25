-- Forward read projection: storage availability and site custody remain
-- separate rows, while immutable inventory IDs continue to back QR links.
-- Appended columns preserve deployed readers of the existing view.
create or replace view public.inventory_search_rows with (security_invoker=true) as
select 'quantity'::text as kind, i.id as entity_id, i.name, i.description,
 i.manufacturer, i.model, i.category_id, c.name as category_name,
 case when i.archived then 'archived' else 'active' end as status,
 l.id as location_id, l.code as location_code, l.name as location_name,
 l.breadcrumb, l.ancestor_codes, b.quantity,
 null::text as asset_tag, null::text as serial_number,
 i.reorder_threshold, t.available_quantity::bigint as recorded_total,
 case when i.archived then 'archived' else t.stock_state end::text as stock_state,
 null::uuid as site_id, null::text as site_code, null::text as site_name,
 case when l.id is null then 'unlocated' else 'storage' end::text as custody_kind,
 t.available_quantity, t.assigned_quantity, t.recorded_quantity
from public.quantity_items i join public.categories c on c.id=i.category_id
join public.inventory_quantity_totals t on t.item_id=i.id
left join public.stock_balances b on b.item_id=i.id and b.quantity>0
left join public.inventory_locations l on l.id=b.location_id
where b.location_id is not null or not exists (
 select 1 from public.site_quantity_holdings existing
 where existing.item_id=i.id and existing.quantity>0)
union all
select 'quantity',i.id,i.name,i.description,i.manufacturer,i.model,
 i.category_id,c.name,case when i.archived then 'archived' else 'active' end,
 null::uuid,null::text,null::text,null::text,null::text[],h.quantity,
 null::text,null::text,i.reorder_threshold,t.available_quantity::bigint,
 case when i.archived then 'archived' else t.stock_state end,
 s.id,s.code,s.name,'site',t.available_quantity,t.assigned_quantity,t.recorded_quantity
from public.site_quantity_holdings h join public.quantity_items i on i.id=h.item_id
join public.categories c on c.id=i.category_id
join public.sites s on s.id=h.site_id
join public.inventory_quantity_totals t on t.item_id=i.id
where h.quantity>0
union all
select 'asset',a.id,a.name,a.description,a.manufacturer,a.model,
 a.category_id,c.name,a.status,l.id,l.code,l.name,l.breadcrumb,l.ancestor_codes,
 null::integer,a.asset_tag,a.serial_number,null::integer,null::bigint,null::text,
 null::uuid,null::text,null::text,
 case when a.status='retired' then 'retired' when l.id is null then 'unlocated' else 'storage' end,
 null::text,null::text,null::text
from public.serialized_assets a join public.categories c on c.id=a.category_id
left join public.inventory_locations l on l.id=a.location_id
where a.site_id is null
union all
select 'asset',a.id,a.name,a.description,a.manufacturer,a.model,
 a.category_id,c.name,a.status,null::uuid,null::text,null::text,null::text,null::text[],
 null::integer,a.asset_tag,a.serial_number,null::integer,null::bigint,null::text,
 s.id,s.code,s.name,'site',null::text,null::text,null::text
from public.serialized_assets a join public.categories c on c.id=a.category_id
join public.sites s on s.id=a.site_id where a.status='active';

-- Search returns rows at each storage or site holding. A site filter selects
-- current site holdings, while stock state remains item-wide availability.
create function public.inventory_search_v3(
 p_query text default '',p_type text default 'all',p_status text default 'active',
 p_category_id uuid default null,p_location_code text default null,
 p_site_id uuid default null,p_page integer default 1,p_page_size integer default 25,
 p_low_stock boolean default false
) returns jsonb language sql stable security invoker set search_path='' as $$
 with matches as materialized (
  select r.* from public.inventory_search_rows r
  where (p_type='all' or r.kind=p_type)
   and (p_status='all' or (p_status='active' and r.status='active')
    or (p_status='historical' and r.status<>'active'))
   and (p_category_id is null or r.category_id=p_category_id)
   and (p_location_code is null or p_location_code=any(r.ancestor_codes))
   and (p_site_id is null or r.site_id=p_site_id)
   and (not coalesce(p_low_stock,false) or r.stock_state in ('needs_restocking','out_of_stock'))
   and strpos(lower(concat_ws(' ',r.name,r.description,r.manufacturer,r.model,
     r.category_name,r.location_code,r.location_name,r.breadcrumb,r.site_code,
     r.site_name,r.asset_tag,r.serial_number)),lower(coalesce(p_query,'')))>0
 ), page as (
  select * from matches order by lower(name),kind,entity_id,
    coalesce(location_code,''),coalesce(site_code,'')
  limit greatest(1,least(coalesce(p_page_size,25),100))
  offset (greatest(1,least(coalesce(p_page,1),100000))::bigint-1)
    * greatest(1,least(coalesce(p_page_size,25),100))
 )
 select jsonb_build_object(
  'rows',coalesce((select jsonb_agg(to_jsonb(p) order by lower(p.name),p.kind,
   p.entity_id,coalesce(p.location_code,''),coalesce(p.site_code,'')) from page p),'[]'::jsonb),
  'total',(select count(*) from matches));
$$;
revoke all on function public.inventory_search_v3(text,text,text,uuid,text,uuid,integer,integer,boolean)
 from public,anon,authenticated,service_role;
grant execute on function public.inventory_search_v3(text,text,text,uuid,text,uuid,integer,integer,boolean) to authenticated;

create or replace function public.inventory_search_v2(
 p_query text default '',p_type text default 'all',p_status text default 'active',
 p_category_id uuid default null,p_location_code text default null,
 p_page integer default 1,p_page_size integer default 25,p_low_stock boolean default false
) returns jsonb language sql stable security invoker set search_path='' as $$
 select public.inventory_search_v3(p_query,p_type,p_status,p_category_id,
  p_location_code,null::uuid,p_page,p_page_size,p_low_stock);
$$;

-- One statement/snapshot with the same 10,000-row and 2 MiB caps as the
-- metadata-aware export. Both holding endpoints form the row identity.
create function public.inventory_export_snapshot_v3(
 p_query text,p_type text,p_status text,p_category_id uuid,p_location_code text,
 p_site_id uuid,p_low_stock boolean,p_export_type text,p_include_custom boolean
) returns jsonb language plpgsql stable security invoker set search_path='' set statement_timeout='5s' as $$
declare r record; holding record; one_row jsonb; custom jsonb; described jsonb;
 rows_json jsonb[]:=array[]::jsonb[]; used_bytes integer:=128; row_bytes integer;
 count_rows integer:=0; holdings text; response jsonb; exported_at timestamptz:=statement_timestamp();
 key_kinds text[]; key_entities uuid[]; key_locations uuid[]; key_sites uuid[]; low_keys uuid[];
begin
 if p_export_type not in ('inventory','low_stock') or p_export_type is null then
  raise exception using errcode='P1012',message='invalid_export_type'; end if;
 if p_type is null or p_type not in ('all','quantity','asset')
   or p_status is null or p_status not in ('all','active','historical')
   or length(coalesce(p_query,''))>200 or length(coalesce(p_location_code,''))>100 then
  raise exception using errcode='P1012',message='invalid_export_filter'; end if;
 if p_export_type='inventory' then
  with candidates as materialized (
   select x.kind,x.entity_id,x.location_id,x.site_id from public.inventory_search_rows x
   where (p_type='all' or x.kind=p_type)
    and (p_status='all' or (p_status='active' and x.status='active')
      or (p_status='historical' and x.status<>'active'))
    and (p_category_id is null or x.category_id=p_category_id)
    and (p_location_code is null or p_location_code=any(x.ancestor_codes))
    and (p_site_id is null or x.site_id=p_site_id)
    and (not coalesce(p_low_stock,false) or x.stock_state in ('needs_restocking','out_of_stock'))
    and strpos(lower(concat_ws(' ',x.name,x.description,x.manufacturer,x.model,x.category_name,
      x.location_code,x.location_name,x.breadcrumb,x.site_code,x.site_name,x.asset_tag,x.serial_number)),
      lower(coalesce(p_query,'')))>0
   limit 10001
  )
  select coalesce(array_agg(kind),array[]::text[]),
   coalesce(array_agg(entity_id),array[]::uuid[]),
   coalesce(array_agg(location_id),array[]::uuid[]),
   coalesce(array_agg(site_id),array[]::uuid[])
  into key_kinds,key_entities,key_locations,key_sites from candidates;
  if cardinality(key_entities)>10000 then raise exception using errcode='P1013',message='export_row_limit'; end if;
  for r in
   select x.* from generate_subscripts(key_entities,1) key_index(n)
   join public.inventory_search_rows x on x.kind=key_kinds[key_index.n]
    and x.entity_id=key_entities[key_index.n]
    and x.location_id is not distinct from key_locations[key_index.n]
    and x.site_id is not distinct from key_sites[key_index.n]
   order by lower(x.name),x.kind,x.entity_id,coalesce(x.location_code,''),coalesce(x.site_code,'')
  loop
   count_rows:=count_rows+1;
   if count_rows>10000 then raise exception using errcode='P1013',message='export_row_limit'; end if;
   one_row:=(to_jsonb(r)-'reorder_threshold'-'stock_state')||
     jsonb_build_object('recorded_total',r.recorded_quantity);
   if p_include_custom then
    if r.kind='quantity' then select custom_values into custom from public.quantity_items where id=r.entity_id;
    else select custom_values into custom from public.serialized_assets where id=r.entity_id; end if;
    described:=public.metadata_describe_values(custom,r.category_id);
    one_row:=one_row||jsonb_build_object('custom_fields',described);
   end if;
   row_bytes:=octet_length(one_row::text)+1;
   if row_bytes>2096640 then raise exception using errcode='P1025',message='single_export_record_too_large'; end if;
   used_bytes:=used_bytes+row_bytes;
   if used_bytes>2096640 then raise exception using errcode='P1025',message='export_byte_limit'; end if;
   rows_json:=array_append(rows_json,one_row);
  end loop;
 else
  with keys as materialized (
   select i.id from public.quantity_items i
   where (p_type='all' or p_type='quantity') and (p_status='all' or p_status='active')
    and exists (select 1 from public.inventory_search_rows x
      where x.kind='quantity' and x.entity_id=i.id and x.status='active'
       and x.stock_state in ('needs_restocking','out_of_stock')
       and (p_category_id is null or x.category_id=p_category_id)
       and (p_location_code is null or p_location_code=any(x.ancestor_codes))
       and (p_site_id is null or x.site_id=p_site_id)
       and strpos(lower(concat_ws(' ',x.name,x.description,x.manufacturer,x.model,x.category_name,
         x.location_code,x.location_name,x.breadcrumb,x.site_code,x.site_name,x.asset_tag,x.serial_number)),
         lower(coalesce(p_query,'')))>0)
   limit 10001
  )
  select coalesce(array_agg(id),array[]::uuid[]) into low_keys from keys;
  if cardinality(low_keys)>10000 then raise exception using errcode='P1013',message='export_row_limit'; end if;
  for r in
   select i.id as entity_id,i.name,i.description,i.manufacturer,i.model,i.category_id,
    c.name as category_name, i.reorder_threshold,t.available_quantity,t.assigned_quantity,
    t.recorded_quantity,t.stock_state
   from unnest(low_keys) key_id(id) join public.quantity_items i on i.id=key_id.id
   join public.categories c on c.id=i.category_id
   join public.inventory_quantity_totals t on t.item_id=i.id
   order by lower(i.name),i.id
  loop
   count_rows:=count_rows+1;
   if count_rows>10000 then raise exception using errcode='P1013',message='export_row_limit'; end if;
   holdings:='';
   for holding in select x.location_code,x.breadcrumb,x.site_code,x.site_name,x.quantity
    from public.inventory_search_rows x where x.kind='quantity' and x.entity_id=r.entity_id
     and (x.location_code is not null or x.site_code is not null)
    order by coalesce(x.location_code,''),coalesce(x.site_code,'') loop
    if holdings<>'' then holdings:=holdings||'; '; end if;
    if holding.site_code is not null then
      holdings:=holdings||'Site '||holding.site_name||' ['||holding.site_code||']: '||holding.quantity::text;
    else
      holdings:=holdings||holding.breadcrumb||' ['||holding.location_code||']: '||holding.quantity::text;
    end if;
    if octet_length(holdings)>2096640 then raise exception using errcode='P1025',message='single_export_record_too_large'; end if;
   end loop;
   one_row:=jsonb_build_object('entity_id',r.entity_id,'kind','quantity','name',r.name,
    'description',r.description,'manufacturer',r.manufacturer,'model',r.model,
    'category_id',r.category_id,'category_name',r.category_name,'status','active',
    'reorder_threshold',r.reorder_threshold,'recorded_total',r.recorded_quantity,
    'available_quantity',r.available_quantity,'assigned_quantity',r.assigned_quantity,
    'stock_state',r.stock_state,'holding_context',holdings);
   if p_include_custom then
    select custom_values into custom from public.quantity_items where id=r.entity_id;
    described:=public.metadata_describe_values(custom,r.category_id);
    one_row:=one_row||jsonb_build_object('custom_fields',described);
   end if;
   row_bytes:=octet_length(one_row::text)+1;
   if row_bytes>2096640 then raise exception using errcode='P1025',message='single_export_record_too_large'; end if;
   used_bytes:=used_bytes+row_bytes;
   if used_bytes>2096640 then raise exception using errcode='P1025',message='export_byte_limit'; end if;
   rows_json:=array_append(rows_json,one_row);
  end loop;
 end if;
 response:=jsonb_build_object('rows',to_jsonb(rows_json),'total',count_rows::text,
  'exported_at',exported_at,'custom_fields_included',coalesce(p_include_custom,false));
 if octet_length(response::text)>2097152 then raise exception using errcode='P1025',message='export_byte_limit'; end if;
 return response;
end;
$$;
revoke all on function public.inventory_export_snapshot_v3(text,text,text,uuid,text,uuid,boolean,text,boolean)
 from public,anon,authenticated,service_role;
grant execute on function public.inventory_export_snapshot_v3(text,text,text,uuid,text,uuid,boolean,text,boolean)
 to authenticated;

create or replace function public.inventory_export_snapshot(
 p_query text,p_type text,p_status text,p_category_id uuid,p_location_code text,
 p_low_stock boolean,p_export_type text,p_include_custom boolean
) returns jsonb language sql stable security invoker set search_path='' set statement_timeout='5s' as $$
 select public.inventory_export_snapshot_v3(p_query,p_type,p_status,p_category_id,
  p_location_code,null::uuid,p_low_stock,p_export_type,p_include_custom);
$$;

-- Current grouped holdings are separate from dated activity. Never add
-- anonymous quantity units to the count of distinct serialized devices.
create function public.site_holding_groups(
 p_site_id uuid,p_page integer default 1,p_page_size integer default 25
) returns jsonb language sql stable security invoker set search_path='' as $$
 with grouped as materialized (
  select inventory_kind,category_name,name,model,
   case when inventory_kind='quantity' then sum(quantity::bigint)::text else null end as quantity_units,
   case when inventory_kind='asset' then count(distinct entity_id)::text else null end as serialized_devices
  from public.site_current_holdings where site_id=p_site_id
  group by inventory_kind,category_name,name,model
 ), page as (
  select * from grouped order by category_name,name,model,inventory_kind
  limit greatest(1,least(coalesce(p_page_size,25),100))
  offset (greatest(1,least(coalesce(p_page,1),100000))::bigint-1)
    * greatest(1,least(coalesce(p_page_size,25),100))
 )
 select jsonb_build_object('rows',coalesce((select jsonb_agg(to_jsonb(p)
   order by p.category_name,p.name,p.model,p.inventory_kind) from page p),'[]'::jsonb),
   'total',(select count(*) from grouped));
$$;
revoke all on function public.site_holding_groups(uuid,integer,integer)
 from public,anon,authenticated,service_role;
grant execute on function public.site_holding_groups(uuid,integer,integer) to authenticated;
