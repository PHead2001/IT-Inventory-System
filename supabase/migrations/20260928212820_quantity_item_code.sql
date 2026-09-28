-- Quantity item code is a nullable display identity.  A generated key and its
-- unfiltered unique index reserve codes on archived definitions as well.
create function public.inventory_normalize_item_code(p_value text) returns text
language plpgsql immutable security invoker set search_path='' as $$
declare trimmed text; whitespace text:=chr(9)||chr(10)||chr(11)||chr(12)||chr(13)||
  ' '||chr(133)||chr(160)||chr(5760)||chr(8192)||chr(8193)||chr(8194)||
  chr(8195)||chr(8196)||chr(8197)||chr(8198)||chr(8199)||chr(8200)||
  chr(8201)||chr(8202)||chr(8232)||chr(8233)||chr(8239)||chr(8287)||chr(12288);
begin
 if p_value is null then return null; end if;
 trimmed:=btrim(p_value,whitespace);
 if trimmed='' then return null; end if;
 if char_length(trimmed)>100 or trimmed ~ '[[:cntrl:]]' or exists(
   select 1 from generate_series(128,159) n where strpos(trimmed,chr(n))>0
 ) then raise exception using errcode='P1012',message='invalid_item_code'; end if;
 return trimmed;
end;
$$;
revoke all on function public.inventory_normalize_item_code(text) from public,anon,authenticated,service_role;
grant execute on function public.inventory_normalize_item_code(text) to authenticated;

create function private.inventory_item_code(p_value text) returns text
language sql immutable set search_path='' as $$
 select public.inventory_normalize_item_code(p_value);
$$;
revoke all on function private.inventory_item_code(text) from public,anon,authenticated,service_role;

create function private.inventory_item_code_payload(p_payload jsonb) returns text
language plpgsql immutable set search_path='' as $$
begin
 if not p_payload ? 'item_code' then return null; end if;
 if jsonb_typeof(p_payload->'item_code')='null' then return null; end if;
 if jsonb_typeof(p_payload->'item_code')<>'string' then
  raise exception using errcode='P1012',message='invalid_item_code'; end if;
 return private.inventory_item_code(p_payload->>'item_code');
end;
$$;
revoke all on function private.inventory_item_code_payload(jsonb) from public,anon,authenticated,service_role;

alter table public.quantity_items add column item_code text;
alter table public.quantity_items add column item_code_key text
 generated always as (lower(item_code)) stored;
alter table public.quantity_items add constraint quantity_item_code_valid check (
 item_code is null or (item_code=private.inventory_item_code(item_code)
  and char_length(item_code)<=100));
create unique index quantity_item_code_unique on public.quantity_items(item_code_key)
 where item_code_key is not null;

-- Exact bare-code lookup is invoker RLS and uses the same database key.
create function public.inventory_item_code_lookup(p_code text) returns jsonb
language sql stable security invoker set search_path='' as $$
 select to_jsonb(q) from (
  select id,name,archived,item_code from public.quantity_items
  where item_code_key=lower(public.inventory_normalize_item_code(p_code)) limit 1
 ) q;
$$;
revoke all on function public.inventory_item_code_lookup(text) from public,anon,authenticated,service_role;
grant execute on function public.inventory_item_code_lookup(text) to authenticated;


