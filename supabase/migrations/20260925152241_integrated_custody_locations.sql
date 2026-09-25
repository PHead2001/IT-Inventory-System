-- Managed logical storage and site custody. Inventory in stock_balances remains
-- physically stored; site_quantity_holdings is the sole current assigned count.
-- All exposed writes are hardened, receipt-backed RPCs. The placement advisory
-- lock serializes topology changes with inventory references before row locks.
alter table public.locations drop constraint locations_kind_check;
alter table public.locations add constraint locations_kind_check
  check(kind in ('room','storage_group','storage_area','shelf','shelf_section','drawer','rack','container'));
alter table public.locations add column version bigint not null default 1 check(version>0);

create table public.sites (
 id uuid primary key default gen_random_uuid(),
 code text not null unique check(code ~ '^[A-Z][A-Z0-9]*(-[A-Z0-9]+)*$'),
 name text not null check(name=btrim(name) and char_length(name) between 1 and 200),
 notes text check(notes=btrim(notes) and char_length(notes) between 1 and 2000),
 active boolean not null default true,
 version bigint not null default 1 check(version>0),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create trigger sites_timestamp before update on public.sites for each row execute function private.set_updated_at();
create function private.preserve_site_identity() returns trigger language plpgsql set search_path='' as $$
begin
 if new.id is distinct from old.id or new.code is distinct from old.code then
  raise exception using errcode='23514',message='Site identity is immutable';
 end if;
 return new;
end; $$;
create trigger site_identity before update on public.sites for each row execute function private.preserve_site_identity();
create function private.prevent_custody_identity_delete() returns trigger language plpgsql set search_path='' as $$
begin raise exception using errcode='23514',message='Location and site codes are never recycled'; end; $$;
create trigger location_no_delete before delete on public.locations for each row execute function private.prevent_custody_identity_delete();
create trigger site_no_delete before delete on public.sites for each row execute function private.prevent_custody_identity_delete();
create function private.preserve_modeled_location() returns trigger language plpgsql set search_path='' as $$
begin
 if old.code='ITC' or old.code like 'ITC-%' then
  if new.parent_id is distinct from old.parent_id or new.kind is distinct from old.kind
     or new.can_hold_inventory is distinct from old.can_hold_inventory then
   raise exception using errcode='P1008',message='modeled_location_shape_immutable';
  end if;
 end if;
 return new;
end; $$;
create trigger location_modeled_shape before update on public.locations
for each row execute function private.preserve_modeled_location();

create table public.site_quantity_holdings (
 item_id uuid not null references public.quantity_items(id) on delete restrict,
 site_id uuid not null references public.sites(id) on delete restrict,
 quantity integer not null check(quantity>=0),
 primary key(item_id,site_id)
);
create index site_quantity_holdings_site on public.site_quantity_holdings(site_id,item_id) where quantity>0;

alter table public.serialized_assets alter column location_id drop not null;
alter table public.serialized_assets add column site_id uuid references public.sites(id) on delete restrict;
alter table public.serialized_assets add constraint asset_exclusive_custody check(
 (status='active' and ((location_id is not null) <> (site_id is not null)))
 or (status='retired' and site_id is null)
);
create index serialized_assets_site on public.serialized_assets(site_id,id) where status='active' and site_id is not null;
create function private.asset_site_transition_guard() returns trigger language plpgsql set search_path='' as $$
begin
 if old.site_id is not null and new.site_id=old.site_id and
   (new.location_id is distinct from old.location_id or new.status is distinct from old.status) then
  raise exception using errcode='P1008',message='site_custody_requires_assignment_operation';
 end if;
 return new;
end; $$;
create trigger asset_site_transition before update of location_id,site_id,status on public.serialized_assets
for each row execute function private.asset_site_transition_guard();

alter table public.quantity_events drop constraint quantity_events_kind_check;
alter table public.quantity_events add constraint quantity_events_kind_check check(kind in
 ('created','received','moved','adjusted','metadata_updated','archived','restored',
  'site_opened','site_issued','site_returned','site_transferred','site_corrected','site_written_off'));
alter table public.asset_events drop constraint asset_events_kind_check;
alter table public.asset_events add constraint asset_events_kind_check check(kind in
 ('created','moved','location_corrected','metadata_updated','retired','restored',
  'site_opened','site_assigned','site_returned','site_transferred','site_corrected',
  'site_written_off','site_retired'));

-- Site lines cannot be squeezed into quantity_event_lines, whose location FK
-- deliberately denotes logical storage only. The linked assignment event and
-- line snapshots are append-only and preserve both endpoints.
create table public.site_quantity_event_lines (
 event_id uuid not null references public.quantity_events(id) on delete restrict,
 site_id uuid not null references public.sites(id) on delete restrict,
 delta integer not null check(delta<>0),
 before_quantity integer not null check(before_quantity>=0),
 after_quantity integer not null check(after_quantity>=0),
 primary key(event_id,site_id),
 check(after_quantity::bigint=before_quantity::bigint+delta::bigint)
);
create table public.assignment_events (
 id uuid primary key default gen_random_uuid(),
 quantity_event_id uuid unique references public.quantity_events(id) on delete restrict,
 asset_event_id uuid unique references public.asset_events(id) on delete restrict,
 item_id uuid references public.quantity_items(id) on delete restrict,
 asset_id uuid references public.serialized_assets(id) on delete restrict,
 kind text not null check(kind in ('opened','issued','returned','transferred','corrected','written_off','retired')),
 actor_id uuid not null references public.app_members(user_id) on delete restrict,
 actor_name text not null,
 reason text check(reason=btrim(reason) and char_length(reason) between 1 and 2000),
 reference text check(reference=btrim(reference) and char_length(reference) between 1 and 200),
 from_location_id uuid references public.locations(id) on delete restrict,
 to_location_id uuid references public.locations(id) on delete restrict,
 from_site_id uuid references public.sites(id) on delete restrict,
 to_site_id uuid references public.sites(id) on delete restrict,
 from_label text, to_label text,
 quantity integer check(quantity>0),
 created_at timestamptz not null default now(),
 check((quantity_event_id is not null and asset_event_id is null and item_id is not null and asset_id is null and quantity is not null)
    or (asset_event_id is not null and quantity_event_id is null and asset_id is not null and item_id is null and quantity is null)),
 check(num_nonnulls(from_location_id,from_site_id)<=1 and num_nonnulls(to_location_id,to_site_id)<=1)
);
create index assignment_events_site_from on public.assignment_events(from_site_id,created_at desc,id desc);
create index assignment_events_site_to on public.assignment_events(to_site_id,created_at desc,id desc);
create trigger assignment_events_append_only before update or delete on public.assignment_events for each row execute function private.inventory_append_only();
create trigger site_quantity_event_lines_append_only before update or delete on public.site_quantity_event_lines for each row execute function private.inventory_append_only();

create function private.assignment_link_guard() returns trigger language plpgsql set search_path='' as $$
begin
 if new.quantity_event_id is not null and not exists
   (select 1 from public.quantity_events e where e.id=new.quantity_event_id and e.item_id=new.item_id and e.kind like 'site_%') then
  raise exception using errcode='23514',message='Assignment quantity event mismatch';
 end if;
 if new.asset_event_id is not null and not exists
   (select 1 from public.asset_events e where e.id=new.asset_event_id and e.asset_id=new.asset_id and e.kind like 'site_%') then
  raise exception using errcode='23514',message='Assignment asset event mismatch';
 end if;
 return new;
end; $$;
create trigger assignment_link before insert on public.assignment_events for each row execute function private.assignment_link_guard();

create table public.location_configuration_events (
 id uuid primary key default gen_random_uuid(),
 location_id uuid not null references public.locations(id) on delete restrict,
 actor_id uuid not null references public.app_members(user_id) on delete restrict,
 actor_name text not null,
 kind text not null check(kind in ('created','updated')),
 before_state jsonb, after_state jsonb not null,
 version bigint not null check(version>0),
 created_at timestamptz not null default now(), unique(location_id,version)
);
create table public.site_configuration_events (
 id uuid primary key default gen_random_uuid(),
 site_id uuid not null references public.sites(id) on delete restrict,
 actor_id uuid not null references public.app_members(user_id) on delete restrict,
 actor_name text not null,
 kind text not null check(kind in ('created','updated')),
 before_state jsonb, after_state jsonb not null,
 version bigint not null check(version>0),
 created_at timestamptz not null default now(), unique(site_id,version)
);
create trigger location_configuration_append_only before update or delete on public.location_configuration_events for each row execute function private.inventory_append_only();
create trigger site_configuration_append_only before update or delete on public.site_configuration_events for each row execute function private.inventory_append_only();

-- Read grants are useful for caller-authorized lists. No ordinary client can
-- write current state or history directly, including through service_role grants.
alter table public.sites enable row level security;
alter table public.site_quantity_holdings enable row level security;
alter table public.site_quantity_event_lines enable row level security;
alter table public.assignment_events enable row level security;
alter table public.location_configuration_events enable row level security;
alter table public.site_configuration_events enable row level security;
create policy sites_member_read on public.sites for select to authenticated using
 (exists(select 1 from public.app_members m where m.user_id=(select auth.uid()) and m.active));
create policy site_holdings_member_read on public.site_quantity_holdings for select to authenticated using
 (exists(select 1 from public.app_members m where m.user_id=(select auth.uid()) and m.active));
create policy site_lines_member_read on public.site_quantity_event_lines for select to authenticated using
 (exists(select 1 from public.app_members m where m.user_id=(select auth.uid()) and m.active));
create policy assignment_events_member_read on public.assignment_events for select to authenticated using
 (exists(select 1 from public.app_members m where m.user_id=(select auth.uid()) and m.active));
create policy location_config_member_read on public.location_configuration_events for select to authenticated using
 (exists(select 1 from public.app_members m where m.user_id=(select auth.uid()) and m.active));
create policy site_config_member_read on public.site_configuration_events for select to authenticated using
 (exists(select 1 from public.app_members m where m.user_id=(select auth.uid()) and m.active));
revoke all on public.sites,public.site_quantity_holdings,public.site_quantity_event_lines,
 public.assignment_events,public.location_configuration_events,public.site_configuration_events
 from public,anon,authenticated,service_role;
grant select on public.sites,public.site_quantity_holdings,public.site_quantity_event_lines,
 public.assignment_events,public.location_configuration_events,public.site_configuration_events
 to authenticated,service_role;

-- Fixed lock key distinct from the catalog guard (91081,5). Existing callers
-- reserve receipts before this guard; catalog writers take catalog first.
create function private.placement_lock(p_exclusive boolean) returns void
language plpgsql set search_path='' as $$
begin
 if current_setting('transaction_isolation') <> 'read committed' then
  raise exception using errcode='P1016',message='unsupported_isolation';
 end if;
 perform set_config('lock_timeout','2s',true);
 if p_exclusive then perform pg_catalog.pg_advisory_xact_lock(91081,6);
 else perform pg_catalog.pg_advisory_xact_lock_shared(91081,6); end if;
end; $$;

create or replace function private.inventory_receipt(actor uuid,request uuid,op text,payload jsonb)
returns jsonb language plpgsql set search_path='' as $$
declare receipt private.mutation_requests%rowtype;
begin
 if request is null then raise exception using errcode='P1012',message='invalid_input'; end if;
 insert into private.mutation_requests(actor_id,request_id,operation,request_payload)
 values(actor,request,op,payload) on conflict(actor_id,request_id) do nothing;
 select * into receipt from private.mutation_requests where actor_id=actor and request_id=request for update;
 if receipt.operation<>op or receipt.request_payload<>payload then
  raise exception using errcode='P1009',message='idempotency_conflict'; end if;
 if receipt.result is not null then return receipt.result; end if;
 -- All legacy stock-only writers which can create/use storage references. A
 -- schema test enumerates this allowlist against exposed mutation entrypoints.
 if op=any(array['quantity_receive','quantity_move','quantity_adjust',
                  'quantity_archive','quantity_archive_and_clear',
                  'asset_move','asset_correct_location','asset_retire']) then
  perform private.placement_lock(false);
 end if;
 return null;
end; $$;

create or replace function private.configuration_catalog_lock(exclusive boolean) returns void
language plpgsql set search_path='' as $$
begin
 if current_setting('transaction_isolation') <> 'read committed' then
  raise exception using errcode='P1016',message='unsupported_isolation';
 end if;
 perform set_config('lock_timeout','2s',true);
 if exclusive then perform pg_catalog.pg_advisory_xact_lock(91081,5);
 else perform pg_catalog.pg_advisory_xact_lock_shared(91081,5); end if;
 -- Catalog operations may also touch inventory references. This short shared
 -- placement hold preserves catalog -> placement -> inventory row order. Site
 -- and location lifecycle RPCs do not call this helper or upgrade this hold.
 perform private.placement_lock(false);
end; $$;

-- Privileged direct topology SQL passes through this statement trigger too;
-- the exclusive placement lock is acquired before the hierarchy guard row.
create or replace function private.lock_location_hierarchy() returns trigger
language plpgsql set search_path='' as $$
begin
 perform private.placement_lock(true);
 update private.location_hierarchy_guard set token=not token where singleton;
 if not found then raise exception 'Location hierarchy guard missing'; end if;
 return null;
end; $$;
create function private.lock_site_topology() returns trigger language plpgsql set search_path='' as $$
begin perform private.placement_lock(true); return null; end; $$;
create trigger sites_serialize before insert or update or delete on public.sites
for each statement execute function private.lock_site_topology();

create or replace function private.validate_location_hierarchy() returns trigger
language plpgsql set search_path='' as $$
begin
 if exists (
  with recursive ancestors as (
   select id,parent_id,array[id] as visited,false as cycle from public.locations
   union all
   select p.id,p.parent_id,a.visited||p.id,p.id=any(a.visited)
   from ancestors a join public.locations p on p.id=a.parent_id where not a.cycle
  ) select 1 from ancestors where cycle
 ) then raise exception 'Location hierarchy cannot contain cycles' using errcode='23514'; end if;
 if exists (
  select 1 from public.locations c join public.locations p on p.id=c.parent_id
  where not (
   (c.kind in ('storage_group','rack','container') and p.kind='room')
   or (c.kind='storage_area' and p.kind in ('room','storage_group'))
   or (c.kind in ('shelf','drawer') and p.kind='storage_group')
   or (c.kind='shelf_section' and p.kind='shelf')
  )
 ) then raise exception 'Invalid location parent kind' using errcode='23514'; end if;
 return null;
end; $$;

-- Validate only topology edits that can *newly* invalidate a holding. Existing
-- inactive-location stock predates this migration and remains evacuable; a
-- global scan on Office INSERT would otherwise block a valid upgrade.
create function private.validate_affected_location_holdings() returns trigger
language plpgsql set search_path='' as $$
begin
 if new.active=old.active and new.can_hold_inventory=old.can_hold_inventory
    and new.parent_id is not distinct from old.parent_id then return new; end if;
 if exists (
  with recursive descendants as (
   select new.id as id,array[new.id] as visited
   union all
   select c.id,d.visited||c.id from descendants d
   join public.locations c on c.parent_id=d.id where not c.id=any(d.visited)
  ), held as (
   select b.location_id as leaf from public.stock_balances b
   join descendants d on d.id=b.location_id where b.quantity>0
   union
   select a.location_id from public.serialized_assets a
   join descendants d on d.id=a.location_id where a.status='active'
  ), chain as (
   select h.leaf as id,h.leaf,array[h.leaf] as visited from held h
   union all
   select p.id,c.leaf,c.visited||p.id from chain c
   join public.locations l on l.id=c.id
   join public.locations p on p.id=l.parent_id where not p.id=any(c.visited)
  )
  select 1 from chain c join public.locations l on l.id=c.id
  join public.locations leaf on leaf.id=c.leaf
  where not l.active or not leaf.can_hold_inventory
 ) then raise exception using errcode='P1008',message='location_has_inventory'; end if;
 return new;
end; $$;
create trigger locations_affected_holdings after update of active,can_hold_inventory,parent_id
on public.locations for each row execute function private.validate_affected_location_holdings();

create function private.validate_site_topology() returns trigger language plpgsql set search_path='' as $$
begin
 if exists(select 1 from public.sites s where not s.active and
   (exists(select 1 from public.site_quantity_holdings h where h.site_id=s.id and h.quantity>0)
    or exists(select 1 from public.serialized_assets a where a.site_id=s.id and a.status='active')))
 then raise exception using errcode='P1008',message='site_has_inventory'; end if;
 return null;
end; $$;
create trigger sites_validate after insert or update or delete on public.sites
for each statement execute function private.validate_site_topology();

-- Office labels are provisional software destinations, with no room geometry.
insert into public.locations(code,name,kind,can_hold_inventory,sort_order)
values ('ITO','IT Office','room',false,0);
insert into public.locations(code,name,parent_id,kind,can_hold_inventory,sort_order)
select 'ITO-GENERAL','General Storage / Unsorted',id,'storage_area',true,0
from public.locations where code='ITO';

-- Destination eligibility includes active ancestry. Inactive sources are
-- deliberately not checked here so staff can evacuate them.
create or replace function private.inventory_destination(location uuid) returns void
language plpgsql set search_path='' as $$
declare v_ok boolean;
begin
 select l.active and l.can_hold_inventory and not exists(
  with recursive ancestors as (
   select p.id,p.parent_id,p.active,array[p.id] as visited
   from public.locations p where p.id=l.parent_id
   union all
   select p.id,p.parent_id,p.active,a.visited||p.id
   from ancestors a join public.locations p on p.id=a.parent_id
   where not p.id=any(a.visited)
  ) select 1 from ancestors where not active
 ) into v_ok from public.locations l where l.id=location for share;
 if not coalesce(v_ok,false) then raise exception using errcode='P1004',message='invalid_location'; end if;
end; $$;

revoke all on function private.placement_lock(boolean),private.lock_site_topology(),
 private.validate_site_topology(),private.assignment_link_guard(),private.preserve_site_identity()
 from public,anon,authenticated,service_role;
-- Existing administrative fixtures write topology through service_role; the
-- invoker statement triggers must be able to take the same guard.
grant execute on function private.placement_lock(boolean) to service_role;

create function private.custody_boolean(p jsonb,k text) returns boolean language plpgsql set search_path='' as $$
begin
 if jsonb_typeof(p->k) is distinct from 'boolean' then
  raise exception using errcode='P1012',message='invalid_input'; end if;
 return (p->>k)::boolean;
end; $$;
create function private.location_parent_active(p_parent uuid) returns void
language plpgsql set search_path='' as $$
begin
 if p_parent is null then return; end if;
 if not exists (
  with recursive chain as (
   select id,parent_id,active,array[id] as visited from public.locations where id=p_parent
   union all select l.id,l.parent_id,l.active,c.visited||l.id
   from chain c join public.locations l on l.id=c.parent_id where not l.id=any(c.visited)
  ) select 1 from chain having bool_and(active) and count(*)>0
 ) then raise exception using errcode='P1004',message='invalid_location'; end if;
end; $$;

create function public.location_create(p_request_id uuid,p_payload jsonb) returns jsonb
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

create function public.location_update(p_request_id uuid,p_payload jsonb) returns jsonb
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

create function public.site_create(p_request_id uuid,p_payload jsonb) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare actor uuid:=auth.uid(); actor_name text; normalized jsonb; replay jsonb;
 v_code text; v_name text; v_notes text; id uuid; event_id uuid:=gen_random_uuid();
 after_state jsonb;
begin
 select display_name into actor_name from public.app_members
 where user_id=actor and active and role='staff' and can_manage_configuration for share;
 if not found then raise exception using errcode='P1001',message='forbidden'; end if;
 perform private.inventory_payload(p_payload,array['code','name','notes']);
 v_code:=private.inventory_text(p_payload,'code',100,true);
 if v_code !~ '^[A-Z][A-Z0-9]*(-[A-Z0-9]+)*$' then
  raise exception using errcode='P1012',message='invalid_input'; end if;
 v_name:=private.inventory_text(p_payload,'name',200,true);
 v_notes:=private.inventory_text(p_payload,'notes',2000);
 normalized:=jsonb_build_object('code',v_code,'name',v_name,'notes',v_notes);
 replay:=private.inventory_receipt(actor,p_request_id,'site_create',normalized);
 if replay is not null then return replay; end if;
 perform private.placement_lock(true);
 insert into public.sites(code,name,notes) values(v_code,v_name,v_notes) returning public.sites.id into id;
 after_state:=jsonb_build_object('code',v_code,'name',v_name,'notes',v_notes,'active',true);
 insert into public.site_configuration_events(id,site_id,actor_id,actor_name,kind,before_state,after_state,version)
 values(event_id,id,actor,actor_name,'created',null,after_state,1);
 replay:=jsonb_build_object('entity_id',id,'version','1','event_id',event_id,'changed',true);
 update private.mutation_requests set result=replay where actor_id=actor and request_id=p_request_id;
 return replay;
exception when unique_violation then raise exception using errcode='P1007',message='identifier_conflict';
end; $$;

create function public.site_update(p_request_id uuid,p_payload jsonb) returns jsonb
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

revoke all on function public.location_create(uuid,jsonb),public.location_update(uuid,jsonb),
 public.site_create(uuid,jsonb),public.site_update(uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.location_create(uuid,jsonb),public.location_update(uuid,jsonb),
 public.site_create(uuid,jsonb),public.site_update(uuid,jsonb) to authenticated;
revoke all on function private.custody_boolean(jsonb,text),private.location_parent_active(uuid),
 private.prevent_custody_identity_delete(),private.preserve_modeled_location()
 from public,anon,authenticated,service_role;

create function private.inventory_expected_version(p jsonb) returns integer
language plpgsql set search_path='' as $$
declare raw text;
begin
 if jsonb_typeof(p->'expected_version')='string' then
  raw:=p->>'expected_version';
  if raw !~ '^[1-9][0-9]{0,9}$' or raw::numeric>2147483647 then
   raise exception using errcode='P1012',message='invalid_input'; end if;
  return raw::integer;
 end if;
 return private.inventory_integer(p,'expected_version',1);
end; $$;

create function public.quantity_site_change(p_request_id uuid,p_payload jsonb) returns jsonb
language plpgsql volatile security definer set search_path='' set statement_timeout='5s' as $$
<<quantity_site_change>>
declare actor uuid:=auth.uid(); actor_name text; normalized jsonb; replay jsonb;
 item_id uuid; expected integer; item public.quantity_items%rowtype;
 action text; source_location uuid; destination_location uuid; source_site uuid; destination_site uuid;
 amount integer; observed integer; before_source integer; before_destination integer;
 after_source integer; after_destination integer; delta bigint; event_id uuid:=gen_random_uuid();
 reason text; reference_value text; from_label text; to_label text;
 site_row record; event_kind text; assignment_kind text;
begin
 select display_name into actor_name from public.app_members
 where user_id=actor and active and role='staff' for share;
 if not found then raise exception using errcode='P1001',message='forbidden'; end if;
 perform private.inventory_payload(p_payload,array['action','item_id','expected_version',
  'source_location_id','destination_location_id','source_site_id','destination_site_id',
  'quantity','observed_quantity','reason','reference']);
 action:=private.inventory_text(p_payload,'action',30,true);
 if action not in ('issue','return','transfer','opening','correct','write_off') then
  raise exception using errcode='P1012',message='invalid_input'; end if;
 item_id:=private.inventory_uuid(p_payload,'item_id');
 expected:=private.inventory_expected_version(p_payload);
 source_location:=private.inventory_uuid(p_payload,'source_location_id',false);
 destination_location:=private.inventory_uuid(p_payload,'destination_location_id',false);
 source_site:=private.inventory_uuid(p_payload,'source_site_id',false);
 destination_site:=private.inventory_uuid(p_payload,'destination_site_id',false);
 reason:=private.inventory_text(p_payload,'reason',2000,action in ('correct','write_off'));
 reference_value:=private.inventory_text(p_payload,'reference',200);
 if action='correct' then
  observed:=private.inventory_integer(p_payload,'observed_quantity',0);
  if source_site is null or num_nonnulls(source_location,destination_location,destination_site)>0
     or p_payload ? 'quantity' then raise exception using errcode='P1012',message='invalid_input'; end if;
 else
  amount:=private.inventory_integer(p_payload,'quantity',1);
  if p_payload ? 'observed_quantity' then raise exception using errcode='P1012',message='invalid_input'; end if;
  if action='issue' and (source_location is null or destination_site is null
      or num_nonnulls(destination_location,source_site)>0)
   or action='return' and (source_site is null or destination_location is null
      or num_nonnulls(source_location,destination_site)>0)
   or action='transfer' and (source_site is null or destination_site is null
      or source_site=destination_site or num_nonnulls(source_location,destination_location)>0)
   or action='opening' and (destination_site is null or
      num_nonnulls(source_location,destination_location,source_site)>0)
   or action='write_off' and (source_site is null or
      num_nonnulls(source_location,destination_location,destination_site)>0)
  then raise exception using errcode='P1012',message='invalid_input'; end if;
 end if;
 normalized:=jsonb_build_object('action',action,'item_id',item_id,'expected_version',expected::text,
  'source_location_id',source_location,'destination_location_id',destination_location,
  'source_site_id',source_site,'destination_site_id',destination_site,
  'quantity',amount,'observed_quantity',observed,'reason',reason,'reference',reference_value);
 replay:=private.inventory_receipt(actor,p_request_id,'quantity_site_change',normalized);
 if replay is not null then return replay; end if;
 perform private.placement_lock(false);
 select * into item from public.quantity_items q where q.id=item_id for update;
 if not found then raise exception using errcode='P1010',message='not_found'; end if;
 if item.version<>expected then raise exception using errcode='P1002',message='stale_version'; end if;
 if item.archived or item.version=2147483647 then
  raise exception using errcode='P1008',message='invalid_transition'; end if;
 -- A topology update holds the exclusive placement guard; ordered site row
 -- locks provide deterministic behavior when both source and target are sites.
 for site_row in select id,name,active from public.sites
   where id=any(array[source_site,destination_site]) order by id for share loop
  if site_row.id=destination_site and not site_row.active then
   raise exception using errcode='P1004',message='invalid_site'; end if;
  if site_row.id=source_site then from_label:=site_row.name; end if;
  if site_row.id=destination_site then to_label:=site_row.name; end if;
 end loop;
 if source_site is not null and from_label is null or destination_site is not null and to_label is null then
  raise exception using errcode='P1004',message='invalid_site'; end if;
 if destination_location is not null then
  perform private.inventory_destination(destination_location);
  select name into to_label from public.locations where id=destination_location;
 end if;
 if source_location is not null then
  select name into from_label from public.locations where id=source_location;
  if from_label is null then raise exception using errcode='P1004',message='invalid_location'; end if;
 end if;
 if source_location is not null then
  select quantity into before_source from public.stock_balances
  where public.stock_balances.item_id=quantity_site_change.item_id and location_id=source_location;
 elsif source_site is not null then
  select quantity into before_source from public.site_quantity_holdings
  where public.site_quantity_holdings.item_id=quantity_site_change.item_id and site_id=source_site;
 end if;
 before_source:=coalesce(before_source,0);
 if action='correct' then
  delta:=observed::bigint-before_source::bigint;
  if delta>0 and exists(select 1 from public.sites where id=source_site and not active) then
   raise exception using errcode='P1004',message='invalid_site'; end if;
  if delta=0 then
   replay:=jsonb_build_object('entity_id',item_id,'version',expected::text,'event_id',null,
      'changed',false,'before',before_source,'after',before_source);
   update private.mutation_requests set result=replay where actor_id=actor and request_id=p_request_id;
   return replay;
  end if;
  amount:=abs(delta)::integer;
  after_source:=observed;
 elsif action='opening' then
  after_source:=before_source;
 elsif amount>before_source then
  raise exception using errcode='P1006',message='invalid_quantity';
 else after_source:=before_source-amount; end if;
 if destination_location is not null then
  select quantity into before_destination from public.stock_balances
  where public.stock_balances.item_id=quantity_site_change.item_id and location_id=destination_location;
 elsif destination_site is not null then
  select quantity into before_destination from public.site_quantity_holdings
  where public.site_quantity_holdings.item_id=quantity_site_change.item_id and site_id=destination_site;
 end if;
 before_destination:=coalesce(before_destination,0);
 if before_destination::bigint+coalesce(amount,0)>2147483647 then
  raise exception using errcode='P1006',message='invalid_quantity'; end if;
 after_destination:=before_destination+coalesce(amount,0);
 event_kind:=case action when 'issue' then 'site_issued' when 'return' then 'site_returned'
  when 'transfer' then 'site_transferred' when 'opening' then 'site_opened'
  when 'correct' then 'site_corrected'
  else 'site_written_off' end;
 assignment_kind:=case when action='issue' then 'issued' when action='return' then 'returned'
  when action='transfer' then 'transferred' when action='opening' then 'opened'
  when action='correct' then 'corrected'
  else 'written_off' end;
 if source_location is not null then
  update public.stock_balances set quantity=after_source
  where public.stock_balances.item_id=quantity_site_change.item_id and location_id=source_location;
 elsif source_site is not null then
  if action='correct' then
   insert into public.site_quantity_holdings(item_id,site_id,quantity)
   values(item_id,source_site,after_source)
   on conflict on constraint site_quantity_holdings_pkey do update set quantity=excluded.quantity;
  else
   update public.site_quantity_holdings set quantity=after_source
   where public.site_quantity_holdings.item_id=quantity_site_change.item_id and site_id=source_site;
  end if;
 end if;
 if destination_location is not null then
  insert into public.stock_balances(item_id,location_id,quantity)
  values(item_id,destination_location,after_destination)
  on conflict on constraint stock_balances_pkey do update set quantity=excluded.quantity;
 elsif destination_site is not null then
  insert into public.site_quantity_holdings(item_id,site_id,quantity)
  values(item_id,destination_site,after_destination)
  on conflict on constraint site_quantity_holdings_pkey do update set quantity=excluded.quantity;
 end if;
 update public.quantity_items set version=expected+1,updated_at=now() where id=item_id;
 insert into public.quantity_events(id,item_id,kind,actor_id,actor_name,reason,version)
 values(event_id,item_id,event_kind,actor,actor_name,reason,expected+1);
 if source_location is not null then
  insert into public.quantity_event_lines(event_id,location_id,delta,before_quantity,after_quantity)
  values(event_id,source_location,-amount,before_source,after_source);
 elsif source_site is not null then
  insert into public.site_quantity_event_lines(event_id,site_id,delta,before_quantity,after_quantity)
  values(event_id,source_site,case when action='correct' then delta::integer else -amount end,
   before_source,after_source);
 end if;
 if destination_location is not null then
  insert into public.quantity_event_lines(event_id,location_id,delta,before_quantity,after_quantity)
  values(event_id,destination_location,amount,before_destination,after_destination);
 elsif destination_site is not null then
  insert into public.site_quantity_event_lines(event_id,site_id,delta,before_quantity,after_quantity)
  values(event_id,destination_site,amount,before_destination,after_destination);
 end if;
 insert into public.assignment_events(quantity_event_id,item_id,kind,actor_id,actor_name,
  reason,reference,from_location_id,to_location_id,from_site_id,to_site_id,from_label,to_label,quantity)
 values(event_id,item_id,assignment_kind,actor,actor_name,reason,reference_value,
  source_location,destination_location,source_site,destination_site,from_label,to_label,amount);
 replay:=jsonb_build_object('entity_id',item_id,'version',(expected+1)::text,'event_id',event_id,
  'changed',true,'before',before_source,'after',after_source,'destination_before',before_destination,
  'destination_after',after_destination);
 update private.mutation_requests set result=replay where actor_id=actor and request_id=p_request_id;
 return replay;
end; $$;
revoke all on function public.quantity_site_change(uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.quantity_site_change(uuid,jsonb) to authenticated;

create function public.asset_site_change(p_request_id uuid,p_payload jsonb) returns jsonb
language plpgsql volatile security definer set search_path='' set statement_timeout='5s' as $$
declare actor uuid:=auth.uid(); actor_name text; normalized jsonb; replay jsonb;
 asset_id uuid; expected integer; asset public.serialized_assets%rowtype;
 action text; source_location uuid; destination_location uuid; source_site uuid; destination_site uuid;
 reason text; reference_value text; from_label text; to_label text;
 event_id uuid:=gen_random_uuid(); event_kind text; assignment_kind text;
begin
 select display_name into actor_name from public.app_members
 where user_id=actor and active and role='staff' for share;
 if not found then raise exception using errcode='P1001',message='forbidden'; end if;
 perform private.inventory_payload(p_payload,array['action','asset_id','expected_version',
  'source_location_id','destination_location_id','source_site_id','destination_site_id',
  'reason','reference']);
 action:=private.inventory_text(p_payload,'action',30,true);
 if action not in ('assign','return','transfer','correct','write_off','retire') then
  raise exception using errcode='P1012',message='invalid_input'; end if;
 asset_id:=private.inventory_uuid(p_payload,'asset_id');
 expected:=private.inventory_expected_version(p_payload);
 source_location:=private.inventory_uuid(p_payload,'source_location_id',false);
 destination_location:=private.inventory_uuid(p_payload,'destination_location_id',false);
 source_site:=private.inventory_uuid(p_payload,'source_site_id',false);
 destination_site:=private.inventory_uuid(p_payload,'destination_site_id',false);
 reason:=private.inventory_text(p_payload,'reason',2000,action in ('correct','write_off','retire'));
 reference_value:=private.inventory_text(p_payload,'reference',200);
 if action='assign' and (source_location is null or destination_site is null
     or num_nonnulls(source_site,destination_location)>0)
   or action='return' and (source_site is null or destination_location is null
     or num_nonnulls(source_location,destination_site)>0)
   or action in ('transfer','correct') and (source_site is null or destination_site is null
     or source_site=destination_site or num_nonnulls(source_location,destination_location)>0)
   or action in ('write_off','retire') and (source_site is null or
     num_nonnulls(source_location,destination_location,destination_site)>0)
 then raise exception using errcode='P1012',message='invalid_input'; end if;
 normalized:=jsonb_build_object('action',action,'asset_id',asset_id,'expected_version',expected::text,
  'source_location_id',source_location,'destination_location_id',destination_location,
  'source_site_id',source_site,'destination_site_id',destination_site,
  'reason',reason,'reference',reference_value);
 replay:=private.inventory_receipt(actor,p_request_id,'asset_site_change',normalized);
 if replay is not null then return replay; end if;
 perform private.placement_lock(false);
 select * into asset from public.serialized_assets a where a.id=asset_id for update;
 if not found then raise exception using errcode='P1010',message='not_found'; end if;
 if asset.version<>expected then raise exception using errcode='P1002',message='stale_version'; end if;
 if asset.status<>'active' or asset.version=2147483647 then
  raise exception using errcode='P1008',message='invalid_transition'; end if;
 if asset.location_id is distinct from source_location or asset.site_id is distinct from source_site then
  raise exception using errcode='P1002',message='stale_custody'; end if;
 if destination_site is not null then
  select name into to_label from public.sites where id=destination_site and active for share;
  if not found then raise exception using errcode='P1004',message='invalid_site'; end if;
 end if;
 if source_site is not null then
  select name into from_label from public.sites where id=source_site for share;
  if not found then raise exception using errcode='P1004',message='invalid_site'; end if;
 end if;
 if destination_location is not null then
  perform private.inventory_destination(destination_location);
  select name into to_label from public.locations where id=destination_location;
 end if;
 if source_location is not null then
  select name into from_label from public.locations where id=source_location;
 end if;
 event_kind:=case action when 'assign' then 'site_assigned' when 'return' then 'site_returned'
  when 'transfer' then 'site_transferred' when 'correct' then 'site_corrected'
  when 'write_off' then 'site_written_off'
  else 'site_retired' end;
 assignment_kind:=case action when 'assign' then 'issued' when 'return' then 'returned'
  when 'transfer' then 'transferred' when 'correct' then 'corrected'
  when 'write_off' then 'written_off' else 'retired' end;
 update public.serialized_assets set location_id=destination_location,site_id=destination_site,
  status=case when action in ('write_off','retire') then 'retired' else 'active' end,
  version=expected+1,updated_at=now() where id=asset_id;
 insert into public.asset_events(id,asset_id,kind,actor_id,actor_name,reason,
  from_location_id,to_location_id,before_metadata,after_metadata,version)
 values(event_id,asset_id,event_kind,actor,actor_name,reason,source_location,
  destination_location,
  jsonb_build_object('status','active','location_id',source_location,'site_id',source_site),
  jsonb_build_object('status',case when action in ('write_off','retire') then 'retired' else 'active' end,
   'location_id',destination_location,'site_id',destination_site),expected+1);
 insert into public.assignment_events(asset_event_id,asset_id,kind,actor_id,actor_name,
  reason,reference,from_location_id,to_location_id,from_site_id,to_site_id,from_label,to_label)
 values(event_id,asset_id,assignment_kind,actor,actor_name,reason,reference_value,
  source_location,destination_location,source_site,destination_site,from_label,to_label);
 replay:=jsonb_build_object('entity_id',asset_id,'version',(expected+1)::text,'event_id',event_id,
  'changed',true,'status',case when action in ('write_off','retire') then 'retired' else 'active' end,
  'location_id',destination_location,'site_id',destination_site);
 update private.mutation_requests set result=replay where actor_id=actor and request_id=p_request_id;
 return replay;
end; $$;
revoke all on function public.asset_site_change(uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.asset_site_change(uuid,jsonb) to authenticated;

create function public.quantity_site_open(p_request_id uuid,p_payload jsonb) returns jsonb
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
 where id=category_uuid and active and removed_at is null for share;
 if not found then raise exception using errcode='P1011',message='invalid_category'; end if;
 if current_rev is distinct from expected_rev then
  raise exception using errcode='P1024',message='stale_published_form'; end if;
 custom_values:=private.metadata_apply_patch(current_rev,'quantity','{}'::jsonb,custom_patch);
 needs:=private.metadata_needs(current_rev,'quantity',custom_values);
 if needs then raise exception using errcode='P1023',message='required_published_metadata_missing'; end if;
 select name into site_name from public.sites where id=site_uuid and active for share;
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

create function public.asset_site_open(p_request_id uuid,p_payload jsonb) returns jsonb
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
 where id=category_uuid and active and removed_at is null for share;
 if not found then raise exception using errcode='P1011',message='invalid_category'; end if;
 if current_rev is distinct from expected_rev then
  raise exception using errcode='P1024',message='stale_published_form'; end if;
 custom_values:=private.metadata_apply_patch(current_rev,'asset','{}'::jsonb,custom_patch);
 needs:=private.metadata_needs(current_rev,'asset',custom_values);
 if needs then raise exception using errcode='P1023',message='required_published_metadata_missing'; end if;
 select name into site_name from public.sites where id=site_uuid and active for share;
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
revoke all on function public.quantity_site_open(uuid,jsonb),public.asset_site_open(uuid,jsonb)
 from public,anon,authenticated,service_role;
grant execute on function public.quantity_site_open(uuid,jsonb),public.asset_site_open(uuid,jsonb) to authenticated;

-- Existing archive RPCs remain storage-only. This trigger closes both the
-- legacy and explicit-clear routes without changing their receipt behavior.
create function private.prevent_archived_site_holdings() returns trigger
language plpgsql set search_path='' as $$
begin
 if new.archived and not old.archived and exists(
  select 1 from public.site_quantity_holdings h where h.item_id=new.id and h.quantity>0
 ) then raise exception using errcode='P1008',message='assigned_stock_must_be_resolved'; end if;
 return new;
end; $$;
create trigger quantity_archive_site_guard before update of archived on public.quantity_items
for each row execute function private.prevent_archived_site_holdings();

-- Deferred links reject even privileged creation of an orphaned site event.
create function private.require_assignment_link() returns trigger language plpgsql set search_path='' as $$
begin
 if new.kind like 'site_%' and
  (tg_table_name='quantity_events' and not exists
    (select 1 from public.assignment_events a where a.quantity_event_id=new.id)
   or tg_table_name='asset_events' and not exists
    (select 1 from public.assignment_events a where a.asset_event_id=new.id)) then
  raise exception using errcode='23514',message='Site event requires assignment link';
 end if;
 return null;
end; $$;
create constraint trigger quantity_site_link_required after insert on public.quantity_events
deferrable initially deferred for each row execute function private.require_assignment_link();
create constraint trigger asset_site_link_required after insert on public.asset_events
deferrable initially deferred for each row execute function private.require_assignment_link();

create or replace function private.assignment_link_guard() returns trigger language plpgsql set search_path='' as $$
declare expected_kind text;
begin
 expected_kind:=case new.kind when 'opened' then 'site_opened'
  when 'issued' then case when new.item_id is not null then 'site_issued' else 'site_assigned' end
  when 'returned' then 'site_returned' when 'transferred' then 'site_transferred'
  when 'corrected' then 'site_corrected' when 'written_off' then 'site_written_off'
  when 'retired' then 'site_retired' end;
 if new.quantity_event_id is not null and not exists
   (select 1 from public.quantity_events e where e.id=new.quantity_event_id
    and e.item_id=new.item_id and e.kind=expected_kind) then
  raise exception using errcode='23514',message='Assignment quantity event mismatch'; end if;
 if new.asset_event_id is not null and not exists
   (select 1 from public.asset_events e where e.id=new.asset_event_id
    and e.asset_id=new.asset_id and e.kind=expected_kind) then
  raise exception using errcode='23514',message='Assignment asset event mismatch'; end if;
 return new;
end; $$;

create view public.inventory_quantity_totals with (security_invoker=true) as
select i.id as item_id,
 coalesce(storage.available,0)::text as available_quantity,
 coalesce(assigned.assigned,0)::text as assigned_quantity,
 (coalesce(storage.available,0)+coalesce(assigned.assigned,0))::text as recorded_quantity,
 case when i.reorder_threshold is null or i.archived then 'disabled'
  when coalesce(storage.available,0)=0 then 'out_of_stock'
  when coalesce(storage.available,0)<=i.reorder_threshold then 'needs_restocking'
  else 'in_stock' end as stock_state
from public.quantity_items i
left join lateral (select sum(b.quantity::bigint) as available from public.stock_balances b
 where b.item_id=i.id) storage on true
left join lateral (select sum(h.quantity::bigint) as assigned from public.site_quantity_holdings h
 where h.item_id=i.id) assigned on true;
revoke all on public.inventory_quantity_totals from public,anon,authenticated,service_role;
grant select on public.inventory_quantity_totals to authenticated,service_role;

-- A caller-authorized snapshot of site holdings, not a stock balance join.
create view public.site_current_holdings with (security_invoker=true) as
select s.id as site_id,s.code as site_code,s.name as site_name,s.active as site_active,
 'quantity'::text as inventory_kind,i.id as entity_id,i.name,c.name as category_name,
 i.manufacturer,i.model,h.quantity,null::text as asset_tag,null::text as serial_number
from public.site_quantity_holdings h join public.sites s on s.id=h.site_id
join public.quantity_items i on i.id=h.item_id join public.categories c on c.id=i.category_id
where h.quantity>0
union all
select s.id,s.code,s.name,s.active,'asset'::text,a.id,a.name,c.name,
 a.manufacturer,a.model,1,a.asset_tag,a.serial_number
from public.serialized_assets a join public.sites s on s.id=a.site_id
join public.categories c on c.id=a.category_id where a.status='active';
revoke all on public.site_current_holdings from public,anon,authenticated,service_role;
grant select on public.site_current_holdings to authenticated,service_role;

create function public.site_activity_summary(p_site_id uuid,p_from timestamptz default null,
 p_until timestamptz default null) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare result jsonb;
begin
 if p_site_id is null or p_from is not null and p_until is not null and p_from>=p_until then
  raise exception using errcode='P1012',message='invalid_input'; end if;
 if not exists(select 1 from public.sites where id=p_site_id) then
  raise exception using errcode='P1010',message='not_found'; end if;
 select jsonb_build_object(
  'site_id',p_site_id,
  'current_quantity_units',coalesce((select sum(quantity::numeric)::text
     from public.site_quantity_holdings where site_id=p_site_id), '0'),
  'current_serialized_assets',(select count(*) from public.serialized_assets
     where site_id=p_site_id and status='active')::text,
  'quantity',jsonb_build_object(
   'gross_issued_units',coalesce(sum(quantity) filter(where kind='issued' and item_id is not null
      and from_location_id is not null and to_site_id=p_site_id),0)::text,
   'return_units',coalesce(sum(quantity) filter(where kind='returned' and item_id is not null
      and from_site_id=p_site_id and to_location_id is not null),0)::text,
   'transfer_in_units',coalesce(sum(quantity) filter(where kind='transferred' and item_id is not null
      and to_site_id=p_site_id),0)::text,
   'transfer_out_units',coalesce(sum(quantity) filter(where kind='transferred' and item_id is not null
      and from_site_id=p_site_id),0)::text,
   'opening_units',coalesce(sum(quantity) filter(where kind='opened' and item_id is not null
      and to_site_id=p_site_id),0)::text,
   'write_off_units',coalesce(sum(quantity) filter(where kind='written_off' and item_id is not null
      and from_site_id=p_site_id),0)::text),
  'serialized',jsonb_build_object(
   'gross_storage_issue_events',count(*) filter(where kind='issued' and asset_id is not null
      and from_location_id is not null and to_site_id=p_site_id)::text,
   'unique_issued_assets',count(distinct asset_id) filter(where kind='issued' and asset_id is not null
      and from_location_id is not null and to_site_id=p_site_id)::text,
   'return_events',count(*) filter(where kind='returned' and asset_id is not null
      and from_site_id=p_site_id)::text,
   'opening_events',count(*) filter(where kind='opened' and asset_id is not null
      and to_site_id=p_site_id)::text,
   'retirement_events',count(*) filter(where kind in ('retired','written_off') and asset_id is not null
      and from_site_id=p_site_id)::text)
 ) into result
 from public.assignment_events
 where (from_site_id=p_site_id or to_site_id=p_site_id)
  and (p_from is null or created_at>=p_from)
  and (p_until is null or created_at<p_until);
 return result;
end; $$;
revoke all on function public.site_activity_summary(uuid,timestamptz,timestamptz)
 from public,anon,authenticated,service_role;
grant execute on function public.site_activity_summary(uuid,timestamptz,timestamptz) to authenticated;

revoke all on function private.inventory_expected_version(jsonb),
 private.prevent_archived_site_holdings(),private.require_assignment_link(),
 private.validate_affected_location_holdings(),private.asset_site_transition_guard()
 from public,anon,authenticated,service_role;
