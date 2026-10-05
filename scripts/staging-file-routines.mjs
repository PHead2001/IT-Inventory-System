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
    ['private.inventory_file_storage_completion_guard()', false],
    ['public.inventory_file_cancel(uuid)', true],
    ['public.inventory_file_remove(uuid,bigint,bigint,uuid)', true],
    ['public.inventory_file_rename(uuid,bigint,bigint,text,uuid)', true],
    ['public.inventory_file_read(uuid,text)', true],
    ['public.inventory_file_cards(text,uuid)', true],
    ['public.inventory_file_history(text,uuid,integer)', true],
    ['public.inventory_file_list_thumbnails(uuid[],uuid[])', true],
    ['storage.protect_delete()', true],
    ['storage.update_updated_at_column()', true],
    ['storage.allow_any_operation(text[])', true],
    ['storage.operation()', true],
  ].map(([signature, authenticated]) =>
    Object.freeze({ signature, authenticated }),
  ),
);

// Reviewed canonical migration owner, represented by name rather than local OID.
export const STAGING_ROUTINE_OWNER = 'postgres';

// Reviewed provider source: supabase/storage tag v1.77.9, tenant migrations
// 0011, 0024, 0055 and 0058. These four signatures alone retain provider ACLs.
export const STAGING_STORAGE_PROVIDER_BASELINE = Object.freeze(
  [
    {
      signature: 'storage.protect_delete()',
      language: 'plpgsql',
      volatility: 'v',
      return_type: 'trigger',
      argument_names: null,
      source: '0055-prevent-direct-deletes.sql',
      body_sha256:
        '8c757b3898456c92b28f30e15cdeadb43ff4522c0b9f0526100da3a34b174236',
    },
    {
      signature: 'storage.update_updated_at_column()',
      language: 'plpgsql',
      volatility: 'v',
      return_type: 'trigger',
      argument_names: null,
      source: '0011-add-trigger-to-auto-update-updated_at-column.sql',
      body_sha256:
        '1e0582c796d58810ca3d1066e97ce7f4a5d55e4174b8185ff8aebe14e61f424f',
    },
    {
      signature: 'storage.allow_any_operation(text[])',
      language: 'sql',
      volatility: 's',
      return_type: 'bool',
      argument_names: ['expected_operations'],
      source: '0058-operation-ergonomics.sql',
      body_sha256:
        'c54409510ad2ecf68bd6b7da4a526f2d51ecba75d4ff6529dc6f1cc3a72774d6',
    },
    {
      signature: 'storage.operation()',
      language: 'plpgsql',
      volatility: 's',
      return_type: 'text',
      argument_names: null,
      source: '0024-operation-function.sql',
      body_sha256:
        'b211a4c4b376b7bd1c50cc5fd2876824c7b639717e6e0d6484482411bebc34af',
    },
  ].map(Object.freeze),
);

// Complete reviewed noninternal INSERT/UPDATE/DELETE/TRUNCATE trigger set.
export const STAGING_STORAGE_TRIGGER = Object.freeze({
  table_schema: 'storage',
  table_name: 'objects',
  name: 'inventory_file_storage_completion_guard',
  routine: 'private.inventory_file_storage_completion_guard()',
  type: 23, // ROW | BEFORE | INSERT | UPDATE.
  enabled: 'O',
  internal: false,
  has_condition: false,
  columns_empty: true,
  argument_count: 0,
  arguments_empty: true,
  has_parent: false,
  has_constraint: false,
  has_constraint_relation: false,
  has_constraint_index: false,
  deferrable: false,
  initially_deferred: false,
  has_old_transition_table: false,
  has_new_transition_table: false,
});
export const STAGING_STORAGE_TRIGGERS = Object.freeze([
  STAGING_STORAGE_TRIGGER,
  Object.freeze({
    ...STAGING_STORAGE_TRIGGER,
    name: 'protect_objects_delete',
    routine: 'storage.protect_delete()',
    type: 10,
  }),
  Object.freeze({
    ...STAGING_STORAGE_TRIGGER,
    name: 'update_objects_updated_at',
    routine: 'storage.update_updated_at_column()',
    type: 19,
  }),
]);
export const STAGING_STORAGE_POLICIES = Object.freeze(
  [
    {
      name: 'inventory_file_cleanup_select',
      command: 'r',
      permissive: true,
      roles: ['authenticated'],
      using_expression:
        "(private.file_storage_delete(bucket_id, name) AND storage.allow_any_operation(ARRAY['object.delete'::text, 'object.delete_many'::text]))",
      check_expression: null,
    },
    {
      name: 'inventory_file_delete',
      command: 'd',
      permissive: true,
      roles: ['authenticated'],
      using_expression: 'private.file_storage_delete(bucket_id, name)',
      check_expression: null,
    },
    {
      name: 'inventory_file_insert',
      command: 'a',
      permissive: true,
      roles: ['authenticated'],
      using_expression: null,
      check_expression: 'private.file_storage_insert(bucket_id, name)',
    },
    {
      name: 'inventory_file_select',
      command: 'r',
      permissive: true,
      roles: ['authenticated'],
      using_expression:
        "(private.file_storage_select(bucket_id, name) AND storage.allow_any_operation(ARRAY['object.get_authenticated'::text, 'object.get_authenticated_info'::text, 'object.head_authenticated_info'::text]))",
      check_expression: null,
    },
  ].map(Object.freeze),
);

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

