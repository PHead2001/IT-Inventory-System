-- Cleanup decisions use one real-time observation after the global guard and parent lock.
-- Keep the applied CP5 migrations intact; signatures, ownership and grants are retained.
create or replace function public.inventory_file_cleanup_status(p_parent_type text,p_parent_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare a uuid; outstanding bigint; blocked bigint; checked_at timestamptz;
begin
 a:=private.file_staff();
 perform private.file_guard_lock();
 perform private.file_parent_staff(p_parent_type,p_parent_id);
 checked_at:=clock_timestamp();
 -- Every undeleted object except a currently referenced ready object is relevant,
 -- including held pending bytes, terminal bytes in grace and another actor's lease.
 select count(*), count(*) filter(where o.cleanup_state='held' or
   (o.cleanup_state='claimed' and o.cleanup_actor<>a and o.cleanup_lease_until>checked_at) or
   (f.validation_lease_until is not null and f.validation_lease_until+interval '30 seconds'>=checked_at and f.state<>'removed'))
 into outstanding,blocked
 from private.file_objects o join public.inventory_files f on f.id=o.file_id
 where (p_parent_type='asset' and f.asset_id=p_parent_id or p_parent_type='quantity' and f.quantity_id=p_parent_id)
  and o.cleanup_state<>'deleted'
  and not (f.state='ready' and (o.variant='source' and f.purpose='asset_document' or o.variant<>'source' and o.generation=f.validation_generation));
 return jsonb_build_object('outstanding',outstanding,'blocked',blocked);
end $$;

create or replace function public.inventory_file_cleanup_claim_parent(p_parent_type text,p_parent_id uuid,p_limit integer,p_key_id text,p_nonce text,p_expires bigint,p_mac text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare a uuid; output jsonb; checked_at timestamptz; proof_key private.file_keys%rowtype;
begin
 a:=private.file_staff();
 if p_limit is null or p_limit not between 1 and 20 or p_key_id is null or p_nonce is null
  or p_expires is null or p_mac is null then raise exception using errcode='P1012',message='invalid_input'; end if;
 if private.file_server_proof(p_key_id,a,'cleanup_claim',p_parent_type||':'||p_parent_id::text||':'||p_limit::text||':'||p_key_id,
  p_nonce,p_expires,p_mac) is distinct from true then
  raise exception using errcode='P1001',message='server_proof_required'; end if;
 perform private.file_guard_lock();
 perform private.file_parent_staff(p_parent_type,p_parent_id);
 -- Keep the initial invalid-proof rejection, but authorize again after every wait.
 select * into proof_key from private.file_keys where key_id=p_key_id and accepts_new for share;
 if not found then raise exception using errcode='P1001',message='server_proof_required'; end if;
 -- The held-to-eligible update below can wait for an object row even while this
 -- caller owns the guard. Lock that parent-scoped set in a stable order first.
 perform 1 from private.file_objects o join public.inventory_files f on f.id=o.file_id
  where (p_parent_type='asset' and f.asset_id=p_parent_id or p_parent_type='quantity' and f.quantity_id=p_parent_id)
   and o.cleanup_state='held' order by o.id for update of o;
 checked_at:=clock_timestamp();
 if to_timestamp(p_expires)<=checked_at or
  to_timestamp(p_expires)>checked_at+interval '60 seconds' or
  proof_key.verify_until<=checked_at or
  private.file_mac(a::text||':cleanup_claim:'||p_parent_type||':'||p_parent_id::text||':'||p_limit::text||':'||p_key_id||':'||p_nonce||':'||p_expires,
   proof_key.secret) is distinct from p_mac then
  raise exception using errcode='P1001',message='server_proof_required'; end if;
 update public.inventory_files f set state='expired',version=version+1
 from (select id from public.inventory_files where
   (p_parent_type='asset' and asset_id=p_parent_id or p_parent_type='quantity' and quantity_id=p_parent_id) and (
   (state='reserved' and reserve_expires_at+interval '30 seconds'<checked_at) or
   (state='uploaded' and reserve_expires_at+interval '1 hour'<checked_at) or
   (state='validating' and validation_lease_until+interval '30 seconds'<checked_at) or
   (state='validated' and created_at+interval '24 hours'<checked_at)
  ) order by created_at limit p_limit for update skip locked) expired
 where f.id=expired.id;
 update private.file_objects o set cleanup_state='eligible'
 from public.inventory_files f where o.file_id=f.id and (p_parent_type='asset' and f.asset_id=p_parent_id or p_parent_type='quantity' and f.quantity_id=p_parent_id) and f.state='expired' and o.cleanup_state='held';
 -- Grace protects a bounded in-flight validation before another generation begins.
 update private.file_objects o set cleanup_state='claimed',cleanup_actor=a,
  cleanup_lease_until=checked_at+interval '2 minutes'
 from (select fo.id from private.file_objects fo join public.inventory_files f on f.id=fo.file_id
  where (p_parent_type='asset' and f.asset_id=p_parent_id or p_parent_type='quantity' and f.quantity_id=p_parent_id) and (fo.cleanup_state='eligible' or fo.cleanup_state='claimed' and fo.cleanup_lease_until<checked_at)
   and (f.state in ('removed','rejected','cancelled','expired') or
    f.state='ready' and fo.variant='source' and f.purpose<>'asset_document' or
    f.state='ready' and fo.variant<>'source' and fo.generation<>f.validation_generation or
    fo.cleanup_state='eligible' and fo.variant<>'source' and f.state in ('validating','validated'))
   and (f.validation_lease_until is null or f.validation_lease_until+interval '30 seconds'<checked_at or f.state='removed')
   and not exists(select 1 from public.inventory_files live where live.state='ready' and live.id=fo.file_id
    and (fo.variant='source' and live.purpose='asset_document' or
      fo.variant<>'source' and fo.generation=live.validation_generation))
  order by fo.created_at limit p_limit for update of fo skip locked) pick
 where o.id=pick.id;
 select coalesce(jsonb_agg(jsonb_build_object('object_id',claim.id,'path',claim.path)), '[]'::jsonb) into output
 from (select o.id,o.path from private.file_objects o join public.inventory_files f on f.id=o.file_id
   where (p_parent_type='asset' and f.asset_id=p_parent_id or p_parent_type='quantity' and f.quantity_id=p_parent_id) and o.cleanup_actor=a and o.cleanup_state='claimed' and o.cleanup_lease_until>checked_at
   order by o.created_at,o.id limit 20) claim;
 return output;
end $$;


create or replace function public.inventory_file_cleanup_confirm(p_object_id uuid,p_key_id text,p_nonce text,p_expires bigint,p_mac text) returns void
language plpgsql security definer set search_path='' as $$
declare a uuid; o private.file_objects%rowtype; f public.inventory_files%rowtype; checked_at timestamptz; proof_key private.file_keys%rowtype;
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
 if not found or o.cleanup_state<>'claimed' or o.cleanup_actor<>a then
  raise exception using errcode='P1001',message='forbidden'; end if;
 select * into proof_key from private.file_keys where key_id=p_key_id and accepts_new for share;
 checked_at:=clock_timestamp();
 if not found or to_timestamp(p_expires)<=checked_at or
  to_timestamp(p_expires)>checked_at+interval '60 seconds' or
  proof_key.verify_until<=checked_at or
  private.file_mac(a::text||':cleanup_confirm:'||p_object_id::text||':'||p_key_id||':'||p_nonce||':'||p_expires,
   proof_key.secret) is distinct from p_mac then
  raise exception using errcode='P1001',message='server_proof_required'; end if;
 if o.cleanup_lease_until<=checked_at then
  raise exception using errcode='P1001',message='forbidden'; end if;
 if exists(select 1 from storage.objects where bucket_id='inventory-files' and name=o.path) then
  raise exception using errcode='P1012',message='object_still_present'; end if;
 update private.file_objects set cleanup_state='deleted',deleted_at=checked_at,cleanup_actor=null,cleanup_lease_until=null where id=o.id;
end $$;

create or replace function private.file_storage_delete(p_bucket text,p_path text) returns boolean
language plpgsql volatile security definer set search_path='' as $$
declare o private.file_objects%rowtype; f public.inventory_files%rowtype; object_found boolean; checked_at timestamptz;
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
 object_found:=found;
 -- The staff check below locks membership; acquire that row before observing time.
 perform 1 from public.app_members where user_id=auth.uid() for share;
 checked_at:=clock_timestamp();
 return object_found and o.cleanup_state='claimed' and o.cleanup_actor=auth.uid()
  and o.cleanup_lease_until>checked_at and private.file_staff()=auth.uid()
  and (f.state in ('removed','rejected','cancelled','expired') or
   f.state='ready' and o.variant='source' and f.purpose<>'asset_document' or
   f.state='ready' and o.variant<>'source' and o.generation<>f.validation_generation
    and f.validation_lease_until+interval '30 seconds'<checked_at or
   f.state in ('validating','validated') and o.variant<>'source' and
    f.validation_lease_until+interval '30 seconds'<checked_at)
  and not (f.state='ready' and (o.variant='source' and f.purpose='asset_document' or
   o.variant<>'source' and o.generation=f.validation_generation));
end $$;
