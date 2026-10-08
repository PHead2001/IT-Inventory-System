-- Do not invent corrective names for an existing installation. Owners must
-- resolve the reported parent/name collision before this migration can apply.
begin;
lock table public.locations in share row exclusive mode;
do $$
declare collisions text;
begin
 select string_agg(codes, '; ' order by codes) into collisions from (
  select string_agg(code, ', ' order by code) codes from public.locations
  where active group by parent_id,lower(btrim(name)) having count(*)>1
 ) duplicate_names;
 if collisions is not null then
  raise exception using errcode='P1012',message='active_sibling_name_collision_prerequisite',
   detail=collisions,hint='Rename the listed active sibling locations to distinct names before retrying. Codes, inventory and history must be preserved.';
 end if;
end; $$;

create unique index locations_active_sibling_name_key
 on public.locations(parent_id,lower(btrim(name))) nulls not distinct where active;

create function private.location_sibling_name_available(p_id uuid,p_parent uuid,p_name text,p_active boolean)
returns void language plpgsql security invoker set search_path='' as $$
begin
 if p_active and exists(select 1 from public.locations sibling where sibling.active
  and sibling.id is distinct from p_id and sibling.parent_id is not distinct from p_parent
  and lower(btrim(sibling.name))=lower(btrim(p_name))) then
  raise exception using errcode='P1007',message='location_name_conflict';
 end if;
end; $$;

-- A backstop for trusted direct topology writers, including activation and
-- reparenting. The existing statement trigger takes placement_lock(true).
create function private.validate_location_sibling_name() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 perform private.location_sibling_name_available(new.id,new.parent_id,new.name,new.active);
 return new;
end; $$;
create trigger locations_sibling_name before insert or update of name,parent_id,active
 on public.locations for each row execute function private.validate_location_sibling_name();
revoke all on function private.location_sibling_name_available(uuid,uuid,text,boolean),
 private.validate_location_sibling_name() from public,anon,authenticated,service_role;
-- Existing trusted fixture writers use invoker triggers; no application writes
-- or structural RPC grants are added here.
grant execute on function private.location_sibling_name_available(uuid,uuid,text,boolean),
 private.validate_location_sibling_name() to service_role;
create or replace function public.location_rename(p_request_id uuid,p_payload jsonb) returns jsonb
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
 perform private.location_sibling_name_available(location_uuid,row_before.parent_id,v_name,row_before.active);
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


create or replace function public.location_create(p_request_id uuid,p_payload jsonb) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare actor uuid:=auth.uid(); actor_name text; normalized jsonb; replay jsonb;
 new_id uuid; event_id uuid:=gen_random_uuid(); v_code text; v_name text; v_kind text;
 v_parent uuid; v_can boolean; v_active boolean; v_order integer; after_state jsonb;
begin
 select display_name into actor_name from public.app_members
 where user_id=actor and active and role='staff' and can_manage_configuration for share;
 if not found then raise exception using errcode='P1001',message='forbidden'; end if;
 perform private.inventory_payload(p_payload,array['code','name','parent_id','kind','can_hold_inventory','active','sort_order']);
 v_code:=private.inventory_text(p_payload,'code',100,true);
 if v_code !~ '^[A-Z][A-Z0-9]*(-[A-Z0-9]+)*$' or v_code='ITC' or v_code like 'ITC-%' then
  raise exception using errcode='P1012',message='invalid_input'; end if;
 v_name:=private.inventory_text(p_payload,'name',200,true);
 v_parent:=private.inventory_uuid(p_payload,'parent_id',false);
 v_kind:=private.inventory_text(p_payload,'kind',30,true);
 v_can:=private.custody_boolean(p_payload,'can_hold_inventory');
 v_active:=private.custody_boolean(p_payload,'active');
 v_order:=private.inventory_integer(p_payload,'sort_order',0,0);
 normalized:=jsonb_build_object('code',v_code,'name',v_name,'parent_id',v_parent,
  'kind',v_kind,'can_hold_inventory',v_can,'active',v_active,'sort_order',v_order);
 replay:=private.inventory_receipt(actor,p_request_id,'location_create',normalized);
 if replay is not null then return replay; end if;
 perform private.placement_lock(true);
 perform private.location_parent_active(v_parent);
 perform private.location_sibling_name_available(null,v_parent,v_name,v_active);
 if v_kind='room' and v_parent is not null or v_kind<>'room' and v_parent is null then
  raise exception using errcode='P1012',message='invalid_input'; end if;
 insert into public.locations(code,name,parent_id,kind,can_hold_inventory,active,sort_order)
 values(v_code,v_name,v_parent,v_kind,v_can,v_active,v_order) returning public.locations.id into new_id;
 after_state:=jsonb_build_object('code',v_code,'name',v_name,'parent_id',v_parent,
  'kind',v_kind,'can_hold_inventory',v_can,'active',v_active,'sort_order',v_order);
 insert into public.location_configuration_events
 (id,location_id,actor_id,actor_name,kind,before_state,after_state,version)
 values(event_id,new_id,actor,actor_name,'created',null,after_state,1);
 replay:=jsonb_build_object('entity_id',new_id,'version','1','event_id',event_id,'changed',true);
 update private.mutation_requests set result=replay where actor_id=actor and request_id=p_request_id;
 return replay;
