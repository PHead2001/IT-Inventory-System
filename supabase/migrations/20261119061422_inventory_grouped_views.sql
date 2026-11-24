-- Read-only invoker APIs. PostgREST 12.2+ hoists this function proconfig timeout
-- before execution; do not replace it with set_config inside the function body.
create function private.inventory_view_matches(
 p_query text default '',p_type text default 'all',p_status text default 'active',
 p_category_id uuid default null,p_location_code text default null,
 p_site_id uuid default null,p_low_stock boolean default false
) returns setof public.inventory_search_rows
language sql stable security invoker set search_path='' set statement_timeout='5s' as $$
 select r.* from public.inventory_search_rows r
 where exists(select 1 from public.app_members where user_id=auth.uid() and active)
  and (p_type='all' or r.kind=p_type)
  and (p_status='all' or (p_status='active' and r.status='active')
   or (p_status='historical' and r.status<>'active'))
  and (p_category_id is null or r.category_id=p_category_id)
  and (p_location_code is null or p_location_code=any(r.ancestor_codes))
  and (p_site_id is null or r.site_id=p_site_id)
  and (not coalesce(p_low_stock,false) or r.stock_state in ('needs_restocking','out_of_stock'))
  and strpos(lower(concat_ws(' ',r.name,r.description,r.manufacturer,r.model,
   r.category_name,r.location_code,r.location_name,r.breadcrumb,r.site_code,
   r.site_name,r.asset_tag,r.serial_number,r.item_code)),lower(coalesce(p_query,'')))>0;
$$;

create function public.inventory_grouped_page(
 p_query text default '',p_type text default 'all',p_status text default 'active',
 p_category_id uuid default null,p_location_code text default null,
 p_site_id uuid default null,p_page integer default 1,p_low_stock boolean default false
) returns jsonb language plpgsql stable security invoker
set search_path='' set statement_timeout='5s' as $$
declare total_groups bigint; keys text[]; holding record; projected jsonb;
 groups jsonb:='[]'; group_value jsonb; group_key text; previous_key text;
 storage_total numeric:=0; site_total numeric:=0; holding_count integer:=0;
 physical_count integer:=0; result jsonb; group_header jsonb;
 groups_bytes integer:=2; holding_bytes integer:=2; next_holding_bytes integer;
 group_bytes integer; candidate_bytes integer; projected_bytes integer;
