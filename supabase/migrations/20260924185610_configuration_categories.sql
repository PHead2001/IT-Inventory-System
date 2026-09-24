-- Category lifecycle and shared print defaults. Existing category IDs and codes stay stable.
alter table public.app_members add column can_manage_configuration boolean not null default false;
alter table public.app_members add constraint configuration_requires_staff check (not can_manage_configuration or role='staff');

drop index public.categories_name_normalized;
alter table public.categories add column version bigint not null default 1 check (version>0);
alter table public.categories add column removed_at timestamptz;
alter table public.categories add constraint categories_removal_state check (removed_at is null or not active);
create unique index categories_active_name_normalized on public.categories
  (lower(regexp_replace(name,'[[:space:]]+',' ','g'))) where active and removed_at is null;

create function private.preserve_category_identity() returns trigger
language plpgsql set search_path='' as $$
begin
  if new.id is distinct from old.id or new.code is distinct from old.code then
    raise exception using errcode='23514',message='Category identity is immutable';
  end if;
  return new;
end;
$$;
create trigger category_identity before update on public.categories
for each row execute function private.preserve_category_identity();

create table public.label_defaults (
  singleton boolean primary key default true check(singleton),
  size text not null default '90x50' check(size in ('90x50','70x35')),
  page text not null default 'letter' check(page in ('letter','A4')),
  format text not null default 'qr' check(format in ('qr','code128')),
  version bigint not null default 1 check(version>0),
  updated_at timestamptz not null default now()
);
insert into public.label_defaults(singleton) values(true);

create table public.configuration_events (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid not null references public.app_members(user_id) on delete restrict,
  actor_name text not null,
  kind text not null check(kind in ('category_created','category_renamed','category_removed','label_defaults_updated')),
  category_id uuid,
  before_state jsonb,
  after_state jsonb,
  affected_quantity integer not null default 0 check(affected_quantity>=0),
  affected_assets integer not null default 0 check(affected_assets>=0),
  created_at timestamptz not null default now()
);
create index configuration_events_recent on public.configuration_events(created_at desc,id desc);
create trigger configuration_events_append_only before update or delete on public.configuration_events
for each row execute function private.inventory_append_only();

create table private.category_impact_reviews (
  token uuid primary key default gen_random_uuid(),
  actor_id uuid not null references public.app_members(user_id) on delete restrict,
  source_id uuid not null,
  target_id uuid,
  source_version bigint not null,
  target_version bigint,
  reference_set jsonb not null,
  created_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null default (clock_timestamp()+interval '15 minutes')
);
create index category_impact_reviews_actor on private.category_impact_reviews(actor_id,expires_at);

alter table public.label_defaults enable row level security;
alter table public.configuration_events enable row level security;
create policy label_defaults_member_read on public.label_defaults for select to authenticated
using (exists(select 1 from public.app_members m where m.user_id=(select auth.uid()) and m.active));
create policy configuration_events_member_read on public.configuration_events for select to authenticated
using (exists(select 1 from public.app_members m where m.user_id=(select auth.uid()) and m.active));
revoke all on public.label_defaults,public.configuration_events from public,anon,authenticated;
grant select on public.label_defaults,public.configuration_events to authenticated;
grant all on public.label_defaults,public.configuration_events to service_role;
revoke all on private.category_impact_reviews from public,anon,authenticated;
create view public.configuration_categories with (security_invoker=true) as
select id,code,name,active,sort_order,version::text as version,removed_at,created_at,updated_at
from public.categories;
create view public.configuration_label_defaults with (security_invoker=true) as
select size,page,format,version::text as version,updated_at from public.label_defaults where singleton;
revoke all on public.configuration_categories,public.configuration_label_defaults from public,anon,authenticated;
grant select on public.configuration_categories,public.configuration_label_defaults to authenticated;

-- A two-key advisory lock applies only to paths that can create or reassign
-- category references. Stock-only operations retain their existing row locks.
create function private.configuration_catalog_lock(exclusive boolean) returns void
language plpgsql set search_path='' as $$
begin
  if current_setting('transaction_isolation') <> 'read committed' then
    raise exception using errcode='P1016',message='unsupported_isolation';
  end if;
  perform set_config('lock_timeout','2s',true);
  if exclusive then perform pg_catalog.pg_advisory_xact_lock(91081,5);
  else perform pg_catalog.pg_advisory_xact_lock_shared(91081,5); end if;
end;
$$;

create function private.configuration_version(p jsonb,k text) returns bigint
language plpgsql set search_path='' as $$
declare raw text; result bigint;
begin
  if not(p ? k) or not coalesce(jsonb_typeof(p->k) in ('string','number'),false) then
    raise exception using errcode='P1012',message='invalid_input';
  end if;
  raw:=p->>k;
  if raw !~ '^[1-9][0-9]{0,18}$' then
    raise exception using errcode='P1012',message='invalid_input';
  end if;
  if jsonb_typeof(p->k)='number' and raw::numeric>9007199254740991 then
    raise exception using errcode='P1012',message='invalid_input';
  end if;
  result:=raw::bigint;
  return result;
