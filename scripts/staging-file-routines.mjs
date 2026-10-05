// Reviewed observation-time CP5 closure; never discover additional routines from
// a hosted catalog. Changes to this list and its generated manifest need review.
export const STAGING_ROUTINE_ALLOWLIST = Object.freeze(
  [
    ['private.file_parent_staff(text,uuid)', false],
    [
      'private.file_reserve_ready(text,uuid,bigint,text,text,bigint,uuid,bigint)',
      false,
    ],
    [
      'public.inventory_file_reserve(text,uuid,bigint,text,text,bigint,uuid,bigint)',
      true,
    ],
    [
      'public.inventory_file_reserve_ready(text,uuid,bigint,text,text,bigint,uuid,bigint,text,text,bigint,text)',
      true,
    ],
    ['public.inventory_file_cleanup_status(text,uuid)', true],
    [
      'public.inventory_file_cleanup_claim_parent(text,uuid,integer,text,text,bigint,text)',
      true,
    ],
    [
      'public.inventory_file_cleanup_claim(integer,text,text,bigint,text)',
      true,
    ],
    ['private.file_pending_active(public.inventory_files,timestamptz)', false],
    ['private.file_staging_bytes(timestamptz)', false],
    ['public.inventory_file_begin(uuid,uuid,text,text,bigint,text)', true],
    [
      'public.inventory_file_prepare_variant(uuid,integer,text,text,bigint,text,text)',
      true,
    ],
    ['public.inventory_file_uploaded(uuid)', true],
    ['public.inventory_file_finalize(uuid,bigint,uuid)', true],
    ['public.inventory_file_review(uuid,bigint,bigint)', true],
    [
      'public.inventory_file_register(uuid,integer,text,text,uuid,bigint,text,text)',
      true,
    ],
    ['public.inventory_file_source_details(uuid)', true],
    ['public.inventory_file_reject(uuid,integer,text,text,bigint,text)', true],
    ['public.inventory_file_active_key()', true],
    [
      'public.inventory_file_validated(uuid,integer,text,uuid,text,text,bigint,text,text)',
      true,
    ],
    ['private.file_staff()', false],
    ['private.file_member()', false],
    ['private.file_storage_select(text,text)', true],
    ['private.file_guard_lock()', false],
    ['private.file_collection_lock(uuid,uuid)', false],
    ['private.file_server_proof(text,uuid,text,text,text,bigint,text)', false],
    ['private.file_signature_valid(text,text,text,boolean)', false],
    ['private.file_mac(text,text)', false],
    [
      'private.file_attestation_message(public.inventory_files,uuid,text,text,bigint,text)',
      false,
    ],
    ['private.file_storage_insert(text,text)', true],
    ['public.inventory_file_cleanup_confirm(uuid,text,text,bigint,text)', true],
    ['private.file_storage_delete(text,text)', true],
  ].map(([signature, authenticated]) =>
    Object.freeze({ signature, authenticated }),
  ),
);

// Reviewed canonical migration owner, represented by name rather than local OID.
export const STAGING_ROUTINE_OWNER = 'postgres';

