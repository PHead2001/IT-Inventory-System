import {
  fileProviders,
  boundedJsonRequest,
} from './preview-file-providers.mjs';
import { fingerprint } from './preview-file-keys.mjs';
import { PreviewAccessError } from './preview-access-core.mjs';
import { STAGING_REF, PRODUCTION_REF } from './staging-user-sync-core.mjs';
import {
  STAGING_PINS,
  STAGING_KEY_ID,
  parseStagingIntent,
} from './staging-file-keys.mjs';

const fail = (code) => {
  throw new PreviewAccessError(code, 'Staging file provider refused');
};
export function migrationRevision(rows) {
  if (
    !Array.isArray(rows) ||
    !rows.length ||
    rows.length > 1000 ||
    rows.some((row) => !/^\d{14}$/.test(row?.version ?? '')) ||
    new Set(rows.map((row) => row.version)).size !== rows.length
  )
    fail('STAGING_MIGRATION_DENIED');
  return fingerprint(JSON.stringify(rows.map((row) => row.version).sort()));
}

export const STAGING_FILE_MIGRATIONS = Object.freeze([
  '20261005142029',
  '20261005153057',
]);
// Migration history alone is insufficient: the current RPC/permission contract
// must also be present before a validator secret can enable file operations.
export const STAGING_SCHEMA_SQL = `with required(signature,authenticated,return_type) as (values
  ('private.file_parent_staff(text,uuid)',false,'void'),
  ('private.file_reserve_ready(text,uuid,bigint,text,text,bigint,uuid,bigint)',false,'jsonb'),
  ('public.inventory_file_reserve_ready(text,uuid,bigint,text,text,bigint,uuid,bigint,text,text,bigint,text)',true,'jsonb'),
  ('public.inventory_file_cleanup_status(text,uuid)',true,'jsonb'),
  ('public.inventory_file_cleanup_claim_parent(text,uuid,integer,text,text,bigint,text)',true,'jsonb')
), routines as (
  select required.*,p.* from required left join pg_proc p on p.oid=to_regprocedure(required.signature)
), legacy(signature,message) as (values
  ('public.inventory_file_reserve(text,uuid,bigint,text,text,bigint,uuid,bigint)','file_upload_requires_current_application'),
  ('public.inventory_file_cleanup_claim(integer,text,text,bigint,text)','file_cleanup_requires_current_application')
)
select (
  (select count(*)=${STAGING_FILE_MIGRATIONS.length} from supabase_migrations.schema_migrations where version in (${STAGING_FILE_MIGRATIONS.map((version) => `'${version}'`).join(',')}))
  and (select coalesce(bool_and(oid is not null and prosecdef and prorettype=to_regtype(return_type)
    and exists(select 1 from unnest(proconfig) setting where setting in ('search_path=""','search_path='))
    and has_function_privilege('authenticated',oid,'EXECUTE')=authenticated
    and not has_function_privilege('anon',oid,'EXECUTE')
    and not has_function_privilege('service_role',oid,'EXECUTE')
    and not exists(select 1 from aclexplode(coalesce(proacl,acldefault('f',proowner))) acl where acl.grantee=0)),false) from routines)
  and not exists(select 1 from legacy left join pg_proc p on p.oid=to_regprocedure(legacy.signature)
    where p.oid is null or regexp_replace(p.prosrc,'[[:space:]]','','g') is distinct from
      'beginperformprivate.file_staff();raiseexceptionusingerrcode=''P1014'',message='''||legacy.message||''';end')
) as ready`;

