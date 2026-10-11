-- Forward display-only correction for the unmerged choice-identity implementation.
-- Preserve persisted revisions, option order, answers, events and receipts.
create or replace function private.metadata_option_paths(rev uuid, field uuid, selected uuid[]) returns jsonb
language plpgsql stable set search_path='' as $$
declare labels jsonb:='{}'::jsonb; answer uuid; current_id uuid; node jsonb; path text[];
  paths jsonb:='[]'::jsonb; path_json jsonb; path_bytes integer:=2; option_count integer;
  reserved jsonb; used jsonb:='{}'::jsonb; ordinals jsonb:='{}'::jsonb;
  choices jsonb; choice jsonb; base_label text; candidate text; label_key text; candidate_key text; ordinal integer;
begin
  if selected is null or cardinality(selected)>1000 then
    raise exception using errcode='P1022',message='selection_resource_limit'; end if;
  if cardinality(selected)=0 then return paths; end if;
  select count(*) into option_count from (
    select 1 from public.form_revision_options where revision_id=rev and field_id=field limit 1001
  ) bounded;
  if option_count>1000 then raise exception using errcode='P1022',message='option_resource_limit'; end if;
  -- Stable UUID allocation is independent of editable navigation/sort order.
  -- Complete referenced revision, including retained inactive choices. Quote
  -- literal path delimiters/quotes/escapes so a root label cannot mimic a path.
  with bases as materialized (
    select option_id,parent_option_id,sort_order,
      case when position('/' in label)>0 or position('"' in label)>0 or position(chr(92) in label)>0
      then to_jsonb(coalesce(nullif(label,''),'Unnamed option'))::text
      else coalesce(nullif(label,''),'Unnamed option') end base
    from public.form_revision_options where revision_id=rev and field_id=field
  ) select coalesce(jsonb_agg(jsonb_build_object('id',option_id,'parent',parent_option_id,
    'base',base,'key',private.metadata_option_label_key(base)) order by option_id),'[]'::jsonb)
    into choices from bases;
  select coalesce(jsonb_object_agg(value->>'key',true),'{}'::jsonb) into reserved
    from jsonb_array_elements(choices);
  for choice in select value from jsonb_array_elements(choices) loop
    base_label:=choice->>'base'; label_key:=choice->>'key';
    ordinal:=coalesce((ordinals->>label_key)::integer,1);
    candidate:=base_label;
    candidate_key:=label_key;
    if used ? label_key then
      loop
        ordinal:=greatest(2,ordinal);
        candidate:=base_label||' ('||ordinal::text||')';
        -- A retained Unicode-whitespace-only label has an empty key; the
        -- normalizer trims the suffix's leading space in that case too.
        candidate_key:=case when label_key='' then '(' else label_key||' (' end||ordinal::text||')';
        ordinal:=ordinal+1;
        exit when not (reserved ? candidate_key) and not (used ? candidate_key);
      end loop;
    end if;
    ordinals:=ordinals||jsonb_build_object(label_key,greatest(2,ordinal));
    used:=used||jsonb_build_object(candidate_key,true);
    labels:=labels||jsonb_build_object(choice->>'id',
      jsonb_build_object('parent',choice->'parent','label',candidate));
  end loop;
  foreach answer in array selected loop
    path:=null; current_id:=answer;
    for depth in 1..64 loop
      exit when current_id is null;
      node:=labels->current_id::text;
      exit when node is null;
      path:=array_prepend(node->>'label',path);
      current_id:=(node->>'parent')::uuid;
    end loop;
    if current_id is not null and node is not null then
      raise exception using errcode='P1022',message='option_depth_or_cycle'; end if;
    path_json:=coalesce(to_jsonb(path),'null'::jsonb);
    path_bytes:=path_bytes+octet_length(path_json::text)+case when jsonb_array_length(paths)>0 then 2 else 0 end;
    if path_bytes>2096640 then
      raise exception using errcode='P1025',message='metadata_description_too_large'; end if;
    paths:=paths||jsonb_build_array(path_json);
  end loop;
  return paths;
end;
$$;
revoke all on function private.metadata_option_paths(uuid,uuid,uuid[])
  from public,anon,authenticated,service_role;
