-- Ordinary members can rename display labels, but storage topology is code-managed.
-- Preserve legacy functions for trusted migration tooling; revoke application entry.
revoke all on function public.location_create(uuid,jsonb), public.location_update(uuid,jsonb)
 from public, anon, authenticated, service_role;

alter table public.site_configuration_events add column reason text
 check (reason is null or (length(reason) between 1 and 2000 and reason=btrim(reason)));

create function public.location_rename(p_request_id uuid,p_payload jsonb) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare actor uuid:=auth.uid(); actor_name text; normalized jsonb; replay jsonb;
 location_uuid uuid; expected bigint; row_before public.locations%rowtype;
 v_name text; before_state jsonb; after_state jsonb; event_uuid uuid:=gen_random_uuid();
begin
 select display_name into actor_name from public.app_members
 where user_id=actor and active and role='staff' and can_manage_configuration for share;
 if not found then raise exception using errcode='P1001',message='forbidden'; end if;
 perform private.inventory_payload(p_payload,array['location_id','expected_version','name']);
 location_uuid:=private.inventory_uuid(p_payload,'location_id');
 expected:=private.configuration_version(p_payload,'expected_version');
 v_name:=private.inventory_text(p_payload,'name',200,true);
 normalized:=jsonb_build_object('location_id',location_uuid,'expected_version',expected::text,'name',v_name);
 replay:=private.inventory_receipt(actor,p_request_id,'location_rename',normalized);
 if replay is not null then return replay; end if;
 perform private.placement_lock(true);
 select * into row_before from public.locations where id=location_uuid for update;
 if not found then raise exception using errcode='P1010',message='not_found'; end if;
 if row_before.version<>expected then raise exception using errcode='P1002',message='stale_version'; end if;
 before_state:=jsonb_build_object('code',row_before.code,'name',row_before.name,
  'parent_id',row_before.parent_id,'kind',row_before.kind,'can_hold_inventory',row_before.can_hold_inventory,
  'active',row_before.active,'sort_order',row_before.sort_order);
 after_state:=jsonb_set(before_state,'{name}',to_jsonb(v_name));
 if before_state=after_state then
  replay:=jsonb_build_object('entity_id',location_uuid,'version',expected::text,'event_id',null,'changed',false);
 else
  if expected=9223372036854775807 then raise exception using errcode='P1008',message='invalid_transition'; end if;
  update public.locations set name=v_name,version=expected+1 where id=location_uuid;
  insert into public.location_configuration_events(id,location_id,actor_id,actor_name,kind,before_state,after_state,version)
   values(event_uuid,location_uuid,actor,actor_name,'updated',before_state,after_state,expected+1);
  replay:=jsonb_build_object('entity_id',location_uuid,'version',(expected+1)::text,'event_id',event_uuid,'changed',true);
 end if;
 update private.mutation_requests set result=replay where actor_id=actor and request_id=p_request_id;
 return replay;
end; $$;

create function public.site_set_active(p_request_id uuid,p_payload jsonb) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare actor uuid:=auth.uid(); actor_name text; normalized jsonb; replay jsonb;
 site_uuid uuid; expected bigint; row_before public.sites%rowtype;
 v_active boolean; v_reason text; before_state jsonb; after_state jsonb; event_uuid uuid:=gen_random_uuid();