const literal = (value) => `'${value.replaceAll("'", "''")}'`;
// Only CRLF is normalized: whitespace, comments and literals otherwise remain
// exact. OIDs, owner IDs and pg_get_functiondef presentation are not portable.
export const STAGING_ROUTINE_CATALOG_CTE = `required(signature,authenticated) as (values
  ${STAGING_ROUTINE_ALLOWLIST.map((row) => `(${literal(row.signature)},${row.authenticated})`).join(',\n  ')}
), catalog as (
  select required.signature,pg_catalog.jsonb_build_object(
    'signature',required.signature,
    'owner',owner.rolname,
    'acl',(select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'grantee',case when acl.grantee=0 then 'PUBLIC' else grantee.rolname end,
      'grantor',grantor.rolname,'privilege',acl.privilege_type,'grantable',acl.is_grantable)
      order by case when acl.grantee=0 then 'PUBLIC' else grantee.rolname end collate "C",
        grantor.rolname collate "C",acl.privilege_type collate "C",acl.is_grantable)
      from pg_catalog.aclexplode(coalesce(p.proacl,pg_catalog.acldefault('f',p.proowner))) acl
      left join pg_catalog.pg_roles grantee on grantee.oid=acl.grantee
      left join pg_catalog.pg_roles grantor on grantor.oid=acl.grantor),
    'language',l.lanname,'kind',p.prokind,
    'return_schema',tn.nspname,'return_type',t.typname,'returns_set',p.proretset,
    'security_definer',p.prosecdef,'volatility',p.provolatile,'strict',p.proisstrict,
    'argument_names',p.proargnames,'argument_modes',p.proargmodes,
    'default_count',p.pronargdefaults,'defaults',pg_catalog.pg_get_expr(p.proargdefaults,0),
    'config',p.proconfig,
    'body_sha256',pg_catalog.encode(extensions.digest(pg_catalog.convert_to(pg_catalog.replace(p.prosrc,E'\\r\\n',E'\\n'),'UTF8'),'sha256'),'hex'),
    'external_body',p.probin is not null or p.prosqlbody is not null,
    'authenticated_execute',pg_catalog.has_function_privilege('authenticated',p.oid,'EXECUTE'),
    'anon_execute',pg_catalog.has_function_privilege('anon',p.oid,'EXECUTE'),
    'service_execute',pg_catalog.has_function_privilege('service_role',p.oid,'EXECUTE'),
    'public_execute',exists(select 1 from pg_catalog.aclexplode(coalesce(p.proacl,pg_catalog.acldefault('f',p.proowner))) acl where acl.grantee=0)
  ) as routine
  from required left join pg_catalog.pg_proc p on p.oid=pg_catalog.to_regprocedure(required.signature)
  left join pg_catalog.pg_roles owner on owner.oid=p.proowner
  left join pg_catalog.pg_language l on l.oid=p.prolang
  left join pg_catalog.pg_type t on t.oid=p.prorettype left join pg_catalog.pg_namespace tn on tn.oid=t.typnamespace
)`;
export const STAGING_ROUTINE_CATALOG_SQL = `with ${STAGING_ROUTINE_CATALOG_CTE} select routine from catalog order by signature`;

export function assertStagingRoutineManifest(manifest) {
  if (
    manifest?.version !== 2 ||
    !Array.isArray(manifest.routines) ||
    manifest.routines.length !== STAGING_ROUTINE_ALLOWLIST.length
  )
    throw new Error('Invalid staging routine manifest');
  const rows = new Map(manifest.routines.map((row) => [row.signature, row]));
  if (rows.size !== STAGING_ROUTINE_ALLOWLIST.length)
    throw new Error('Invalid staging routine manifest');
  for (const { signature, authenticated } of STAGING_ROUTINE_ALLOWLIST) {
    const row = rows.get(signature);
    if (
      !row ||
      row.owner !== STAGING_ROUTINE_OWNER ||
      !Array.isArray(row.acl) ||
      row.acl.length !== (authenticated ? 2 : 1) ||
      row.acl.some(
        (entry, index) =>
          !entry ||
          Object.keys(entry).length !== 4 ||
          entry.grantee !==
            (authenticated
              ? ['authenticated', STAGING_ROUTINE_OWNER]
              : [STAGING_ROUTINE_OWNER])[index] ||
          entry.grantor !== STAGING_ROUTINE_OWNER ||
          entry.privilege !== 'EXECUTE' ||
          entry.grantable !== false,
      ) ||
      !/^[a-f0-9]{64}$/.test(row.body_sha256 ?? '') ||
      !['sql', 'plpgsql'].includes(row.language) ||
      row.kind !== 'f' ||
      row.external_body !== false ||
      row.authenticated_execute !== authenticated ||
      row.anon_execute !== false ||
      row.service_execute !== false ||
      row.public_execute !== false ||
      JSON.stringify(row.config) !== JSON.stringify(['search_path=""'])
    )
      throw new Error('Invalid staging routine manifest');
  }
  return manifest;
}

export function stagingRoutineComparisonSql(manifest) {
  assertStagingRoutineManifest(manifest);
  return `not exists(select 1 from catalog left join pg_catalog.jsonb_array_elements(${literal(JSON.stringify(manifest.routines))}::jsonb) expected
    on expected->>'signature'=catalog.signature where catalog.routine is distinct from expected)`;
}
