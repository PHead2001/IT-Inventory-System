-- Storage's privileged completion/upsert path maps SQLSTATE 42501 to an
-- authorization denial. Keep all lifecycle and byte-identity checks from the
-- prior trigger; change only its intentionally denied P1008 SQLSTATE values.
create or replace function private.inventory_file_storage_completion_guard() returns trigger
language plpgsql security definer set search_path='' as $$
declare
 a uuid;
 f public.inventory_files%rowtype;
 o private.file_objects%rowtype;
 parts text[];
 generation integer;
 expires bigint;
 file_uuid uuid;
 signed text;
 checked_at timestamptz;
begin
 if tg_op='UPDATE' then
  if old.bucket_id='inventory-files' or new.bucket_id='inventory-files' then
   -- path_tokens is generated from name after BEFORE triggers. Compare every
   -- stored identity/content field explicitly; only access timestamps may
   -- change. In particular Storage's privileged conflict update cannot
   -- replace the object version, owner, metadata or bytes at a sealed path.
   if new.id is distinct from old.id or
      new.bucket_id is distinct from old.bucket_id or
      new.name is distinct from old.name or
      new.owner is distinct from old.owner or
      new.owner_id is distinct from old.owner_id or
      new.metadata is distinct from old.metadata or
      new.user_metadata is distinct from old.user_metadata or
      new.version is distinct from old.version or
      new.created_at is distinct from old.created_at or
      new.archived_at is distinct from old.archived_at or
      new.is_delete_marker is distinct from old.is_delete_marker or
      new.is_versioned is distinct from old.is_versioned then
    raise exception using errcode='42501',message='immutable_file_storage_object';
   end if;
  end if;
  return new;
 end if;
 if new.bucket_id<>'inventory-files' then return new; end if;
 if new.owner_id is null or new.owner_id !~
   '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
  raise exception using errcode='42501',message='forbidden';
 end if;
 a:=new.owner_id::uuid;
 -- The final Storage write runs with a service-role JWT. Its auth.uid() is
 -- not the request actor; owner_id is carried from the authenticated request.
 perform 1 from public.app_members where user_id=a and active and role='staff' for share;
 if not found then raise exception using errcode='42501',message='forbidden'; end if;
 perform private.file_guard_lock();
 select * into o from private.file_objects where path=new.name;
 if not found then raise exception using errcode='42501',message='forbidden'; end if;
 select * into f from public.inventory_files where id=o.file_id;
 if not found then raise exception using errcode='42501',message='forbidden'; end if;
 perform private.file_collection_lock(f.asset_id,f.quantity_id);
 select * into f from public.inventory_files where id=o.file_id for update;
 select * into o from private.file_objects where path=new.name for update;
 checked_at:=clock_timestamp();
 if f.uploader_id is distinct from a or new.owner is distinct from a then
  raise exception using errcode='42501',message='forbidden';
 end if;
 if not found or o.file_id is distinct from f.id or
    o.cleanup_state<>'held' or o.object_id is not null or
    o.object_version is not null then
  raise exception using errcode='42501',message='sealed_file_storage_path';
 end if;
 if o.variant='source' then
  if f.source_path is distinct from new.name or o.generation<>0 or
     f.state<>'reserved' or f.reserve_expires_at<=checked_at then
   raise exception using errcode='42501',message='source_reservation_closed';
  end if;
  return new;
 end if;
 parts:=string_to_array(new.name,'/');
 if o.variant not in ('display','thumbnail') or array_length(parts,1)<>8 or
    parts[1]<>'d' or parts[5] is distinct from o.variant or
    parts[6] !~ '^[a-f0-9]{32}$' or parts[7] !~ '^[0-9]+$' or
    parts[8] !~ '^[a-f0-9]{64}$' then
  raise exception using errcode='42501',message='forbidden';
 end if;
 begin
  generation:=parts[4]::integer;
  expires:=parts[7]::bigint;
  file_uuid:=parts[3]::uuid;
 exception when invalid_text_representation or numeric_value_out_of_range then
  raise exception using errcode='42501',message='forbidden';
 end;
 if f.id is distinct from file_uuid or o.generation<>generation or
    f.state<>'validating' or f.validation_generation<>generation or
    f.validation_key_id is distinct from parts[2] or
    f.validation_lease_until<=checked_at or to_timestamp(expires)<=checked_at or
    to_timestamp(expires)>f.validation_lease_until then
  raise exception using errcode='42501',message='derived_file_lease_closed';
 end if;
 perform 1 from private.file_keys where key_id=parts[2] and accepts_new
  and verify_until>checked_at for share;
 if not found then
  raise exception using errcode='42501',message='forbidden';
 end if;
 -- The key lock can wait across a real expiry even though this transaction's
 -- now() remains fixed. Recheck every capability lifetime after that wait.
 checked_at:=clock_timestamp();
 if not exists(select 1 from private.file_keys where key_id=parts[2]
   and accepts_new and verify_until>checked_at) then
  raise exception using errcode='42501',message='forbidden';
 end if;
 if f.validation_lease_until<=checked_at or to_timestamp(expires)<=checked_at then
  raise exception using errcode='42501',message='derived_file_lease_closed';
 end if;
 signed:=a::text||':'||f.id::text||':'||generation||':'||o.variant||':'||parts[6]||':'||expires;
 if private.file_signature_valid(parts[2],signed,parts[8],true) is distinct from true then
  raise exception using errcode='42501',message='forbidden';
 end if;
 return new;
end $$;
