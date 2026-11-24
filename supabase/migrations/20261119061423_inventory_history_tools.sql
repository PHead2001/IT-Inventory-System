-- Additive U313 reads. Do not replace the legacy history RPC/view or event data.
-- This relation does not aggregate ledger lines: bounded consumers select keys first.
create view private.inventory_history_event_keys with (security_invoker = true) as
select e.id, 'quantity'::text kind, e.item_id entity_id, i.name entity_name,
 e.kind event_type, e.created_at, e.actor_id, e.actor_name, e.reason,
 e.before_metadata-'custom_values' as before_metadata, e.after_metadata-'custom_values' as after_metadata, i.item_code current_item_code,
 null::text current_asset_tag, null::text current_serial_number,
 null::uuid from_location_id, null::uuid to_location_id,
 ae.id assignment_event_id, ae.kind assignment_kind,
 ae.from_location_id assignment_from_location_id, ae.to_location_id assignment_to_location_id,
 ae.from_site_id assignment_from_site_id, ae.to_site_id assignment_to_site_id,
 ae.from_label assignment_from_label, ae.to_label assignment_to_label,
 ae.quantity assignment_quantity, ae.reference assignment_reference,
 (coalesce(e.before_metadata->'custom_values','{}'::jsonb)<>'{}'::jsonb or coalesce(e.after_metadata->'custom_values','{}'::jsonb)<>'{}'::jsonb) custom_present,
 (coalesce(e.before_metadata->'custom_values','{}'::jsonb) is distinct from coalesce(e.after_metadata->'custom_values','{}'::jsonb)) custom_changed
from public.quantity_events e join public.quantity_items i on i.id=e.item_id
left join public.assignment_events ae on ae.quantity_event_id=e.id
union all
select e.id,'asset',e.asset_id,a.name,e.kind,e.created_at,e.actor_id,e.actor_name,e.reason,
 e.before_metadata-'custom_values',e.after_metadata-'custom_values',null::text,a.asset_tag,a.serial_number,
 case when e.kind='metadata_updated' then null::uuid else e.from_location_id end,
 case when e.kind='metadata_updated' then null::uuid else e.to_location_id end,
 ae.id,ae.kind,ae.from_location_id,ae.to_location_id,ae.from_site_id,ae.to_site_id,
 ae.from_label,ae.to_label,ae.quantity,ae.reference,
 (coalesce(e.before_metadata->'custom_values','{}'::jsonb)<>'{}'::jsonb or coalesce(e.after_metadata->'custom_values','{}'::jsonb)<>'{}'::jsonb),
 (coalesce(e.before_metadata->'custom_values','{}'::jsonb) is distinct from coalesce(e.after_metadata->'custom_values','{}'::jsonb))
from public.asset_events e join public.serialized_assets a on a.id=e.asset_id
left join public.assignment_events ae on ae.asset_event_id=e.id;
revoke all on private.inventory_history_event_keys from public,anon,authenticated,service_role;
grant select on private.inventory_history_event_keys to authenticated;

