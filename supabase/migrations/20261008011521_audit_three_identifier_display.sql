-- Display spelling and lookup identity have separate contracts. Existing rows,
-- events and v1/v2 receipt payloads are deliberately left untouched.
alter table public.serialized_assets
 drop constraint serialized_assets_asset_tag_check,
 drop constraint serialized_assets_asset_tag_key,
 add constraint serialized_assets_asset_tag_check
   check(asset_tag=btrim(asset_tag) and char_length(asset_tag) between 1 and 100),
 add column asset_tag_normalized text generated always as (lower(btrim(asset_tag))) stored,
 add constraint serialized_assets_asset_tag_normalized_key unique(asset_tag_normalized);

create function private.asset_metadata_mutate_v3(p_request_id uuid,p_payload jsonb,p_action text)
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

create function public.asset_create_v3(p_request_id uuid,p_payload jsonb) returns jsonb
language sql volatile security definer set search_path='' set statement_timeout='5s' as $$
 select private.asset_metadata_mutate_v3(p_request_id,p_payload,'create');
$$;
create function public.asset_update_v3(p_request_id uuid,p_payload jsonb) returns jsonb
language sql volatile security definer set search_path='' set statement_timeout='5s' as $$
 select private.asset_metadata_mutate_v3(p_request_id,p_payload,'update');
$$;
revoke all on function private.asset_metadata_mutate_v3(uuid,jsonb,text),
 public.asset_create_v3(uuid,jsonb),public.asset_update_v3(uuid,jsonb)
 from public,anon,authenticated,service_role;
grant execute on function public.asset_create_v3(uuid,jsonb),public.asset_update_v3(uuid,jsonb) to authenticated;
create function public.asset_site_open_v3(p_request_id uuid,p_payload jsonb) returns jsonb
language plpgsql volatile security definer set search_path='' set statement_timeout='5s' as $$
declare actor uuid:=auth.uid(); actor_name text; normalized jsonb; replay jsonb;
 name_value text; description_value text; manufacturer_value text; model_value text;
 category_uuid uuid; expected_rev uuid; current_rev uuid; category_name text;
 site_uuid uuid; site_name text; tag_value text; serial_value text;
 custom_patch jsonb; custom_values jsonb; needs boolean;
 reason text; reference_value text; id uuid; event_id uuid:=gen_random_uuid(); metadata_value jsonb;
begin
 select display_name into actor_name from public.app_members where user_id=actor and active and role='staff' for share;
 if not found then raise exception using errcode='P1001',message='forbidden'; end if;
 perform private.inventory_payload(p_payload,array['name','description','category_id','manufacturer','model',
  'asset_tag','serial_number','site_id','expected_published_revision_id','custom_patch','reason','reference']);
 name_value:=private.inventory_text(p_payload,'name',200,true);
 description_value:=private.inventory_text(p_payload,'description',4000);
 category_uuid:=private.inventory_uuid(p_payload,'category_id');
 expected_rev:=private.inventory_uuid(p_payload,'expected_published_revision_id');
 manufacturer_value:=private.inventory_text(p_payload,'manufacturer',200);
 model_value:=private.inventory_text(p_payload,'model',200);
 tag_value:=private.inventory_text(p_payload,'asset_tag',100);
 serial_value:=private.inventory_text(p_payload,'serial_number',200);
 site_uuid:=private.inventory_uuid(p_payload,'site_id');
 custom_patch:=coalesce(p_payload->'custom_patch','{}'::jsonb);
 reason:=private.inventory_text(p_payload,'reason',2000);
 reference_value:=private.inventory_text(p_payload,'reference',200);
 normalized:=jsonb_build_object('name',name_value,'description',description_value,
  'category_id',category_uuid,'manufacturer',manufacturer_value,'model',model_value,
  'asset_tag',tag_value,'serial_number',serial_value,'site_id',site_uuid,
  'expected_published_revision_id',expected_rev,'custom_patch',custom_patch,
  'reason',reason,'reference',reference_value);
 replay:=private.inventory_receipt(actor,p_request_id,'asset_site_open_v3',normalized);
 if replay is not null then return replay; end if;
 perform private.configuration_catalog_lock(false);
 select published_form_revision_id,name into current_rev,category_name from public.categories
 where public.categories.id=category_uuid and active and removed_at is null for share;
 if not found then raise exception using errcode='P1011',message='invalid_category'; end if;
 if current_rev is distinct from expected_rev then
  raise exception using errcode='P1024',message='stale_published_form'; end if;
 custom_values:=private.metadata_apply_patch(current_rev,'asset','{}'::jsonb,custom_patch);
 needs:=private.metadata_needs(current_rev,'asset',custom_values);
 if needs then raise exception using errcode='P1023',message='required_published_metadata_missing'; end if;
 select name into site_name from public.sites where public.sites.id=site_uuid and active for share;
 if not found then raise exception using errcode='P1004',message='invalid_site'; end if;
 insert into public.serialized_assets(name,description,category_id,manufacturer,model,asset_tag,
  serial_number,location_id,site_id,custom_values,validated_form_revision_id,needs_metadata)
 values(name_value,description_value,category_uuid,manufacturer_value,model_value,tag_value,
  serial_value,null,site_uuid,custom_values,current_rev,needs) returning public.serialized_assets.id into id;
 metadata_value:=jsonb_build_object('name',name_value,'description',description_value,'category_id',category_uuid,
  'category_name',category_name,'manufacturer',manufacturer_value,'model',model_value,
  'asset_tag',tag_value,'serial_number',serial_value,'custom_values',custom_values,'form_revision_id',current_rev);
 insert into public.asset_events(id,asset_id,kind,actor_id,actor_name,reason,before_metadata,after_metadata,version)
 values(event_id,id,'site_opened',actor,actor_name,reason,null,metadata_value,1);
 insert into public.assignment_events(asset_event_id,asset_id,kind,actor_id,actor_name,reason,
  reference,to_site_id,to_label)
 values(event_id,id,'opened',actor,actor_name,reason,reference_value,site_uuid,site_name);
 replay:=jsonb_build_object('entity_id',id,'version','1','event_id',event_id,
  'changed',true,'published_revision_id',current_rev,'needs_metadata',needs);
 update private.mutation_requests set result=replay where actor_id=actor and request_id=p_request_id;
 return replay;
exception when unique_violation then raise exception using errcode='P1007',message='identifier_conflict';
end; $$;


revoke all on function public.asset_site_open_v3(uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.asset_site_open_v3(uuid,jsonb) to authenticated;