begin
 perform 1 from public.app_members where user_id=auth.uid() and active;
 if not found then raise exception using errcode='P1001',message='forbidden'; end if;
 if p_type is null or p_type not in ('all','quantity','asset') or p_status is null
  or p_status not in ('active','historical','all') or p_page is null or p_page not between 1 and 100000
  or p_query is null or length(p_query)>200 or length(p_location_code)>100 then
  raise exception using errcode='P1012',message='invalid_inventory_view'; end if;
 -- This aggregates identities only. Holdings are bounded below before JSON construction.
 with identities as materialized (
  select kind,entity_id,min(lower(name)) as ordering_name
  from private.inventory_view_matches(p_query,p_type,p_status,p_category_id,p_location_code,p_site_id,p_low_stock)
  group by kind,entity_id
 ), page as (
  select * from identities order by ordering_name,kind,entity_id
  limit 25 offset (p_page::bigint-1)*25
 ) select (select count(*) from identities),
  coalesce((select array_agg(kind||':'||entity_id order by ordering_name,kind,entity_id) from page),array[]::text[])
  into total_groups,keys;
 -- STABLE uses the request's single MVCC snapshot for count, keys and full matches.
 for holding in
  select r.* from private.inventory_view_matches(p_query,p_type,p_status,p_category_id,p_location_code,p_site_id,p_low_stock) r
  where (r.kind||':'||r.entity_id)=any(keys)
  order by array_position(keys,r.kind||':'||r.entity_id),coalesce(r.location_code,''),coalesce(r.site_code,''),r.location_id,r.site_id
  limit 1001
 loop
  physical_count:=physical_count+1;
  if physical_count>1000 then raise exception using errcode='P1025',message='inventory_group_holdings_limit'; end if;
  -- Project only the existing human search contract, excluding descriptions/custom JSON.
  projected:=jsonb_build_object('kind',holding.kind,'entity_id',holding.entity_id,
   'name',holding.name,'category_name',holding.category_name,'status',holding.status,
   'location_id',holding.location_id,'site_id',holding.site_id,'site_code',holding.site_code,
   'site_name',holding.site_name,'custody_kind',holding.custody_kind,'quantity',holding.quantity,
   'asset_tag',holding.asset_tag,'item_code',holding.item_code,'serial_number',holding.serial_number,
   'recorded_total',null,'reorder_threshold',holding.reorder_threshold,'stock_state',holding.stock_state,
   'available_quantity',holding.available_quantity,'assigned_quantity',holding.assigned_quantity,
   'recorded_quantity',holding.recorded_quantity);
  projected_bytes:=octet_length(projected::text);
  -- Every projected row contains only schema-bounded labels/identifiers and scalar
  -- counts. Guard that intermediate independently before collecting any array.
  if projected_bytes>65536 then raise exception using errcode='P1025',message='inventory_group_byte_limit'; end if;
  group_key:=holding.kind||':'||holding.entity_id;
  if previous_key is distinct from group_key then
   if previous_key is not null then
    groups_bytes:=groups_bytes+octet_length(group_value::text)+case when jsonb_array_length(groups)>0 then 2 else 0 end;
    groups:=groups||jsonb_build_array(group_value);
   end if;
   group_value:=jsonb_build_object('row',projected,'holdings','[]'::jsonb);
   storage_total:=0; site_total:=0; holding_count:=0; previous_key:=group_key;
   holding_bytes:=2;
  end if;
  if holding.kind='quantity' then
   if holding.custody_kind='storage' then storage_total:=storage_total+coalesce(holding.quantity,0);
   elsif holding.custody_kind='site' then site_total:=site_total+coalesce(holding.quantity,0); end if;
   if coalesce(holding.quantity,0)>0 and (holding.location_id is not null or holding.site_id is not null) then holding_count:=holding_count+1; end if;
  elsif holding.location_id is not null or holding.site_id is not null then holding_count:=holding_count+1; end if;
  group_header:=jsonb_build_object('row',group_value->'row','holdings','[]'::jsonb,
   'scoped_storage',storage_total::text,'scoped_site',site_total::text,'holding_count',holding_count);
  -- jsonb::text uses two-byte ", " separators. Replace each empty-array pair
  -- exactly, including current count digit widths, before appending the row.
  next_holding_bytes:=holding_bytes+projected_bytes+case when jsonb_array_length(group_value->'holdings')>0 then 2 else 0 end;
  group_bytes:=octet_length(group_header::text)-2+next_holding_bytes;
  candidate_bytes:=octet_length(jsonb_build_object('rows','[]'::jsonb,'total',total_groups,'holding_rows',physical_count)::text)-2
   +groups_bytes+group_bytes+case when jsonb_array_length(groups)>0 then 2 else 0 end;
  if candidate_bytes>2097152 then raise exception using errcode='P1025',message='inventory_group_byte_limit'; end if;
  group_value:=group_header||jsonb_build_object('holdings',(group_value->'holdings')||jsonb_build_array(projected));
  holding_bytes:=next_holding_bytes;
 end loop;
 if previous_key is not null then
  groups:=groups||jsonb_build_array(group_value);
 end if;
 result:=jsonb_build_object('rows',groups,'total',total_groups,'holding_rows',physical_count);
 if octet_length(result::text)>2097152 then raise exception using errcode='P1025',message='inventory_group_byte_limit'; end if;
 return result;
end; $$;

create function public.metadata_inventory_columns(p_query text default '',p_selected uuid[] default array[]::uuid[])
returns jsonb language plpgsql stable security invoker set search_path='' set statement_timeout='5s' as $$
declare result jsonb;
begin
 perform 1 from public.app_members where user_id=auth.uid() and active;
 if not found then raise exception using errcode='P1001',message='forbidden'; end if;
 if p_query is null or length(p_query)>200 or p_selected is null or cardinality(p_selected)>6
  or exists(select 1 from unnest(p_selected) id where id is null)
  or (select count(distinct id) from unnest(p_selected) id)<>cardinality(p_selected) then
  raise exception using errcode='P1012',message='invalid_column_request'; end if;
 with latest as materialized (
  select distinct on (f.field_id) f.field_id,f.label,m.field_type,c.name as category_name,
   (c.published_form_revision_id is distinct from f.revision_id) as legacy
  from public.form_revision_fields f join public.category_form_revisions rev on rev.id=f.revision_id and rev.status='published'
  join public.metadata_fields m on m.id=f.field_id join public.categories c on c.id=m.category_id
  order by f.field_id,(c.published_form_revision_id=f.revision_id) desc,rev.published_at desc,rev.id desc
 ), labelled as materialized (
  select *,count(*) over(partition by category_name,label) as same_name_count,
   row_number() over(partition by category_name,label order by field_id) as label_ordinal from latest
 ), matches as materialized (
  select * from labelled where strpos(lower(concat_ws(' ',label,category_name)),lower(p_query))>0
 ), page as (select field_id from matches order by lower(category_name),lower(label),field_id limit 200),
 selected as (select * from labelled where field_id in(select field_id from page) or field_id=any(p_selected))
 select jsonb_build_object('truncated',(select count(*)>200 from matches),'fields',coalesce((select jsonb_agg(
  jsonb_build_object('id',field_id,'label',left(label,200),'category',left(category_name,200),'type',field_type,
   'legacy',legacy,'ordinal',case when same_name_count>1 then label_ordinal else null end)
  order by lower(category_name),lower(label),field_id) from selected),'[]'::jsonb)) into result;
 if octet_length(result::text)>524288 then raise exception using errcode='P1025',message='column_catalog_too_large'; end if;
 return result;
