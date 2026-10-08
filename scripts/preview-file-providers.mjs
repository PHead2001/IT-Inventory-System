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
      redirect: 'error',
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
  const envs = async (branch) => {
    const nonempty = (value) =>
      typeof value === 'string' && value.length > 0 && value.trim() === value;
    const object = (value) =>
      value !== null && typeof value === 'object' && !Array.isArray(value);
    if (!nonempty(branch)) refuse('FILE_ENV_BOUNDS');
    const listing = await api(`/v10/projects/${projectPath}/env?decrypt=false`);
    if (
      !object(listing) ||
      !Array.isArray(listing.envs) ||
      listing.envs.length > 512 ||
      (listing.pagination != null &&
        (!object(listing.pagination) || listing.pagination.next != null)) ||
      listing.envs.some(
        (row) =>
          !object(row) ||
          !nonempty(row.key) ||
          !nonempty(row.id) ||
          (row.gitBranch != null && !nonempty(row.gitBranch)),
      )
    )
      refuse('FILE_ENV_BOUNDS');
    if (new Set(listing.envs.map((row) => row.id)).size !== listing.envs.length)
      refuse('FILE_ENV_BOUNDS');
    // Validate the complete response before removing only proven other branches.
    // Wider values, duplicate keys and every target/custom scope stay visible
    // to the existing ownership/backend guards and their 100-row scoped bound.
    return {
      ...listing,
      envs: listing.envs.filter(
        (row) => row.gitBranch == null || row.gitBranch === branch,
      ),
    };
  };
  const hydrate = async (id) => {
    if (typeof id !== 'string' || !id) refuse('FILE_DEPLOYMENT_DENIED');
    const row = await api(`/v13/deployments/${encodeURIComponent(id)}`);
    if (row?.id !== id) refuse('FILE_DEPLOYMENT_DENIED');
    return row;
  };
  const vercel = {
    project: () => api(`/v9/projects/${projectPath}`),
    envs,
    assertBackend: async (branch, child, keys) => {
      // Classification comes from the verified child's Management API, never
      // from decoding an opaque key or trusting a browser-side prefix.
      if (
        !Array.isArray(keys) ||
        !keys.length ||
        keys.length > 100 ||
        keys.some(
          (key) =>
            !key ||
            typeof key.type !== 'string' ||
            typeof key.api_key !== 'string' ||
            !key.api_key ||
            key.api_key.length > 16384,
        ) ||
        new Set(keys.map((key) => key.api_key)).size !== keys.length
      )
        refuse('FILE_PUBLIC_KEYS_DENIED');
      const publicKeys = new Set(
        keys
          .filter(
            (key) =>
              key.type === 'publishable' ||
              (key.type === 'legacy' && key.name === 'anon'),
          )
          .map((key) => key.api_key),
      );
      if (!publicKeys.size) refuse('FILE_PUBLIC_KEYS_DENIED');
      const listing = await envs(branch);
      if (
        !Array.isArray(listing?.envs) ||
        listing.envs.length > 100 ||
        listing.pagination?.next != null
      )
        refuse('FILE_ENV_BOUNDS');
      const names = [
        'NEXT_PUBLIC_SUPABASE_URL',
        'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
      ];
      // The canonical app uses this URL/key pair for server and browser clients.
      // Contradictory wider preview values are refused even when a branch wins.
      const rows = listing.envs.filter(
        (row) =>
          names.includes(row.key) &&
          (row.gitBranch == null || row.gitBranch === branch) &&
          (!Array.isArray(row.target) || row.target.includes('preview')),
      );
      if (
        names.some((name) => !rows.some((row) => row.key === name)) ||
        rows.length > 4 ||
        rows.some(
          (row) =>
            row.customEnvironmentIds?.length ||
            !Array.isArray(row.target) ||
            !row.target.includes('preview') ||
            row.target.some(
              (target) =>
                !['preview', 'production', 'development'].includes(target),
            ) ||
            new Set(row.target).size !== row.target.length,
        ) ||
        new Set(rows.map((row) => row.id)).size !== rows.length
      )
        refuse('FILE_BACKEND_DENIED');
      const snapshots = [];
      const legacyUrlSnapshots = [];
      for (const row of rows) {
        if (
          typeof row.id !== 'string' ||
          !row.id ||
          !Number.isSafeInteger(row.updatedAt) ||
          row.updatedAt < 0
        )
          refuse('FILE_BACKEND_REVISION');
        const value = await api(
          `/v1/projects/${projectPath}/env/${encodeURIComponent(row.id)}`,
        );
        if (
          row.key === names[0]
            ? value?.value !== `https://${child}.supabase.co`
            : !publicKeys.has(value?.value)
        )
          refuse('FILE_BACKEND_DENIED');
        snapshots.push([
          row.key,
          row.id,
          row.updatedAt,
          row.gitBranch ?? null,
          [...row.target].sort(),
          [], // Custom environment scopes are forbidden above.
          createHash('sha256').update(value.value).digest('hex'),
        ]);
        if (row.key === names[0])
          legacyUrlSnapshots.push([
            row.id,
            row.updatedAt,
            row.gitBranch ?? null,
            value.value,
          ]);
      }
      if (
        names.some(
          (name) =>
            rows.filter((row) => row.key === name && row.gitBranch === branch)
              .length > 1 ||
            rows.filter((row) => row.key === name && row.gitBranch == null)
              .length > 1,
        )
      )
        refuse('FILE_BACKEND_DENIED');
      snapshots.sort((a, b) => a[1].localeCompare(b[1]));
      legacyUrlSnapshots.sort((a, b) => a[0].localeCompare(b[0]));
      return {
        fingerprint: createHash('sha256')
          .update(JSON.stringify(snapshots))
          .digest('hex'),
        updatedAt: Math.max(...rows.map((row) => row.updatedAt)),
        // Kept only to verify ownership/provenance before migrating a v1 intent.
        legacyFingerprint: createHash('sha256')
          .update(JSON.stringify(legacyUrlSnapshots))
          .digest('hex'),
        legacyUpdatedAt: Math.max(
          ...rows
            .filter((row) => row.key === names[0])
            .map((row) => row.updatedAt),
        ),
      };
    },
    writeEnv: async (id, body) => {
      // PATCH v9 rejects additional properties and saved Sensitive/Secret names
      // cannot be edited. Key/visibility remain owned-row/readback invariants.
      const patchBody = { ...body };
      delete patchBody.visibility;
      delete patchBody.key;
      const result = id
        ? await api(
            `/v9/projects/${projectPath}/env/${encodeURIComponent(id)}`,
            'PATCH',
            patchBody,
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
            return hydrate(row.uid ?? row.id);
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
    deployment: hydrate,
  };
  return { database, vercel };
}