exception when numeric_value_out_of_range then
  raise exception using errcode='P1012',message='invalid_input';
end;
$$;

create function private.category_reference_set(category uuid) returns jsonb
language sql volatile set search_path='' as $$
  select coalesce(jsonb_agg(jsonb_build_object('kind',kind,'id',id,'version',version::text)
    order by kind,id),'[]'::jsonb)
  from (
    select 'quantity'::text kind,id,version from public.quantity_items where category_id=category
    union all
    select 'asset'::text kind,id,version from public.serialized_assets where category_id=category
    order by kind,id limit 10001
  ) r;
$$;

create function public.category_create(p_request_id uuid,p_payload jsonb) returns jsonb
language plpgsql volatile security definer set search_path='' set statement_timeout='5s' as $$
declare actor uuid:=auth.uid(); actor_name text; normalized jsonb; replay jsonb;
  category_id uuid; category_name text; category_code text; sort_order integer; event_id uuid;
begin
  select display_name into actor_name from public.app_members
    where user_id=actor and active and role='staff' and can_manage_configuration for share;
  if not found then raise exception using errcode='P1001',message='forbidden'; end if;
  perform private.inventory_payload(p_payload,array['code','name','sort_order']);
  category_name:=regexp_replace(private.inventory_text(p_payload,'name',200,true),'[[:space:]]+',' ','g');
  category_code:=private.inventory_text(p_payload,'code',100,true);
  if category_code !~ '^[A-Z][A-Z0-9]*(-[A-Z0-9]+)*$' then
    raise exception using errcode='P1012',message='invalid_input'; end if;
  sort_order:=private.inventory_integer(p_payload,'sort_order',0,0);
  normalized:=jsonb_build_object('code',category_code,'name',category_name,'sort_order',sort_order);
  replay:=private.inventory_receipt(actor,p_request_id,'category_create',normalized);
  if replay is not null then return replay; end if;
  perform private.configuration_catalog_lock(true);
  insert into public.categories(code,name,sort_order) values(category_code,category_name,sort_order)
    returning id into category_id;
  insert into public.configuration_events(actor_id,actor_name,kind,category_id,after_state)
    values(actor,actor_name,'category_created',category_id,
      jsonb_build_object('code',category_code,'name',category_name,'version','1')) returning id into event_id;
  replay:=jsonb_build_object('entity_id',category_id,'category_id',category_id,'version','1','event_id',event_id,'changed',true);
  update private.mutation_requests set result=replay where actor_id=actor and request_id=p_request_id;
  return replay;
exception when unique_violation then raise exception using errcode='P1014',message='category_conflict';
end;
$$;

create function public.category_rename(p_request_id uuid,p_payload jsonb) returns jsonb
language plpgsql volatile security definer set search_path='' set statement_timeout='5s' as $$
declare actor uuid:=auth.uid(); actor_name text; normalized jsonb; replay jsonb;
  category_id uuid; expected bigint; category_name text; old_row public.categories%rowtype; event_id uuid;
begin
  select display_name into actor_name from public.app_members
    where user_id=actor and active and role='staff' and can_manage_configuration for share;
  if not found then raise exception using errcode='P1001',message='forbidden'; end if;
  perform private.inventory_payload(p_payload,array['category_id','expected_version','name']);
  category_id:=private.inventory_uuid(p_payload,'category_id');
  expected:=private.configuration_version(p_payload,'expected_version');
  category_name:=regexp_replace(private.inventory_text(p_payload,'name',200,true),'[[:space:]]+',' ','g');
  normalized:=jsonb_build_object('category_id',category_id,'expected_version',expected::text,'name',category_name);
  replay:=private.inventory_receipt(actor,p_request_id,'category_rename',normalized);
  if replay is not null then return replay; end if;
  perform private.configuration_catalog_lock(true);
  select * into old_row from public.categories where id=category_id for update;
  if not found or old_row.removed_at is not null or not old_row.active then
    raise exception using errcode='P1011',message='invalid_category'; end if;
  if old_row.version<>expected then raise exception using errcode='P1002',message='stale_version'; end if;
  if old_row.name=category_name then
    replay:=jsonb_build_object('entity_id',category_id,'category_id',category_id,'version',old_row.version::text,'event_id',null,'changed',false);
  else
    if old_row.version=9223372036854775807 then raise exception using errcode='P1008',message='invalid_transition'; end if;
    update public.categories set name=category_name,version=old_row.version+1 where id=category_id;
    insert into public.configuration_events(actor_id,actor_name,kind,category_id,before_state,after_state)
      values(actor,actor_name,'category_renamed',category_id,
        jsonb_build_object('name',old_row.name,'version',old_row.version::text),
        jsonb_build_object('name',category_name,'version',(old_row.version+1)::text)) returning id into event_id;
    replay:=jsonb_build_object('entity_id',category_id,'category_id',category_id,'version',(old_row.version+1)::text,'event_id',event_id,'changed',true);
  end if;
  update private.mutation_requests set result=replay where actor_id=actor and request_id=p_request_id;
  return replay;
