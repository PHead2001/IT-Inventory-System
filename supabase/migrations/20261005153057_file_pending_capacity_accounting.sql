-- Pending slots cover currently usable work, without expiring unrelated parents.
-- Source and derivative tombstones retain their byte charge until physical absence
-- is confirmed; an expired lease alone is never proof of absent Storage bytes.
create function private.file_pending_active(p_file public.inventory_files,p_checked_at timestamptz)
returns boolean language sql immutable strict set search_path='' as $$
 select coalesce(p_file.state in ('reserved','uploaded','validating','validated') and (
  (p_file.state='reserved' and p_file.reserve_expires_at+interval '30 seconds'>=p_checked_at) or
  (p_file.state='uploaded' and p_file.reserve_expires_at+interval '1 hour'>=p_checked_at) or
  (p_file.state='validating' and p_file.validation_lease_until+interval '30 seconds'>=p_checked_at) or
  (p_file.state='validated' and p_file.created_at+interval '24 hours'>=p_checked_at) or
  (p_file.validation_lease_until is not null and p_file.validation_lease_until+interval '30 seconds'>=p_checked_at)
 ),false);
$$;
revoke all on function private.file_pending_active(public.inventory_files,timestamptz) from public,anon,authenticated,service_role;

-- VOLATILE intentionally observes an admission/update performed earlier in the
-- same RPC. Callers hold file_guard and pass their single captured wall clock.
create function private.file_staging_bytes(p_checked_at timestamptz)
returns bigint language sql volatile strict set search_path='' as $$
 with charged as (
  select f.id,f.state,f.purpose,
   private.file_pending_active(f,p_checked_at) or
   (f.state in ('rejected','cancelled','expired') and f.validation_lease_until is not null
    and f.validation_lease_until+interval '30 seconds'>=p_checked_at) as allocation
  from public.inventory_files f
 )
 select (select coalesce(sum(case when purpose='asset_document' then 20971520 else 62914560 end),0)
   from charged where allocation) +
  (select coalesce(sum(o.bytes),0) from private.file_objects o join charged f on f.id=o.file_id
   where o.cleanup_state<>'deleted' and
    (o.cleanup_state in ('eligible','claimed') or
     (not f.allocation and f.state not in ('ready','removed'))));
$$;
revoke all on function private.file_staging_bytes(timestamptz) from public,anon,authenticated,service_role;

create or replace function private.file_reserve_ready(p_parent_type text,p_parent_id uuid,p_expected_revision bigint,
 p_name text,p_type text,p_bytes bigint,p_replaces uuid default null,
 p_expected_file_version bigint default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare a uuid; f public.inventory_files%rowtype; collection public.inventory_file_collections%rowtype;
 pending_count integer; ready_count integer; new_file_id uuid:=gen_random_uuid(); path text; checked_at timestamptz;
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
 checked_at:=clock_timestamp();
 select count(*) into pending_count from public.inventory_files pending_file
  where uploader_id=a and private.file_pending_active(pending_file,checked_at);
 if pending_count>=3 then raise exception using errcode='P1012',message='pending_quota'; end if;
 if p_parent_type='asset' then
  select count(*) into ready_count from public.inventory_files where asset_id=p_parent_id and state='ready';
  if ready_count>=20 and p_replaces is null then raise exception using errcode='P1012',message='asset_file_quota'; end if;
 else
  select count(*) into ready_count from public.inventory_files where quantity_id=p_parent_id and state='ready';
  if ready_count>=1 and p_replaces is null then raise exception using errcode='P1012',message='recognition_photo_exists'; end if;
 end if;
 if private.file_staging_bytes(checked_at) +
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
  p_expected_revision,p_replaces,p_expected_file_version,path,checked_at+interval '15 minutes');
 -- Declared length is untrusted until Storage metadata is reconciled. A
 -- cancelled/expired reservation keeps the full bucket allowance charged,
 -- even if upload completed physically before inventory_file_uploaded ran.
 insert into private.file_objects(file_id,variant,path,bytes) values(new_file_id,'source',path,20971520);
 return jsonb_build_object('id',new_file_id,'path',path,'expires_at',checked_at+interval '15 minutes',
  'collection_revision',collection.revision::text);
end $$;