// Runtime/current alias observations come from the caller's supported verified
// host tooling. This module does not manufacture runtime proof from env metadata.
export function stagingFileProviders({
  managementToken,
  vercelToken,
  currentDeployment,
  runtimeBinding,
  request = boundedJsonRequest,
}) {
  if (
    typeof currentDeployment !== 'function' ||
    typeof runtimeBinding !== 'function'
  )
    fail('STAGING_RUNTIME_ADAPTER_REQUIRED');
  const shared = fileProviders({
    managementToken,
    vercelToken,
    pins: STAGING_PINS,
    request,
  });
  const query = (queryText) =>
    request(
      `https://api.supabase.com/v1/projects/${STAGING_REF}/database/query`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${managementToken}`,
          'Content-Type': 'application/json',
        },
        body: { query: queryText, parameters: [], read_only: true },
      },
    );
  const api = (path, method = 'GET', body) =>
    request(
      `https://api.vercel.com${path}${path.includes('?') ? '&' : '?'}teamId=${encodeURIComponent(STAGING_PINS.teamId)}`,
      {
        method,
        body,
        headers: {
          Authorization: `Bearer ${vercelToken}`,
          'Content-Type': 'application/json',
        },
      },
    );
  const pinned =
    (fn) =>
    (child, ...args) => {
      if (child !== STAGING_REF) fail('STAGING_DATABASE_TARGET');
      return fn(child, ...args);
    };
  const ownedKey = (fn) =>
    pinned((child, id, ...args) => {
      if (id !== STAGING_KEY_ID) fail('STAGING_KEY_TARGET');
      return fn(child, id, ...args);
    });
  return {
    management: {
      branches: (parent) => {
        if (parent !== PRODUCTION_REF) fail('STAGING_PARENT_DENIED');
        return request(
          `https://api.supabase.com/v1/projects/${PRODUCTION_REF}/branches`,
          { headers: { Authorization: `Bearer ${managementToken}` } },
        );
      },
      keys: pinned((child) =>
        request(
          `https://api.supabase.com/v1/projects/${child}/api-keys?reveal=true`,
          { headers: { Authorization: `Bearer ${managementToken}` } },
        ),
      ),
    },
    database: {
      ...Object.fromEntries(
        Object.entries(shared.database).map(([name, fn]) => [
          name,
          name === 'schema' ? pinned(fn) : ownedKey(fn),
        ]),
      ),
      schema: pinned(async (child) => {
        await shared.database.schema(child);
        const rows = await query(STAGING_SCHEMA_SQL);
        if (
          !Array.isArray(rows) ||
          rows.length !== 1 ||
          rows[0]?.ready !== true
        )
          fail('STAGING_SCHEMA_DENIED');
        return true;
      }),
      migrationRevision: pinned(async () =>
        migrationRevision(
          await query(
            'select version from supabase_migrations.schema_migrations order by version limit 1001',
          ),
        ),
      ),
    },
    vercel: {
      ...shared.vercel,
      currentDeployment,
      runtimeBinding,
      deployments: async (context) => {
        const listing = await api(
          `/v7/deployments?projectId=${STAGING_PINS.projectId}&limit=100&sha=${context.sha}&branch=staging`,
        );
        if (
          !Array.isArray(listing?.deployments) ||
          listing.deployments.length > 100 ||
          listing.pagination?.next != null
        )
          fail('STAGING_DEPLOYMENT_BOUNDS');
        const rows = listing.deployments.filter(
          (row) => row.meta?.inventoryStagingFiles === context.intent,
        );
        if (rows.length > 1) fail('STAGING_DEPLOYMENT_AMBIGUOUS');
        return {
          deployments: await Promise.all(
            rows.map((row) => shared.vercel.deployment(row.uid ?? row.id)),
          ),
        };
      },
      createDeployment: (context) => {
        const marker = parseStagingIntent(context.intent);
        if (
          context.projectId !== STAGING_PINS.projectId ||
          context.repoId !== STAGING_PINS.repoId ||
          context.branch !== 'staging' ||
          !/^[a-f0-9]{40}$/.test(context.sha ?? '') ||
          marker?.child !== STAGING_REF ||
          marker.sha !== context.sha
        )
          fail('STAGING_DEPLOYMENT_INPUT_DENIED');
        return api('/v13/deployments', 'POST', {
          name: 'it-inventory-system',
          project: STAGING_PINS.projectId,
          gitSource: {
            type: 'github',
            repoId: STAGING_PINS.repoId,
            ref: 'staging',
            sha: context.sha,
          },
          meta: { inventoryStagingFiles: context.intent },
        });
      },
    },
  };
}