exception when unique_violation then raise exception using errcode='P1014',message='category_conflict';
end;
$$;

create function public.category_removal_review(p_category_id uuid,p_replacement_id uuid default null) returns jsonb
language plpgsql volatile security definer set search_path='' set statement_timeout='5s' as $$
declare actor uuid:=auth.uid(); source_row public.categories%rowtype; target_row public.categories%rowtype;
  refs jsonb; token_id uuid; quantity_count integer; asset_count integer;
begin
  perform 1 from public.app_members where user_id=actor and active and role='staff'
    and can_manage_configuration for share;
  if not found then raise exception using errcode='P1001',message='forbidden'; end if;
  if p_category_id is null or p_category_id=p_replacement_id then
    raise exception using errcode='P1012',message='invalid_input'; end if;
  perform private.configuration_catalog_lock(false);
  select * into source_row from public.categories where id=p_category_id for share;
  if not found or not source_row.active or source_row.removed_at is not null then
    raise exception using errcode='P1011',message='invalid_category'; end if;
  if p_replacement_id is not null then
    select * into target_row from public.categories where id=p_replacement_id for share;
    if not found or not target_row.active or target_row.removed_at is not null then
      raise exception using errcode='P1011',message='invalid_category'; end if;
  end if;
  refs:=private.category_reference_set(p_category_id);
  if jsonb_array_length(refs)>10000 then raise exception using errcode='P1015',message='impact_too_large'; end if;
  select count(*) filter(where x->>'kind'='quantity'),count(*) filter(where x->>'kind'='asset')
    into quantity_count,asset_count from jsonb_array_elements(refs) x;
  insert into private.category_impact_reviews(actor_id,source_id,target_id,source_version,target_version,reference_set)
    values(actor,p_category_id,p_replacement_id,source_row.version,target_row.version,refs) returning token into token_id;
  return jsonb_build_object('token',token_id,'source_id',p_category_id,'source_name',source_row.name,
    'source_version',source_row.version::text,'target_id',p_replacement_id,
    'target_name',target_row.name,'target_version',target_row.version::text,
    'quantity_count',quantity_count::text,'asset_count',asset_count::text,'expires_at',clock_timestamp()+interval '15 minutes');
end;
$$;

create function public.category_remove(p_request_id uuid,p_payload jsonb) returns jsonb
language plpgsql volatile security definer set search_path='' set statement_timeout='5s' as $$
declare actor uuid:=auth.uid(); actor_name text; normalized jsonb; replay jsonb;
  source_id uuid; target_id uuid; review_token uuid; reviewed private.category_impact_reviews%rowtype;
  source_row public.categories%rowtype; target_row public.categories%rowtype;
  item public.quantity_items%rowtype; asset public.serialized_assets%rowtype;
  current_refs jsonb; q_count integer:=0; a_count integer:=0; historical boolean; event_id uuid;
