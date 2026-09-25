-- Forward replacement after the first published-metadata migration may be deployed.
create or replace function public.metadata_publish(p_request_id uuid,p_payload jsonb) returns jsonb
language plpgsql volatile security definer set search_path='' set statement_timeout='5s' as $$
<<publish_block>>
declare actor uuid:=auth.uid(); actor_name text; normalized jsonb; replay jsonb;
  category_id uuid; expected bigint; expected_draft uuid; expected_published uuid; review_token uuid;
  category_row public.categories%rowtype; draft public.category_form_revisions%rowtype;
  reviewed private.form_impact_reviews%rowtype; event_id uuid;
  item public.quantity_items%rowtype; asset public.serialized_assets%rowtype;
begin
  select display_name into actor_name from public.app_members where user_id=actor
    and active and role='staff' and can_manage_configuration for share;
  if not found then raise exception using errcode='P1001',message='forbidden'; end if;
  perform private.inventory_payload(p_payload,array['category_id','expected_actor_id',
    'expected_draft_id','expected_draft_version','expected_published_revision_id','review_token']);
  if private.inventory_uuid(p_payload,'expected_actor_id') is distinct from actor then
    raise exception using errcode='P1001',message='actor_changed'; end if;
  category_id:=private.inventory_uuid(p_payload,'category_id');
  expected_draft:=private.inventory_uuid(p_payload,'expected_draft_id');
  expected:=private.configuration_version(p_payload,'expected_draft_version');
  expected_published:=private.inventory_uuid(p_payload,'expected_published_revision_id');
  review_token:=private.inventory_uuid(p_payload,'review_token');
  normalized:=jsonb_build_object('category_id',category_id,'expected_actor_id',actor,
    'expected_draft_id',expected_draft,'expected_draft_version',expected::text,
    'expected_published_revision_id',expected_published,'review_token',review_token);
  replay:=private.inventory_receipt(actor,p_request_id,'metadata_publish',normalized);
  if replay is not null then return replay; end if;
  perform private.configuration_catalog_lock(true);
  select * into category_row from public.categories where id=category_id for update;
  if not found or not category_row.active or category_row.removed_at is not null then
    raise exception using errcode='P1011',message='invalid_category'; end if;
  select * into draft from public.category_form_revisions r
    where r.category_id=(p_payload->>'category_id')::uuid and r.status='draft' for update;
  if not found or draft.id is distinct from expected_draft or draft.draft_version<>expected or
    category_row.published_form_revision_id is distinct from expected_published then
    raise exception using errcode='P1002',message='stale_form'; end if;
  -- Stock mutations do not take the catalog lock. Lock every referenced row in
  -- UUID order before checking the reviewed fingerprint against committed state.
  for item in select * from public.quantity_items q where q.category_id=publish_block.category_id order by q.id for update loop
    null;
  end loop;
  for asset in select * from public.serialized_assets a where a.category_id=publish_block.category_id order by a.id for update loop
    null;
  end loop;
  select * into reviewed from private.form_impact_reviews where token=review_token and actor_id=actor for update;
  if not found or reviewed.expires_at<=clock_timestamp() or reviewed.category_id<>category_id
    or reviewed.draft_id<>draft.id or reviewed.draft_version<>draft.draft_version
    or reviewed.published_id is distinct from category_row.published_form_revision_id
    or reviewed.reference_fingerprint<>private.metadata_reference_fingerprint(category_id) then
    raise exception using errcode='P1017',message='stale_form_review'; end if;
  perform private.metadata_compile_form(draft.id,category_id,draft.draft_definition);
  update public.category_form_revisions set status='published',published_at=now(),published_by=actor where id=draft.id;
  update public.categories set published_form_revision_id=draft.id,version=version+1 where id=category_id;
  -- All affected rows were locked in UUID order above. Compute each derived
  -- result once and update only changed flags as a set; no business events,
  -- versions, timestamps, values or provenance change.
  with computed as materialized (
    select q.id,private.metadata_needs(draft.id,'quantity',q.custom_values) needed
      from public.quantity_items q where q.category_id=publish_block.category_id
  )
  update public.quantity_items q set needs_metadata=computed.needed
    from computed where q.id=computed.id and q.needs_metadata is distinct from computed.needed;
  with computed as materialized (
    select a.id,private.metadata_needs(draft.id,'asset',a.custom_values) needed
      from public.serialized_assets a where a.category_id=publish_block.category_id
  )
  update public.serialized_assets a set needs_metadata=computed.needed
    from computed where a.id=computed.id and a.needs_metadata is distinct from computed.needed;
  insert into public.form_publication_events(actor_id,actor_name,category_id,revision_id,
    previous_revision_id,affected_quantity,affected_assets)
    values(actor,actor_name,category_id,draft.id,expected_published,
      reviewed.affected_quantity,reviewed.affected_assets) returning id into event_id;
  replay:=jsonb_build_object('entity_id',draft.id,'version',draft.revision_number::text,
    'published_revision_id',draft.id,'event_id',event_id,'changed',true);
  update private.mutation_requests set result=replay where actor_id=actor and request_id=p_request_id;
  return replay;