create or replace function public.quantity_create(p_request_id uuid,p_payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
 v_actor uuid; v_actor_name text; v_payload jsonb; v_result jsonb;
 v_id uuid; v_version integer; v_event uuid:=gen_random_uuid();
 v_name text; v_description text; v_category uuid; v_category_name text; v_manufacturer text; v_model text; v_threshold integer; v_item_code text;
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
 perform private.inventory_payload(p_payload,array['name','description','category_id','manufacturer','model','initial_location_id','initial_quantity','reorder_threshold','item_code']);

 v_name:=private.inventory_text(p_payload,'name',200,true);
 v_description:=private.inventory_text(p_payload,'description',4000);
 v_category:=private.inventory_uuid(p_payload,'category_id');
 v_manufacturer:=private.inventory_text(p_payload,'manufacturer',200);
 v_model:=private.inventory_text(p_payload,'model',200);
 if p_payload ? 'reorder_threshold' then v_threshold:=private.inventory_threshold(p_payload); end if;
 if p_payload ? 'item_code' then v_item_code:=private.inventory_item_code_payload(p_payload); end if;

 v_location:=private.inventory_uuid(p_payload,'initial_location_id',false);
 v_quantity:=private.inventory_integer(p_payload,'initial_quantity',0,0);
 if v_quantity>0 and v_location is null then raise exception using errcode='P1012',message='invalid_input'; end if;
 v_payload:=jsonb_build_object('name',v_name,'description',v_description,'category_id',v_category,'manufacturer',v_manufacturer,'model',v_model,'initial_location_id',v_location,'initial_quantity',v_quantity);

 if p_payload ? 'reorder_threshold' then v_payload:=v_payload || jsonb_build_object('reorder_threshold',v_threshold); end if;
 if p_payload ? 'item_code' then v_payload:=v_payload || jsonb_build_object('item_code',v_item_code); end if;
 v_result:=private.inventory_receipt(v_actor,p_request_id,'quantity_create',v_payload);
 if v_result is not null then return v_result; end if;
 perform private.configuration_catalog_lock(false);

 perform private.inventory_category(v_category);
 select name into v_category_name from public.categories where id=v_category;
 if v_location is not null then perform private.inventory_destination(v_location); end if;
 insert into public.quantity_items(name,description,category_id,manufacturer,model,reorder_threshold,item_code)
 values(v_name,v_description,v_category,v_manufacturer,v_model,v_threshold,v_item_code) returning id,version into v_id,v_version;
 insert into public.quantity_events(id,item_id,kind,actor_id,actor_name,reason,before_metadata,after_metadata,version) values(v_event,v_id,'created',v_actor,v_actor_name,v_reason,null,jsonb_build_object('name',v_name,'description',v_description,'category_id',v_category,'category_name',v_category_name,'manufacturer',v_manufacturer,'model',v_model,'reorder_threshold',v_threshold,'item_code',v_item_code),v_version);
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
 update public.quantity_items set name=v_name,description=v_description,category_id=v_category,manufacturer=v_manufacturer,model=v_model,reorder_threshold=v_threshold,item_code=v_item_code where id=v_id;
 if v_item.version=2147483647 then raise exception using errcode='P1008',message='invalid_transition'; end if;
 v_version:=v_item.version+1; update public.quantity_items set version=v_version,updated_at=now() where id=v_id; insert into public.quantity_events(id,item_id,kind,actor_id,actor_name,reason,before_metadata,after_metadata,version) values(v_event,v_id,'metadata_updated',v_actor,v_actor_name,v_reason,jsonb_build_object('name',v_item.name,'description',v_item.description,'category_id',v_item.category_id,'category_name',v_previous_category_name,'manufacturer',v_item.manufacturer,'model',v_item.model,'reorder_threshold',v_item.reorder_threshold,'item_code',v_item.item_code),jsonb_build_object('name',v_name,'description',v_description,'category_id',v_category,'category_name',v_category_name,'manufacturer',v_manufacturer,'model',v_model,'reorder_threshold',v_threshold,'item_code',v_item_code),v_version);
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

create or replace function public.quantity_site_open(p_request_id uuid,p_payload jsonb) returns jsonb
language plpgsql volatile security definer set search_path='' set statement_timeout='5s' as $$
declare actor uuid:=auth.uid(); actor_name text; normalized jsonb; replay jsonb;
 name_value text; description_value text; manufacturer_value text; model_value text;
 category_uuid uuid; expected_rev uuid; current_rev uuid; category_name text;
 site_uuid uuid; site_name text; amount integer; threshold_value integer; item_code_value text;
 custom_patch jsonb; custom_values jsonb; needs boolean;
 reason text; reference_value text; id uuid; event_id uuid:=gen_random_uuid(); metadata_value jsonb;
begin
 select display_name into actor_name from public.app_members where user_id=actor and active and role='staff' for share;
 if not found then raise exception using errcode='P1001',message='forbidden'; end if;
 perform private.inventory_payload(p_payload,array['name','description','category_id','manufacturer','model',
  'reorder_threshold','item_code','site_id','quantity','expected_published_revision_id','custom_patch','reason','reference']);
 name_value:=private.inventory_text(p_payload,'name',200,true);
 description_value:=private.inventory_text(p_payload,'description',4000);
 category_uuid:=private.inventory_uuid(p_payload,'category_id');
 expected_rev:=private.inventory_uuid(p_payload,'expected_published_revision_id');
 manufacturer_value:=private.inventory_text(p_payload,'manufacturer',200);
 model_value:=private.inventory_text(p_payload,'model',200);
 if p_payload ? 'reorder_threshold' then threshold_value:=private.inventory_threshold(p_payload); end if;
 if p_payload ? 'item_code' then item_code_value:=private.inventory_item_code_payload(p_payload); end if;
 site_uuid:=private.inventory_uuid(p_payload,'site_id');
 amount:=private.inventory_integer(p_payload,'quantity',1);
 custom_patch:=coalesce(p_payload->'custom_patch','{}'::jsonb);
 reason:=private.inventory_text(p_payload,'reason',2000);
 reference_value:=private.inventory_text(p_payload,'reference',200);
 normalized:=jsonb_build_object('name',name_value,'description',description_value,
  'category_id',category_uuid,'manufacturer',manufacturer_value,'model',model_value,
  'reorder_threshold',threshold_value,'site_id',site_uuid,'quantity',amount,
  'expected_published_revision_id',expected_rev,'custom_patch',custom_patch,
  'reason',reason,'reference',reference_value);
 if p_payload ? 'item_code' then normalized:=normalized||jsonb_build_object('item_code',item_code_value); end if;
 replay:=private.inventory_receipt(actor,p_request_id,'quantity_site_open',normalized);
 if replay is not null then return replay; end if;
 perform private.configuration_catalog_lock(false);
 select published_form_revision_id,name into current_rev,category_name from public.categories
 where public.categories.id=category_uuid and active and removed_at is null for share;
 if not found then raise exception using errcode='P1011',message='invalid_category'; end if;
 if current_rev is distinct from expected_rev then
  raise exception using errcode='P1024',message='stale_published_form'; end if;
 custom_values:=private.metadata_apply_patch(current_rev,'quantity','{}'::jsonb,custom_patch);
 needs:=private.metadata_needs(current_rev,'quantity',custom_values);
 if needs then raise exception using errcode='P1023',message='required_published_metadata_missing'; end if;
 select name into site_name from public.sites where public.sites.id=site_uuid and active for share;
 if not found then raise exception using errcode='P1004',message='invalid_site'; end if;
 insert into public.quantity_items(name,description,category_id,manufacturer,model,reorder_threshold,item_code,
  custom_values,validated_form_revision_id,needs_metadata)
 values(name_value,description_value,category_uuid,manufacturer_value,model_value,threshold_value,item_code_value,
  custom_values,current_rev,needs) returning public.quantity_items.id into id;
 insert into public.site_quantity_holdings(item_id,site_id,quantity) values(id,site_uuid,amount);
 metadata_value:=jsonb_build_object('name',name_value,'description',description_value,'category_id',category_uuid,
  'category_name',category_name,'manufacturer',manufacturer_value,'model',model_value,
  'reorder_threshold',threshold_value,'item_code',item_code_value,'custom_values',custom_values,'form_revision_id',current_rev);
 insert into public.quantity_events(id,item_id,kind,actor_id,actor_name,reason,before_metadata,after_metadata,version)
 values(event_id,id,'site_opened',actor,actor_name,reason,null,metadata_value,1);
 insert into public.site_quantity_event_lines(event_id,site_id,delta,before_quantity,after_quantity)
 values(event_id,site_uuid,amount,0,amount);
 insert into public.assignment_events(quantity_event_id,item_id,kind,actor_id,actor_name,reason,
  reference,to_site_id,to_label,quantity)
 values(event_id,id,'opened',actor,actor_name,reason,reference_value,site_uuid,site_name,amount);
 replay:=jsonb_build_object('entity_id',id,'version','1','event_id',event_id,
  'changed',true,'published_revision_id',current_rev,'needs_metadata',needs);
 update private.mutation_requests set result=replay where actor_id=actor and request_id=p_request_id;
 return replay;
exception when unique_violation then raise exception using errcode='P1007',message='identifier_conflict';
end; $$;

create or replace function private.metadata_effective_definition(rev uuid, definition jsonb)
returns jsonb language plpgsql stable set search_path='' as $$
declare result jsonb:=definition; missing jsonb:='[]'::jsonb; name text;
  id uuid; section_id uuid:=md5('metadata-identification:'||rev::text)::uuid;
begin
  if jsonb_typeof(definition)<>'object' or jsonb_typeof(definition->'layout')<>'array' then
    return definition;
  end if;
  foreach name in array array['name','category_id','asset_tag','item_code'] loop
    if not exists(select 1 from jsonb_array_elements(definition->'layout') s,
      jsonb_array_elements(coalesce(s->'controls','[]'::jsonb)) c
      where c->>'kind'='builtin' and c->>'builtin'=name) then
      id:=md5('metadata-control:'||rev::text||':'||name)::uuid;
      missing:=missing||jsonb_build_array(jsonb_build_object('id',id,'kind','builtin',
        'builtin',name,'width',12,'applies_to',
        case when name='asset_tag' then jsonb_build_array('asset')
          when name='item_code' then jsonb_build_array('quantity')
          else jsonb_build_array('quantity','asset') end));
    end if;
  end loop;
  if jsonb_array_length(missing)>0 then
    result:=jsonb_set(result,'{layout}',(result->'layout')||jsonb_build_array(
      jsonb_build_object('id',section_id,'label','Identification',
        'controls',missing)));
  end if;
  return result;
end;
$$;

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
 t.available_quantity, t.assigned_quantity, t.recorded_quantity,i.item_code
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
 s.id,s.code,s.name,'site',t.available_quantity,t.assigned_quantity,t.recorded_quantity,i.item_code
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
 null::text,null::text,null::text,null::text
from public.serialized_assets a join public.categories c on c.id=a.category_id
left join public.inventory_locations l on l.id=a.location_id
where a.site_id is null
union all
select 'asset',a.id,a.name,a.description,a.manufacturer,a.model,
 a.category_id,c.name,a.status,null::uuid,null::text,null::text,null::text,null::text[],
 null::integer,a.asset_tag,a.serial_number,null::integer,null::bigint,null::text,
 s.id,s.code,s.name,'site',null::text,null::text,null::text,null::text
from public.serialized_assets a join public.categories c on c.id=a.category_id
join public.sites s on s.id=a.site_id where a.status='active';

create or replace function public.inventory_search_v3(
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
     r.site_name,r.asset_tag,r.serial_number,r.item_code)),lower(coalesce(p_query,'')))>0
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