create function private.inventory_history_matching(
 p_type text default 'all', p_entity_id uuid default null, p_location_code text default null,
 p_query text default '', p_actor_id uuid default null, p_event_type text default 'all',
 p_from timestamptz default null, p_until timestamptz default null, p_key_limit integer default null
) returns table(id uuid,kind text,created_at timestamptz)
language plpgsql stable security invoker set search_path='' set statement_timeout='5s' as $$
begin
  perform 1 from public.app_members where user_id=auth.uid() and active;
  if not found then raise exception using errcode='42501',message='history_access_denied'; end if;
 if p_type is null or p_type not in ('all','quantity','asset')
  or p_event_type is null or p_event_type not in ('all','movements','created','received','moved',
    'adjusted','metadata_updated','archived','restored','location_corrected','retired',
    'site_opened','site_issued','site_assigned','site_returned','site_transferred',
    'site_corrected','site_written_off','site_retired')
  -- Match the persisted quantity_events/asset_events kind constraints.
  or (p_type='quantity' and p_event_type in ('location_corrected','retired','site_assigned','site_retired'))
  or (p_type='asset' and p_event_type in ('received','adjusted','archived','site_issued'))
  or char_length(coalesce(p_query,''))>200 or char_length(coalesce(p_location_code,''))>200
  or (p_from is not null and not isfinite(p_from)) or (p_until is not null and not isfinite(p_until))
  or (p_from is not null and p_until is not null and p_from>=p_until)
  or (p_key_limit is not null and (p_key_limit<1 or p_key_limit>10001))
 then raise exception using errcode='P1001',message='invalid_history_filters'; end if;
 return query select r.id,r.kind,r.created_at from private.inventory_history_event_keys r
 where (p_type='all' or r.kind=p_type)
  and (p_entity_id is null or r.entity_id=p_entity_id)
  and (p_actor_id is null or r.actor_id=p_actor_id)
  and (p_from is null or r.created_at>=p_from) and (p_until is null or r.created_at<p_until)
  and (p_event_type='all' or r.event_type=p_event_type or
    (p_event_type='movements' and r.event_type in
      ('moved','site_issued','site_assigned','site_returned','site_transferred')))
  and strpos(lower(concat_ws(' ',r.entity_name,r.current_item_code,r.current_asset_tag,r.current_serial_number,
    r.before_metadata->>'name',r.after_metadata->>'name',
    r.before_metadata->>'item_code',r.after_metadata->>'item_code',
    r.before_metadata->>'asset_tag',r.after_metadata->>'asset_tag',
    r.before_metadata->>'serial_number',r.after_metadata->>'serial_number')),lower(coalesce(p_query,'')))>0
  and (p_location_code is null or exists (
   select 1 from public.inventory_locations l where p_location_code=any(l.ancestor_codes)
   and (l.id in (r.from_location_id,r.to_location_id,r.assignment_from_location_id,r.assignment_to_location_id)
    or (r.kind='quantity' and exists (select 1 from public.quantity_event_lines x
       where x.event_id=r.id and x.location_id=l.id)))
  )) order by r.created_at desc,r.kind,r.id limit p_key_limit;
end $$;

create function public.inventory_history_v2(
 p_type text default 'all', p_entity_id uuid default null, p_location_code text default null,
 p_query text default '', p_actor_id uuid default null, p_event_type text default 'all',
 p_from timestamptz default null, p_until timestamptz default null,
 p_page integer default 1, p_page_size integer default 25
) returns jsonb language plpgsql stable security invoker set search_path='' set statement_timeout='5s' as $$
declare total bigint; rows jsonb:='[]'::jsonb; lines jsonb; row_data jsonb; line_data jsonb;
 r record; x record; response jsonb; used_bytes bigint; row_bytes bigint; extra_bytes bigint;
 physical_lines integer:=0; row_count integer:=0;
begin
  perform 1 from public.app_members where user_id=auth.uid() and active;
  if not found then raise exception using errcode='42501',message='history_access_denied'; end if;
 select count(*) into total from private.inventory_history_matching(
  p_type,p_entity_id,p_location_code,p_query,p_actor_id,p_event_type,p_from,p_until);
 -- Current page/count API uses safe integers. Reject instead of rounding an exact count.
 if total>9007199254740991 then raise exception using errcode='P1025',message='history_count_too_large'; end if;
 used_bytes:=octet_length(jsonb_build_object('rows',rows,'total',total)::text);
 for r in select e.* from private.inventory_history_matching(
  p_type,p_entity_id,p_location_code,p_query,p_actor_id,p_event_type,p_from,p_until) k
  join private.inventory_history_event_keys e on e.kind=k.kind and e.id=k.id
  order by k.created_at desc,k.kind,k.id
  limit greatest(1,least(coalesce(p_page_size,25),100))
  offset (greatest(1,least(coalesce(p_page,1),100000))::bigint-1)*greatest(1,least(coalesce(p_page_size,25),100))
 loop
  lines:='[]'::jsonb;
  row_data:=(to_jsonb(r)-array['actor_id','current_item_code','current_asset_tag','current_serial_number'])||jsonb_build_object('lines',lines);
  row_bytes:=octet_length(row_data::text);
  if used_bytes+row_bytes+(case when row_count=0 then 0 else 2 end)>2097152 then
   raise exception using errcode='P1025',message='history_page_too_large'; end if;
  if r.kind='quantity' then
   -- No nested aggregate is evaluated before the cumulative row/byte guard.
   for x in select * from public.quantity_event_lines where event_id=r.id order by location_id limit 10001 loop
    physical_lines:=physical_lines+1;
    if physical_lines>10000 then raise exception using errcode='P1013',message='history_line_limit'; end if;
    line_data:=jsonb_build_object('location_id',x.location_id,'delta',x.delta,'before_quantity',x.before_quantity,'after_quantity',x.after_quantity);
    extra_bytes:=octet_length(line_data::text)+case when lines='[]'::jsonb then 0 else 2 end;
    if used_bytes+row_bytes+extra_bytes+(case when row_count=0 then 0 else 2 end)>2097152 then
     raise exception using errcode='P1025',message='history_page_too_large'; end if;
    row_bytes:=row_bytes+extra_bytes;
    lines:=lines||jsonb_build_array(line_data);
   end loop;
  end if;
  row_data:=jsonb_set(row_data,'{lines}',lines);
  used_bytes:=used_bytes+row_bytes+case when row_count=0 then 0 else 2 end;
  rows:=rows||jsonb_build_array(row_data); row_count:=row_count+1;
 end loop;
 response:=jsonb_build_object('total',total,'rows',rows);
 if octet_length(response::text)>2097152 then raise exception using errcode='P1025',message='history_page_too_large'; end if;
 return response;