end;
$$;

-- Bounded identity input prevents clients from injecting unverified values.
-- Invoker reads retain the inventory/event RLS policy; the description
-- function independently checks active membership and immutable provenance.
create function public.metadata_describe_batch(p_mode text,p_keys jsonb) returns jsonb
language plpgsql stable security invoker set search_path='' set statement_timeout='5s' as $$
declare actor uuid:=auth.uid(); supplied jsonb; kind text; raw_id text; record_id uuid;
  map_key text; result jsonb:='{}'::jsonb; category_id uuid; values_json jsonb;
  described jsonb; entry jsonb; path jsonb; value_json jsonb;
  display text; piece text; summary text; abbreviated boolean;
begin
  perform 1 from public.app_members where user_id=actor and active;
  if not found then raise exception using errcode='P1001',message='forbidden'; end if;
  if p_mode is distinct from 'search' or
    jsonb_typeof(p_keys) is distinct from 'array' or
    octet_length(p_keys::text)>4096 or
    jsonb_array_length(p_keys)>25 then
    raise exception using errcode='P1012',message='invalid_batch_request'; end if;
  for supplied in select value from jsonb_array_elements(p_keys) loop
    if jsonb_typeof(supplied) is distinct from 'object' or
      not(supplied ?& array['kind','id']) or
      (select count(*) from jsonb_object_keys(supplied))<>2 or
      jsonb_typeof(supplied->'kind') is distinct from 'string' or
      jsonb_typeof(supplied->'id') is distinct from 'string' then
      raise exception using errcode='P1012',message='invalid_batch_key'; end if;
    kind:=supplied->>'kind'; raw_id:=supplied->>'id';
    if kind not in ('quantity','asset') or
      raw_id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      raise exception using errcode='P1012',message='invalid_batch_key'; end if;
    record_id:=raw_id::uuid; map_key:=kind||':'||raw_id;
    if result ? map_key then raise exception using errcode='P1012',message='duplicate_batch_key'; end if;
      if kind='quantity' then
        select q.category_id,q.custom_values into category_id,values_json
          from public.quantity_items q where q.id=record_id;
      else
        select a.category_id,a.custom_values into category_id,values_json
          from public.serialized_assets a where a.id=record_id;
      end if;
      if not found then raise exception using errcode='P1010',message='not_found'; end if;
      -- Search is an explicitly abbreviated preview; full values remain on
      -- detail, history and opt-in export. Keep the RPC response compact.
      described:=public.metadata_describe_values(values_json,category_id);
      summary:=''; abbreviated:=false;
      for entry in select value from jsonb_each(described) order by key loop
        value_json:=entry->'value';
        if jsonb_array_length(coalesce(entry->'option_paths','[]'::jsonb))>0 then
          display:='';
          for path in select value from jsonb_array_elements(entry->'option_paths') loop
            if display<>'' then display:=display||'; '; end if;
            display:=display||array_to_string(array(select jsonb_array_elements_text(path)),' / ');
            if length(display)>180 then exit; end if;
          end loop;
        elsif jsonb_typeof(value_json)='boolean' then
          display:=case when value_json='true'::jsonb then 'Yes' else 'No' end;
        elsif jsonb_typeof(value_json)='string' then
          display:=value_json#>>'{}';
        elsif jsonb_typeof(value_json)='number' then
          display:=value_json::text;
        elsif jsonb_typeof(value_json)='array' then
          select string_agg(v#>>'{}',', ') into display from jsonb_array_elements(value_json) v;
        elsif jsonb_typeof(value_json)='object' and value_json ?& array['amount','currency'] then
          display:=(value_json->>'amount')||' '||(value_json->>'currency');
        else display:=value_json::text;
        end if;
        piece:=coalesce(entry->>'label','Field')||': '||coalesce(display,'')||
          ' [revision '||coalesce(entry->>'validated_revision_id','unknown')||']'||
          case when entry->>'legacy'='true' then ' (legacy)' else '' end;
        if length(piece)>180 then piece:=left(piece,179)||'…'; abbreviated:=true; end if;
        if length(summary)+length(piece)+3>900 then abbreviated:=true; exit; end if;
        if summary<>'' then summary:=summary||' · '; end if;
        summary:=summary||piece;
      end loop;
      if abbreviated then summary:=summary||' … [summary abbreviated; open record for full values]'; end if;
      result:=result||jsonb_build_object(map_key,summary);
  end loop;
  return result;
end;
$$;
revoke all on function public.metadata_describe_batch(text,jsonb)
  from public,anon,authenticated,service_role;
grant execute on function public.metadata_describe_batch(text,jsonb) to authenticated;

-- History list pages project only compact operational snapshots. Event-owned
-- custom values remain in append-only events and are read one field at a time.
create or replace view public.inventory_history_rows with (security_invoker = true) as
select e.id, 'quantity'::text as kind, e.item_id as entity_id,
 i.name as entity_name, e.kind as event_type, e.created_at, e.actor_name, e.reason,
 case when e.before_metadata is null then null else e.before_metadata-'custom_values' end as before_metadata,
 case when e.after_metadata is null then null else e.after_metadata-'custom_values' end as after_metadata,
 null::uuid as from_location_id, null::uuid as to_location_id,
 coalesce((select jsonb_agg(jsonb_build_object(
   'location_id', x.location_id, 'delta', x.delta,
   'before_quantity', x.before_quantity, 'after_quantity', x.after_quantity
 ) order by x.location_id) from public.quantity_event_lines x where x.event_id = e.id), '[]'::jsonb) as lines,
 array(select x.location_id from public.quantity_event_lines x where x.event_id = e.id) as location_ids,
 (coalesce(e.before_metadata->'custom_values','{}'::jsonb)<>'{}'::jsonb or
   coalesce(e.after_metadata->'custom_values','{}'::jsonb)<>'{}'::jsonb) as custom_present,
 (coalesce(e.before_metadata->'custom_values','{}'::jsonb) is distinct from
   coalesce(e.after_metadata->'custom_values','{}'::jsonb)) as custom_changed
from public.quantity_events e join public.quantity_items i on i.id = e.item_id
union all
select e.id, 'asset', e.asset_id, a.name, e.kind, e.created_at, e.actor_name, e.reason,
 case when e.before_metadata is null then null else e.before_metadata-'custom_values' end,
 case when e.after_metadata is null then null else e.after_metadata-'custom_values' end,
 case when e.kind='metadata_updated' then null::uuid else e.from_location_id end,
 case when e.kind='metadata_updated' then null::uuid else e.to_location_id end,
 '[]'::jsonb,
 case when e.kind='metadata_updated' then '{}'::uuid[]
   else array_remove(array[e.from_location_id, e.to_location_id], null) end,
 (coalesce(e.before_metadata->'custom_values','{}'::jsonb)<>'{}'::jsonb or
   coalesce(e.after_metadata->'custom_values','{}'::jsonb)<>'{}'::jsonb),
 (coalesce(e.before_metadata->'custom_values','{}'::jsonb) is distinct from
   coalesce(e.after_metadata->'custom_values','{}'::jsonb))
from public.asset_events e join public.serialized_assets a on a.id = e.asset_id;

-- The public privileged boundary authenticates explicitly. All active members
-- can read all inventory events under the matching event RLS policies.
create function public.metadata_event_custom_page(
  p_kind text,p_event_id uuid,p_side text,p_field_id uuid default null,p_option_offset integer default 0
) returns jsonb language plpgsql stable security definer set search_path='' set statement_timeout='5s' as $$
declare actor uuid:=auth.uid(); before_state jsonb; after_state jsonb;
  before_values jsonb; after_values jsonb; all_values jsonb; side_values jsonb;
  selected_field text; next_field text; entry jsonb; source_entry jsonb;
  chosen_revision uuid; field_uuid uuid; field_label text; field_type text;
  owner_category uuid; current_revision uuid; event_category uuid;
  option_value jsonb; option_id uuid; option_path text[]; paths jsonb:='[]'::jsonb;
  option_total integer:=0; next_offset integer; result jsonb;
begin
  perform 1 from public.app_members where user_id=actor and active;
  if not found then raise exception using errcode='P1001',message='forbidden'; end if;
  if p_kind is null or p_kind not in ('quantity','asset') or
    p_side is null or p_side not in ('before','after') or
    p_event_id is null or p_option_offset is null or p_option_offset<0 or
    p_option_offset>1000 or p_option_offset%16<>0 then
    raise exception using errcode='P1012',message='invalid_history_page'; end if;
  if p_kind='quantity' then
    select e.before_metadata,e.after_metadata into before_state,after_state
      from public.quantity_events e where e.id=p_event_id;
  else
    select e.before_metadata,e.after_metadata into before_state,after_state
      from public.asset_events e where e.id=p_event_id;
  end if;
  if not found then raise exception using errcode='P1010',message='not_found'; end if;
  before_values:=coalesce(before_state->'custom_values','{}'::jsonb);
  after_values:=coalesce(after_state->'custom_values','{}'::jsonb);
  if jsonb_typeof(before_values) is distinct from 'object' or
    jsonb_typeof(after_values) is distinct from 'object' or
    octet_length(before_values::text)>262144 or octet_length(after_values::text)>262144 then
    raise exception using errcode='P1012',message='invalid_history_values'; end if;
  all_values:=before_values||after_values;
  if p_field_id is not null and not (all_values ? p_field_id::text) then
    raise exception using errcode='P1012',message='invalid_history_field'; end if;
  select min(key) into selected_field from jsonb_object_keys(all_values) key
    where p_field_id is null or key=p_field_id::text;
  if selected_field is null then
    if p_option_offset<>0 then raise exception using errcode='P1012',message='invalid_history_offset'; end if;
    return jsonb_build_object('event_id',p_event_id,'kind',p_kind,'side',p_side,
      'field_id',null,'next_field_id',null,'present',false,'option_paths','[]'::jsonb,
      'next_option_offset',null);
  end if;
  if selected_field !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    raise exception using errcode='P1012',message='invalid_history_field'; end if;
  select min(key) into next_field from jsonb_object_keys(all_values) key where key>selected_field;
  field_uuid:=selected_field::uuid;
  side_values:=case when p_side='before' then before_values else after_values end;
  entry:=side_values->selected_field;
  source_entry:=coalesce(entry,all_values->selected_field);
  if jsonb_typeof(source_entry) is distinct from 'object' or
    jsonb_typeof(source_entry->'validated_revision_id') is distinct from 'string' or
    (source_entry->>'validated_revision_id') !~
      '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    raise exception using errcode='P1012',message='invalid_history_provenance'; end if;
  chosen_revision:=(source_entry->>'validated_revision_id')::uuid;
  select f.label,m.field_type,m.category_id,c.published_form_revision_id
    into field_label,field_type,owner_category,current_revision
    from public.form_revision_fields f join public.metadata_fields m on m.id=f.field_id
    join public.categories c on c.id=m.category_id
    where f.revision_id=chosen_revision and f.field_id=field_uuid;
  if not found then raise exception using errcode='P1012',message='invalid_history_provenance'; end if;
  event_category:=nullif((case when p_side='before' then before_state else after_state end)->>'category_id','')::uuid;
  if entry is not null then
    if entry->>'validated_revision_id'<>chosen_revision::text or
      not private.metadata_value_valid(chosen_revision,field_uuid,entry->'value') then
      raise exception using errcode='P1012',message='invalid_history_value'; end if;
    if field_type='multi_select' then
      option_total:=jsonb_array_length(entry->'value');
      if option_total>1000 then raise exception using errcode='P1022',message='selection_resource_limit'; end if;
      if p_option_offset>0 and p_option_offset>=option_total then
        raise exception using errcode='P1012',message='invalid_history_offset'; end if;
      for option_value in select v.value from jsonb_array_elements(entry->'value')
        with ordinality as v(value,position) where v.position>p_option_offset
        order by v.position limit 16 loop
        option_id:=(option_value#>>'{}')::uuid;
        option_path:=private.metadata_option_path(chosen_revision,field_uuid,option_id);
        paths:=paths||jsonb_build_array(option_path);
        if octet_length(paths::text)>1500000 then
          raise exception using errcode='P1025',message='metadata_history_page_too_large'; end if;
      end loop;
      if option_total>p_option_offset+16 then next_offset:=p_option_offset+16; end if;
    elsif field_type in ('single_select','hierarchical_select') then
      if p_option_offset<>0 then raise exception using errcode='P1012',message='invalid_history_offset'; end if;
      option_id:=(entry->>'value')::uuid;
      paths:=jsonb_build_array(private.metadata_option_path(chosen_revision,field_uuid,option_id));
    elsif p_option_offset<>0 then
      raise exception using errcode='P1012',message='invalid_history_offset';
    end if;
  elsif p_option_offset<>0 then
    raise exception using errcode='P1012',message='invalid_history_offset';
  end if;
  result:=jsonb_build_object('event_id',p_event_id,'kind',p_kind,'side',p_side,
    'field_id',field_uuid,'next_field_id',next_field,'present',entry is not null,
    'value',entry->'value','validated_revision_id',entry->>'validated_revision_id',
    'label',field_label,'field_type',field_type,'owner_category_id',owner_category,
    'event_category_id',event_category,'current_published_revision_id',current_revision,
    'legacy',owner_category is distinct from event_category or
      chosen_revision is distinct from current_revision or
      not exists(select 1 from public.form_revision_fields current_field
        where current_field.revision_id=current_revision and current_field.field_id=field_uuid),
    'option_paths',paths,'option_offset',p_option_offset,'next_option_offset',next_offset);
  if octet_length(result::text)>2096640 then
    raise exception using errcode='P1025',message='metadata_history_page_too_large'; end if;
  return result;
end;
$$;
revoke all on function public.metadata_event_custom_page(text,uuid,text,uuid,integer)
  from public,anon,authenticated,service_role;
grant execute on function public.metadata_event_custom_page(text,uuid,text,uuid,integer) to authenticated;