begin
  select display_name into actor_name from public.app_members
    where user_id=actor and active and role='staff' and can_manage_configuration for share;
  if not found then raise exception using errcode='P1001',message='forbidden'; end if;
  perform private.inventory_payload(p_payload,array['category_id','replacement_id','review_token']);
  source_id:=private.inventory_uuid(p_payload,'category_id');
  target_id:=private.inventory_uuid(p_payload,'replacement_id',false);
  review_token:=private.inventory_uuid(p_payload,'review_token');
  if source_id=target_id then raise exception using errcode='P1012',message='invalid_input'; end if;
  normalized:=jsonb_build_object('category_id',source_id,'replacement_id',target_id,'review_token',review_token);
  replay:=private.inventory_receipt(actor,p_request_id,'category_remove',normalized);
  if replay is not null then return replay; end if;
  perform private.configuration_catalog_lock(true);
  -- Category locks precede inventory locks. The order is stable by UUID.
  if target_id is not null and target_id<source_id then
    select * into target_row from public.categories where id=target_id for update;
    select * into source_row from public.categories where id=source_id for update;
  else
    select * into source_row from public.categories where id=source_id for update;
    if target_id is not null then select * into target_row from public.categories where id=target_id for update; end if;
  end if;
  if source_row.id is null or not source_row.active or source_row.removed_at is not null then
    raise exception using errcode='P1011',message='invalid_category'; end if;
  if target_id is not null and (target_row.id is null or not target_row.active or target_row.removed_at is not null) then
    raise exception using errcode='P1011',message='invalid_category'; end if;
  select * into reviewed from private.category_impact_reviews where token=review_token and actor_id=actor for update;
  if not found or reviewed.expires_at<=clock_timestamp() or reviewed.source_id<>source_id
    or reviewed.target_id is distinct from target_id or reviewed.source_version<>source_row.version
    or reviewed.target_version is distinct from target_row.version then
    raise exception using errcode='P1017',message='stale_review'; end if;
  current_refs:=private.category_reference_set(source_id);
  if jsonb_array_length(current_refs)>10000 then raise exception using errcode='P1015',message='impact_too_large'; end if;
  -- Lock no more than the capped reference set, then verify it again.
  for item in select * from public.quantity_items where category_id=source_id order by id for update loop
    null;
  end loop;
  for asset in select * from public.serialized_assets where category_id=source_id order by id for update loop
    null;
  end loop;
  current_refs:=private.category_reference_set(source_id);
  if current_refs<>reviewed.reference_set then raise exception using errcode='P1017',message='stale_review'; end if;
  if jsonb_array_length(current_refs)>10000 then raise exception using errcode='P1015',message='impact_too_large'; end if;
  if jsonb_array_length(current_refs)>0 and target_id is null then
    raise exception using errcode='P1018',message='replacement_required'; end if;
  if target_id is not null then
    for item in select * from public.quantity_items where category_id=source_id order by id loop
      if item.version=2147483647 then raise exception using errcode='P1008',message='invalid_transition'; end if;
      event_id:=gen_random_uuid();
      update public.quantity_items set category_id=target_id,version=item.version+1,updated_at=now() where id=item.id;
      insert into public.quantity_events(id,item_id,kind,actor_id,actor_name,reason,before_metadata,after_metadata,version)
      values(event_id,item.id,'metadata_updated',actor,actor_name,'Category removed: '||source_row.name,
        jsonb_build_object('name',item.name,'description',item.description,'category_id',source_id,'category_name',source_row.name,'manufacturer',item.manufacturer,'model',item.model,'reorder_threshold',item.reorder_threshold),
        jsonb_build_object('name',item.name,'description',item.description,'category_id',target_id,'category_name',target_row.name,'manufacturer',item.manufacturer,'model',item.model,'reorder_threshold',item.reorder_threshold),item.version+1);
      q_count:=q_count+1;
    end loop;
    for asset in select * from public.serialized_assets where category_id=source_id order by id loop
      if asset.version=2147483647 then raise exception using errcode='P1008',message='invalid_transition'; end if;
      event_id:=gen_random_uuid();
      update public.serialized_assets set category_id=target_id,version=asset.version+1,updated_at=now() where id=asset.id;
      insert into public.asset_events(id,asset_id,kind,actor_id,actor_name,reason,from_location_id,to_location_id,before_metadata,after_metadata,version)
      values(event_id,asset.id,'metadata_updated',actor,actor_name,'Category removed: '||source_row.name,
        asset.location_id,asset.location_id,
        jsonb_build_object('name',asset.name,'description',asset.description,'category_id',source_id,'category_name',source_row.name,'manufacturer',asset.manufacturer,'model',asset.model,'asset_tag',asset.asset_tag,'serial_number',asset.serial_number),
        jsonb_build_object('name',asset.name,'description',asset.description,'category_id',target_id,'category_name',target_row.name,'manufacturer',asset.manufacturer,'model',asset.model,'asset_tag',asset.asset_tag,'serial_number',asset.serial_number),asset.version+1);
      a_count:=a_count+1;
    end loop;
  end if;
  select exists(
    select 1 from public.quantity_events e where e.before_metadata->>'category_id'=source_id::text or e.after_metadata->>'category_id'=source_id::text
    union all
    select 1 from public.asset_events e where e.before_metadata->>'category_id'=source_id::text or e.after_metadata->>'category_id'=source_id::text
  ) into historical;
  if historical or q_count+a_count>0 then
    if source_row.version=9223372036854775807 then raise exception using errcode='P1008',message='invalid_transition'; end if;
    update public.categories set active=false,removed_at=now(),version=source_row.version+1 where id=source_id;
  else
    delete from public.categories where id=source_id;
  end if;
  insert into public.configuration_events(actor_id,actor_name,kind,category_id,before_state,after_state,affected_quantity,affected_assets)
    values(actor,actor_name,'category_removed',source_id,
      jsonb_build_object('code',source_row.code,'name',source_row.name,'version',source_row.version::text),
      jsonb_build_object('replacement_id',target_id,'tombstoned',historical or q_count+a_count>0),q_count,a_count) returning id into event_id;
  replay:=jsonb_build_object('entity_id',source_id,'category_id',source_id,'version',case when historical or q_count+a_count>0 then (source_row.version+1)::text else null end,
    'event_id',event_id,'changed',true,'quantity_count',q_count::text,'asset_count',a_count::text);
  update private.mutation_requests set result=replay where actor_id=actor and request_id=p_request_id;
  return replay;
