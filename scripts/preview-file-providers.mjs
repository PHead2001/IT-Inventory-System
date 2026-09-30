import { createHash } from 'node:crypto';
import { PARENT_REF, PreviewAccessError } from './preview-access-core.mjs';

const refuse = (code) => {
  throw new PreviewAccessError(code, 'Preview file provider request refused');
};

export async function boundedJsonRequest(url, options = {}) {
  try {
    const response = await fetch(url, {
      method: options.method ?? 'GET',
      headers: options.headers,
      body:
        options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) refuse(`FILE_HTTP_${response.status}`);
    if (response.status === 204) return null;
    if (Number(response.headers.get('content-length')) > 1048576)
      refuse('FILE_RESPONSE_BOUNDS');
    const reader = response.body.getReader();
    const chunks = [];
    let size = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 1048576) {
        await reader.cancel();
        refuse('FILE_RESPONSE_BOUNDS');
      }
      chunks.push(Buffer.from(value));
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch (error) {
    if (error instanceof PreviewAccessError) throw error;
    refuse('FILE_REQUEST_FAILED');
  }
}

export const SQL = {
  schema: `select (
    (select count(*)=5 from information_schema.columns where table_schema='private' and table_name='file_keys')
    and (select count(*)=5 from information_schema.columns where table_schema='private' and table_name='file_keys' and is_nullable='NO' and (column_name,data_type) in (('key_id','text'),('secret','text'),('accepts_new','boolean'),('verify_until','timestamp with time zone'),('created_at','timestamp with time zone')))
    and to_regclass('private.file_guard') is not null
    and to_regprocedure('private.file_guard_lock()') is not null
    and exists(select 1 from information_schema.columns where table_schema='private' and table_name='file_keys' and column_name='created_at' and column_default='now()')
    and exists(select 1 from information_schema.columns where table_schema='private' and table_name='file_keys' and column_name='accepts_new' and column_default='false')
    and exists(select 1 from pg_indexes where schemaname='private' and tablename='file_keys' and indexname='file_one_active_key' and indexdef like 'CREATE UNIQUE INDEX%WHERE accepts_new%')
    and not exists(select 1 from pg_class c cross join lateral aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a where c.oid='private.file_keys'::regclass and a.grantee=0)
    and not has_table_privilege('anon','private.file_keys','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
    and not has_table_privilege('authenticated','private.file_keys','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
    and not has_table_privilege('service_role','private.file_keys','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
    and exists(select 1 from pg_constraint where conrelid='private.file_keys'::regclass and contype='p' and pg_get_constraintdef(oid)='PRIMARY KEY (key_id)')
    and exists(select 1 from pg_constraint where conrelid='private.file_keys'::regclass and contype='c' and pg_get_constraintdef(oid) like '%^[a-z0-9]{4,32}$%')
    and exists(select 1 from pg_constraint where conrelid='private.file_keys'::regclass and contype='c' and pg_get_constraintdef(oid) like '%length(secret)%32%')
  ) as ready`,
  read: `select coalesce((select json_agg(k) from (select key_id,secret,accepts_new,verify_until::text from private.file_keys where key_id=$1) k),'[]'::json) as rows, (select count(*)::int from private.file_keys where accepts_new and key_id<>$1) as "foreignActive"`,
  stage: `with guard as materialized (select private.file_guard_lock())
    insert into private.file_keys(key_id,secret,accepts_new,verify_until)
    select $1,$2,false,'-infinity'::timestamptz from guard
    where not exists(select 1 from private.file_keys where accepts_new and key_id<>$1)
    on conflict(key_id) do nothing`,
  activate: `with guard as materialized (select private.file_guard_lock())
    update private.file_keys set accepts_new=true,verify_until='infinity'::timestamptz
    from guard where key_id=$1 and secret=$2 and not accepts_new and verify_until='-infinity'::timestamptz
    and not exists(select 1 from private.file_keys where accepts_new and key_id<>$1)`,
};

export function fileProviders({
  managementToken,
  vercelToken,
  pins,
  request = boundedJsonRequest,
}) {
  const query = async (child, query, parameters, readOnly) => {
    if (!/^[a-z0-9]{20}$/.test(child) || child === PARENT_REF)
      refuse('FILE_DATABASE_TARGET');
    return request(
      `https://api.supabase.com/v1/projects/${child}/database/query`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${managementToken}`,
          'Content-Type': 'application/json',
        },
        body: { query, parameters, read_only: readOnly },
      },
    );
  };
  const database = {
    schema: async (child) => {
      const rows = await query(child, SQL.schema, [], true);
      if (!Array.isArray(rows) || rows.length !== 1 || rows[0].ready !== true)
        refuse('FILE_SCHEMA_DENIED');
    },
    read: async (child, id) => {
      const rows = await query(child, SQL.read, [id], true);
      if (!Array.isArray(rows) || rows.length !== 1)
        refuse('FILE_KEY_RESPONSE');
      return rows[0];
    },
    stage: (child, id, secret) => query(child, SQL.stage, [id, secret], false),
    activate: (child, id, secret) =>
      query(child, SQL.activate, [id, secret], false),
  };
  const team = `teamId=${encodeURIComponent(pins.teamId)}`;
  const api = (path, method = 'GET', body) =>
    request(
      `https://api.vercel.com${path}${path.includes('?') ? '&' : '?'}${team}`,
      {
        method,
        body,
        headers: {
          Authorization: `Bearer ${vercelToken}`,
          'Content-Type': 'application/json',
        },
      },
    );
  const projectPath = encodeURIComponent(pins.projectId);
  const envs = () => api(`/v10/projects/${projectPath}/env?decrypt=false`);
  const vercel = {
    project: () => api(`/v9/projects/${projectPath}`),
    envs,
    assertBackend: async (branch, child) => {
      const listing = await envs();
      if (
        !Array.isArray(listing?.envs) ||
        listing.envs.length > 100 ||
        listing.pagination?.next != null
      )
        refuse('FILE_ENV_BOUNDS');
      // The canonical Supabase configuration has no server URL override. Reject
      // contradictory preview URL rows, even if a branch-specific row wins.
      const rows = listing.envs.filter(
        (row) =>
          row.key === 'NEXT_PUBLIC_SUPABASE_URL' &&
          (row.gitBranch == null || row.gitBranch === branch) &&
          row.target?.includes('preview'),
      );
      if (
        !rows.length ||
        rows.length > 2 ||
        rows.some((row) => row.customEnvironmentIds?.length)
      )
        refuse('FILE_BACKEND_DENIED');
      const snapshots = [];
      for (const row of rows) {
        if (typeof row.id !== 'string' || !Number.isSafeInteger(row.updatedAt))
          refuse('FILE_BACKEND_REVISION');
        // Only this public configuration value is read, never signing secrets.
        const value = await api(
          `/v1/projects/${projectPath}/env/${encodeURIComponent(row.id)}`,
        );
        if (value?.value !== `https://${child}.supabase.co`)
          refuse('FILE_BACKEND_DENIED');
        snapshots.push([
          row.id,
          row.updatedAt,
          row.gitBranch ?? null,
          value.value,
        ]);
      }
      if (
        rows.filter((row) => row.gitBranch === branch).length > 1 ||
        rows.filter((row) => row.gitBranch == null).length > 1
      )
        refuse('FILE_BACKEND_DENIED');
      snapshots.sort((a, b) => a[0].localeCompare(b[0]));
      return {
        fingerprint: createHash('sha256')
          .update(JSON.stringify(snapshots))
          .digest('hex'),
        updatedAt: Math.max(...rows.map((row) => row.updatedAt)),
      };
    },
    writeEnv: async (id, body) => {
      const result = id
        ? await api(
            `/v9/projects/${projectPath}/env/${encodeURIComponent(id)}`,
            'PATCH',
            body,
          )
        : await api(`/v10/projects/${projectPath}/env`, 'POST', body);
      if (result?.failed?.length) refuse('FILE_ENV_WRITE_FAILED');
      return result;
    },
    deployments: async (context) => {
      const listing = await api(
        `/v7/deployments?projectId=${projectPath}&limit=100&sha=${context.sha}&branch=${encodeURIComponent(context.branch)}`,
      );
      if (
        !Array.isArray(listing?.deployments) ||
        listing.deployments.length > 100 ||
        listing.pagination?.next != null
      )
        refuse('FILE_DEPLOYMENT_BOUNDS');
      const matches = listing.deployments.filter(
        (row) => row.meta?.inventoryPreviewFiles === context.intent,
      );
      if (matches.length > 1) refuse('FILE_DEPLOYMENT_AMBIGUOUS');
      return {
        deployments: await Promise.all(
          matches.map((row) => {
            if (typeof row.uid !== 'string' && typeof row.id !== 'string')
              refuse('FILE_DEPLOYMENT_DENIED');
            return api(
              `/v13/deployments/${encodeURIComponent(row.uid ?? row.id)}`,
            );
          }),
        ),
      };
    },
    createDeployment: (context) =>
      api('/v13/deployments', 'POST', {
        name: 'it-inventory-system',
        project: pins.projectId,
        gitSource: {
          type: 'github',
          repoId: context.repoId,
          ref: context.branch,
          sha: context.sha,
        },
        meta: { inventoryPreviewFiles: context.intent },
      }),
    deployment: (id) => api(`/v13/deployments/${encodeURIComponent(id)}`),
  };
  return { database, vercel };
}
