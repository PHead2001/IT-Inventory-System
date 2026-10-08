-- Ordinary previews have an explicit human-answer projection. The original
-- provenance-rich metadata_describe_batch API remains available unchanged.
create function public.metadata_preview_batch(p_keys jsonb) returns jsonb
language plpgsql stable security invoker set search_path='' set statement_timeout='5s' as $$
declare supplied jsonb; kind text; raw_id text; map_key text; category_uuid uuid;
 values_json jsonb; field_key text; entry jsonb; limited_entry jsonb; described jsonb;
 answer jsonb; path jsonb; value_json jsonb; answers jsonb; result jsonb:='{}'::jsonb;
 label_value text; display_value text; raw_label text; raw_display text;
 record_truncated boolean; answer_truncated boolean; multi_truncated boolean;
begin
 perform 1 from public.app_members where user_id=auth.uid() and active;
 if not found then raise exception using errcode='P1001',message='forbidden'; end if;
 if jsonb_typeof(p_keys) is distinct from 'array' or octet_length(p_keys::text)>4096
  or jsonb_array_length(p_keys)>25 then
  raise exception using errcode='P1012',message='invalid_batch_request'; end if;
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
  record_truncated:=(select count(*)>3 from jsonb_object_keys(values_json));
  for field_key,entry in select key,value from jsonb_each(values_json) order by key limit 3 loop
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
   answers:=answers||jsonb_build_array(jsonb_build_object('label',label_value,'type',answer->>'field_type',
    'displayValue',display_value,'truncated',answer_truncated));
  end loop;
  result:=result||jsonb_build_object(map_key,jsonb_build_object('answers',answers,'truncated',record_truncated));
 end loop;
 if octet_length(result::text)>49152 then
  raise exception using errcode='P1025',message='metadata_preview_too_large'; end if;
 return result;
end; $$;

-- Counts are entries, never physical units: one positive quantity holding plus
-- one active asset. Text preserves PostgreSQL bigint precision at the API.
create function public.inventory_location_entry_counts(p_location_codes text[])
returns table(location_code text,entry_count text)
language plpgsql stable security invoker set search_path='' set statement_timeout='5s' as $$
begin
 perform 1 from public.app_members where user_id=auth.uid() and active;
 if not found then raise exception using errcode='P1001',message='forbidden'; end if;
 if p_location_codes is null or cardinality(p_location_codes)>100
  or octet_length(to_jsonb(p_location_codes)::text)>16384
  or exists(select 1 from unnest(p_location_codes) code where code is null or length(code) not between 1 and 100)
  or (select count(distinct code) from unnest(p_location_codes) code)<>cardinality(p_location_codes) then
  raise exception using errcode='P1012',message='invalid_location_count_request'; end if;
 return query
 with eligible as materialized (
  select l.id,l.code from public.locations l
  where l.code=any(p_location_codes) and l.active and l.can_hold_inventory
   and not exists(select 1 from public.locations child where child.parent_id=l.id)
 ), entries as (
  select b.location_id from public.stock_balances b join eligible l on l.id=b.location_id
   join public.quantity_items q on q.id=b.item_id where b.quantity>0 and not q.archived
  union all
  select a.location_id from public.serialized_assets a join eligible l on l.id=a.location_id where a.status='active'
 )
 select l.code,count(e.location_id)::text from eligible l left join entries e on e.location_id=l.id
 group by l.id,l.code order by l.code;
end; $$;
revoke all on function public.metadata_preview_batch(jsonb),public.inventory_location_entry_counts(text[])
 from public,anon,authenticated,service_role;
grant execute on function public.metadata_preview_batch(jsonb),public.inventory_location_entry_counts(text[]) to authenticated;
