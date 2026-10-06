-- Require matching caller-bound server/DB readiness before fresh reservation.
-- Scope every cleanup phase to the authorized parent; never maintain unrelated records.
create function private.file_parent_staff(p_parent_type text,p_parent_id uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
 perform private.file_staff();
 if p_parent_type is null or p_parent_type not in ('asset','quantity') or p_parent_id is null then
  raise exception using errcode='P1012',message='invalid_input'; end if;
 if p_parent_type='asset' then
  perform 1 from public.serialized_assets where id=p_parent_id for share;
 else
  perform 1 from public.quantity_items where id=p_parent_id for share;
 end if;
 if not found then raise exception using errcode='P1010',message='not_found'; end if;
end $$;

create function private.file_reserve_ready(p_parent_type text,p_parent_id uuid,p_expected_revision bigint,
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
revoke all on function private.file_reserve_ready(text,uuid,bigint,text,text,bigint,uuid,bigint) from public,anon,authenticated,service_role;

create or replace function public.inventory_file_reserve(p_parent_type text,p_parent_id uuid,p_expected_revision bigint,
 p_name text,p_type text,p_bytes bigint,p_replaces uuid default null,p_expected_file_version bigint default null) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
 perform private.file_staff();
 raise exception using errcode='P1014',message='file_upload_requires_current_application';
end $$;

create function public.inventory_file_reserve_ready(p_parent_type text,p_parent_id uuid,p_expected_revision bigint,
 p_name text,p_type text,p_bytes bigint,p_replaces uuid,p_expected_file_version bigint,
 p_key_id text,p_nonce text,p_expires bigint,p_mac text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare a uuid; signed text; checked_at timestamptz;
begin
 a:=private.file_staff();
 perform private.file_guard_lock();
 perform private.file_parent_staff(p_parent_type,p_parent_id);
 if p_expected_revision is null or p_expected_revision<1 or p_name is null or
  length(btrim(p_name)) not between 1 and 200 or p_name<>btrim(p_name) or p_name ~ '[[:cntrl:]/\\]' or
  p_type is null or p_type not in ('image/jpeg','image/png','image/webp','application/pdf') or
  p_bytes is null or p_bytes not between 1 and 20971520 or
  ((p_replaces is null) <> (p_expected_file_version is null)) or
  (p_expected_file_version is not null and p_expected_file_version<1) then
  raise exception using errcode='P1012',message='invalid_input'; end if;
 -- Name is UTF8 hex so delimiters cannot make distinct business payloads collide.
 signed:=p_parent_type||':'||p_parent_id::text||':'||p_expected_revision::text||':'||
  encode(convert_to(p_name,'UTF8'),'hex')||':'||p_type||':'||p_bytes::text||':'||
  coalesce(p_replaces::text,'-')||':'||coalesce(p_expected_file_version::text,'-')||':'||p_key_id;
 perform 1 from private.file_keys where key_id=p_key_id and accepts_new and verify_until>clock_timestamp() for share;
 checked_at:=clock_timestamp();
 if not found or p_expires is null or to_timestamp(p_expires)<=checked_at or
  not exists(select 1 from private.file_keys where key_id=p_key_id and accepts_new and verify_until>checked_at) or
  private.file_server_proof(p_key_id,a,'reserve',signed,p_nonce,p_expires,p_mac) is distinct from true then
  raise exception using errcode='P1013',message='file_validation_unavailable'; end if;
 return private.file_reserve_ready(p_parent_type,p_parent_id,p_expected_revision,p_name,p_type,p_bytes,p_replaces,p_expected_file_version);
end $$;

create function public.inventory_file_cleanup_status(p_parent_type text,p_parent_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare a uuid; outstanding bigint; blocked bigint;
begin
 a:=private.file_staff();
 perform private.file_guard_lock();
 perform private.file_parent_staff(p_parent_type,p_parent_id);
 -- Every undeleted object except a currently referenced ready object is relevant,
 -- including held pending bytes, terminal bytes in grace and another actor's lease.
 select count(*), count(*) filter(where o.cleanup_state='held' or
   (o.cleanup_state='claimed' and o.cleanup_actor<>a and o.cleanup_lease_until>now()) or
   (f.validation_lease_until is not null and f.validation_lease_until+interval '30 seconds'>=now() and f.state<>'removed'))
 into outstanding,blocked
 from private.file_objects o join public.inventory_files f on f.id=o.file_id
 where (p_parent_type='asset' and f.asset_id=p_parent_id or p_parent_type='quantity' and f.quantity_id=p_parent_id)
  and o.cleanup_state<>'deleted'
  and not (f.state='ready' and (o.variant='source' and f.purpose='asset_document' or o.variant<>'source' and o.generation=f.validation_generation));
 return jsonb_build_object('outstanding',outstanding,'blocked',blocked);
end $$;

create function public.inventory_file_cleanup_claim_parent(p_parent_type text,p_parent_id uuid,p_limit integer,p_key_id text,p_nonce text,p_expires bigint,p_mac text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare a uuid; output jsonb;
begin
 a:=private.file_staff();
 if p_limit is null or p_limit not between 1 and 20 or p_key_id is null or p_nonce is null
  or p_expires is null or p_mac is null then raise exception using errcode='P1012',message='invalid_input'; end if;
 if private.file_server_proof(p_key_id,a,'cleanup_claim',p_parent_type||':'||p_parent_id::text||':'||p_limit::text||':'||p_key_id,
  p_nonce,p_expires,p_mac) is distinct from true then
  raise exception using errcode='P1001',message='server_proof_required'; end if;
 perform private.file_guard_lock();
 perform private.file_parent_staff(p_parent_type,p_parent_id);
 update public.inventory_files f set state='expired',version=version+1
 from (select id from public.inventory_files where
   (p_parent_type='asset' and asset_id=p_parent_id or p_parent_type='quantity' and quantity_id=p_parent_id) and (
   (state='reserved' and reserve_expires_at+interval '30 seconds'<now()) or
   (state='uploaded' and reserve_expires_at+interval '1 hour'<now()) or
   (state='validating' and validation_lease_until+interval '30 seconds'<now()) or
   (state='validated' and created_at+interval '24 hours'<now())
  ) order by created_at limit p_limit for update skip locked) expired
 where f.id=expired.id;
 update private.file_objects o set cleanup_state='eligible'
 from public.inventory_files f where o.file_id=f.id and (p_parent_type='asset' and f.asset_id=p_parent_id or p_parent_type='quantity' and f.quantity_id=p_parent_id) and f.state='expired' and o.cleanup_state='held';
 -- Grace protects a bounded in-flight validation before another generation begins.
 update private.file_objects o set cleanup_state='claimed',cleanup_actor=a,
  cleanup_lease_until=now()+interval '2 minutes'
 from (select fo.id from private.file_objects fo join public.inventory_files f on f.id=fo.file_id
  where (p_parent_type='asset' and f.asset_id=p_parent_id or p_parent_type='quantity' and f.quantity_id=p_parent_id) and (fo.cleanup_state='eligible' or fo.cleanup_state='claimed' and fo.cleanup_lease_until<now())
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
 from (select o.id,o.path from private.file_objects o join public.inventory_files f on f.id=o.file_id
   where (p_parent_type='asset' and f.asset_id=p_parent_id or p_parent_type='quantity' and f.quantity_id=p_parent_id) and o.cleanup_actor=a and o.cleanup_state='claimed' and o.cleanup_lease_until>now()
   order by o.created_at,o.id limit 20) claim;
 return output;
end $$;

-- Retain the legacy signature only to give old applications a safe upgrade error.
create or replace function public.inventory_file_cleanup_claim(p_limit integer,p_key_id text,p_nonce text,p_expires bigint,p_mac text) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
 perform private.file_staff();
 raise exception using errcode='P1014',message='file_cleanup_requires_current_application';
end $$;
revoke all on function private.file_parent_staff(text,uuid) from public,anon,authenticated,service_role;
revoke all on function public.inventory_file_reserve_ready(text,uuid,bigint,text,text,bigint,uuid,bigint,text,text,bigint,text),
 public.inventory_file_cleanup_status(text,uuid),public.inventory_file_cleanup_claim_parent(text,uuid,integer,text,text,bigint,text)
 from public,anon,authenticated,service_role;
grant execute on function public.inventory_file_reserve_ready(text,uuid,bigint,text,text,bigint,uuid,bigint,text,text,bigint,text),
 public.inventory_file_cleanup_status(text,uuid),public.inventory_file_cleanup_claim_parent(text,uuid,integer,text,text,bigint,text) to authenticated;