create or replace function public.low_stock_dashboard(
 p_page integer default 1, p_page_size integer default 25
) returns jsonb language sql stable security invoker set search_path='' as $$
 with items as materialized (
  select distinct on (entity_id) entity_id,name,category_name,item_code,recorded_total,
   reorder_threshold,stock_state,available_quantity,assigned_quantity,recorded_quantity
  from public.inventory_search_rows
  where kind='quantity' and status='active' and reorder_threshold is not null
  order by entity_id
 ), attention as materialized (
  select * from items where stock_state in ('needs_restocking','out_of_stock')
 ), page as (
  select * from attention order by lower(name),entity_id
  limit greatest(1,least(coalesce(p_page_size,25),100))
  offset (greatest(1,least(coalesce(p_page,1),100000))::bigint-1)
    * greatest(1,least(coalesce(p_page_size,25),100))
 )
 select jsonb_build_object(
  'configured_count',(select count(*) from items),
  'needs_restocking_count',(select count(*) from attention),
  'out_of_stock_count',(select count(*) from attention where stock_state='out_of_stock'),
  'total',(select count(*) from attention),
  'rows',coalesce((select jsonb_agg(to_jsonb(p) order by lower(p.name),p.entity_id)
   from page p),'[]'::jsonb));
$$;

create or replace function public.inventory_label_search(
 p_query text default '', p_type text default 'all', p_status text default 'active',
 p_category_id uuid default null, p_location_code text default null,
 p_page integer default 1, p_page_size integer default 25
) returns jsonb language sql stable security invoker set search_path='' as $$
 with matches as materialized (
  select distinct on (r.kind,r.entity_id)
   r.kind,r.entity_id,r.name,r.category_name,r.status,
   r.asset_tag,r.serial_number,r.manufacturer,r.model,r.item_code
  from public.inventory_search_rows r
  where (p_type='all' or r.kind=p_type)
   and (p_status='all' or (p_status='active' and r.status='active')
    or (p_status='historical' and r.status<>'active'))
   and (p_category_id is null or r.category_id=p_category_id)
   and (p_location_code is null or p_location_code=any(r.ancestor_codes))
   and strpos(lower(concat_ws(' ',r.name,r.serial_number,r.asset_tag,
    r.category_name,r.manufacturer,r.model,r.site_code,r.site_name,r.item_code,r.entity_id::text)),
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
   null::text as tag,null::text as category_name,null::text as item_code
  from requested r join public.inventory_locations l
   on r.kind='location' and l.code=r.key
  union all
  select r.ordinality,'quantity',q.id::text,q.name,
   concat_ws(' / ',c.name,public.inventory_label_context('quantity',q.id)),
   case when q.archived then 'archived' else 'active' end,
   null::text,c.name,q.item_code
  from requested r join public.quantity_items q
   on r.kind='quantity' and q.id::text=r.key
  join public.categories c on c.id=q.category_id
  union all
  select r.ordinality,'asset',a.id::text,a.name,
   concat_ws(' / ',c.name,public.inventory_label_context('asset',a.id)),
   a.status,a.asset_tag,c.name,null::text
  from requested r join public.serialized_assets a
   on r.kind='asset' and a.id::text=r.key
  join public.categories c on c.id=a.category_id
 )
 select coalesce(jsonb_agg(to_jsonb(resolved)-'ordinality' order by ordinality),'[]'::jsonb)
 into v_result from resolved;
 return v_result;
end;
$$;

create or replace function public.inventory_export_snapshot_v3(
 p_query text,p_type text,p_status text,p_category_id uuid,p_location_code text,
 p_site_id uuid,p_low_stock boolean,p_export_type text,p_include_custom boolean
) returns jsonb language plpgsql stable security invoker set search_path='' set statement_timeout='5s' as $$
declare r record; holding record; one_row jsonb; custom jsonb; described jsonb;
 rows_json jsonb[]:=array[]::jsonb[]; used_bytes integer:=128; row_bytes integer;
 count_rows integer:=0; holdings text; response jsonb; exported_at timestamptz:=statement_timestamp();
 key_kinds text[]; key_entities uuid[]; key_locations uuid[]; key_sites uuid[]; low_keys uuid[]; previous_quantity_id uuid;
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
      x.location_code,x.location_name,x.breadcrumb,x.site_code,x.site_name,x.asset_tag,x.serial_number,x.item_code)),
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
   one_row:=to_jsonb(r)-'reorder_threshold'-'stock_state'-'recorded_total';
   if r.kind='quantity' then
    if previous_quantity_id=r.entity_id then
     one_row:=one_row||jsonb_build_object('available_quantity',null,
      'assigned_quantity',null,'recorded_quantity',null);
    else previous_quantity_id:=r.entity_id; end if;
   end if;
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
         x.location_code,x.location_name,x.breadcrumb,x.site_code,x.site_name,x.asset_tag,x.serial_number,x.item_code)),
         lower(coalesce(p_query,'')))>0)
   limit 10001
  )
  select coalesce(array_agg(id),array[]::uuid[]) into low_keys from keys;
  if cardinality(low_keys)>10000 then raise exception using errcode='P1013',message='export_row_limit'; end if;
  for r in
   select i.id as entity_id,i.name,i.description,i.manufacturer,i.model,i.item_code,i.category_id,
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
    'description',r.description,'manufacturer',r.manufacturer,'model',r.model,'item_code',r.item_code,
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
