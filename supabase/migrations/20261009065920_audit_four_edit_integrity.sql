-- F401: forward-only no-op enforcement for all supported metadata update APIs.
-- Existing normalized receipt payloads, authorization and replay order are preserved.
-- A no-op writes only its ordinary atomic receipt, never inventory state or history.
begin;

-- Semantic metadata equality never rewrites retained answer provenance. Exact JSON
-- equality preserves the existing grandfather contract; only valid historical
-- datetimes additionally compare their exact PostgreSQL microsecond instants.
create function private.metadata_answer_unchanged(entry jsonb, field uuid, candidate jsonb)
returns boolean language plpgsql stable set search_path='' as $$
declare historical uuid; kind text;
begin
 if entry is null or not(entry ? 'value') then return false; end if;
 if entry->'value' is not distinct from candidate then return true; end if;
 if jsonb_typeof(entry->'validated_revision_id') is distinct from 'string'
   or entry->>'validated_revision_id' !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then return false; end if;
 historical:=(entry->>'validated_revision_id')::uuid;
 select m.field_type into kind from public.form_revision_fields f
 join public.metadata_fields m on m.id=f.field_id
 where f.revision_id=historical and f.field_id=field;
 if kind is distinct from 'datetime' then return false; end if;
 -- Validate both strings before casting: no malformed input, offset coercion,
 -- fractional rounding or current/caller-supplied schema can grant equality.
 if not private.metadata_value_valid(historical,field,entry->'value')
   or not private.metadata_value_valid(historical,field,candidate) then return false; end if;
 return (entry->>'value')::timestamptz = (candidate#>>'{}')::timestamptz;
end; $$;
revoke all on function private.metadata_answer_unchanged(jsonb,uuid,jsonb) from public,anon,authenticated,service_role;

create or replace function private.metadata_apply_patch(rev uuid, entity_kind text, prior jsonb, patch jsonb)
returns jsonb language plpgsql stable set search_path='' as $$
declare result jsonb:=coalesce(prior,'{}'::jsonb); field_key text; field_uuid uuid;
  cfg public.form_revision_fields%rowtype; value jsonb;
begin
  if jsonb_typeof(patch) is distinct from 'object' then
    raise exception using errcode='P1012',message='invalid_custom_patch'; end if;
  if exists(select 1 from jsonb_object_keys(patch) k where k not in ('set','unset')) or
    jsonb_typeof(coalesce(patch->'set','{}'::jsonb))<>'object' or
    jsonb_typeof(coalesce(patch->'unset','[]'::jsonb))<>'array' then
    raise exception using errcode='P1012',message='invalid_custom_patch'; end if;
  for field_key in select jsonb_object_keys(coalesce(patch->'set','{}'::jsonb)) loop
    if field_key !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then raise exception using errcode='P1012',message='invalid_field_id'; end if;
    field_uuid:=field_key::uuid;
    if field_key<>field_uuid::text then raise exception using errcode='P1012',message='noncanonical_field_id'; end if;
    if exists(select 1 from jsonb_array_elements(coalesce(patch->'unset','[]'::jsonb)) x
      where jsonb_typeof(x)='string' and x#>>'{}'=field_key) then
      raise exception using errcode='P1012',message='patch_overlap'; end if;
    select * into cfg from public.form_revision_fields where revision_id=rev and field_id=field_uuid
      and entity_kind=any(applies_to);
    if not found then raise exception using errcode='P1021',message='field_not_applicable'; end if;
    value:=patch->'set'->field_key;
    if not private.metadata_answer_unchanged(result->field_key,field_uuid,value) then
      if not private.metadata_value_valid(rev,field_uuid,value) then
        raise exception using errcode='P1021',message='invalid_custom_value'; end if;
      value:=private.metadata_canonical_value(rev,field_uuid,value);
      result:=jsonb_set(result,array[field_key],jsonb_build_object('value',value,'validated_revision_id',rev));
    end if;
  end loop;
  for value in select x from jsonb_array_elements(coalesce(patch->'unset','[]'::jsonb)) x loop
    if jsonb_typeof(value)<>'string' or (value#>>'{}') !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then
      raise exception using errcode='P1012',message='invalid_unset_field'; end if;
    field_key:=value#>>'{}'; field_uuid:=field_key::uuid;
    if field_key<>field_uuid::text then raise exception using errcode='P1012',message='noncanonical_field_id'; end if;
    select * into cfg from public.form_revision_fields where revision_id=rev and field_id=field_uuid
      and entity_kind=any(applies_to);
    if not found then
      raise exception using errcode='P1021',message='field_not_applicable'; end if;
    if cfg.required then raise exception using errcode='P1021',message='required_field_cannot_unset'; end if;
    result:=result-field_key;
  end loop;
  if octet_length(result::text)>262144 then
    raise exception using errcode='P1022',message='custom_values_too_large'; end if;
  return result;
end;
$$;

create or replace function public.quantity_update(p_request_id uuid,p_payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
 v_actor uuid; v_actor_name text; v_payload jsonb; v_result jsonb;
 v_id uuid; v_version integer; v_event uuid:=gen_random_uuid();
 v_name text; v_description text; v_category uuid; v_previous_category uuid; v_category_name text; v_previous_category_name text; v_manufacturer text; v_model text; v_threshold integer; v_item_code text;
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
 perform private.inventory_payload(p_payload,array['item_id','expected_version','name','description','category_id','manufacturer','model','reorder_threshold','item_code']);
 v_id:=private.inventory_uuid(p_payload,'item_id'); v_version:=private.inventory_integer(p_payload,'expected_version',1);
 v_name:=private.inventory_text(p_payload,'name',200,true);
 v_description:=private.inventory_text(p_payload,'description',4000);
 v_category:=private.inventory_uuid(p_payload,'category_id');
 v_manufacturer:=private.inventory_text(p_payload,'manufacturer',200);
 v_model:=private.inventory_text(p_payload,'model',200);
 if p_payload ? 'reorder_threshold' then v_threshold:=private.inventory_threshold(p_payload); end if;
 if p_payload ? 'item_code' then v_item_code:=private.inventory_item_code_payload(p_payload); end if;

 v_payload:=jsonb_build_object('item_id',v_id,'expected_version',v_version,'name',v_name,'description',v_description,'category_id',v_category,'manufacturer',v_manufacturer,'model',v_model);

 if p_payload ? 'reorder_threshold' then v_payload:=v_payload || jsonb_build_object('reorder_threshold',v_threshold); end if;
 if p_payload ? 'item_code' then v_payload:=v_payload || jsonb_build_object('item_code',v_item_code); end if;
 v_result:=private.inventory_receipt(v_actor,p_request_id,'quantity_update',v_payload);
 if v_result is not null then return v_result; end if;
 perform private.configuration_catalog_lock(false);
 select category_id into v_previous_category from public.quantity_items where id=v_id;
 perform id from public.categories where id in (v_previous_category,v_category) order by id for share;
 select name into v_category_name from public.categories where id=v_category;
 select * into v_item from public.quantity_items where id=v_id for update;
 if not found then raise exception using errcode='P1010',message='not_found'; end if;
 if v_item.version<>v_version then raise exception using errcode='P1002',message='stale_version'; end if;
 select name into v_previous_category_name from public.categories where id=v_item.category_id;
 if v_item.archived then raise exception using errcode='P1008',message='invalid_transition'; end if;
 if not(p_payload ? 'reorder_threshold') then v_threshold:=v_item.reorder_threshold; end if;
 if not(p_payload ? 'item_code') then v_item_code:=v_item.item_code; end if;
 perform private.inventory_category(v_category,v_item.category_id);

 -- Compare effective normalized values only after authorization, replay and locked checks.
 if v_item.name is not distinct from v_name
   and v_item.description is not distinct from v_description
   and v_item.category_id is not distinct from v_category
   and v_item.manufacturer is not distinct from v_manufacturer
   and v_item.model is not distinct from v_model
   and v_item.reorder_threshold is not distinct from v_threshold
   and v_item.item_code is not distinct from v_item_code then
  v_result:=jsonb_build_object('entity_id',v_id,'version',v_item.version,'event_id',null,'changed',false);
  update private.mutation_requests set result=v_result where actor_id=v_actor and request_id=p_request_id;
  return v_result;
 end if;
 update public.quantity_items set name=v_name,description=v_description,category_id=v_category,manufacturer=v_manufacturer,model=v_model,reorder_threshold=v_threshold,item_code=v_item_code where id=v_id;
 if v_item.version=2147483647 then raise exception using errcode='P1008',message='invalid_transition'; end if;
 v_version:=v_item.version+1; update public.quantity_items set version=v_version,updated_at=now() where id=v_id; insert into public.quantity_events(id,item_id,kind,actor_id,actor_name,reason,before_metadata,after_metadata,version) values(v_event,v_id,'metadata_updated',v_actor,v_actor_name,v_reason,jsonb_build_object('name',v_item.name,'description',v_item.description,'category_id',v_item.category_id,'category_name',v_previous_category_name,'manufacturer',v_item.manufacturer,'model',v_item.model,'reorder_threshold',v_item.reorder_threshold,'item_code',v_item.item_code),jsonb_build_object('name',v_name,'description',v_description,'category_id',v_category,'category_name',v_category_name,'manufacturer',v_manufacturer,'model',v_model,'reorder_threshold',v_threshold,'item_code',v_item_code),v_version);
 v_result:=jsonb_build_object('entity_id',v_id,'version',v_version,'event_id',v_event,'changed',true);

 update private.mutation_requests set result=v_result where actor_id=v_actor and request_id=p_request_id;
 return v_result;
exception when unique_violation then raise exception using errcode='P1007',message='identifier_conflict';
end;
$$;

create or replace function public.asset_update(p_request_id uuid,p_payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
 v_actor uuid; v_actor_name text; v_payload jsonb; v_result jsonb;
 v_id uuid; v_version integer; v_event uuid:=gen_random_uuid();
 v_name text; v_description text; v_category uuid; v_previous_category uuid; v_category_name text; v_previous_category_name text; v_manufacturer text; v_model text;
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
 perform private.inventory_payload(p_payload,array['asset_id','expected_version','name','description','category_id','manufacturer','model','asset_tag','serial_number']);
 v_id:=private.inventory_uuid(p_payload,'asset_id'); v_version:=private.inventory_integer(p_payload,'expected_version',1);
 v_name:=private.inventory_text(p_payload,'name',200,true);
 v_description:=private.inventory_text(p_payload,'description',4000);
 v_category:=private.inventory_uuid(p_payload,'category_id');
 v_manufacturer:=private.inventory_text(p_payload,'manufacturer',200);
 v_model:=private.inventory_text(p_payload,'model',200);

 v_tag:=lower(private.inventory_text(p_payload,'asset_tag',100));
 v_serial:=private.inventory_text(p_payload,'serial_number',200);

 v_payload:=jsonb_build_object('asset_id',v_id,'expected_version',v_version,'name',v_name,'description',v_description,'category_id',v_category,'manufacturer',v_manufacturer,'model',v_model,'asset_tag',v_tag,'serial_number',v_serial);

 v_result:=private.inventory_receipt(v_actor,p_request_id,'asset_update',v_payload);
 if v_result is not null then return v_result; end if;
 perform private.configuration_catalog_lock(false);
 select category_id into v_previous_category from public.serialized_assets where id=v_id;
 perform id from public.categories where id in (v_previous_category,v_category) order by id for share;
 select name into v_category_name from public.categories where id=v_category;
 select * into v_asset from public.serialized_assets where id=v_id for update;
 if not found then raise exception using errcode='P1010',message='not_found'; end if;
 if v_asset.version<>v_version then raise exception using errcode='P1002',message='stale_version'; end if;
 select name into v_previous_category_name from public.categories where id=v_asset.category_id;
 perform private.inventory_category(v_category,v_asset.category_id);

 -- Compare effective normalized values only after authorization, replay and locked checks.
 if v_asset.name is not distinct from v_name
   and v_asset.description is not distinct from v_description
   and v_asset.category_id is not distinct from v_category
   and v_asset.manufacturer is not distinct from v_manufacturer
   and v_asset.model is not distinct from v_model
   and v_asset.asset_tag is not distinct from v_tag
   and v_asset.serial_number is not distinct from v_serial then
  v_result:=jsonb_build_object('entity_id',v_id,'version',v_asset.version,'event_id',null,'changed',false);
  update private.mutation_requests set result=v_result where actor_id=v_actor and request_id=p_request_id;
  return v_result;
 end if;
 update public.serialized_assets set name=v_name,description=v_description,category_id=v_category,manufacturer=v_manufacturer,model=v_model,asset_tag=v_tag,serial_number=v_serial where id=v_id;
 if v_asset.version=2147483647 then raise exception using errcode='P1008',message='invalid_transition'; end if;
 v_version:=v_asset.version+1; update public.serialized_assets set version=v_version,updated_at=now() where id=v_id; insert into public.asset_events(id,asset_id,kind,actor_id,actor_name,reason,from_location_id,to_location_id,before_metadata,after_metadata,version) values(v_event,v_id,'metadata_updated',v_actor,v_actor_name,v_reason,null,null,jsonb_build_object('name',v_asset.name,'description',v_asset.description,'category_id',v_asset.category_id,'category_name',v_previous_category_name,'manufacturer',v_asset.manufacturer,'model',v_asset.model,'asset_tag',v_asset.asset_tag,'serial_number',v_asset.serial_number),jsonb_build_object('name',v_name,'description',v_description,'category_id',v_category,'category_name',v_category_name,'manufacturer',v_manufacturer,'model',v_model,'asset_tag',v_tag,'serial_number',v_serial),v_version);
 v_result:=jsonb_build_object('entity_id',v_id,'version',v_version,'event_id',v_event,'changed',true);

 update private.mutation_requests set result=v_result where actor_id=v_actor and request_id=p_request_id;
 return v_result;
exception when unique_violation then raise exception using errcode='P1007',message='identifier_conflict';
end;
$$;

create or replace function private.metadata_mutate_v2(p_request_id uuid,p_payload jsonb,p_kind text,p_action text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare actor uuid:=auth.uid(); actor_name text; normalized jsonb; replay jsonb;
  category_uuid uuid; expected_rev uuid; current_rev uuid; record_id uuid; expected_version integer;
  name_value text; description_value text; manufacturer_value text; model_value text;
  tag_value text; serial_value text; threshold_value integer; item_code_value text; location_uuid uuid;
  initial_quantity integer; custom_patch jsonb; new_custom jsonb; old_custom jsonb;
  item public.quantity_items%rowtype; asset public.serialized_assets%rowtype;
  version_value integer; event_id uuid:=gen_random_uuid(); category_name text;
  previous_category_name text; old_metadata jsonb; new_metadata jsonb; needs boolean;
  category_changed boolean:=false;
  operation text:=p_kind||'_'||p_action||'_v2';
begin
  if p_kind not in ('quantity','asset') or p_action not in ('create','update') then
    raise exception using errcode='P1012',message='invalid_operation'; end if;
  select display_name into actor_name from public.app_members where user_id=actor and active and role='staff' for share;
  if not found then raise exception using errcode='P1001',message='forbidden'; end if;
  if p_kind='quantity' and p_action='create' then
    perform private.inventory_payload(p_payload,array['name','description','category_id','manufacturer','model',
      'reorder_threshold','item_code','initial_location_id','initial_quantity','expected_published_revision_id','custom_patch']);
  elsif p_kind='quantity' then
    perform private.inventory_payload(p_payload,array['item_id','expected_version','name','description','category_id',
      'manufacturer','model','reorder_threshold','item_code','expected_published_revision_id','custom_patch',
      'acknowledge_legacy_values']);
  elsif p_action='create' then
    perform private.inventory_payload(p_payload,array['name','description','category_id','manufacturer','model',
      'asset_tag','serial_number','location_id','expected_published_revision_id','custom_patch']);
  else
    perform private.inventory_payload(p_payload,array['asset_id','expected_version','name','description','category_id',
      'manufacturer','model','asset_tag','serial_number','expected_published_revision_id','custom_patch',
      'acknowledge_legacy_values']);
  end if;
  name_value:=private.inventory_text(p_payload,'name',200,true);
  description_value:=private.inventory_text(p_payload,'description',4000);
  category_uuid:=private.inventory_uuid(p_payload,'category_id');
  expected_rev:=private.inventory_uuid(p_payload,'expected_published_revision_id');
  manufacturer_value:=private.inventory_text(p_payload,'manufacturer',200);
  model_value:=private.inventory_text(p_payload,'model',200);
  custom_patch:=coalesce(p_payload->'custom_patch','{}'::jsonb);
  if p_payload ? 'acknowledge_legacy_values' and
    jsonb_typeof(p_payload->'acknowledge_legacy_values') is distinct from 'boolean' then
    raise exception using errcode='P1012',message='invalid_legacy_acknowledgement'; end if;
  if p_kind='quantity' then
    if p_payload ? 'reorder_threshold' then threshold_value:=private.inventory_threshold(p_payload); end if;
    if p_payload ? 'item_code' then item_code_value:=private.inventory_item_code_payload(p_payload); end if;
    if p_action='create' then
      location_uuid:=private.inventory_uuid(p_payload,'initial_location_id',false);
      initial_quantity:=private.inventory_integer(p_payload,'initial_quantity',0,0);
      if initial_quantity>0 and location_uuid is null then raise exception using errcode='P1012',message='invalid_input'; end if;
    else record_id:=private.inventory_uuid(p_payload,'item_id');
      expected_version:=private.inventory_integer(p_payload,'expected_version',1); end if;
  else
    tag_value:=lower(private.inventory_text(p_payload,'asset_tag',100));
    serial_value:=private.inventory_text(p_payload,'serial_number',200);
    if p_action='create' then location_uuid:=private.inventory_uuid(p_payload,'location_id');
    else record_id:=private.inventory_uuid(p_payload,'asset_id');
      expected_version:=private.inventory_integer(p_payload,'expected_version',1); end if;
  end if;
  normalized:=jsonb_build_object('name',name_value,'description',description_value,'category_id',category_uuid,
    'manufacturer',manufacturer_value,'model',model_value,'expected_published_revision_id',expected_rev,
    'custom_patch',custom_patch);
  if p_kind='quantity' then
    if p_payload ? 'reorder_threshold' then normalized:=normalized||jsonb_build_object('reorder_threshold',threshold_value); end if;
    if p_payload ? 'item_code' then normalized:=normalized||jsonb_build_object('item_code',item_code_value); end if;
    if p_action='create' then normalized:=normalized||jsonb_build_object('initial_location_id',location_uuid,
      'initial_quantity',initial_quantity);
    else normalized:=normalized||jsonb_build_object('item_id',record_id,'expected_version',expected_version); end if;
  else
    normalized:=normalized||jsonb_build_object('asset_tag',tag_value,'serial_number',serial_value);
    if p_action='create' then normalized:=normalized||jsonb_build_object('location_id',location_uuid);
    else normalized:=normalized||jsonb_build_object('asset_id',record_id,'expected_version',expected_version); end if;
  end if;
  if p_action='update' then
    normalized:=normalized||jsonb_build_object('acknowledge_legacy_values',
      coalesce((p_payload->>'acknowledge_legacy_values')::boolean,false));
  end if;
  replay:=private.inventory_receipt(actor,p_request_id,operation,normalized);
  if replay is not null then return replay; end if;
  perform private.configuration_catalog_lock(false);
  select published_form_revision_id,name into current_rev,category_name from public.categories
    where id=category_uuid and active and removed_at is null for share;
  if not found then raise exception using errcode='P1011',message='invalid_category'; end if;
  if current_rev is distinct from expected_rev then
    raise exception using errcode='P1024',message='stale_published_form'; end if;
  if p_action='update' then
    if p_kind='quantity' then
      select * into item from public.quantity_items where id=record_id for update;
      if not found then raise exception using errcode='P1010',message='not_found'; end if;
      if item.version<>expected_version then raise exception using errcode='P1002',message='stale_version'; end if;
      if item.archived then raise exception using errcode='P1008',message='invalid_transition'; end if;
      old_custom:=item.custom_values;
      category_changed:=item.category_id<>category_uuid;
      if not(p_payload ? 'reorder_threshold') then threshold_value:=item.reorder_threshold; end if;
      if not(p_payload ? 'item_code') then item_code_value:=item.item_code; end if;
      old_metadata:=jsonb_build_object('name',item.name,'description',item.description,'category_id',item.category_id,
        'manufacturer',item.manufacturer,'model',item.model,'reorder_threshold',item.reorder_threshold,
        'item_code',item.item_code,
        'custom_values',item.custom_values,'form_revision_id',item.validated_form_revision_id);
      select name into previous_category_name from public.categories where id=item.category_id;
    else
      select * into asset from public.serialized_assets where id=record_id for update;
      if not found then raise exception using errcode='P1010',message='not_found'; end if;
      if asset.version<>expected_version then raise exception using errcode='P1002',message='stale_version'; end if;
      old_custom:=asset.custom_values;
      category_changed:=asset.category_id<>category_uuid;
      old_metadata:=jsonb_build_object('name',asset.name,'description',asset.description,'category_id',asset.category_id,
        'manufacturer',asset.manufacturer,'model',asset.model,'asset_tag',asset.asset_tag,
        'serial_number',asset.serial_number,'custom_values',asset.custom_values,
        'form_revision_id',asset.validated_form_revision_id);
      select name into previous_category_name from public.categories where id=asset.category_id;
    end if;
    old_metadata:=old_metadata||jsonb_build_object('category_name',previous_category_name);
  end if;
  new_custom:=private.metadata_apply_patch(current_rev,p_kind,coalesce(old_custom,'{}'::jsonb),custom_patch);
  needs:=private.metadata_needs(current_rev,p_kind,new_custom);
  if needs and (p_action='create' or (p_kind='quantity' and item.category_id<>category_uuid)
    or (p_kind='asset' and asset.category_id<>category_uuid)) then
    raise exception using errcode='P1023',message='required_published_metadata_missing'; end if;
  if category_changed and old_custom<>'{}'::jsonb then
    if p_payload->'acknowledge_legacy_values' is distinct from 'true'::jsonb then
      raise exception using errcode='P1026',message='legacy_metadata_acknowledgement_required'; end if;
    perform set_config('app.metadata_reassignment_reviewed','on',true);
  end if;
  if p_action='update' and (
    (p_kind='quantity' and item.name is not distinct from name_value
        and item.description is not distinct from description_value
        and item.category_id is not distinct from category_uuid
        and item.manufacturer is not distinct from manufacturer_value
        and item.model is not distinct from model_value
        and item.reorder_threshold is not distinct from threshold_value
        and item.item_code is not distinct from item_code_value
        and item.custom_values is not distinct from new_custom)
    or (p_kind='asset' and asset.name is not distinct from name_value
        and asset.description is not distinct from description_value
        and asset.category_id is not distinct from category_uuid
        and asset.manufacturer is not distinct from manufacturer_value
        and asset.model is not distinct from model_value
        and asset.asset_tag is not distinct from tag_value
        and asset.serial_number is not distinct from serial_value
        and asset.custom_values is not distinct from new_custom)) then
    version_value:=case when p_kind='quantity' then item.version else asset.version end;
    replay:=jsonb_build_object('entity_id',record_id,'version',version_value,'event_id',null,
      'changed',false,'published_revision_id',current_rev,'needs_metadata',needs);
    update private.mutation_requests set result=replay where actor_id=actor and request_id=p_request_id;
    return replay;
  end if;
  if p_kind='quantity' then
    if p_action='create' then
      if location_uuid is not null then perform private.inventory_destination(location_uuid); end if;
      insert into public.quantity_items(name,description,category_id,manufacturer,model,reorder_threshold,item_code,
        custom_values,validated_form_revision_id,needs_metadata)
        values(name_value,description_value,category_uuid,manufacturer_value,model_value,threshold_value,item_code_value,
          new_custom,current_rev,needs) returning id,version into record_id,version_value;
      if initial_quantity>0 then
        insert into public.stock_balances values(record_id,location_uuid,initial_quantity);
      end if;
    else
      if item.version=2147483647 then raise exception using errcode='P1008',message='invalid_transition'; end if;
      update public.quantity_items set name=name_value,description=description_value,category_id=category_uuid,
        manufacturer=manufacturer_value,model=model_value,reorder_threshold=threshold_value,item_code=item_code_value,
        custom_values=new_custom,validated_form_revision_id=current_rev,needs_metadata=needs,
        version=item.version+1,updated_at=now() where id=record_id returning version into version_value;
    end if;
    new_metadata:=jsonb_build_object('name',name_value,'description',description_value,'category_id',category_uuid,
      'category_name',category_name,'manufacturer',manufacturer_value,'model',model_value,
      'reorder_threshold',threshold_value,'item_code',item_code_value,'custom_values',new_custom,'form_revision_id',current_rev);
    insert into public.quantity_events(id,item_id,kind,actor_id,actor_name,before_metadata,after_metadata,version)
      values(event_id,record_id,case when p_action='create' then 'created' else 'metadata_updated' end,
        actor,actor_name,old_metadata,new_metadata,version_value);
    if p_action='create' and initial_quantity>0 then
      insert into public.quantity_event_lines values(event_id,location_uuid,initial_quantity,0,initial_quantity);
    end if;
  else
    if p_action='create' then
      perform private.inventory_destination(location_uuid);
      insert into public.serialized_assets(name,description,category_id,manufacturer,model,asset_tag,
        serial_number,location_id,custom_values,validated_form_revision_id,needs_metadata)
        values(name_value,description_value,category_uuid,manufacturer_value,model_value,tag_value,
          serial_value,location_uuid,new_custom,current_rev,needs) returning id,version into record_id,version_value;
    else
      if asset.version=2147483647 then raise exception using errcode='P1008',message='invalid_transition'; end if;
      update public.serialized_assets set name=name_value,description=description_value,category_id=category_uuid,
        manufacturer=manufacturer_value,model=model_value,asset_tag=tag_value,serial_number=serial_value,
        custom_values=new_custom,validated_form_revision_id=current_rev,needs_metadata=needs,
        version=asset.version+1,updated_at=now() where id=record_id returning version into version_value;
    end if;
    new_metadata:=jsonb_build_object('name',name_value,'description',description_value,'category_id',category_uuid,
      'category_name',category_name,'manufacturer',manufacturer_value,'model',model_value,
      'asset_tag',tag_value,'serial_number',serial_value,'custom_values',new_custom,'form_revision_id',current_rev);
    insert into public.asset_events(id,asset_id,kind,actor_id,actor_name,from_location_id,to_location_id,
      before_metadata,after_metadata,version)
      values(event_id,record_id,case when p_action='create' then 'created' else 'metadata_updated' end,
        actor,actor_name,null,case when p_action='create' then location_uuid end,
        old_metadata,new_metadata,version_value);
  end if;
  replay:=jsonb_build_object('entity_id',record_id,'version',version_value,'event_id',event_id,
    'changed',true,'published_revision_id',current_rev,'needs_metadata',needs);
  update private.mutation_requests set result=replay where actor_id=actor and request_id=p_request_id;
  return replay;
exception when unique_violation then raise exception using errcode='P1007',message='identifier_conflict';
end;
$$;

create or replace function private.asset_metadata_mutate_v3(p_request_id uuid,p_payload jsonb,p_action text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare actor uuid:=auth.uid(); actor_name text; normalized jsonb; replay jsonb;
 category_uuid uuid; expected_rev uuid; current_rev uuid; record_id uuid; expected_version integer;
 name_value text; description_value text; manufacturer_value text; model_value text;
 tag_value text; serial_value text; location_uuid uuid; custom_patch jsonb; new_custom jsonb;
 old_custom jsonb; asset public.serialized_assets%rowtype; version_value integer;
 event_id uuid:=gen_random_uuid(); category_name text; previous_category_name text;
 old_metadata jsonb; new_metadata jsonb; needs boolean; category_changed boolean:=false;
 operation text:='asset_'||p_action||'_v3';
begin
 if p_action not in ('create','update') then
  raise exception using errcode='P1012',message='invalid_operation'; end if;
 select display_name into actor_name from public.app_members
  where user_id=actor and active and role='staff' for share;
 if not found then raise exception using errcode='P1001',message='forbidden'; end if;
 if p_action='create' then
  perform private.inventory_payload(p_payload,array['name','description','category_id','manufacturer','model',
   'asset_tag','serial_number','location_id','expected_published_revision_id','custom_patch']);
 else
  perform private.inventory_payload(p_payload,array['asset_id','expected_version','name','description','category_id',
   'manufacturer','model','asset_tag','serial_number','expected_published_revision_id','custom_patch',
   'acknowledge_legacy_values']);
 end if;
 name_value:=private.inventory_text(p_payload,'name',200,true);
 description_value:=private.inventory_text(p_payload,'description',4000);
 category_uuid:=private.inventory_uuid(p_payload,'category_id');
 expected_rev:=private.inventory_uuid(p_payload,'expected_published_revision_id');
 manufacturer_value:=private.inventory_text(p_payload,'manufacturer',200);
 model_value:=private.inventory_text(p_payload,'model',200);
 -- Unlike v2, the exact trimmed display spelling is business intent in v3.
 tag_value:=private.inventory_text(p_payload,'asset_tag',100);
 serial_value:=private.inventory_text(p_payload,'serial_number',200);
 custom_patch:=coalesce(p_payload->'custom_patch','{}'::jsonb);
 if p_payload ? 'acknowledge_legacy_values' and
  jsonb_typeof(p_payload->'acknowledge_legacy_values') is distinct from 'boolean' then
  raise exception using errcode='P1012',message='invalid_legacy_acknowledgement'; end if;
 normalized:=jsonb_build_object('name',name_value,'description',description_value,'category_id',category_uuid,
  'manufacturer',manufacturer_value,'model',model_value,'asset_tag',tag_value,'serial_number',serial_value,
  'expected_published_revision_id',expected_rev,'custom_patch',custom_patch);
 if p_action='create' then
  location_uuid:=private.inventory_uuid(p_payload,'location_id');
  normalized:=normalized||jsonb_build_object('location_id',location_uuid);
 else
  record_id:=private.inventory_uuid(p_payload,'asset_id');
  expected_version:=private.inventory_integer(p_payload,'expected_version',1);
  normalized:=normalized||jsonb_build_object('asset_id',record_id,'expected_version',expected_version,
   'acknowledge_legacy_values',coalesce((p_payload->>'acknowledge_legacy_values')::boolean,false));
 end if;
 replay:=private.inventory_receipt(actor,p_request_id,operation,normalized);
 if replay is not null then return replay; end if;
 perform private.configuration_catalog_lock(false);
 select published_form_revision_id,name into current_rev,category_name from public.categories
  where id=category_uuid and active and removed_at is null for share;
 if not found then raise exception using errcode='P1011',message='invalid_category'; end if;
 if current_rev is distinct from expected_rev then
  raise exception using errcode='P1024',message='stale_published_form'; end if;
 if p_action='update' then
  select * into asset from public.serialized_assets where id=record_id for update;
  if not found then raise exception using errcode='P1010',message='not_found'; end if;
  if asset.version<>expected_version then raise exception using errcode='P1002',message='stale_version'; end if;
  old_custom:=asset.custom_values; category_changed:=asset.category_id<>category_uuid;
  select name into previous_category_name from public.categories where id=asset.category_id;
  old_metadata:=jsonb_build_object('name',asset.name,'description',asset.description,'category_id',asset.category_id,
   'category_name',previous_category_name,'manufacturer',asset.manufacturer,'model',asset.model,
   'asset_tag',asset.asset_tag,'serial_number',asset.serial_number,'custom_values',asset.custom_values,
   'form_revision_id',asset.validated_form_revision_id);
 end if;
 new_custom:=private.metadata_apply_patch(current_rev,'asset',coalesce(old_custom,'{}'::jsonb),custom_patch);
 needs:=private.metadata_needs(current_rev,'asset',new_custom);
 if needs and (p_action='create' or category_changed) then
  raise exception using errcode='P1023',message='required_published_metadata_missing'; end if;
 if category_changed and old_custom<>'{}'::jsonb then
  if p_payload->'acknowledge_legacy_values' is distinct from 'true'::jsonb then
   raise exception using errcode='P1026',message='legacy_metadata_acknowledgement_required'; end if;
  perform set_config('app.metadata_reassignment_reviewed','on',true);
 end if;
 if p_action='update' and asset.name is not distinct from name_value
        and asset.description is not distinct from description_value
        and asset.category_id is not distinct from category_uuid
        and asset.manufacturer is not distinct from manufacturer_value
        and asset.model is not distinct from model_value
        and asset.asset_tag is not distinct from tag_value
        and asset.serial_number is not distinct from serial_value
        and asset.custom_values is not distinct from new_custom then
  replay:=jsonb_build_object('entity_id',record_id,'version',asset.version,'event_id',null,
   'changed',false,'published_revision_id',current_rev,'needs_metadata',needs);
  update private.mutation_requests set result=replay where actor_id=actor and request_id=p_request_id;
  return replay;
 end if;
 if p_action='create' then
  perform private.inventory_destination(location_uuid);
  insert into public.serialized_assets(name,description,category_id,manufacturer,model,asset_tag,
   serial_number,location_id,custom_values,validated_form_revision_id,needs_metadata)
  values(name_value,description_value,category_uuid,manufacturer_value,model_value,tag_value,
   serial_value,location_uuid,new_custom,current_rev,needs) returning id,version into record_id,version_value;
 else
  if asset.version=2147483647 then raise exception using errcode='P1008',message='invalid_transition'; end if;
  update public.serialized_assets set name=name_value,description=description_value,category_id=category_uuid,
   manufacturer=manufacturer_value,model=model_value,asset_tag=tag_value,serial_number=serial_value,
   custom_values=new_custom,validated_form_revision_id=current_rev,needs_metadata=needs,
   version=asset.version+1,updated_at=now() where id=record_id returning version into version_value;
 end if;
 new_metadata:=jsonb_build_object('name',name_value,'description',description_value,'category_id',category_uuid,
  'category_name',category_name,'manufacturer',manufacturer_value,'model',model_value,
  'asset_tag',tag_value,'serial_number',serial_value,'custom_values',new_custom,'form_revision_id',current_rev);
 insert into public.asset_events(id,asset_id,kind,actor_id,actor_name,from_location_id,to_location_id,
  before_metadata,after_metadata,version)
 values(event_id,record_id,case when p_action='create' then 'created' else 'metadata_updated' end,
  actor,actor_name,null,case when p_action='create' then location_uuid end,old_metadata,new_metadata,version_value);
 replay:=jsonb_build_object('entity_id',record_id,'version',version_value,'event_id',event_id,
  'changed',true,'published_revision_id',current_rev,'needs_metadata',needs);
 update private.mutation_requests set result=replay where actor_id=actor and request_id=p_request_id;
 return replay;
exception when unique_violation then raise exception using errcode='P1007',message='identifier_conflict';
end; $$;

commit;