end; $$;

revoke all on function private.inventory_view_matches(text,text,text,uuid,text,uuid,boolean),
 public.inventory_grouped_page(text,text,text,uuid,text,uuid,integer,boolean),
 public.metadata_inventory_columns(text,uuid[]) from public,anon,authenticated,service_role;
grant execute on function private.inventory_view_matches(text,text,text,uuid,text,uuid,boolean),
 public.inventory_grouped_page(text,text,text,uuid,text,uuid,integer,boolean),
 public.metadata_inventory_columns(text,uuid[]) to authenticated;

-- Ordinary previews have an explicit human-answer projection. The original
-- provenance-rich metadata_describe_batch API remains available unchanged.
create function public.metadata_selected_preview(p_keys jsonb,p_fields uuid[]) returns jsonb
language plpgsql stable security invoker set search_path='' set statement_timeout='5s' as $$
declare supplied jsonb; kind text; raw_id text; map_key text; category_uuid uuid;
 values_json jsonb; field_key text; entry jsonb; limited_entry jsonb; described jsonb;
 answer jsonb; path jsonb; value_json jsonb; answers jsonb; result jsonb:='{}'::jsonb;
 label_value text; display_value text; raw_label text; raw_display text;
 record_truncated boolean; answer_truncated boolean; multi_truncated boolean; field_uuid uuid; applies text[]; absence_state text; missing_legacy boolean;
