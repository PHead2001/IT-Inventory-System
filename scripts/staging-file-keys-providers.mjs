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
import routineManifest from './staging-file-routines.json' with { type: 'json' };
import {
  STAGING_ROUTINE_CATALOG_CTE,
  STAGING_TRIGGER_CATALOG_CTE,
  STAGING_STORAGE_CATALOG_CTE,
  STAGING_FILE_API_COMPARISON_SQL,
  stagingRoutineComparisonSql,
  stagingTriggerComparisonSql,
  stagingStorageComparisonSql,
} from './staging-file-routines.mjs';

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
  '20261005163814',
  '20261006051349',
]);
// Version history and signatures cannot prove the CP5 implementation. Compare
// the reviewed portable manifest at each fresh guard, including legacy wrappers.
export const STAGING_SCHEMA_SQL = `with ${STAGING_STORAGE_CATALOG_CTE}, ${STAGING_ROUTINE_CATALOG_CTE}, ${STAGING_TRIGGER_CATALOG_CTE}
select (
  (select pg_catalog.count(*)=${STAGING_FILE_MIGRATIONS.length} from supabase_migrations.schema_migrations where version in (${STAGING_FILE_MIGRATIONS.map((version) => `'${version}'`).join(',')}))
  and ${stagingRoutineComparisonSql(routineManifest)}
  and ${stagingTriggerComparisonSql(routineManifest)}
  and ${stagingStorageComparisonSql(routineManifest)}
  and ${STAGING_FILE_API_COMPARISON_SQL}
) as ready from contract_context`;

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