exception when unique_violation then raise exception using errcode='P1007',message='identifier_conflict';
end; $$;

create or replace function public.location_update(p_request_id uuid,p_payload jsonb) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
<<location_update>>
declare actor uuid:=auth.uid(); actor_name text; normalized jsonb; replay jsonb;
 id uuid; expected bigint; row_before public.locations%rowtype;
 v_name text; v_parent uuid; v_kind text; v_can boolean; v_active boolean; v_order integer;
 before_state jsonb; after_state jsonb; event_id uuid:=gen_random_uuid();
begin
 select display_name into actor_name from public.app_members
 where user_id=actor and active and role='staff' and can_manage_configuration for share;
 if not found then raise exception using errcode='P1001',message='forbidden'; end if;
 perform private.inventory_payload(p_payload,array['location_id','expected_version','name','parent_id','kind','can_hold_inventory','active','sort_order']);
 id:=private.inventory_uuid(p_payload,'location_id');
 expected:=private.configuration_version(p_payload,'expected_version');
 v_name:=private.inventory_text(p_payload,'name',200,true);
 v_parent:=private.inventory_uuid(p_payload,'parent_id',false);
 v_kind:=private.inventory_text(p_payload,'kind',30,true);
 v_can:=private.custody_boolean(p_payload,'can_hold_inventory');
 v_active:=private.custody_boolean(p_payload,'active');
 v_order:=private.inventory_integer(p_payload,'sort_order',0);
 normalized:=jsonb_build_object('location_id',id,'expected_version',expected::text,
  'name',v_name,'parent_id',v_parent,'kind',v_kind,'can_hold_inventory',v_can,
  'active',v_active,'sort_order',v_order);
 replay:=private.inventory_receipt(actor,p_request_id,'location_update',normalized);
 if replay is not null then return replay; end if;
 perform private.placement_lock(true);
 select * into row_before from public.locations where public.locations.id=location_update.id for update;
 if not found then raise exception using errcode='P1010',message='not_found'; end if;
 if row_before.version<>expected then raise exception using errcode='P1002',message='stale_version'; end if;
 perform private.location_sibling_name_available(id,v_parent,v_name,v_active);
 if v_parent is distinct from row_before.parent_id then perform private.location_parent_active(v_parent); end if;
 if v_kind='room' and v_parent is not null or v_kind<>'room' and v_parent is null
 then raise exception using errcode='P1012',message='invalid_input'; end if;
 before_state:=jsonb_build_object('code',row_before.code,'name',row_before.name,
  'parent_id',row_before.parent_id,'kind',row_before.kind,
  'can_hold_inventory',row_before.can_hold_inventory,'active',row_before.active,
  'sort_order',row_before.sort_order);
 after_state:=jsonb_build_object('code',row_before.code,'name',v_name,
  'parent_id',v_parent,'kind',v_kind,'can_hold_inventory',v_can,'active',v_active,
  'sort_order',v_order);
 if before_state=after_state then
  replay:=jsonb_build_object('entity_id',id,'version',expected::text,'event_id',null,'changed',false);
 else
  if expected=9223372036854775807 then raise exception using errcode='P1008',message='invalid_transition'; end if;
  update public.locations set name=v_name,parent_id=v_parent,kind=v_kind,can_hold_inventory=v_can,
   active=v_active,sort_order=v_order,version=expected+1 where public.locations.id=location_update.id;
  insert into public.location_configuration_events
  (id,location_id,actor_id,actor_name,kind,before_state,after_state,version)
  values(event_id,id,actor,actor_name,'updated',before_state,after_state,expected+1);
  replay:=jsonb_build_object('entity_id',id,'version',(expected+1)::text,'event_id',event_id,'changed',true);
 end if;
 update private.mutation_requests set result=replay where actor_id=actor and request_id=p_request_id;
 return replay;
end; $$;


revoke all on function public.location_create(uuid,jsonb),public.location_update(uuid,jsonb) from public,anon,authenticated,service_role;
commit;