export const STAGING_TRIGGER_CATALOG_CTE = `trigger_catalog as (
  select pg_catalog.jsonb_build_object(
    'table_schema',n.nspname,'table_name',c.relname,'name',t.tgname,
    'routine',case ${STAGING_STORAGE_TRIGGERS.map((row) => `when t.tgfoid=pg_catalog.to_regprocedure(${literal(row.routine)}) then ${literal(row.routine)}`).join(' ')} else null end,
    'type',t.tgtype,'enabled',t.tgenabled,'internal',t.tgisinternal,
    'has_condition',t.tgqual is not null,'columns_empty',t.tgattr=''::pg_catalog.int2vector,
    'argument_count',t.tgnargs,'arguments_empty',t.tgargs=''::pg_catalog.bytea,
    'has_parent',t.tgparentid<>0,'has_constraint',t.tgconstraint<>0,
    'has_constraint_relation',t.tgconstrrelid<>0,'has_constraint_index',t.tgconstrindid<>0,
    'deferrable',t.tgdeferrable,'initially_deferred',t.tginitdeferred,
    'has_old_transition_table',t.tgoldtable is not null,'has_new_transition_table',t.tgnewtable is not null
  ) binding
  from (values (1)) required(dummy)
  left join pg_catalog.pg_namespace n on n.nspname=${literal(STAGING_STORAGE_TRIGGER.table_schema)}
  left join pg_catalog.pg_class c on c.relnamespace=n.oid and c.relname=${literal(STAGING_STORAGE_TRIGGER.table_name)}
  left join pg_catalog.pg_trigger t on t.tgrelid=c.oid and not t.tgisinternal and (t.tgtype & 60)<>0
)`;
export const STAGING_TRIGGER_CATALOG_SQL = `with ${STAGING_TRIGGER_CATALOG_CTE} select binding from trigger_catalog order by binding->>'name' collate "C"`;

// Materialized context is evaluated before expression deparsing. Only a
// transaction-local safe path is set; caller schema visibility cannot rewrite
// portable textual policy expressions or choose a different helper.
export const STAGING_STORAGE_CATALOG_CTE = `contract_context as materialized (
  select pg_catalog.set_config('search_path','pg_catalog',true) as path
), storage_catalog as (
  select pg_catalog.jsonb_build_object(
    'table_schema',n.nspname,'table_name',c.relname,
    'row_security',c.relrowsecurity,'force_row_security',c.relforcerowsecurity,
    'policies',coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'name',p.polname,'command',p.polcmd,'permissive',p.polpermissive,
      'roles',array(select role_name from (select case when roleid=0 then 'PUBLIC' else r.rolname::text end role_name
        from pg_catalog.unnest(p.polroles) roleid left join pg_catalog.pg_roles r on r.oid=roleid) role_names order by role_name collate "C"),
      'using_expression',pg_catalog.pg_get_expr(p.polqual,p.polrelid,false),
      'check_expression',pg_catalog.pg_get_expr(p.polwithcheck,p.polrelid,false)) order by p.polname collate "C")
      from pg_catalog.pg_policy p where p.polrelid=c.oid),'[]'::jsonb)
  ) storage_contract
  from contract_context cross join (values (1)) required(dummy)
  left join pg_catalog.pg_namespace n on n.nspname='storage'
  left join pg_catalog.pg_class c on c.relnamespace=n.oid and c.relname='objects'
)`;
export const STAGING_STORAGE_CATALOG_SQL = `with ${STAGING_STORAGE_CATALOG_CTE} select storage_contract from storage_catalog`;