end $$;

-- Latest *recorded* name, including inactive historical actors. No directory join.
-- Disambiguation is calculated over the full authorized actor set, before search/cap.
create function public.inventory_history_actors(p_query text default '',p_selected_id uuid default null,p_page integer default 1)
returns jsonb language plpgsql stable security invoker set search_path='' set statement_timeout='5s' as $$
declare result jsonb; rows jsonb:='[]'::jsonb; row_data jsonb; r record;
 total bigint:=0; used_bytes bigint; row_bytes bigint; row_count integer:=0;
begin
 perform 1 from public.app_members where user_id=auth.uid() and active;
 if not found then raise exception using errcode='42501',message='history_access_denied'; end if;
 if char_length(coalesce(p_query,''))>200 or p_page is null or p_page<1 or p_page>100000 then
  raise exception using errcode='P1001',message='invalid_actor_search'; end if;
 -- A safe-count-sized header is conservative until the cursor supplies total.
 used_bytes:=octet_length(jsonb_build_object('rows',rows,'total',9007199254740991)::text);
 for r in
 with latest as materialized (
  select distinct on (e.actor_id) e.actor_id,e.actor_name
   from private.inventory_history_event_keys e order by e.actor_id,e.created_at desc,e.kind,e.id
 ), first_event as materialized (
  select distinct on (e.actor_id) e.actor_id,e.created_at,e.kind,e.id
   from private.inventory_history_event_keys e order by e.actor_id,e.created_at,e.kind,e.id
 ), actors as materialized (
  select l.*,f.created_at first_recorded_at,
   count(*) over(partition by lower(l.actor_name)) same_name_count,
   row_number() over(partition by lower(l.actor_name) order by f.created_at,f.kind,f.id,l.actor_id) name_ordinal
   from latest l join first_event f using(actor_id)
 ), matches as materialized (
  select * from actors where strpos(lower(actor_name),lower(coalesce(p_query,'')))>0
 ), page as materialized (
  select * from matches order by lower(actor_name),actor_id limit 50 offset (p_page::bigint-1)*50
 ), selected as (
  select * from actors where actor_id=p_selected_id and not exists(select 1 from page where actor_id=p_selected_id)
 ), counted as (select count(*) n from matches)
 select a.*,(select n from counted) total from (select * from page union all select * from selected) a
 union all select null::uuid,null::text,null::timestamptz,null::bigint,null::bigint,n from counted order by actor_name,actor_id
 loop
  total:=r.total;
  if total>9007199254740991 then raise exception using errcode='P1025',message='history_count_too_large'; end if;
  if r.actor_id is null then continue; end if;
  if r.same_name_count>9007199254740991 or r.name_ordinal>9007199254740991 then
   raise exception using errcode='P1025',message='history_count_too_large'; end if;
  row_data:=to_jsonb(r)-'total'; row_bytes:=octet_length(row_data::text);
  if used_bytes+row_bytes+(case when row_count=0 then 0 else 2 end)>131072 then
   raise exception using errcode='P1025',message='history_actors_too_large'; end if;
  used_bytes:=used_bytes+row_bytes+case when row_count=0 then 0 else 2 end;
  rows:=rows||jsonb_build_array(row_data); row_count:=row_count+1;
 end loop;
 result:=jsonb_build_object('rows',rows,'total',total);
 if octet_length(result::text)>131072 then raise exception using errcode='P1025',message='history_actors_too_large'; end if;
 return result;