begin
 select display_name into actor_name from public.app_members
 where user_id=actor and active and role='staff' and can_manage_configuration for share;
 if not found then raise exception using errcode='P1001',message='forbidden'; end if;
 perform private.inventory_payload(p_payload,array['site_id','expected_version','active','reason']);
 site_uuid:=private.inventory_uuid(p_payload,'site_id');
 expected:=private.configuration_version(p_payload,'expected_version');
 v_active:=private.custody_boolean(p_payload,'active');
 v_reason:=private.inventory_text(p_payload,'reason',2000,true);
 normalized:=jsonb_build_object('site_id',site_uuid,'expected_version',expected::text,'active',v_active,'reason',v_reason);
 replay:=private.inventory_receipt(actor,p_request_id,'site_set_active',normalized);
 if replay is not null then return replay; end if;
 perform private.placement_lock(true);
 select * into row_before from public.sites where id=site_uuid for update;
 if not found then raise exception using errcode='P1010',message='not_found'; end if;
 if row_before.version<>expected then raise exception using errcode='P1002',message='stale_version'; end if;
 before_state:=jsonb_build_object('code',row_before.code,'name',row_before.name,'notes',row_before.notes,'active',row_before.active);
 after_state:=jsonb_set(before_state,'{active}',to_jsonb(v_active));
 if before_state=after_state then
  replay:=jsonb_build_object('entity_id',site_uuid,'version',expected::text,'event_id',null,'changed',false);
 else
  if expected=9223372036854775807 then raise exception using errcode='P1008',message='invalid_transition'; end if;
  -- Existing statement topology lock and holdings guard recheck atomically.
  update public.sites set active=v_active,version=expected+1 where id=site_uuid;
  insert into public.site_configuration_events(id,site_id,actor_id,actor_name,kind,before_state,after_state,version,reason)
   values(event_uuid,site_uuid,actor,actor_name,'updated',before_state,after_state,expected+1,v_reason);
  replay:=jsonb_build_object('entity_id',site_uuid,'version',(expected+1)::text,'event_id',event_uuid,'changed',true);
 end if;
 update private.mutation_requests set result=replay where actor_id=actor and request_id=p_request_id;
 return replay;
end; $$;

revoke all on function public.location_rename(uuid,jsonb),public.site_set_active(uuid,jsonb)
 from public,anon,authenticated,service_role;
grant execute on function public.location_rename(uuid,jsonb),public.site_set_active(uuid,jsonb) to authenticated;

create or replace function public.site_update(p_request_id uuid,p_payload jsonb) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
<<site_update>>
declare actor uuid:=auth.uid(); actor_name text; normalized jsonb; replay jsonb;
 id uuid; expected bigint; row_before public.sites%rowtype;
 v_name text; v_notes text; v_active boolean; before_state jsonb; after_state jsonb;
 event_id uuid:=gen_random_uuid();
begin
 select display_name into actor_name from public.app_members
 where user_id=actor and active and role='staff' and can_manage_configuration for share;
 if not found then raise exception using errcode='P1001',message='forbidden'; end if;
 perform private.inventory_payload(p_payload,array['site_id','expected_version','name','notes','active']);
 id:=private.inventory_uuid(p_payload,'site_id');
 expected:=private.configuration_version(p_payload,'expected_version');
 v_name:=private.inventory_text(p_payload,'name',200,true);
 v_notes:=private.inventory_text(p_payload,'notes',2000);
 v_active:=private.custody_boolean(p_payload,'active');
 normalized:=jsonb_build_object('site_id',id,'expected_version',expected::text,
  'name',v_name,'notes',v_notes,'active',v_active);
 replay:=private.inventory_receipt(actor,p_request_id,'site_update',normalized);
 if replay is not null then return replay; end if;
 perform private.placement_lock(true);
 select * into row_before from public.sites where public.sites.id=site_update.id for update;
 if not found then raise exception using errcode='P1010',message='not_found'; end if;
 if row_before.version<>expected then raise exception using errcode='P1002',message='stale_version'; end if;
 -- Completed old receipts replay above, after authorization. Fresh lifecycle edits
 -- require the narrow operation with an explicit reason.
 if v_active is distinct from row_before.active then
  raise exception using errcode='P1012',message='use_site_lifecycle'; end if;
 before_state:=jsonb_build_object('code',row_before.code,'name',row_before.name,
  'notes',row_before.notes,'active',row_before.active);
 after_state:=jsonb_build_object('code',row_before.code,'name',v_name,'notes',v_notes,'active',v_active);
 if before_state=after_state then
  replay:=jsonb_build_object('entity_id',id,'version',expected::text,'event_id',null,'changed',false);
 else
  if expected=9223372036854775807 then raise exception using errcode='P1008',message='invalid_transition'; end if;
  update public.sites set name=v_name,notes=v_notes,active=v_active,version=expected+1
   where public.sites.id=site_update.id;
  insert into public.site_configuration_events(id,site_id,actor_id,actor_name,kind,before_state,after_state,version)
  values(event_id,id,actor,actor_name,'updated',before_state,after_state,expected+1);
  replay:=jsonb_build_object('entity_id',id,'version',(expected+1)::text,'event_id',event_id,'changed',true);
 end if;
 update private.mutation_requests set result=replay where actor_id=actor and request_id=p_request_id;
 return replay;
end; $$;