create or replace function public.inventory_file_begin(p_file_id uuid,p_request_id uuid,p_key_id text,
 p_nonce text,p_expires bigint,p_mac text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare a uuid; f public.inventory_files%rowtype; o storage.objects%rowtype;
 collection public.inventory_file_collections%rowtype; checked_at timestamptz;
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
 checked_at:=clock_timestamp();
 if (f.state not in ('uploaded','validated') and
     not (f.state='validating' and f.validation_lease_until+interval '30 seconds'<checked_at))
    then
  raise exception using errcode='P1008',message='invalid_transition'; end if;
 select * into o from storage.objects where bucket_id='inventory-files' and name=f.source_path;
 if not found or (o.metadata->>'size')::bigint is distinct from f.declared_bytes then raise exception using errcode='P1012',message='source_mismatch'; end if;
 if (select count(*) from public.inventory_files where state='validating' and validation_lease_until>checked_at
     and id<>f.id and uploader_id=a)>=1 or
    (select count(*) from public.inventory_files where state='validating' and validation_lease_until>checked_at
     and id<>f.id)>=2 then
  raise exception using errcode='P1012',message='validation_quota'; end if;
 update private.file_objects set object_id=o.id,object_version=o.version,bytes=(o.metadata->>'size')::bigint
  where file_id=f.id and variant='source' and object_id=o.id and object_version=o.version;
 if not found then raise exception using errcode='P1012',message='source_generation_mismatch'; end if;
 update public.inventory_files set state='validating',validation_generation=validation_generation+1,
  validation_request_id=p_request_id,validation_lease_until=checked_at+interval '5 minutes',
  validation_key_id=p_key_id,
  attestation=null,version=version+1 where id=f.id returning * into f;
 if f.validation_key_id is null then raise exception using errcode='P1012',message='file_keys_unconfigured'; end if;
 update private.file_objects set cleanup_state='eligible' where file_id=f.id and variant<>'source' and cleanup_state='held';
 -- Expired work is an explicit new admission, serialized with fresh reserves.
 if (select count(*) from public.inventory_files pending where pending.uploader_id=a
  and private.file_pending_active(pending,checked_at))>3 then
  raise exception using errcode='P1012',message='pending_quota'; end if;
 if private.file_staging_bytes(checked_at)>134217728 then
  raise exception using errcode='P1012',message='staging_quota'; end if;
 return jsonb_build_object('generation',f.validation_generation,'key_id',f.validation_key_id,
  'lease_until',extract(epoch from f.validation_lease_until)::bigint,'source_path',f.source_path,
  'source_id',o.id,'source_version',o.version);
end $$;

create or replace function public.inventory_file_prepare_variant(p_file_id uuid,p_generation integer,p_variant text,
 p_path text,p_bytes bigint,p_sha256 text,p_mac text) returns void
language plpgsql security definer set search_path='' as $$
declare a uuid; f public.inventory_files%rowtype; checked_at timestamptz;
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
 checked_at:=clock_timestamp();
 if not found or f.uploader_id<>a or f.state<>'validating' or f.validation_generation<>p_generation
  or f.validation_lease_until<=checked_at or p_variant not in ('display','thumbnail') then
  raise exception using errcode='P1008',message='invalid_transition'; end if;
 if private.file_signature_valid(f.validation_key_id,
   a::text||':'||f.id::text||':'||p_generation||':'||p_variant||':'||p_path||':'||
   p_bytes||':'||p_sha256,p_mac,true) is distinct from true then
  raise exception using errcode='P1001',message='server_proof_required'; end if;
 if private.file_staging_bytes(checked_at)>134217728 then
  raise exception using errcode='P1012',message='staging_quota'; end if;
 insert into private.file_objects(file_id,variant,generation,path,bytes,sha256)
 values(p_file_id,p_variant,p_generation,p_path,p_bytes,p_sha256);
 if private.file_storage_insert('inventory-files',p_path) is distinct from true then
  raise exception using errcode='P1001',message='invalid_capability'; end if;
end $$;


-- A transaction started before expiry may have waited beyond grace on the guard.
-- Recheck wall-clock eligibility before a transition can revive its allowance.
create or replace function public.inventory_file_uploaded(p_file_id uuid) returns void
language plpgsql security definer set search_path='' as $$
declare a uuid; f public.inventory_files%rowtype; o storage.objects%rowtype;
 collection public.inventory_file_collections%rowtype; checked_at timestamptz;
begin
 a:=private.file_staff();
 if p_file_id is null then raise exception using errcode='P1012',message='invalid_input'; end if;
 perform private.file_guard_lock();
 select * into f from public.inventory_files where id=p_file_id;
 if not found then raise exception using errcode='P1010',message='not_found'; end if;
 collection:=private.file_collection_lock(f.asset_id,f.quantity_id);
 select * into f from public.inventory_files where id=p_file_id for update;
 checked_at:=clock_timestamp();
 if not found or f.uploader_id<>a or f.state<>'reserved' or f.reserve_expires_at<=checked_at then
  raise exception using errcode='P1008',message='invalid_transition'; end if;
 select * into o from storage.objects where bucket_id='inventory-files' and name=f.source_path;
 if not found or (o.metadata->>'size')::bigint is distinct from f.declared_bytes then
  raise exception using errcode='P1012',message='source_mismatch'; end if;
 update private.file_objects set object_id=o.id,object_version=o.version,bytes=(o.metadata->>'size')::bigint
  where file_id=f.id and variant='source' and object_id is null;
 if not found then raise exception using errcode='P1008',message='invalid_transition'; end if;
 update public.inventory_files set state='uploaded',version=version+1 where id=f.id;
end $$;


-- A transaction started before expiry may have waited beyond grace on the guard.
-- Recheck wall-clock eligibility before a transition can revive its allowance.
create or replace function public.inventory_file_validated(p_file_id uuid,p_generation integer,p_key_id text,
 p_source_id uuid,p_source_version text,p_type text,p_bytes bigint,p_sha256 text,p_mac text) returns void
language plpgsql security definer set search_path='' as $$
declare a uuid; f public.inventory_files%rowtype; o storage.objects%rowtype; source private.file_objects%rowtype; signed text; checked_at timestamptz;
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
 checked_at:=clock_timestamp();
 if not found or f.uploader_id<>a or f.state<>'validating' or f.validation_generation<>p_generation
  or f.validation_key_id<>p_key_id or f.validation_lease_until<=checked_at
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
