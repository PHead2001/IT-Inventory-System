-- Private inventory documents and photos. Paths and object generations never appear
-- in application-facing relations. All metadata changes go through RPCs.
insert into storage.buckets (id,name,public,file_size_limit,allowed_mime_types)
values ('inventory-files','inventory-files',false,20971520,
 array['image/jpeg','image/png','image/webp','application/pdf'])
on conflict (id) do update set public=false,file_size_limit=excluded.file_size_limit,
 allowed_mime_types=excluded.allowed_mime_types;

create table private.file_guard (id boolean primary key default true check(id), touched_at timestamptz not null default now());
insert into private.file_guard(id) values(true);
create table private.file_keys (
 key_id text primary key check(key_id ~ '^[a-z0-9]{4,32}$'),
 secret text not null check(length(secret)>=32),
 accepts_new boolean not null default false,
 verify_until timestamptz not null,
 created_at timestamptz not null default now()
);
create unique index file_one_active_key on private.file_keys((accepts_new)) where accepts_new;
create table public.inventory_file_collections (
 id uuid primary key default gen_random_uuid(),
 asset_id uuid unique references public.serialized_assets(id) on delete restrict,
 quantity_id uuid unique references public.quantity_items(id) on delete restrict,
 revision bigint not null default 1 check(revision>0),
 created_at timestamptz not null default now(),
 check ((asset_id is null) <> (quantity_id is null))
);
create table public.inventory_files (
 id uuid primary key default gen_random_uuid(),
 asset_id uuid references public.serialized_assets(id) on delete restrict,
 quantity_id uuid references public.quantity_items(id) on delete restrict,
 uploader_id uuid not null references public.app_members(user_id) on delete restrict,
 original_name text not null check(length(original_name) between 1 and 200),
 display_title text not null check(length(display_title) between 1 and 200),
 declared_type text not null check(declared_type in ('image/jpeg','image/png','image/webp','application/pdf')),
 declared_bytes bigint not null check(declared_bytes between 1 and 20971520),
 sha256 text check(sha256 ~ '^[a-f0-9]{64}$'),
 purpose text not null check(purpose in ('asset_photo','asset_document','recognition_photo')),
 version bigint not null default 1 check(version>=1),
 state text not null default 'reserved' check(state in ('reserved','uploaded','validating','validated','ready','removed','rejected','cancelled','expired')),
 reviewed_collection_revision bigint not null check(reviewed_collection_revision>=1),
 replaces_file_id uuid references public.inventory_files(id) on delete restrict,
 reviewed_replaced_file_version bigint,
 source_path text not null unique,
 reserve_expires_at timestamptz not null,
 validation_generation integer not null default 0,
 validation_request_id uuid,
 validation_lease_until timestamptz,
 validation_key_id text references private.file_keys(key_id),
 attestation text,
 validated_type text,
 validated_bytes bigint,
 created_at timestamptz not null default now(),
 ready_at timestamptz,
 removed_at timestamptz,
 check ((asset_id is null) <> (quantity_id is null)),
 check ((replaces_file_id is null) = (reviewed_replaced_file_version is null)),
 check ((purpose='recognition_photo')=(quantity_id is not null)),
 check (purpose<>'asset_document' or declared_type='application/pdf'),
 check (purpose='asset_document' or declared_type<>'application/pdf')
);
create table public.inventory_file_events (
 id uuid primary key default gen_random_uuid(),
 collection_id uuid not null references public.inventory_file_collections(id) on delete restrict,
 asset_id uuid references public.serialized_assets(id) on delete restrict,
 quantity_id uuid references public.quantity_items(id) on delete restrict,
 file_id uuid not null references public.inventory_files(id) on delete restrict,
 replaces_file_id uuid references public.inventory_files(id) on delete restrict,
 actor_id uuid not null references public.app_members(user_id) on delete restrict,
 actor_name text not null,
 action text not null check(action in ('added','replaced','renamed','removed')),
 before_title text,
 title text not null,
 file_type text not null,
 file_bytes bigint not null,
 collection_revision bigint not null check(collection_revision>1),
 created_at timestamptz not null default now(),
 check ((asset_id is null) <> (quantity_id is null))
);
create trigger inventory_file_events_append_only before update or delete on public.inventory_file_events
 for each row execute function private.inventory_append_only();
create function private.inventory_file_event_identity() returns trigger
language plpgsql security definer set search_path='' as $$
declare c public.inventory_file_collections%rowtype; f public.inventory_files%rowtype;
begin
 select * into c from public.inventory_file_collections where id=new.collection_id;
 select * into f from public.inventory_files where id=new.file_id;
 if not found or c.id is null or c.asset_id is distinct from new.asset_id or
   c.quantity_id is distinct from new.quantity_id or
   f.asset_id is distinct from new.asset_id or f.quantity_id is distinct from new.quantity_id or
   (new.replaces_file_id is not null and not exists(
     select 1 from public.inventory_files old where old.id=new.replaces_file_id
       and old.asset_id is not distinct from new.asset_id
       and old.quantity_id is not distinct from new.quantity_id)) then
  raise exception using errcode='P1012',message='invalid_file_event_identity'; end if;
 return new;
end $$;
create trigger inventory_file_event_identity before insert on public.inventory_file_events
 for each row execute function private.inventory_file_event_identity();
create index inventory_file_events_asset_history on public.inventory_file_events(asset_id,created_at desc,id desc)
 where asset_id is not null;
create index inventory_file_events_quantity_history on public.inventory_file_events(quantity_id,created_at desc,id desc)
 where quantity_id is not null;
create unique index inventory_primary_photo on public.inventory_files(quantity_id)
 where purpose='recognition_photo' and state='ready';
create index inventory_files_asset on public.inventory_files(asset_id,state);
create index inventory_files_quantity on public.inventory_files(quantity_id,state);
create index inventory_files_uploader on public.inventory_files(uploader_id,state);
create table private.file_objects (
 id uuid primary key default gen_random_uuid(),
 file_id uuid not null references public.inventory_files(id) on delete restrict,
 variant text not null check(variant in ('source','display','thumbnail')),
 generation integer not null default 0 check(generation>=0),
 path text not null unique,
 object_id uuid,
 object_version text,
 bytes bigint check(bytes between 1 and 20971520),
 sha256 text check(sha256 ~ '^[a-f0-9]{64}$'),
 cleanup_state text not null default 'held' check(cleanup_state in ('held','eligible','claimed','deleted')),
 cleanup_actor uuid references public.app_members(user_id),
 cleanup_lease_until timestamptz,
 created_at timestamptz not null default now(),
 deleted_at timestamptz,
 unique(file_id,variant,generation)
);
create table private.file_receipts (
 actor_id uuid not null references public.app_members(user_id),
 request_id uuid not null,
 operation text not null,
 business jsonb not null,
 result jsonb,
 created_at timestamptz not null default now(),
 primary key(actor_id,request_id)
);
create index file_objects_cleanup on private.file_objects(cleanup_state,cleanup_lease_until);
alter table public.inventory_files enable row level security;
alter table public.inventory_file_collections enable row level security;
alter table public.inventory_file_events enable row level security;
revoke all on public.inventory_files from public,anon,authenticated,service_role;
revoke all on public.inventory_file_collections,public.inventory_file_events from public,anon,authenticated,service_role;
grant select on public.inventory_files to service_role;
grant select on public.inventory_file_collections,public.inventory_file_events to service_role;
revoke all on private.file_guard,private.file_keys,private.file_objects,private.file_receipts from public,anon,authenticated,service_role;

create function private.file_staff() returns uuid language plpgsql security definer set search_path='' as $$
declare a uuid:=auth.uid();
begin
 perform 1 from public.app_members where user_id=a and active and role='staff' for share;
 if a is null or not found then
  raise exception using errcode='P1001',message='forbidden';
 end if;
 return a;