end $$;

-- One STABLE SQL statement snapshot for keys, labels and full storage/site ledger.
-- LIMIT precedes every ledger aggregate; oversize fails instead of truncating an event.
create function public.inventory_history_export_snapshot(
 p_type text default 'all', p_entity_id uuid default null, p_location_code text default null,
 p_query text default '', p_actor_id uuid default null, p_event_type text default 'all',
 p_from timestamptz default null, p_until timestamptz default null
) returns jsonb language plpgsql stable security invoker set search_path='' set statement_timeout='5s' as $$
declare
 event_keys uuid[]; event_kinds text[]; event_count integer; physical_rows integer:=0;
 rows jsonb:='[]'::jsonb; row_data jsonb; event_row jsonb; response jsonb;
 used_bytes bigint; row_bytes bigint; r record; x record;
 exported_at timestamptz:=statement_timestamp();
begin
  perform 1 from public.app_members where user_id=auth.uid() and active;
  if not found then raise exception using errcode='42501',message='history_access_denied'; end if;
 select array_agg(k.id order by k.created_at desc,k.kind,k.id),
  array_agg(k.kind order by k.created_at desc,k.kind,k.id),count(*)::integer
 into event_keys,event_kinds,event_count from (
  select id,kind,created_at from private.inventory_history_matching(
   p_type,p_entity_id,p_location_code,p_query,p_actor_id,p_event_type,p_from,p_until,10001)
   order by created_at desc,kind,id limit 10001
 ) k;
 used_bytes:=octet_length(jsonb_build_object('rows','[]'::jsonb,'event_count',event_count,'row_count',10000,'exported_at',to_char(exported_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'))::text);
 if event_count>10000 then raise exception using errcode='P1013',message='export_row_limit'; end if;
 -- Count physical ledger rows before building JSON so the row cap is decided
 -- deterministically rather than by whichever bound is crossed first while serializing.
 select count(*) into physical_rows from (
  select 1 from public.quantity_event_lines q where q.event_id=any(event_keys)
  union all
  select 1 from public.site_quantity_event_lines q where q.event_id=any(event_keys)
  limit 10001
 ) ledger_rows;
 if event_count+physical_rows>10000 then raise exception using errcode='P1013',message='export_row_limit'; end if;
 physical_rows:=0;
 for r in select e.*,fl.code from_code,fl.breadcrumb from_label,tl.code to_code,tl.breadcrumb to_label,
  afl.code assignment_from_code,atl.code assignment_to_code,
  fs.code from_site_code,ts.code to_site_code
  from unnest(event_keys,event_kinds) with ordinality k(id,kind,ordinal)
  join private.inventory_history_event_keys e on e.id=k.id and e.kind=k.kind
  left join public.inventory_locations fl on fl.id=e.from_location_id
  left join public.inventory_locations tl on tl.id=e.to_location_id
  left join public.inventory_locations afl on afl.id=e.assignment_from_location_id
  left join public.inventory_locations atl on atl.id=e.assignment_to_location_id
  left join public.sites fs on fs.id=e.assignment_from_site_id
  left join public.sites ts on ts.id=e.assignment_to_site_id
  order by k.ordinal
 loop
  -- Explicit scalar allowlist. Arbitrary custom JSON and file URLs never leave SQL.
  event_row:=jsonb_build_object('row_type','event','event_id',r.id,'kind',r.kind,'entity_id',r.entity_id,
   'event_type',r.event_type,'created_at',to_char(r.created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
   'actor_id',r.actor_id,'actor_name',r.actor_name,'name_current',r.entity_name,
   'name_before',r.before_metadata->>'name','name_after',r.after_metadata->>'name',
   'item_code_current',r.current_item_code,'item_code_before',r.before_metadata->>'item_code','item_code_after',r.after_metadata->>'item_code',
   'asset_tag_current',r.current_asset_tag,'asset_tag_before',r.before_metadata->>'asset_tag','asset_tag_after',r.after_metadata->>'asset_tag',
   'serial_number_current',r.current_serial_number,'serial_number_before',r.before_metadata->>'serial_number','serial_number_after',r.after_metadata->>'serial_number',
   'reason',r.reason,'reference',r.assignment_reference,'event_quantity',r.assignment_quantity,
   'from_location_id',coalesce(r.assignment_from_location_id,r.from_location_id),
   'from_location_code',coalesce(r.assignment_from_code,r.from_code),
   'from_label',coalesce(r.assignment_from_label,r.from_label),
   'to_location_id',coalesce(r.assignment_to_location_id,r.to_location_id),
   'to_location_code',coalesce(r.assignment_to_code,r.to_code),
   'to_label',coalesce(r.assignment_to_label,r.to_label),
   'from_site_id',r.assignment_from_site_id,'from_site_code',r.from_site_code,
   'to_site_id',r.assignment_to_site_id,'to_site_code',r.to_site_code,
   'endpoint_label_provenance',case when r.assignment_event_id is null then 'current reference labels' else 'recorded custody labels; current codes' end);
  physical_rows:=physical_rows+1;
  row_bytes:=octet_length(event_row::text);
  if row_bytes>2097152 then raise exception using errcode='P1025',message='single_export_event_too_large'; end if;
  used_bytes:=used_bytes+row_bytes+case when physical_rows=1 then 0 else 2 end;
  if physical_rows>10000 then raise exception using errcode='P1013',message='export_row_limit'; end if;
  if used_bytes>2097152 then raise exception using errcode='P1025',message='export_byte_limit'; end if;
  rows:=rows||jsonb_build_array(event_row);
  if r.kind='quantity' then
   for x in select ledger.*,l.code,l.breadcrumb,s.code site_code,s.name site_name
    from (
     select q.location_id,null::uuid site_id,q.delta,q.before_quantity,q.after_quantity
      from public.quantity_event_lines q where q.event_id=r.id
     union all
     select null::uuid,q.site_id,q.delta,q.before_quantity,q.after_quantity
      from public.site_quantity_event_lines q where q.event_id=r.id
    ) ledger
    left join public.inventory_locations l on l.id=ledger.location_id
    left join public.sites s on s.id=ledger.site_id
    order by ledger.location_id nulls last,ledger.site_id nulls last
    limit 10001
   loop
    physical_rows:=physical_rows+1;
    if physical_rows>10000 then raise exception using errcode='P1013',message='export_row_limit'; end if;
    row_data:=jsonb_build_object('row_type','quantity_line','event_id',r.id,'kind',r.kind,'entity_id',r.entity_id,
     'location_id',x.location_id,'location_code',x.code,'location_label',x.breadcrumb,
     'site_id',x.site_id,'site_code',x.site_code,'site_label',x.site_name,
     'before_quantity',x.before_quantity,'delta',x.delta,'after_quantity',x.after_quantity,
     'line_label_provenance','current reference labels');
    row_bytes:=octet_length(row_data::text);
    if row_bytes>2097152 then raise exception using errcode='P1025',message='single_export_event_too_large'; end if;
    used_bytes:=used_bytes+row_bytes+case when physical_rows=1 then 0 else 2 end;
    if used_bytes>2097152 then raise exception using errcode='P1025',message='export_byte_limit'; end if;
    rows:=rows||jsonb_build_array(row_data);
   end loop;
  end if;
 end loop;
 response:=jsonb_build_object('rows',rows,'event_count',event_count,'row_count',physical_rows,
  'exported_at',to_char(exported_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'));
 if octet_length(response::text)>2097152 then raise exception using errcode='P1025',message='export_byte_limit'; end if;
 return response;
end $$;

revoke all on function private.inventory_history_matching(text,uuid,text,text,uuid,text,timestamptz,timestamptz,integer),
 public.inventory_history_v2(text,uuid,text,text,uuid,text,timestamptz,timestamptz,integer,integer),
 public.inventory_history_actors(text,uuid,integer),
 public.inventory_history_export_snapshot(text,uuid,text,text,uuid,text,timestamptz,timestamptz)
 from public,anon,service_role;
grant execute on function private.inventory_history_matching(text,uuid,text,text,uuid,text,timestamptz,timestamptz,integer),
 public.inventory_history_v2(text,uuid,text,text,uuid,text,timestamptz,timestamptz,integer,integer),
 public.inventory_history_actors(text,uuid,integer),
 public.inventory_history_export_snapshot(text,uuid,text,text,uuid,text,timestamptz,timestamptz)
 to authenticated;

create index quantity_events_actor_history on public.quantity_events(actor_id,created_at desc,id);
create index asset_events_actor_history on public.asset_events(actor_id,created_at desc,id);
notify pgrst,'reload schema';