const sameFields = (actual, expected) =>
  actual &&
  Object.keys(actual).length === Object.keys(expected).length &&
  Object.entries(expected).every(
    ([field, value]) => JSON.stringify(actual[field]) === JSON.stringify(value),
  );

export function assertStagingRoutineManifest(manifest) {
  if (
    manifest?.version !== 4 ||
    !Array.isArray(manifest.routines) ||
    manifest.routines.length !== STAGING_ROUTINE_ALLOWLIST.length
  )
    throw new Error('Invalid staging routine manifest');
  if (
    !Array.isArray(manifest.triggers) ||
    manifest.triggers.length !== STAGING_STORAGE_TRIGGERS.length ||
    STAGING_STORAGE_TRIGGERS.some(
      (expected, index) => !sameFields(manifest.triggers[index], expected),
    )
  )
    throw new Error('Invalid staging trigger manifest');
  if (
    !manifest.storage ||
    Object.keys(manifest.storage).length !== 5 ||
    manifest.storage.table_schema !== 'storage' ||
    manifest.storage.table_name !== 'objects' ||
    manifest.storage.row_security !== true ||
    manifest.storage.force_row_security !== false ||
    !Array.isArray(manifest.storage.policies) ||
    manifest.storage.policies.length !== STAGING_STORAGE_POLICIES.length ||
    STAGING_STORAGE_POLICIES.some(
      (expected, index) =>
        !sameFields(manifest.storage.policies[index], expected),
    )
  )
    throw new Error('Invalid staging Storage authorization manifest');
  const rows = new Map(manifest.routines.map((row) => [row.signature, row]));
  if (rows.size !== STAGING_ROUTINE_ALLOWLIST.length)
    throw new Error('Invalid staging routine manifest');
  for (const { signature, authenticated } of STAGING_ROUTINE_ALLOWLIST) {
    const row = rows.get(signature);
    const provider = STAGING_STORAGE_PROVIDER_BASELINE.find(
      (entry) => entry.signature === signature,
    );
    const owner = provider ? 'supabase_storage_admin' : STAGING_ROUTINE_OWNER;
    const grantees = provider
      ? ['PUBLIC', owner]
      : authenticated
        ? ['authenticated', owner]
        : [owner];
    if (
      !row ||
      row.owner !== owner ||
      !Array.isArray(row.acl) ||
      row.acl.length !== grantees.length ||
      row.acl.some(
        (entry, index) =>
          !entry ||
          Object.keys(entry).length !== 4 ||
          entry.grantee !== grantees[index] ||
          entry.grantor !== owner ||
          entry.privilege !== 'EXECUTE' ||
          entry.grantable !== false,
      ) ||
      !/^[a-f0-9]{64}$/.test(row.body_sha256 ?? '') ||
      !['sql', 'plpgsql'].includes(row.language) ||
      row.kind !== 'f' ||
      row.external_body !== false ||
      row.authenticated_execute !== authenticated ||
      row.anon_execute !== !!provider ||
      row.service_execute !== !!provider ||
      row.public_execute !== !!provider ||
      JSON.stringify(row.config) !==
        JSON.stringify(provider ? null : ['search_path=""']) ||
      (provider &&
        (row.security_definer !== false ||
          row.strict !== false ||
          row.default_count !== 0 ||
          row.defaults !== null ||
          row.argument_modes !== null ||
          row.return_schema !== 'pg_catalog' ||
          row.returns_set !== false ||
          [
            'language',
            'volatility',
            'return_type',
            'body_sha256',
            'argument_names',
          ].some(
            (field) =>
              JSON.stringify(row[field]) !== JSON.stringify(provider[field]),
          )))
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

export function stagingTriggerComparisonSql(manifest) {
  assertStagingRoutineManifest(manifest);
  return `(select pg_catalog.jsonb_agg(binding order by binding->>'name' collate "C") from trigger_catalog)=${literal(JSON.stringify(manifest.triggers))}::jsonb`;
}

export function stagingStorageComparisonSql(manifest) {
  assertStagingRoutineManifest(manifest);
  return `(select storage_contract from storage_catalog)=${literal(JSON.stringify(manifest.storage))}::jsonb`;
}
export const STAGING_FILE_API_COMPARISON_SQL = `not exists(select 1 from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and pg_catalog.starts_with(p.proname,'inventory_file_') and p.oid not in (${STAGING_ROUTINE_ALLOWLIST.filter(
  (row) => row.signature.startsWith('public.inventory_file_'),
)
  .map((row) => `pg_catalog.to_regprocedure(${literal(row.signature)})`)
  .join(',')}))`;