end $$;
create function private.file_collection_lock(p_asset uuid,p_quantity uuid)
returns public.inventory_file_collections language plpgsql security definer set search_path='' as $$
declare c public.inventory_file_collections%rowtype;
begin
 if (p_asset is null) = (p_quantity is null) then
  raise exception using errcode='P1012',message='invalid_parent'; end if;
 if p_asset is not null then
  insert into public.inventory_file_collections(asset_id) values(p_asset)
   on conflict(asset_id) do nothing;
  select * into c from public.inventory_file_collections where asset_id=p_asset for update;
 else
  insert into public.inventory_file_collections(quantity_id) values(p_quantity)
   on conflict(quantity_id) do nothing;
  select * into c from public.inventory_file_collections where quantity_id=p_quantity for update;
 end if;
 return c;
end $$;
create function private.file_guard_lock() returns void
language plpgsql set search_path='' as $$
begin
 if current_setting('transaction_isolation') <> 'read committed' then
  raise exception using errcode='P1016',message='unsupported_isolation';
 end if;
 perform set_config('lock_timeout','2s',true);
 perform 1 from private.file_guard where id for update;
end $$;
create function private.file_member() returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.app_members where user_id=auth.uid() and active)
$$;
create function private.file_mac(p_text text,p_key text) returns text language sql immutable set search_path='' as $$
 select encode(extensions.hmac(convert_to(p_text,'utf8'),convert_to(p_key,'utf8'),'sha256'),'hex')
$$;
create function private.file_signature_valid(p_key_id text,p_text text,p_signature text,p_new boolean default false)
returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from private.file_keys k where k.key_id=p_key_id
  and k.verify_until>now() and (not p_new or k.accepts_new)
  and private.file_mac(p_text,k.secret)=p_signature)
$$;
create function private.file_server_proof(p_key_id text,p_actor uuid,p_operation text,p_args text,
 p_nonce text,p_expires bigint,p_mac text) returns boolean
language sql stable security definer set search_path='' as $$
 select p_nonce ~ '^[a-f0-9]{32}$' and p_expires is not null
  and to_timestamp(p_expires)>now() and to_timestamp(p_expires)<=now()+interval '60 seconds'
  and private.file_signature_valid(p_key_id,
   p_actor::text||':'||p_operation||':'||p_args||':'||p_nonce||':'||p_expires,p_mac,true)
$$;
create function public.inventory_file_active_key() returns text
language plpgsql security definer set search_path='' as $$
begin
 perform private.file_staff();
 return (select key_id from private.file_keys where accepts_new and verify_until>now() limit 1);
end $$;
create function private.file_attestation_message(f public.inventory_files,p_source_id uuid,
 p_source_version text,p_type text,p_bytes bigint,p_sha text) returns text
language sql stable security definer set search_path='' as $$
 select 'v2:'||f.uploader_id::text||':'||f.id::text||':'||f.validation_generation||':'||
  (case when f.asset_id is null then 'quantity' else 'asset' end)||':'||
  coalesce(f.asset_id,f.quantity_id)::text||':'||f.reviewed_collection_revision||':'||
  f.validation_request_id::text||':'||extract(epoch from f.validation_lease_until)::bigint||':'||
  f.validation_key_id||':'||f.purpose||':'||coalesce(f.replaces_file_id::text,'-')||':'||
  coalesce(f.reviewed_replaced_file_version::text,'-')||':'||
  p_source_id::text||':'||p_source_version||':'||p_type||':'||p_bytes||':'||p_sha||':'||
  coalesce((select string_agg(o.variant||':'||o.object_id::text||':'||o.object_version||':'||
   o.bytes||':'||o.sha256,'|' order by o.variant) from private.file_objects o
   where o.file_id=f.id and o.generation=f.validation_generation
    and o.variant in ('display','thumbnail') and o.cleanup_state='held'),'');
$$;

-- Storage's INSERT policy rechecks the locked live reservation/lease. A
-- SELECT-only snapshot of the row would allow upload racing validation.
create function private.file_storage_insert(p_bucket text,p_path text) returns boolean
language plpgsql volatile security definer set search_path='' as $$
declare f public.inventory_files%rowtype; o private.file_objects%rowtype;
 parts text[]; generation integer; expires bigint; file_uuid uuid; signed text;
begin
 if p_bucket<>'inventory-files' or auth.uid() is null or not exists
  (select 1 from public.app_members where user_id=auth.uid() and active and role='staff') then return false; end if;
 select * into o from private.file_objects where path=p_path;
 if not found then return false; end if;
 select * into f from public.inventory_files where id=o.file_id;
 if not found then return false; end if;
 perform private.file_guard_lock();
 perform private.file_collection_lock(f.asset_id,f.quantity_id);
 select * into f from public.inventory_files where id=o.file_id for update;
 select * into o from private.file_objects where path=p_path for update;
 if o.cleanup_state<>'held' or o.object_id is not null or f.uploader_id<>auth.uid() then return false; end if;
 if o.variant='source' then
  return f.state='reserved' and f.reserve_expires_at>now();
 end if;
 parts:=string_to_array(p_path,'/');
 if array_length(parts,1)<>8 or parts[1]<>'d' or parts[5] not in ('display','thumbnail')
    or parts[6] !~ '^[a-f0-9]{32}$' or parts[7] !~ '^[0-9]+$'
    or parts[8] !~ '^[a-f0-9]{64}$' then return false; end if;
 begin
  generation:=parts[4]::integer; expires:=parts[7]::bigint; file_uuid:=parts[3]::uuid;
 exception when invalid_text_representation or numeric_value_out_of_range then return false; end;
 if f.id is distinct from file_uuid or o.generation<>generation or o.variant<>parts[5]
  or f.state<>'validating'
  or f.validation_generation<>generation or f.validation_key_id<>parts[2]
  or f.validation_lease_until<=now() or to_timestamp(expires)<=now()
  or to_timestamp(expires)>f.validation_lease_until then return false; end if;
 signed:=f.uploader_id::text||':'||f.id::text||':'||generation||':'||parts[5]||':'||parts[6]||':'||expires;
 return private.file_signature_valid(parts[2],signed,parts[8],true);
end $$;
create function private.file_storage_select(p_bucket text,p_path text) returns boolean
language plpgsql volatile security definer set search_path='' as $$
declare o private.file_objects%rowtype; f public.inventory_files%rowtype;
begin
 if p_bucket<>'inventory-files' or auth.uid() is null then return false; end if;
 select * into o from private.file_objects where path=p_path;
 if not found or o.cleanup_state='deleted' then return false; end if;
 select * into f from public.inventory_files where id=o.file_id;
 if f.state='ready' and (o.variant<>'source' or f.purpose='asset_document') and o.cleanup_state='held' then
  return private.file_member();
 end if;
 return o.variant='source' and f.uploader_id=auth.uid() and
  f.state in ('reserved','uploaded','validating','validated') and
  exists(select 1 from public.app_members where user_id=auth.uid() and active and role='staff');
end $$;
create function private.file_storage_delete(p_bucket text,p_path text) returns boolean
language plpgsql volatile security definer set search_path='' as $$
declare o private.file_objects%rowtype; f public.inventory_files%rowtype;
begin
 if p_bucket<>'inventory-files' then return false; end if;
 select * into o from private.file_objects where path=p_path;
 if not found then return false; end if;
 select * into f from public.inventory_files where id=o.file_id;
 if not found then return false; end if;
 perform private.file_guard_lock();
 perform private.file_collection_lock(f.asset_id,f.quantity_id);
 select * into f from public.inventory_files where id=o.file_id for update;
 select * into o from private.file_objects where path=p_path for update;
 return found and o.cleanup_state='claimed' and o.cleanup_actor=auth.uid()
  and o.cleanup_lease_until>now() and private.file_staff()=auth.uid()
  and (f.state in ('removed','rejected','cancelled','expired') or
   f.state='ready' and o.variant='source' and f.purpose<>'asset_document' or
   f.state='ready' and o.variant<>'source' and o.generation<>f.validation_generation
    and f.validation_lease_until+interval '30 seconds'<now() or
   f.state in ('validating','validated') and o.variant<>'source' and
    f.validation_lease_until+interval '30 seconds'<now())
  and not (f.state='ready' and (o.variant='source' and f.purpose='asset_document' or
   o.variant<>'source' and o.generation=f.validation_generation));
