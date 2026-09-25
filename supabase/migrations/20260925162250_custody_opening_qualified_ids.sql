-- Replace only the opening RPCs: their PL/pgSQL result variable id made unqualified category/site id predicates ambiguous.

-- Keep the original hardened authorization, receipt, metadata, event, and RLS contracts.

create or replace function public.quantity_site_open(p_request_id uuid,p_payload jsonb) returns jsonb
language plpgsql volatile security definer set search_path='' set statement_timeout='5s' as $$
declare actor uuid:=auth.uid(); actor_name text; normalized jsonb; replay jsonb;
 name_value text; description_value text; manufacturer_value text; model_value text;
 category_uuid uuid; expected_rev uuid; current_rev uuid; category_name text;
 site_uuid uuid; site_name text; amount integer; threshold_value integer;
 custom_patch jsonb; custom_values jsonb; needs boolean;
 reason text; reference_value text; id uuid; event_id uuid:=gen_random_uuid(); metadata_value jsonb;
begin
 select display_name into actor_name from public.app_members where user_id=actor and active and role='staff' for share;
 if not found then raise exception using errcode='P1001',message='forbidden'; end if;
 perform private.inventory_payload(p_payload,array['name','description','category_id','manufacturer','model',
  'reorder_threshold','site_id','quantity','expected_published_revision_id','custom_patch','reason','reference']);
 name_value:=private.inventory_text(p_payload,'name',200,true);
 description_value:=private.inventory_text(p_payload,'description',4000);
 category_uuid:=private.inventory_uuid(p_payload,'category_id');
 expected_rev:=private.inventory_uuid(p_payload,'expected_published_revision_id');
 manufacturer_value:=private.inventory_text(p_payload,'manufacturer',200);
 model_value:=private.inventory_text(p_payload,'model',200);
 if p_payload ? 'reorder_threshold' then threshold_value:=private.inventory_threshold(p_payload); end if;
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
 insert into public.quantity_items(name,description,category_id,manufacturer,model,reorder_threshold,
  custom_values,validated_form_revision_id,needs_metadata)
 values(name_value,description_value,category_uuid,manufacturer_value,model_value,threshold_value,
  custom_values,current_rev,needs) returning public.quantity_items.id into id;
 insert into public.site_quantity_holdings(item_id,site_id,quantity) values(id,site_uuid,amount);
 metadata_value:=jsonb_build_object('name',name_value,'description',description_value,'category_id',category_uuid,
  'category_name',category_name,'manufacturer',manufacturer_value,'model',model_value,
  'reorder_threshold',threshold_value,'custom_values',custom_values,'form_revision_id',current_rev);
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

create or replace function public.asset_site_open(p_request_id uuid,p_payload jsonb) returns jsonb
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
 tag_value:=lower(private.inventory_text(p_payload,'asset_tag',100));
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
 replay:=private.inventory_receipt(actor,p_request_id,'asset_site_open',normalized);
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

revoke all on function public.quantity_site_open(uuid,jsonb), public.asset_site_open(uuid,jsonb) from public,anon,authenticated,service_role;

grant execute on function public.quantity_site_open(uuid,jsonb), public.asset_site_open(uuid,jsonb) to authenticated;
