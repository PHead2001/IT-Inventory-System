-- A live allocation covers its source and current-generation derivatives once.
-- Obsolete generations retain independent charges until confirmed deletion.
-- Callers retain file_guard and pass their single captured wall clock.
create or replace function private.file_staging_bytes(p_checked_at timestamptz)
returns bigint language sql volatile strict set search_path='' as $$
 with charged as (
  select f.id,f.state,f.purpose,f.validation_generation,
   private.file_pending_active(f,p_checked_at) or coalesce(
    f.state in ('rejected','cancelled','expired') and f.validation_lease_until is not null
    and f.validation_lease_until+interval '30 seconds'>=p_checked_at,false) as allocation
  from public.inventory_files f
 ), bytes as (
  select f.*,
   coalesce(sum(o.bytes) filter(where o.variant='source' or o.generation=f.validation_generation),0) as current_bytes,
   coalesce(sum(o.bytes) filter(where o.variant<>'source' and o.generation<>f.validation_generation),0) as obsolete_bytes,
   coalesce(sum(o.bytes) filter(where f.state not in ('ready','removed') or o.cleanup_state in ('eligible','claimed')),0) as retained_bytes
  from charged f left join private.file_objects o on o.file_id=f.id and o.cleanup_state<>'deleted'
  group by f.id,f.state,f.purpose,f.validation_generation,f.allocation
 )
 select coalesce(sum(case when allocation then
  greatest(case when purpose='asset_document' then 20971520 else 62914560 end,current_bytes)+obsolete_bytes
  else retained_bytes end),0)::bigint from bytes;
$$;
revoke all on function private.file_staging_bytes(timestamptz) from public,anon,authenticated,service_role;