end $$;
create policy inventory_file_insert on storage.objects for insert to authenticated
 with check (private.file_storage_insert(bucket_id,name));
create policy inventory_file_select on storage.objects for select to authenticated
 using (private.file_storage_select(bucket_id,name) and
 storage.allow_any_operation(array['object.get_authenticated','object.get_authenticated_info','object.head_authenticated_info']));
create policy inventory_file_cleanup_select on storage.objects for select to authenticated
 using (private.file_storage_delete(bucket_id,name) and
 storage.allow_any_operation(array['object.delete','object.delete_many']));
create policy inventory_file_delete on storage.objects for delete to authenticated
 using (private.file_storage_delete(bucket_id,name));

-- These public functions are the complete client-facing metadata projection.
create function public.inventory_file_cards(p_parent_type text,p_parent_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare collection_revision bigint;
begin
 if not private.file_member() then raise exception using errcode='P1001',message='forbidden'; end if;
 if p_parent_type is null or p_parent_id is null or p_parent_type not in ('asset','quantity') then
  raise exception using errcode='P1012',message='invalid_input'; end if;
 if not exists(select 1 from public.serialized_assets where id=p_parent_id and p_parent_type='asset')
   and not exists(select 1 from public.quantity_items where id=p_parent_id and p_parent_type='quantity') then
  raise exception using errcode='P1010',message='not_found'; end if;
 select c.revision into collection_revision from public.inventory_file_collections c
  where (p_parent_type='asset' and c.asset_id=p_parent_id or
    p_parent_type='quantity' and c.quantity_id=p_parent_id);
 return jsonb_build_object('revision',coalesce(collection_revision,1)::text,'files',
  coalesce((select jsonb_agg(jsonb_build_object('id',f.id,'name',f.display_title,
  'filename',f.original_name,'uploader',m.display_name,'ready_at',f.ready_at,
  'type',coalesce(f.validated_type,f.declared_type),'bytes',coalesce(f.validated_bytes,f.declared_bytes),
  'purpose',f.purpose,'state',f.state,'created_at',f.created_at,'version',f.version::text,
  'replaces_file_id',f.replaces_file_id,'reviewed_replaced_file_version',f.reviewed_replaced_file_version::text)
  order by f.created_at desc,f.id desc) from public.inventory_files f
  join public.app_members m on m.user_id=f.uploader_id
  where (p_parent_type='asset' and f.asset_id=p_parent_id or p_parent_type='quantity' and f.quantity_id=p_parent_id)
  and (f.state='ready' or f.uploader_id=auth.uid() and f.state in ('reserved','uploaded','validating','validated'))),'[]'::jsonb));
end $$;
create function public.inventory_file_history(p_parent_type text,p_parent_id uuid,p_page integer default 1)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare page_number integer;
begin
 if not private.file_member() then raise exception using errcode='P1001',message='forbidden'; end if;
 if p_parent_type is null or p_parent_type not in ('asset','quantity') or
   p_parent_id is null or p_page is null or p_page not between 1 and 100000 then
  raise exception using errcode='P1012',message='invalid_input'; end if;
 page_number:=p_page;
 return jsonb_build_object('rows',coalesce((select jsonb_agg(to_jsonb(events) order by events.created_at desc,events.id desc)
   from (select e.id,e.action,e.actor_name,e.created_at,e.before_title,e.title,e.file_type,
       e.file_bytes,e.collection_revision::text,e.file_id,e.replaces_file_id
     from public.inventory_file_events e
     where (p_parent_type='asset' and e.asset_id=p_parent_id or
       p_parent_type='quantity' and e.quantity_id=p_parent_id)
     order by e.created_at desc,e.id desc limit 25 offset (page_number-1)*25) events),'[]'::jsonb),
  'page',page_number,'has_more',exists(select 1 from public.inventory_file_events e
    where (p_parent_type='asset' and e.asset_id=p_parent_id or
      p_parent_type='quantity' and e.quantity_id=p_parent_id)
    offset page_number*25 limit 1));
end $$;
-- One bounded projection for the current inventory page. Only ready photo
-- thumbnail paths are returned, after membership authorization.
create function public.inventory_file_list_thumbnails(p_asset_ids uuid[],p_quantity_ids uuid[]) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
 if not private.file_member() then raise exception using errcode='P1001',message='forbidden'; end if;
 if p_asset_ids is null or p_quantity_ids is null or
  cardinality(p_asset_ids)+cardinality(p_quantity_ids)>25 then
  raise exception using errcode='P1012',message='invalid_input'; end if;
 return coalesce((
  select jsonb_agg(jsonb_build_object('kind',request.kind,'id',request.id,
   'thumbnail_path',photo.path,'photo_name',photo.name,
   'photo_count',counts.photos,'document_count',counts.documents)
   order by request.kind,request.id)
  from (select distinct 'asset'::text as kind,input.id from unnest(p_asset_ids) as input(id)
   union all select distinct 'quantity'::text as kind,input.id from unnest(p_quantity_ids) as input(id)) request
  cross join lateral (
   select count(*) filter(where f.purpose<>'asset_document')::integer as photos,
    count(*) filter(where f.purpose='asset_document')::integer as documents
   from public.inventory_files f
   where f.state='ready' and
    (request.kind='asset' and f.asset_id=request.id or
     request.kind='quantity' and f.quantity_id=request.id)
  ) counts
  left join lateral (
   select o.path,f.display_title as name from public.inventory_files f
   join private.file_objects o on o.file_id=f.id and o.variant='thumbnail'
    and o.generation=f.validation_generation and o.cleanup_state='held'
   where f.state='ready' and f.purpose<>'asset_document' and
    (request.kind='asset' and f.asset_id=request.id or
     request.kind='quantity' and f.quantity_id=request.id)
   order by f.ready_at desc,f.id desc limit 1
  ) photo on true
 ),'[]'::jsonb);
end $$;
create function public.inventory_file_read(p_file_id uuid,p_variant text) returns text
language plpgsql security definer set search_path='' as $$
declare f public.inventory_files%rowtype; o private.file_objects%rowtype;
begin
 if not private.file_member() then raise exception using errcode='P1001',message='forbidden'; end if;
 select * into f from public.inventory_files where id=p_file_id;
 if not found or f.state<>'ready' then raise exception using errcode='P1010',message='not_found'; end if;
 if p_variant is null or p_variant not in ('source','display','thumbnail') then raise exception using errcode='P1012',message='invalid_input'; end if;
 if (f.purpose='asset_document' and p_variant<>'source') or
    (f.purpose<>'asset_document' and p_variant='source') then
  raise exception using errcode='P1012',message='invalid_input'; end if;
 select * into o from private.file_objects where file_id=p_file_id and variant=p_variant
  and generation=(case when p_variant='source' then 0 else f.validation_generation end)
  and cleanup_state='held';
 if not found then raise exception using errcode='P1010',message='not_found'; end if;
 return o.path;
end $$;
create function public.inventory_file_source_details(p_file_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare f public.inventory_files%rowtype;
begin
 perform private.file_staff();
 select * into f from public.inventory_files where id=p_file_id;
 if not found or f.uploader_id<>auth.uid() or f.state<>'validating' or f.validation_lease_until<=now() then
  raise exception using errcode='P1010',message='not_found'; end if;
 return jsonb_build_object('type',f.declared_type,'bytes',f.declared_bytes,
  'parent_type',case when f.asset_id is null then 'quantity' else 'asset' end,
  'parent_id',coalesce(f.asset_id,f.quantity_id),'reviewed_revision',f.reviewed_collection_revision::text,
  'purpose',f.purpose,'replaces',f.replaces_file_id,
  'replaced_file_version',f.reviewed_replaced_file_version::text);
end $$;
create function public.inventory_file_reserve(p_parent_type text,p_parent_id uuid,p_expected_revision bigint,
 p_name text,p_type text,p_bytes bigint,p_replaces uuid default null,
 p_expected_file_version bigint default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare a uuid; f public.inventory_files%rowtype; collection public.inventory_file_collections%rowtype;
 pending_count integer; ready_count integer; new_file_id uuid:=gen_random_uuid(); path text;
begin
 a:=private.file_staff();
 if p_parent_type is null or p_parent_id is null or p_type is null or
  p_parent_type not in ('asset','quantity') or p_name is null or length(btrim(p_name)) not between 1 and 200
  or p_name<>btrim(p_name) or p_name ~ '[[:cntrl:]/\\]'
  or p_type not in ('image/jpeg','image/png','image/webp','application/pdf')
  or p_bytes is null or p_bytes not between 1 and 20971520
  or p_expected_revision is null or p_expected_revision<1 or
  ((p_replaces is null) <> (p_expected_file_version is null)) or
  (p_expected_file_version is not null and p_expected_file_version<1) then
  raise exception using errcode='P1012',message='invalid_input'; end if;
 perform private.file_guard_lock();
 if p_parent_type='asset' then
  perform 1 from public.serialized_assets where id=p_parent_id;
 else
  perform 1 from public.quantity_items where id=p_parent_id;
 end if;
 if not found then raise exception using errcode='P1010',message='not_found'; end if;
 collection:=private.file_collection_lock(
  case when p_parent_type='asset' then p_parent_id end,
  case when p_parent_type='quantity' then p_parent_id end);
 if collection.revision<>p_expected_revision then
  raise exception using errcode='P1002',message='stale_collection_revision'; end if;
 if p_parent_type='quantity' and p_type='application/pdf' then raise exception using errcode='P1012',message='invalid_input'; end if;
 if p_replaces is not null then
  select * into f from public.inventory_files where id=p_replaces and state='ready' for update;
  if not found or (p_parent_type='asset' and f.asset_id is distinct from p_parent_id) or
   (p_parent_type='quantity' and f.quantity_id is distinct from p_parent_id) then
    raise exception using errcode='P1010',message='not_found'; end if;
  if f.version<>p_expected_file_version then
   raise exception using errcode='P1002',message='stale_file_version'; end if;
 end if;
 select count(*) into pending_count from public.inventory_files where uploader_id=a and state in ('reserved','uploaded','validating','validated');
 if pending_count>=3 then raise exception using errcode='P1012',message='pending_quota'; end if;
 if p_parent_type='asset' then
  select count(*) into ready_count from public.inventory_files where asset_id=p_parent_id and state='ready';
  if ready_count>=20 and p_replaces is null then raise exception using errcode='P1012',message='asset_file_quota'; end if;
 else
  select count(*) into ready_count from public.inventory_files where quantity_id=p_parent_id and state='ready';
  if ready_count>=1 and p_replaces is null then raise exception using errcode='P1012',message='recognition_photo_exists'; end if;
 end if;
 if (select coalesce(sum(case when purpose='asset_document' then 20971520 else 62914560 end),0)
     from public.inventory_files where state in ('reserved','uploaded','validating','validated')) +
    (select coalesce(sum(o.bytes),0) from private.file_objects o
     where o.cleanup_state in ('eligible','claimed')) +
    (case when p_type='application/pdf' then 20971520 else 62914560 end)>134217728 then
  raise exception using errcode='P1012',message='staging_quota'; end if;
 if (select coalesce(sum(o.bytes),0) from private.file_objects o join public.inventory_files quota_file on quota_file.id=o.file_id
      where o.cleanup_state<>'deleted' and quota_file.state in ('ready','removed')) +
    (case when p_type='application/pdf' then 20971520 else 62914560 end)>805306368 then
  raise exception using errcode='P1012',message='ready_quota'; end if;
 path:='s/'||new_file_id||'/'||encode(extensions.gen_random_bytes(16),'hex');
 insert into public.inventory_files(id,asset_id,quantity_id,uploader_id,original_name,display_title,declared_type,declared_bytes,
  purpose,reviewed_collection_revision,replaces_file_id,reviewed_replaced_file_version,source_path,reserve_expires_at)
 values(new_file_id,case when p_parent_type='asset' then p_parent_id end,
  case when p_parent_type='quantity' then p_parent_id end,a,p_name,p_name,p_type,p_bytes,
  case when p_parent_type='quantity' then 'recognition_photo' when p_type='application/pdf' then 'asset_document' else 'asset_photo' end,
  p_expected_revision,p_replaces,p_expected_file_version,path,now()+interval '15 minutes');
 -- Declared length is untrusted until Storage metadata is reconciled. A
 -- cancelled/expired reservation keeps the full bucket allowance charged,
 -- even if upload completed physically before inventory_file_uploaded ran.
 insert into private.file_objects(file_id,variant,path,bytes) values(new_file_id,'source',path,20971520);
 return jsonb_build_object('id',new_file_id,'path',path,'expires_at',now()+interval '15 minutes',
  'collection_revision',collection.revision::text);
end $$;

create function public.inventory_file_uploaded(p_file_id uuid) returns void
language plpgsql security definer set search_path='' as $$
declare a uuid; f public.inventory_files%rowtype; o storage.objects%rowtype;
 collection public.inventory_file_collections%rowtype;
begin
 a:=private.file_staff();
 if p_file_id is null then raise exception using errcode='P1012',message='invalid_input'; end if;
 perform private.file_guard_lock();
 select * into f from public.inventory_files where id=p_file_id;
 if not found then raise exception using errcode='P1010',message='not_found'; end if;
 collection:=private.file_collection_lock(f.asset_id,f.quantity_id);
 select * into f from public.inventory_files where id=p_file_id for update;
 if not found or f.uploader_id<>a or f.state<>'reserved' or f.reserve_expires_at<=now() then
  raise exception using errcode='P1008',message='invalid_transition'; end if;
 select * into o from storage.objects where bucket_id='inventory-files' and name=f.source_path;
 if not found or (o.metadata->>'size')::bigint is distinct from f.declared_bytes then
  raise exception using errcode='P1012',message='source_mismatch'; end if;
 update private.file_objects set object_id=o.id,object_version=o.version,bytes=(o.metadata->>'size')::bigint
  where file_id=f.id and variant='source' and object_id is null;
 if not found then raise exception using errcode='P1008',message='invalid_transition'; end if;
 update public.inventory_files set state='uploaded',version=version+1 where id=f.id;
end $$;

create function public.inventory_file_begin(p_file_id uuid,p_request_id uuid,p_key_id text,
 p_nonce text,p_expires bigint,p_mac text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare a uuid; f public.inventory_files%rowtype; o storage.objects%rowtype;
 collection public.inventory_file_collections%rowtype;
begin
 a:=private.file_staff();
 if p_file_id is null or p_request_id is null or p_key_id is null or p_nonce is null
  or p_expires is null or p_mac is null then raise exception using errcode='P1012',message='invalid_input'; end if;
 if private.file_server_proof(p_key_id,a,'begin',p_file_id::text||':'||p_request_id::text||':'||p_key_id,
  p_nonce,p_expires,p_mac) is distinct from true then
  raise exception using errcode='P1001',message='server_proof_required'; end if;
 perform private.file_guard_lock();
 select * into f from public.inventory_files where id=p_file_id;
 if not found then raise exception using errcode='P1010',message='not_found'; end if;
 collection:=private.file_collection_lock(f.asset_id,f.quantity_id);
 select * into f from public.inventory_files where id=p_file_id for update;
 if not found or f.uploader_id<>a then raise exception using errcode='P1010',message='not_found'; end if;
 if collection.revision<>f.reviewed_collection_revision then
  raise exception using errcode='P1002',message='stale_collection_revision'; end if;
 if f.replaces_file_id is not null and not exists(
   select 1 from public.inventory_files old where old.id=f.replaces_file_id
    and old.state='ready' and old.version=f.reviewed_replaced_file_version) then
  raise exception using errcode='P1002',message='stale_file_version'; end if;
 if (f.state not in ('uploaded','validated') and
     not (f.state='validating' and f.validation_lease_until+interval '30 seconds'<now()))
    then
  raise exception using errcode='P1008',message='invalid_transition'; end if;
 select * into o from storage.objects where bucket_id='inventory-files' and name=f.source_path;
 if not found or (o.metadata->>'size')::bigint is distinct from f.declared_bytes then raise exception using errcode='P1012',message='source_mismatch'; end if;
 if (select count(*) from public.inventory_files where state='validating' and validation_lease_until>now()
     and id<>f.id and uploader_id=a)>=1 or
    (select count(*) from public.inventory_files where state='validating' and validation_lease_until>now()
     and id<>f.id)>=2 then
  raise exception using errcode='P1012',message='validation_quota'; end if;
 update private.file_objects set object_id=o.id,object_version=o.version,bytes=(o.metadata->>'size')::bigint
  where file_id=f.id and variant='source' and object_id=o.id and object_version=o.version;
 if not found then raise exception using errcode='P1012',message='source_generation_mismatch'; end if;
 update public.inventory_files set state='validating',validation_generation=validation_generation+1,
  validation_request_id=p_request_id,validation_lease_until=now()+interval '5 minutes',
  validation_key_id=p_key_id,
  attestation=null,version=version+1 where id=f.id returning * into f;
 if f.validation_key_id is null then raise exception using errcode='P1012',message='file_keys_unconfigured'; end if;
 update private.file_objects set cleanup_state='eligible' where file_id=f.id and variant<>'source' and cleanup_state='held';
 if (select coalesce(sum(case when purpose='asset_document' then 20971520 else 62914560 end),0)
     from public.inventory_files where state in ('reserved','uploaded','validating','validated')) +
    (select coalesce(sum(bytes),0) from private.file_objects where cleanup_state in ('eligible','claimed'))>134217728 then
  raise exception using errcode='P1012',message='staging_quota'; end if;
 return jsonb_build_object('generation',f.validation_generation,'key_id',f.validation_key_id,
  'lease_until',extract(epoch from f.validation_lease_until)::bigint,'source_path',f.source_path,
  'source_id',o.id,'source_version',o.version);
end $$;

create function public.inventory_file_review(p_file_id uuid,p_expected_revision bigint,
 p_expected_file_version bigint default null) returns void
language plpgsql security definer set search_path='' as $$
declare a uuid; f public.inventory_files%rowtype; collection public.inventory_file_collections%rowtype;
begin
 a:=private.file_staff();
 if p_file_id is null or p_expected_revision is null or p_expected_revision<1 then
  raise exception using errcode='P1012',message='invalid_input'; end if;
 perform private.file_guard_lock();
 select * into f from public.inventory_files where id=p_file_id;
 if not found or f.uploader_id<>a or f.state not in ('uploaded','validated') then
  raise exception using errcode='P1008',message='invalid_transition'; end if;
 collection:=private.file_collection_lock(f.asset_id,f.quantity_id);
 select * into f from public.inventory_files where id=p_file_id for update;
 if f.state not in ('uploaded','validated') then raise exception using errcode='P1008',message='invalid_transition'; end if;
 if collection.revision is distinct from p_expected_revision then
  raise exception using errcode='P1002',message='stale_collection_revision'; end if;
 if (f.replaces_file_id is null) <> (p_expected_file_version is null) or
   (f.replaces_file_id is not null and not exists(
   select 1 from public.inventory_files old where old.id=f.replaces_file_id
     and old.state='ready' and old.version=p_expected_file_version)) then
  raise exception using errcode='P1002',message='stale_file_version'; end if;
 if f.reviewed_collection_revision is distinct from collection.revision or
   f.reviewed_replaced_file_version is distinct from p_expected_file_version then
  update public.inventory_files set reviewed_collection_revision=collection.revision,
   reviewed_replaced_file_version=p_expected_file_version,
   attestation=null,version=version+1 where id=f.id;
 end if;
end $$;

create function public.inventory_file_prepare_variant(p_file_id uuid,p_generation integer,p_variant text,
 p_path text,p_bytes bigint,p_sha256 text,p_mac text) returns void
language plpgsql security definer set search_path='' as $$
declare a uuid; f public.inventory_files%rowtype;
begin
 a:=private.file_staff();
 if p_file_id is null or p_generation is null or p_variant is null or p_path is null
  or p_bytes is null or p_bytes not between 1 and 20971520 or p_sha256 is null
  or p_sha256 !~ '^[a-f0-9]{64}$' or p_mac is null then
  raise exception using errcode='P1012',message='invalid_input'; end if;
 perform private.file_guard_lock();
 select * into f from public.inventory_files where id=p_file_id;
 if not found then raise exception using errcode='P1010',message='not_found'; end if;
 perform private.file_collection_lock(f.asset_id,f.quantity_id);
 select * into f from public.inventory_files where id=p_file_id for update;
 if not found or f.uploader_id<>a or f.state<>'validating' or f.validation_generation<>p_generation
  or f.validation_lease_until<=now() or p_variant not in ('display','thumbnail') then
  raise exception using errcode='P1008',message='invalid_transition'; end if;
 if private.file_signature_valid(f.validation_key_id,
   a::text||':'||f.id::text||':'||p_generation||':'||p_variant||':'||p_path||':'||
   p_bytes||':'||p_sha256,p_mac,true) is distinct from true then
  raise exception using errcode='P1001',message='server_proof_required'; end if;
 if (select coalesce(sum(case when purpose='asset_document' then 20971520 else 62914560 end),0)
     from public.inventory_files where state in ('reserved','uploaded','validating','validated')) +
    (select coalesce(sum(bytes),0) from private.file_objects where cleanup_state in ('eligible','claimed'))>134217728 then
  raise exception using errcode='P1012',message='staging_quota'; end if;
 insert into private.file_objects(file_id,variant,generation,path,bytes,sha256)
 values(p_file_id,p_variant,p_generation,p_path,p_bytes,p_sha256);
 if private.file_storage_insert('inventory-files',p_path) is distinct from true then
  raise exception using errcode='P1001',message='invalid_capability'; end if;
end $$;

create function public.inventory_file_register(p_file_id uuid,p_generation integer,p_variant text,p_path text,
 p_object_id uuid,p_bytes bigint,p_sha256 text,p_mac text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare a uuid; f public.inventory_files%rowtype; o storage.objects%rowtype; prepared private.file_objects%rowtype;
begin
 a:=private.file_staff();
 if p_file_id is null or p_generation is null or p_variant is null or p_path is null
  or p_object_id is null or p_bytes is null or p_sha256 is null or p_mac is null then
  raise exception using errcode='P1012',message='invalid_input'; end if;
 perform private.file_guard_lock();
 select * into f from public.inventory_files where id=p_file_id;
 if not found then raise exception using errcode='P1010',message='not_found'; end if;
 perform private.file_collection_lock(f.asset_id,f.quantity_id);
 select * into f from public.inventory_files where id=p_file_id for update;
 if not found or f.uploader_id<>a or f.state<>'validating' or f.validation_generation<>p_generation
  or f.validation_lease_until<=now() or p_variant not in ('display','thumbnail')
  or not private.file_storage_insert('inventory-files',p_path) then
  raise exception using errcode='P1008',message='invalid_transition'; end if;
 select * into prepared from private.file_objects where file_id=p_file_id and variant=p_variant
  and generation=p_generation and path=p_path for update;
 if not found or prepared.object_id is not null or prepared.bytes is distinct from p_bytes
  or prepared.sha256 is distinct from p_sha256 or prepared.cleanup_state<>'held' then
  raise exception using errcode='P1008',message='variant_not_prepared'; end if;
 select * into o from storage.objects where bucket_id='inventory-files' and name=p_path;
 if not found or o.id<>p_object_id
  or (o.metadata->>'size')::bigint<>p_bytes or p_sha256 !~ '^[a-f0-9]{64}$' then
  raise exception using errcode='P1012',message='object_mismatch'; end if;
 if not private.file_signature_valid(f.validation_key_id,
   a::text||':'||f.id::text||':'||p_generation||':'||p_variant||':'||p_path||':'||
   p_object_id::text||':'||p_bytes||':'||p_sha256,p_mac,true) then
  raise exception using errcode='P1001',message='invalid_registration'; end if;
 update private.file_objects set object_id=o.id,object_version=o.version where id=prepared.id;
 return jsonb_build_object('id',o.id,'version',o.version);
end $$;

create function public.inventory_file_validated(p_file_id uuid,p_generation integer,p_key_id text,
 p_source_id uuid,p_source_version text,p_type text,p_bytes bigint,p_sha256 text,p_mac text) returns void
language plpgsql security definer set search_path='' as $$
declare a uuid; f public.inventory_files%rowtype; o storage.objects%rowtype; source private.file_objects%rowtype; signed text;
begin
 a:=private.file_staff();
 if p_file_id is null or p_generation is null or p_key_id is null or p_source_id is null
  or p_source_version is null or p_type is null or p_bytes is null or p_sha256 is null
  or p_mac is null then raise exception using errcode='P1012',message='invalid_input'; end if;
 perform private.file_guard_lock();
 select * into f from public.inventory_files where id=p_file_id;
 if not found then raise exception using errcode='P1010',message='not_found'; end if;
 perform private.file_collection_lock(f.asset_id,f.quantity_id);
 select * into f from public.inventory_files where id=p_file_id for update;
 if not found or f.uploader_id<>a or f.state<>'validating' or f.validation_generation<>p_generation
  or f.validation_key_id<>p_key_id or f.validation_lease_until<=now()
  or p_type<>f.declared_type or p_bytes<>f.declared_bytes or p_sha256 !~ '^[a-f0-9]{64}$' then
  raise exception using errcode='P1008',message='invalid_transition'; end if;
 signed:=private.file_attestation_message(f,p_source_id,p_source_version,p_type,p_bytes,p_sha256);
 if private.file_signature_valid(p_key_id,signed,p_mac) is distinct from true then
  raise exception using errcode='P1001',message='invalid_attestation'; end if;
 select * into source from private.file_objects where file_id=f.id and variant='source';
 select * into o from storage.objects where bucket_id='inventory-files' and name=f.source_path;
 if not found or source.object_id<>p_source_id or source.object_version is distinct from p_source_version
  or o.id<>p_source_id or o.version is distinct from p_source_version or (o.metadata->>'size')::bigint<>p_bytes then
  raise exception using errcode='P1012',message='source_generation_mismatch'; end if;
 if f.purpose<>'asset_document' and (select count(*) from private.file_objects where file_id=f.id
  and generation=f.validation_generation and variant in ('display','thumbnail')
  and object_id is not null and object_version is not null and cleanup_state='held')<>2 then
  raise exception using errcode='P1012',message='variants_missing'; end if;
 update private.file_objects set sha256=p_sha256 where id=source.id;
 update public.inventory_files set state='validated',sha256=p_sha256,validated_type=p_type,
  validated_bytes=p_bytes,attestation=p_mac,version=version+1 where id=f.id;
end $$;

create function public.inventory_file_finalize(p_file_id uuid,p_expected_revision bigint,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare a uuid; f public.inventory_files%rowtype; old_file public.inventory_files%rowtype;
 r private.file_receipts%rowtype; collection public.inventory_file_collections%rowtype;
 v bigint; e uuid:=gen_random_uuid(); business jsonb; v_result jsonb; actor_name text;
begin
 a:=private.file_staff();
 if p_file_id is null or p_request_id is null or p_expected_revision is null or p_expected_revision<1 then
  raise exception using errcode='P1012',message='invalid_input'; end if;
 business:=jsonb_build_object('file_id',p_file_id,'expected_revision',p_expected_revision::text);
 insert into private.file_receipts(actor_id,request_id,operation,business,result)
  values(a,p_request_id,'finalize',business,null) on conflict(actor_id,request_id) do nothing;
 select * into r from private.file_receipts where actor_id=a and request_id=p_request_id for update;
 if r.operation<>'finalize' or r.business<>business then raise exception using errcode='P1009',message='idempotency_conflict'; end if;
 if r.result is not null then return r.result; end if;
 perform private.file_guard_lock();
 select * into f from public.inventory_files where id=p_file_id;
 if not found or f.uploader_id<>a or f.state<>'validated' then raise exception using errcode='P1008',message='invalid_transition'; end if;
 collection:=private.file_collection_lock(f.asset_id,f.quantity_id);
 select * into f from public.inventory_files where id=p_file_id for update;
 if f.state<>'validated' then raise exception using errcode='P1008',message='invalid_transition'; end if;
 if f.validation_request_id is distinct from p_request_id or f.validation_lease_until<=now() or private.file_signature_valid(f.validation_key_id,
  private.file_attestation_message(f,
   (select object_id from private.file_objects where file_id=f.id and variant='source'),
   (select object_version from private.file_objects where file_id=f.id and variant='source'),
   f.validated_type,f.validated_bytes,f.sha256),f.attestation) is distinct from true then
  raise exception using errcode='P1008',message='attestation_expired'; end if;
 if exists(select 1 from private.file_objects fo left join storage.objects so on so.bucket_id='inventory-files' and so.name=fo.path
  where fo.file_id=f.id and fo.cleanup_state='held' and
   (so.id is distinct from fo.object_id or so.version is distinct from fo.object_version or
    (so.metadata->>'size')::bigint is distinct from fo.bytes)) then
  raise exception using errcode='P1012',message='object_generation_mismatch'; end if;
 if collection.revision is distinct from p_expected_revision or
   collection.revision is distinct from f.reviewed_collection_revision then
  raise exception using errcode='P1002',message='stale_collection_revision'; end if;
 if (select coalesce(sum(o.bytes),0) from private.file_objects o join public.inventory_files other on other.id=o.file_id
     where o.cleanup_state<>'deleted' and other.state in ('ready','removed')) +
    (select coalesce(sum(bytes),0) from private.file_objects where file_id=f.id and cleanup_state<>'deleted')>805306368 then
  raise exception using errcode='P1012',message='ready_quota'; end if;
 if f.asset_id is not null and (select count(*) from public.inventory_files where asset_id=f.asset_id and state='ready') >=
  (case when f.replaces_file_id is null then 20 else 21 end) then
  raise exception using errcode='P1012',message='asset_file_quota'; end if;
 if f.quantity_id is not null and f.replaces_file_id is null and exists(select 1 from public.inventory_files where quantity_id=f.quantity_id and state='ready') then
  raise exception using errcode='P1012',message='recognition_photo_exists'; end if;
 if f.replaces_file_id is not null then
  select * into old_file from public.inventory_files where id=f.replaces_file_id for update;
  if not found or old_file.state<>'ready' or
    old_file.version is distinct from f.reviewed_replaced_file_version or
    old_file.asset_id is distinct from f.asset_id or
    old_file.quantity_id is distinct from f.quantity_id then
   raise exception using errcode='P1002',message='stale_file_version'; end if;
  update public.inventory_files set state='removed',removed_at=now(),version=version+1
   where id=f.replaces_file_id and state='ready' and version=f.reviewed_replaced_file_version;
  if not found then raise exception using errcode='P1002',message='stale_version'; end if;
  update private.file_objects set cleanup_state='eligible' where file_id=f.replaces_file_id and cleanup_state='held';
 end if;
 update public.inventory_files set state='ready',ready_at=now(),version=version+1 where id=f.id;
 if f.purpose<>'asset_document' then
  update private.file_objects set cleanup_state='eligible' where file_id=f.id and variant='source';
 end if;
 select display_name into actor_name from public.app_members where user_id=a;
 update public.inventory_file_collections set revision=revision+1
  where id=collection.id returning revision into v;
 insert into public.inventory_file_events(id,collection_id,asset_id,quantity_id,file_id,replaces_file_id,
  actor_id,actor_name,action,before_title,title,file_type,file_bytes,collection_revision)
 values(e,collection.id,f.asset_id,f.quantity_id,f.id,f.replaces_file_id,a,actor_name,
  case when f.replaces_file_id is null then 'added' else 'replaced' end,
  old_file.display_title,f.display_title,f.validated_type,f.validated_bytes,v);
 v_result:=jsonb_build_object('entity_id',coalesce(f.asset_id,f.quantity_id),
  'collection_revision',v::text,'event_id',e,'changed',true,'file_id',f.id);
 update private.file_receipts set result=v_result where actor_id=a and request_id=p_request_id;
 return v_result;
end $$;

create function public.inventory_file_remove(p_file_id uuid,p_expected_revision bigint,
 p_expected_file_version bigint,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare a uuid; f public.inventory_files%rowtype; r private.file_receipts%rowtype;
 collection public.inventory_file_collections%rowtype; v bigint; e uuid:=gen_random_uuid();
 business jsonb; v_result jsonb; actor_name text;
begin
 a:=private.file_staff();
 if p_file_id is null or p_request_id is null or p_expected_revision is null or p_expected_revision<1
  or p_expected_file_version is null or p_expected_file_version<1 then
  raise exception using errcode='P1012',message='invalid_input'; end if;
 business:=jsonb_build_object('file_id',p_file_id,'expected_revision',p_expected_revision::text,
  'expected_file_version',p_expected_file_version::text);
 insert into private.file_receipts(actor_id,request_id,operation,business,result)
  values(a,p_request_id,'remove',business,null) on conflict(actor_id,request_id) do nothing;
 select * into r from private.file_receipts where actor_id=a and request_id=p_request_id for update;
 if r.operation<>'remove' or r.business<>business then raise exception using errcode='P1009',message='idempotency_conflict'; end if;
 if r.result is not null then return r.result; end if;
 perform private.file_guard_lock();
 select * into f from public.inventory_files where id=p_file_id;
 if not found or f.state<>'ready' then raise exception using errcode='P1010',message='not_found'; end if;
 collection:=private.file_collection_lock(f.asset_id,f.quantity_id);
 select * into f from public.inventory_files where id=p_file_id for update;
 if f.state<>'ready' then raise exception using errcode='P1010',message='not_found'; end if;
 if collection.revision is distinct from p_expected_revision or
   f.version is distinct from p_expected_file_version then
  raise exception using errcode='P1002',message='stale_file_review'; end if;
 update public.inventory_files set state='removed',removed_at=now(),version=version+1 where id=f.id;
 update private.file_objects set cleanup_state='eligible' where file_id=f.id and cleanup_state='held';
 select display_name into actor_name from public.app_members where user_id=a;
 update public.inventory_file_collections set revision=revision+1
  where id=collection.id returning revision into v;
 insert into public.inventory_file_events(id,collection_id,asset_id,quantity_id,file_id,
  actor_id,actor_name,action,before_title,title,file_type,file_bytes,collection_revision)
 values(e,collection.id,f.asset_id,f.quantity_id,f.id,a,actor_name,'removed',f.display_title,
  f.display_title,coalesce(f.validated_type,f.declared_type),coalesce(f.validated_bytes,f.declared_bytes),v);
 v_result:=jsonb_build_object('entity_id',coalesce(f.asset_id,f.quantity_id),
  'collection_revision',v::text,'event_id',e,'changed',true,'file_id',f.id);
 update private.file_receipts set result=v_result where actor_id=a and request_id=p_request_id;
 return v_result;
end $$;

create function public.inventory_file_rename(p_file_id uuid,p_expected_revision bigint,
 p_expected_file_version bigint,p_title text,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare a uuid; f public.inventory_files%rowtype; r private.file_receipts%rowtype;
 collection public.inventory_file_collections%rowtype; v bigint; e uuid:=gen_random_uuid();
 business jsonb; v_result jsonb; actor_name text;
begin
 a:=private.file_staff();
 if p_file_id is null or p_request_id is null or p_expected_revision is null or p_expected_revision<1
  or p_expected_file_version is null or p_expected_file_version<1 or p_title is null
  or length(btrim(p_title)) not between 1 and 200 or p_title<>btrim(p_title)
  or p_title ~ '[[:cntrl:]]' then
  raise exception using errcode='P1012',message='invalid_input'; end if;
 business:=jsonb_build_object('file_id',p_file_id,'expected_revision',p_expected_revision::text,
  'expected_file_version',p_expected_file_version::text,'title',p_title);
 insert into private.file_receipts(actor_id,request_id,operation,business,result)
  values(a,p_request_id,'rename',business,null) on conflict(actor_id,request_id) do nothing;
 select * into r from private.file_receipts where actor_id=a and request_id=p_request_id for update;
 if r.operation<>'rename' or r.business<>business then
  raise exception using errcode='P1009',message='idempotency_conflict'; end if;
 if r.result is not null then return r.result; end if;
 perform private.file_guard_lock();
 select * into f from public.inventory_files where id=p_file_id;
 if not found or f.state<>'ready' then raise exception using errcode='P1010',message='not_found'; end if;
 collection:=private.file_collection_lock(f.asset_id,f.quantity_id);
 select * into f from public.inventory_files where id=p_file_id for update;
 if f.state<>'ready' then raise exception using errcode='P1010',message='not_found'; end if;
 if collection.revision is distinct from p_expected_revision or
   f.version is distinct from p_expected_file_version then
  raise exception using errcode='P1002',message='stale_file_review'; end if;
 if f.display_title=p_title then
  v_result:=jsonb_build_object('entity_id',coalesce(f.asset_id,f.quantity_id),
   'collection_revision',collection.revision::text,'event_id',null,'changed',false,'file_id',f.id);
 else
  update public.inventory_files set display_title=p_title,version=version+1 where id=f.id;
  update public.inventory_file_collections set revision=revision+1
   where id=collection.id returning revision into v;
  select display_name into actor_name from public.app_members where user_id=a;
  insert into public.inventory_file_events(id,collection_id,asset_id,quantity_id,file_id,
   actor_id,actor_name,action,before_title,title,file_type,file_bytes,collection_revision)
  values(e,collection.id,f.asset_id,f.quantity_id,f.id,a,actor_name,'renamed',f.display_title,
   p_title,coalesce(f.validated_type,f.declared_type),coalesce(f.validated_bytes,f.declared_bytes),v);
  v_result:=jsonb_build_object('entity_id',coalesce(f.asset_id,f.quantity_id),
   'collection_revision',v::text,'event_id',e,'changed',true,'file_id',f.id);
 end if;
 update private.file_receipts set result=v_result where actor_id=a and request_id=p_request_id;
 return v_result;
end $$;

create function public.inventory_file_cancel(p_file_id uuid) returns void
language plpgsql security definer set search_path='' as $$
declare a uuid; f public.inventory_files%rowtype;
begin
 a:=private.file_staff();
 if p_file_id is null then raise exception using errcode='P1012',message='invalid_input'; end if;
 perform private.file_guard_lock();
 select * into f from public.inventory_files where id=p_file_id;
 if not found then raise exception using errcode='P1010',message='not_found'; end if;
 perform private.file_collection_lock(f.asset_id,f.quantity_id);
 select * into f from public.inventory_files where id=p_file_id for update;
 if not found or f.uploader_id<>a or f.state not in ('reserved','uploaded','validated') then
  raise exception using errcode='P1008',message='invalid_transition'; end if;
 update public.inventory_files set state='cancelled',version=version+1 where id=f.id;
 update private.file_objects set cleanup_state='eligible' where file_id=f.id and cleanup_state='held';
end $$;

create function public.inventory_file_reject(p_file_id uuid,p_generation integer,p_key_id text,
 p_nonce text,p_expires bigint,p_mac text) returns void
language plpgsql security definer set search_path='' as $$
declare a uuid; f public.inventory_files%rowtype;
begin
 a:=private.file_staff();
 if p_file_id is null or p_generation is null or p_key_id is null or p_nonce is null
  or p_expires is null or p_mac is null then raise exception using errcode='P1012',message='invalid_input'; end if;
 if private.file_server_proof(p_key_id,a,'reject',p_file_id::text||':'||p_generation||':'||p_key_id,
  p_nonce,p_expires,p_mac) is distinct from true then
  raise exception using errcode='P1001',message='server_proof_required'; end if;
 perform private.file_guard_lock();
 select * into f from public.inventory_files where id=p_file_id;
 if not found then raise exception using errcode='P1010',message='not_found'; end if;
 perform private.file_collection_lock(f.asset_id,f.quantity_id);
 select * into f from public.inventory_files where id=p_file_id for update;
 if not found or f.uploader_id<>a or f.state<>'validating' or f.validation_generation<>p_generation
  or f.validation_key_id<>p_key_id then
  raise exception using errcode='P1008',message='invalid_transition'; end if;
 update public.inventory_files set state='rejected',version=version+1 where id=f.id;
 update private.file_objects set cleanup_state='eligible' where file_id=f.id and cleanup_state='held';
end $$;

create function public.inventory_file_cleanup_claim(p_limit integer,p_key_id text,p_nonce text,p_expires bigint,p_mac text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare a uuid; output jsonb;
begin
 a:=private.file_staff();
 if p_limit is null or p_limit not between 1 and 20 or p_key_id is null or p_nonce is null
  or p_expires is null or p_mac is null then raise exception using errcode='P1012',message='invalid_input'; end if;
 if private.file_server_proof(p_key_id,a,'cleanup_claim',p_limit::text||':'||p_key_id,
  p_nonce,p_expires,p_mac) is distinct from true then
  raise exception using errcode='P1001',message='server_proof_required'; end if;
 perform private.file_guard_lock();
 update public.inventory_files f set state='expired',version=version+1
 from (select id from public.inventory_files where
   (state='reserved' and reserve_expires_at+interval '30 seconds'<now()) or
   (state='uploaded' and reserve_expires_at+interval '1 hour'<now()) or
   (state='validating' and validation_lease_until+interval '30 seconds'<now()) or
   (state='validated' and created_at+interval '24 hours'<now())
  order by created_at limit p_limit for update skip locked) expired
 where f.id=expired.id;
 update private.file_objects o set cleanup_state='eligible'
 from public.inventory_files f where o.file_id=f.id and f.state='expired' and o.cleanup_state='held';
 -- Grace protects a bounded in-flight validation before another generation begins.
 update private.file_objects o set cleanup_state='claimed',cleanup_actor=a,
  cleanup_lease_until=now()+interval '2 minutes'
 from (select fo.id from private.file_objects fo join public.inventory_files f on f.id=fo.file_id
  where (fo.cleanup_state='eligible' or fo.cleanup_state='claimed' and fo.cleanup_lease_until<now())
   and (f.state in ('removed','rejected','cancelled','expired') or
    f.state='ready' and fo.variant='source' and f.purpose<>'asset_document' or
    f.state='ready' and fo.variant<>'source' and fo.generation<>f.validation_generation or
    fo.cleanup_state='eligible' and fo.variant<>'source' and f.state in ('validating','validated'))
   and (f.validation_lease_until is null or f.validation_lease_until+interval '30 seconds'<now() or f.state='removed')
   and not exists(select 1 from public.inventory_files live where live.state='ready' and live.id=fo.file_id
    and (fo.variant='source' and live.purpose='asset_document' or
      fo.variant<>'source' and fo.generation=live.validation_generation))
  order by fo.created_at limit p_limit for update of fo skip locked) pick
 where o.id=pick.id;
 select coalesce(jsonb_agg(jsonb_build_object('object_id',claim.id,'path',claim.path)), '[]'::jsonb) into output
 from (select o.id,o.path from private.file_objects o
   where o.cleanup_actor=a and o.cleanup_state='claimed' and o.cleanup_lease_until>now()
   order by o.created_at,o.id limit 20) claim;
 return output;
end $$;
create function public.inventory_file_cleanup_confirm(p_object_id uuid,p_key_id text,p_nonce text,p_expires bigint,p_mac text) returns void
language plpgsql security definer set search_path='' as $$
declare a uuid; o private.file_objects%rowtype; f public.inventory_files%rowtype;
begin
 a:=private.file_staff();
 if p_object_id is null or p_key_id is null or p_nonce is null or p_expires is null or p_mac is null then
  raise exception using errcode='P1012',message='invalid_input'; end if;
 if private.file_server_proof(p_key_id,a,'cleanup_confirm',p_object_id::text||':'||p_key_id,
  p_nonce,p_expires,p_mac) is distinct from true then
  raise exception using errcode='P1001',message='server_proof_required'; end if;
 perform private.file_guard_lock();
 select * into o from private.file_objects where id=p_object_id;
 if not found then raise exception using errcode='P1010',message='not_found'; end if;
 select * into f from public.inventory_files where id=o.file_id;
 perform private.file_collection_lock(f.asset_id,f.quantity_id);
 select * into o from private.file_objects where id=p_object_id for update;
 if not found or o.cleanup_state<>'claimed' or o.cleanup_actor<>a or o.cleanup_lease_until<=now() then
  raise exception using errcode='P1001',message='forbidden'; end if;
 if exists(select 1 from storage.objects where bucket_id='inventory-files' and name=o.path) then
  raise exception using errcode='P1012',message='object_still_present'; end if;
 update private.file_objects set cleanup_state='deleted',deleted_at=now(),cleanup_actor=null,cleanup_lease_until=null where id=o.id;
end $$;

revoke all on function private.file_staff(),private.file_member(),private.file_collection_lock(uuid,uuid),private.file_guard_lock(),
 private.inventory_file_event_identity(),private.file_mac(text,text),
 private.file_signature_valid(text,text,text,boolean),private.file_server_proof(text,uuid,text,text,text,bigint,text),private.file_storage_insert(text,text),
 private.file_storage_select(text,text),private.file_storage_delete(text,text),
 private.file_attestation_message(public.inventory_files,uuid,text,text,bigint,text) from public,anon,authenticated,service_role;
-- RLS evaluates policy helpers as the caller; the private schema remains
-- outside the exposed Data API and the helper bodies are SECURITY DEFINER.
grant usage on schema private to authenticated;
grant execute on function private.file_storage_insert(text,text),
 private.file_storage_select(text,text),private.file_storage_delete(text,text) to authenticated;
revoke all on function public.inventory_file_active_key(),public.inventory_file_cards(text,uuid),public.inventory_file_history(text,uuid,integer),public.inventory_file_list_thumbnails(uuid[],uuid[]),public.inventory_file_read(uuid,text),public.inventory_file_source_details(uuid),
 public.inventory_file_reserve(text,uuid,bigint,text,text,bigint,uuid,bigint),public.inventory_file_begin(uuid,uuid,text,text,bigint,text),
 public.inventory_file_uploaded(uuid),
 public.inventory_file_review(uuid,bigint,bigint),
 public.inventory_file_prepare_variant(uuid,integer,text,text,bigint,text,text),
 public.inventory_file_register(uuid,integer,text,text,uuid,bigint,text,text),
 public.inventory_file_validated(uuid,integer,text,uuid,text,text,bigint,text,text),
 public.inventory_file_finalize(uuid,bigint,uuid),public.inventory_file_remove(uuid,bigint,bigint,uuid),
 public.inventory_file_rename(uuid,bigint,bigint,text,uuid),
 public.inventory_file_cancel(uuid),public.inventory_file_reject(uuid,integer,text,text,bigint,text),public.inventory_file_cleanup_claim(integer,text,text,bigint,text),
 public.inventory_file_cleanup_confirm(uuid,text,text,bigint,text) from public,anon,authenticated,service_role;
grant execute on function public.inventory_file_active_key(),public.inventory_file_cards(text,uuid),public.inventory_file_history(text,uuid,integer),public.inventory_file_list_thumbnails(uuid[],uuid[]),public.inventory_file_read(uuid,text),public.inventory_file_source_details(uuid),
 public.inventory_file_reserve(text,uuid,bigint,text,text,bigint,uuid,bigint),public.inventory_file_begin(uuid,uuid,text,text,bigint,text),
 public.inventory_file_uploaded(uuid),
 public.inventory_file_review(uuid,bigint,bigint),
 public.inventory_file_prepare_variant(uuid,integer,text,text,bigint,text,text),
 public.inventory_file_register(uuid,integer,text,text,uuid,bigint,text,text),
 public.inventory_file_validated(uuid,integer,text,uuid,text,text,bigint,text,text),
 public.inventory_file_finalize(uuid,bigint,uuid),public.inventory_file_remove(uuid,bigint,bigint,uuid),
 public.inventory_file_rename(uuid,bigint,bigint,text,uuid),
 public.inventory_file_cancel(uuid),public.inventory_file_reject(uuid,integer,text,text,bigint,text),public.inventory_file_cleanup_claim(integer,text,text,bigint,text),
 public.inventory_file_cleanup_confirm(uuid,text,text,bigint,text) to authenticated;