end;
$$;

create function public.label_defaults_update(p_request_id uuid,p_payload jsonb) returns jsonb
language plpgsql volatile security definer set search_path='' set statement_timeout='5s' as $$
declare actor uuid:=auth.uid(); actor_name text; normalized jsonb; replay jsonb; event_id uuid;
  expected bigint; selected_size text; selected_page text; selected_format text;
  old_row public.label_defaults%rowtype;
begin
  select display_name into actor_name from public.app_members
    where user_id=actor and active and role='staff' and can_manage_configuration for share;
  if not found then raise exception using errcode='P1001',message='forbidden'; end if;
  perform private.inventory_payload(p_payload,array['expected_version','size','page','format']);
  expected:=private.configuration_version(p_payload,'expected_version');
  selected_size:=private.inventory_text(p_payload,'size',20,true);
  selected_page:=private.inventory_text(p_payload,'page',20,true);
  selected_format:=private.inventory_text(p_payload,'format',20,true);
  if selected_size not in ('90x50','70x35') or selected_page not in ('letter','A4') or selected_format not in ('qr','code128') then
    raise exception using errcode='P1012',message='invalid_input'; end if;
  normalized:=jsonb_build_object('expected_version',expected::text,'size',selected_size,'page',selected_page,'format',selected_format);
  replay:=private.inventory_receipt(actor,p_request_id,'label_defaults_update',normalized);
  if replay is not null then return replay; end if;
  if current_setting('transaction_isolation')<>'read committed' then raise exception using errcode='P1016',message='unsupported_isolation'; end if;
  select * into old_row from public.label_defaults where singleton for update;
  if old_row.version<>expected then raise exception using errcode='P1002',message='stale_version'; end if;
  if old_row.size=selected_size and old_row.page=selected_page and old_row.format=selected_format then
    replay:=jsonb_build_object('version',old_row.version::text,'event_id',null,'changed',false);
  else
    if old_row.version=9223372036854775807 then raise exception using errcode='P1008',message='invalid_transition'; end if;
    update public.label_defaults set size=selected_size,page=selected_page,format=selected_format,
      version=old_row.version+1,updated_at=now() where singleton;
    insert into public.configuration_events(actor_id,actor_name,kind,before_state,after_state)
      values(actor,actor_name,'label_defaults_updated',
        jsonb_build_object('size',old_row.size,'page',old_row.page,'format',old_row.format,'version',old_row.version::text),
        normalized || jsonb_build_object('version',(old_row.version+1)::text)) returning id into event_id;
    replay:=jsonb_build_object('version',(old_row.version+1)::text,'event_id',event_id,'changed',true);
  end if;
  update private.mutation_requests set result=replay where actor_id=actor and request_id=p_request_id;
  return replay;
end;
$$;

revoke all on function private.preserve_category_identity(),private.configuration_catalog_lock(boolean),
  private.configuration_version(jsonb,text),private.category_reference_set(uuid)
  from public,anon,authenticated,service_role;