begin
 perform 1 from public.app_members where user_id=auth.uid() and active;
 if not found then raise exception using errcode='P1001',message='forbidden'; end if;
 if jsonb_typeof(p_keys) is distinct from 'array' or octet_length(p_keys::text)>4096
  or jsonb_array_length(p_keys)>25 then
  raise exception using errcode='P1012',message='invalid_batch_request'; end if;
 if p_fields is null or cardinality(p_fields)>6 or exists(select 1 from unnest(p_fields) id where id is null)
  or (select count(distinct id) from unnest(p_fields) id)<>cardinality(p_fields) then
  raise exception using errcode='P1012',message='invalid_column_request'; end if;
 for supplied in select value from jsonb_array_elements(p_keys) loop
  if jsonb_typeof(supplied) is distinct from 'object' or not(supplied ?& array['kind','id'])
   or (select count(*) from jsonb_object_keys(supplied))<>2
   or jsonb_typeof(supplied->'kind') is distinct from 'string'
   or jsonb_typeof(supplied->'id') is distinct from 'string' then
   raise exception using errcode='P1012',message='invalid_batch_key'; end if;
  kind:=supplied->>'kind'; raw_id:=supplied->>'id';
  if kind not in ('quantity','asset') or raw_id !~
   '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
   raise exception using errcode='P1012',message='invalid_batch_key'; end if;
  map_key:=kind||':'||raw_id;
  if result ? map_key then raise exception using errcode='P1012',message='duplicate_batch_key'; end if;
  if kind='quantity' then
   select q.category_id,q.custom_values into category_uuid,values_json
    from public.quantity_items q where q.id=raw_id::uuid;
  else
   select a.category_id,a.custom_values into category_uuid,values_json
    from public.serialized_assets a where a.id=raw_id::uuid;
  end if;
  if not found then raise exception using errcode='P1010',message='not_found'; end if;
  answers:='[]'::jsonb;
  record_truncated:=false;
  foreach field_uuid in array p_fields loop
   field_key:=field_uuid::text; entry:=values_json->field_key;
   if entry is null then
    select f.label,m.field_type,f.applies_to into raw_label,raw_display,applies
     from public.categories c join public.category_form_revisions rev on rev.id=c.published_form_revision_id and rev.status='published'
     join public.form_revision_fields f on f.revision_id=rev.id and f.field_id=field_uuid
     join public.metadata_fields m on m.id=f.field_id where c.id=category_uuid;
    if found then
     absence_state:=case when kind=any(applies) then 'unanswered' else 'not_applicable' end;
     missing_legacy:=false;
    else
     select f.label,m.field_type into raw_label,raw_display from public.form_revision_fields f
      join public.category_form_revisions rev on rev.id=f.revision_id and rev.status='published'
      join public.metadata_fields m on m.id=f.field_id
      where f.field_id=field_uuid and m.category_id=category_uuid
      order by rev.published_at desc,rev.id desc limit 1;
     missing_legacy:=found;
     absence_state:=case when found then 'historical_unavailable' else 'field_unavailable' end;
    end if;
    label_value:=left(coalesce(raw_label,'Unavailable field'),160);
    while octet_length(label_value)>160 or octet_length(to_jsonb(label_value)::text)>162
     loop label_value:=left(label_value,length(label_value)-1); end loop;
    answers:=answers||jsonb_build_array(jsonb_build_object('fieldId',field_key,'label',label_value,
     'type',coalesce(raw_display,'unavailable'),'displayValue',case absence_state
      when 'unanswered' then 'Unanswered' when 'not_applicable' then 'Not applicable to this tracking type'
      when 'historical_unavailable' then 'Historical field - no current definition' else 'Field unavailable for this category' end,
     'truncated',label_value<>coalesce(raw_label,'Unavailable field'),'present',false,'legacy',missing_legacy,'absence',absence_state));
    record_truncated:=record_truncated or label_value<>coalesce(raw_label,'Unavailable field');
    continue;
   end if;
   limited_entry:=entry; multi_truncated:=false;
   -- At most three selected paths are resolved; do not build a megabyte
   -- description merely to discard it. Immutable revision paths remain truth.
   if jsonb_typeof(entry->'value')='array' then
    multi_truncated:=jsonb_array_length(entry->'value')>3;
    limited_entry:=jsonb_set(entry,'{value}',(select coalesce(jsonb_agg(value order by position),'[]'::jsonb)
     from jsonb_array_elements(entry->'value') with ordinality v(value,position) where position<=3));
   end if;
   described:=public.metadata_describe_values(jsonb_build_object(field_key,limited_entry),category_uuid);
   answer:=described->field_key; value_json:=answer->'value';
   raw_label:=coalesce(answer->>'label','Field'); raw_display:='';
   if jsonb_array_length(coalesce(answer->'option_paths','[]'::jsonb))>0 then
    for path in select value from jsonb_array_elements(answer->'option_paths') loop
     if raw_display<>'' then raw_display:=raw_display||'; '; end if;
     raw_display:=raw_display||array_to_string(array(select jsonb_array_elements_text(path)),' / ');
     if octet_length(raw_display)>256 then exit; end if;
    end loop;
   elsif jsonb_typeof(value_json)='boolean' then
    raw_display:=case when value_json='true'::jsonb then 'Yes' else 'No' end;
   elsif jsonb_typeof(value_json)='string' then raw_display:=value_json#>>'{}';
   elsif jsonb_typeof(value_json)='object' and value_json ?& array['amount','currency'] then
    raw_display:=(value_json->>'amount')||' '||(value_json->>'currency');
   elsif value_json='null'::jsonb then raw_display:='Unanswered';
   else raw_display:=coalesce(value_json::text,''); end if;
   label_value:=left(raw_label,160); display_value:=left(raw_display,256);
   -- Budget JSON escaping too (for example a user-entered control character
   -- occupies six response bytes). Every legal 25-record page still fits.
   while octet_length(label_value)>160 or octet_length(to_jsonb(label_value)::text)>162
    loop label_value:=left(label_value,length(label_value)-1); end loop;
   while octet_length(display_value)>256 or octet_length(to_jsonb(display_value)::text)>258
    loop display_value:=left(display_value,length(display_value)-1); end loop;
   answer_truncated:=multi_truncated or label_value<>raw_label or display_value<>raw_display;
   record_truncated:=record_truncated or answer_truncated;
   answers:=answers||jsonb_build_array(jsonb_build_object('fieldId',field_key,'label',label_value,'type',answer->>'field_type',
    'displayValue',display_value,'truncated',answer_truncated,'present',true,'legacy',coalesce((answer->>'legacy')::boolean,false),'absence',null));
  end loop;
  result:=result||jsonb_build_object(map_key,jsonb_build_object('answers',answers,'truncated',record_truncated));
 end loop;
 if octet_length(result::text)>131072 then
  raise exception using errcode='P1025',message='metadata_preview_too_large'; end if;
 return result;
end; $$;


revoke all on function public.metadata_selected_preview(jsonb,uuid[]) from public,anon,authenticated,service_role;
grant execute on function public.metadata_selected_preview(jsonb,uuid[]) to authenticated;