revoke all on function public.category_create(uuid,jsonb),public.category_rename(uuid,jsonb),
  public.category_removal_review(uuid,uuid),public.category_remove(uuid,jsonb),
  public.label_defaults_update(uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.category_create(uuid,jsonb),public.category_rename(uuid,jsonb),
  public.category_removal_review(uuid,uuid),public.category_remove(uuid,jsonb),
  public.label_defaults_update(uuid,jsonb) to authenticated;

-- Rebind only reference-changing inventory RPCs to the shared catalog lock.
create or replace function public.quantity_create(p_request_id uuid,p_payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
 v_actor uuid; v_actor_name text; v_payload jsonb; v_result jsonb;
 v_id uuid; v_version integer; v_event uuid:=gen_random_uuid();
 v_name text; v_description text; v_category uuid; v_category_name text; v_manufacturer text; v_model text; v_threshold integer;
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
 perform private.inventory_payload(p_payload,array['name','description','category_id','manufacturer','model','initial_location_id','initial_quantity','reorder_threshold']);

 v_name:=private.inventory_text(p_payload,'name',200,true);
 v_description:=private.inventory_text(p_payload,'description',4000);
 v_category:=private.inventory_uuid(p_payload,'category_id');
 v_manufacturer:=private.inventory_text(p_payload,'manufacturer',200);
 v_model:=private.inventory_text(p_payload,'model',200);
 if p_payload ? 'reorder_threshold' then v_threshold:=private.inventory_threshold(p_payload); end if;

 v_location:=private.inventory_uuid(p_payload,'initial_location_id',false);
 v_quantity:=private.inventory_integer(p_payload,'initial_quantity',0,0);
 if v_quantity>0 and v_location is null then raise exception using errcode='P1012',message='invalid_input'; end if;
 v_payload:=jsonb_build_object('name',v_name,'description',v_description,'category_id',v_category,'manufacturer',v_manufacturer,'model',v_model,'initial_location_id',v_location,'initial_quantity',v_quantity);

 if p_payload ? 'reorder_threshold' then v_payload:=v_payload || jsonb_build_object('reorder_threshold',v_threshold); end if;
 v_result:=private.inventory_receipt(v_actor,p_request_id,'quantity_create',v_payload);
 if v_result is not null then return v_result; end if;
 perform private.configuration_catalog_lock(false);

 perform private.inventory_category(v_category);
 select name into v_category_name from public.categories where id=v_category;
 if v_location is not null then perform private.inventory_destination(v_location); end if;
 insert into public.quantity_items(name,description,category_id,manufacturer,model,reorder_threshold)
 values(v_name,v_description,v_category,v_manufacturer,v_model,v_threshold) returning id,version into v_id,v_version;
 insert into public.quantity_events(id,item_id,kind,actor_id,actor_name,reason,before_metadata,after_metadata,version) values(v_event,v_id,'created',v_actor,v_actor_name,v_reason,null,jsonb_build_object('name',v_name,'description',v_description,'category_id',v_category,'category_name',v_category_name,'manufacturer',v_manufacturer,'model',v_model,'reorder_threshold',v_threshold),v_version);
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
 v_name text; v_description text; v_category uuid; v_previous_category uuid; v_category_name text; v_previous_category_name text; v_manufacturer text; v_model text; v_threshold integer;
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
 perform private.inventory_payload(p_payload,array['item_id','expected_version','name','description','category_id','manufacturer','model','reorder_threshold']);
 v_id:=private.inventory_uuid(p_payload,'item_id'); v_version:=private.inventory_integer(p_payload,'expected_version',1);
 v_name:=private.inventory_text(p_payload,'name',200,true);
 v_description:=private.inventory_text(p_payload,'description',4000);
 v_category:=private.inventory_uuid(p_payload,'category_id');
 v_manufacturer:=private.inventory_text(p_payload,'manufacturer',200);
 v_model:=private.inventory_text(p_payload,'model',200);
 if p_payload ? 'reorder_threshold' then v_threshold:=private.inventory_threshold(p_payload); end if;

 v_payload:=jsonb_build_object('item_id',v_id,'expected_version',v_version,'name',v_name,'description',v_description,'category_id',v_category,'manufacturer',v_manufacturer,'model',v_model);

 if p_payload ? 'reorder_threshold' then v_payload:=v_payload || jsonb_build_object('reorder_threshold',v_threshold); end if;
 v_result:=private.inventory_receipt(v_actor,p_request_id,'quantity_update',v_payload);
 if v_result is not null then return v_result; end if;
 perform private.configuration_catalog_lock(false);
 select category_id into v_previous_category from public.quantity_items where id=v_id;
 perform id from public.categories where id in (v_previous_category,v_category) order by id for share;
 select name into v_previous_category_name from public.categories where id=v_previous_category;
 select name into v_category_name from public.categories where id=v_category;
 select * into v_item from public.quantity_items where id=v_id for update;
 if not found then raise exception using errcode='P1010',message='not_found'; end if;
 if v_item.version<>v_version then raise exception using errcode='P1002',message='stale_version'; end if;
 if v_item.archived then raise exception using errcode='P1008',message='invalid_transition'; end if;
 if not(p_payload ? 'reorder_threshold') then v_threshold:=v_item.reorder_threshold; end if;
 perform private.inventory_category(v_category,v_item.category_id);
 update public.quantity_items set name=v_name,description=v_description,category_id=v_category,manufacturer=v_manufacturer,model=v_model,reorder_threshold=v_threshold where id=v_id;
 if v_item.version=2147483647 then raise exception using errcode='P1008',message='invalid_transition'; end if;
 v_version:=v_item.version+1; update public.quantity_items set version=v_version,updated_at=now() where id=v_id; insert into public.quantity_events(id,item_id,kind,actor_id,actor_name,reason,before_metadata,after_metadata,version) values(v_event,v_id,'metadata_updated',v_actor,v_actor_name,v_reason,jsonb_build_object('name',v_item.name,'description',v_item.description,'category_id',v_item.category_id,'category_name',v_previous_category_name,'manufacturer',v_item.manufacturer,'model',v_item.model,'reorder_threshold',v_item.reorder_threshold),jsonb_build_object('name',v_name,'description',v_description,'category_id',v_category,'category_name',v_category_name,'manufacturer',v_manufacturer,'model',v_model,'reorder_threshold',v_threshold),v_version);
 v_result:=jsonb_build_object('entity_id',v_id,'version',v_version,'event_id',v_event,'changed',true);

 update private.mutation_requests set result=v_result where actor_id=v_actor and request_id=p_request_id;
 return v_result;
exception when unique_violation then raise exception using errcode='P1007',message='identifier_conflict';
end;
$$;

create or replace function public.quantity_restore(p_request_id uuid,p_payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
 v_actor uuid; v_actor_name text; v_payload jsonb; v_result jsonb;
 v_id uuid; v_version integer; v_event uuid:=gen_random_uuid();
 v_name text; v_description text; v_category uuid; v_manufacturer text; v_model text;
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
 perform private.inventory_payload(p_payload,array['item_id','expected_version','reason']);
 v_id:=private.inventory_uuid(p_payload,'item_id'); v_version:=private.inventory_integer(p_payload,'expected_version',1);
 v_reason:=private.inventory_text(p_payload,'reason',2000,true);
 v_payload:=jsonb_build_object('item_id',v_id,'expected_version',v_version,'reason',v_reason);

 v_result:=private.inventory_receipt(v_actor,p_request_id,'quantity_restore',v_payload);
 if v_result is not null then return v_result; end if;
 perform private.configuration_catalog_lock(false);
 select category_id into v_category from public.quantity_items where id=v_id;
 perform id from public.categories where id=v_category for share;
 select * into v_item from public.quantity_items where id=v_id for update;
 if not found then raise exception using errcode='P1010',message='not_found'; end if;
 if v_item.version<>v_version then raise exception using errcode='P1002',message='stale_version'; end if;

 if v_item.archived=false then raise exception using errcode='P1008',message='invalid_transition'; end if;

 update public.quantity_items set archived=false where id=v_id;
 if v_item.version=2147483647 then raise exception using errcode='P1008',message='invalid_transition'; end if;
 v_version:=v_item.version+1; update public.quantity_items set version=v_version,updated_at=now() where id=v_id;
 insert into public.quantity_events(id,item_id,kind,actor_id,actor_name,reason,before_metadata,after_metadata,version) values(v_event,v_id,'restored',v_actor,v_actor_name,v_reason,jsonb_build_object('archived',v_item.archived),jsonb_build_object('archived',false),v_version);
 v_result:=jsonb_build_object('entity_id',v_id,'version',v_version,'event_id',v_event,'changed',true);

 update private.mutation_requests set result=v_result where actor_id=v_actor and request_id=p_request_id;
 return v_result;
exception when unique_violation then raise exception using errcode='P1007',message='identifier_conflict';
end;
$$;

create or replace function public.asset_create(p_request_id uuid,p_payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
 v_actor uuid; v_actor_name text; v_payload jsonb; v_result jsonb;
 v_id uuid; v_version integer; v_event uuid:=gen_random_uuid();
 v_name text; v_description text; v_category uuid; v_category_name text; v_manufacturer text; v_model text;
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
 perform private.inventory_payload(p_payload,array['name','description','category_id','manufacturer','model','asset_tag','serial_number','location_id']);

 v_name:=private.inventory_text(p_payload,'name',200,true);
 v_description:=private.inventory_text(p_payload,'description',4000);
 v_category:=private.inventory_uuid(p_payload,'category_id');
 v_manufacturer:=private.inventory_text(p_payload,'manufacturer',200);
 v_model:=private.inventory_text(p_payload,'model',200);

 v_tag:=lower(private.inventory_text(p_payload,'asset_tag',100));
 v_serial:=private.inventory_text(p_payload,'serial_number',200);

 v_location:=private.inventory_uuid(p_payload,'location_id');
 v_payload:=jsonb_build_object('name',v_name,'description',v_description,'category_id',v_category,'manufacturer',v_manufacturer,'model',v_model,'asset_tag',v_tag,'serial_number',v_serial,'location_id',v_location);

 v_result:=private.inventory_receipt(v_actor,p_request_id,'asset_create',v_payload);
 if v_result is not null then return v_result; end if;
 perform private.configuration_catalog_lock(false);

 perform private.inventory_category(v_category); perform private.inventory_destination(v_location);
 select name into v_category_name from public.categories where id=v_category;
 insert into public.serialized_assets(name,description,category_id,manufacturer,model,asset_tag,serial_number,location_id)
 values(v_name,v_description,v_category,v_manufacturer,v_model,v_tag,v_serial,v_location) returning id,version into v_id,v_version;
 insert into public.asset_events(id,asset_id,kind,actor_id,actor_name,reason,from_location_id,to_location_id,before_metadata,after_metadata,version) values(v_event,v_id,'created',v_actor,v_actor_name,v_reason,null,v_location,null,jsonb_build_object('name',v_name,'description',v_description,'category_id',v_category,'category_name',v_category_name,'manufacturer',v_manufacturer,'model',v_model,'asset_tag',v_tag,'serial_number',v_serial),v_version);
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
 select name into v_previous_category_name from public.categories where id=v_previous_category;
 select name into v_category_name from public.categories where id=v_category;
 select * into v_asset from public.serialized_assets where id=v_id for update;
 if not found then raise exception using errcode='P1010',message='not_found'; end if;
 if v_asset.version<>v_version then raise exception using errcode='P1002',message='stale_version'; end if;
 perform private.inventory_category(v_category,v_asset.category_id);
 update public.serialized_assets set name=v_name,description=v_description,category_id=v_category,manufacturer=v_manufacturer,model=v_model,asset_tag=v_tag,serial_number=v_serial where id=v_id;
 if v_asset.version=2147483647 then raise exception using errcode='P1008',message='invalid_transition'; end if;
 v_version:=v_asset.version+1; update public.serialized_assets set version=v_version,updated_at=now() where id=v_id; insert into public.asset_events(id,asset_id,kind,actor_id,actor_name,reason,from_location_id,to_location_id,before_metadata,after_metadata,version) values(v_event,v_id,'metadata_updated',v_actor,v_actor_name,v_reason,null,null,jsonb_build_object('name',v_asset.name,'description',v_asset.description,'category_id',v_asset.category_id,'category_name',v_previous_category_name,'manufacturer',v_asset.manufacturer,'model',v_asset.model,'asset_tag',v_asset.asset_tag,'serial_number',v_asset.serial_number),jsonb_build_object('name',v_name,'description',v_description,'category_id',v_category,'category_name',v_category_name,'manufacturer',v_manufacturer,'model',v_model,'asset_tag',v_tag,'serial_number',v_serial),v_version);
 v_result:=jsonb_build_object('entity_id',v_id,'version',v_version,'event_id',v_event,'changed',true);

 update private.mutation_requests set result=v_result where actor_id=v_actor and request_id=p_request_id;
 return v_result;
exception when unique_violation then raise exception using errcode='P1007',message='identifier_conflict';
end;
$$;

create or replace function public.asset_restore(p_request_id uuid,p_payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
 v_actor uuid; v_actor_name text; v_payload jsonb; v_result jsonb;
 v_id uuid; v_version integer; v_event uuid:=gen_random_uuid();
 v_name text; v_description text; v_category uuid; v_manufacturer text; v_model text;
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
 perform private.inventory_payload(p_payload,array['asset_id','expected_version','location_id','reason']);
 v_id:=private.inventory_uuid(p_payload,'asset_id'); v_version:=private.inventory_integer(p_payload,'expected_version',1);
 v_location:=private.inventory_uuid(p_payload,'location_id'); v_reason:=private.inventory_text(p_payload,'reason',2000,true);
 v_payload:=jsonb_build_object('asset_id',v_id,'expected_version',v_version,'location_id',v_location,'reason',v_reason);

 v_result:=private.inventory_receipt(v_actor,p_request_id,'asset_restore',v_payload);
 if v_result is not null then return v_result; end if;
 perform private.configuration_catalog_lock(false);
 select category_id into v_category from public.serialized_assets where id=v_id;
 perform id from public.categories where id=v_category for share;
 select * into v_asset from public.serialized_assets where id=v_id for update;
 if not found then raise exception using errcode='P1010',message='not_found'; end if;
 if v_asset.version<>v_version then raise exception using errcode='P1002',message='stale_version'; end if;

 if v_asset.status<>'retired' then raise exception using errcode='P1008',message='invalid_transition'; end if;
 perform private.inventory_destination(v_location);
 update public.serialized_assets set status='active',location_id=v_location where id=v_id;
 if v_asset.version=2147483647 then raise exception using errcode='P1008',message='invalid_transition'; end if;
 v_version:=v_asset.version+1; update public.serialized_assets set version=v_version,updated_at=now() where id=v_id; insert into public.asset_events(id,asset_id,kind,actor_id,actor_name,reason,from_location_id,to_location_id,before_metadata,after_metadata,version) values(v_event,v_id,'restored',v_actor,v_actor_name,v_reason,v_asset.location_id,v_location,jsonb_build_object('status','retired'),jsonb_build_object('status','active'),v_version);
 v_result:=jsonb_build_object('entity_id',v_id,'version',v_version,'event_id',v_event,'changed',true);

 update private.mutation_requests set result=v_result where actor_id=v_actor and request_id=p_request_id;
 return v_result;
exception when unique_violation then raise exception using errcode='P1007',message='identifier_conflict';
end;
$$;

