import {
  MAX_USERS,
  PAGE_SIZE,
  PRODUCTION_REF,
  STAGING_REF,
  assertStagingBranch,
  syncStagingUsers,
} from './staging-user-sync-core.mjs';

const REPOSITORY = 'PHead2001/IT-Inventory-System';
const requestTimeoutMs = 15000;

function coded(message) {
  return new Error(message);
}

async function requestJson(url, options = {}) {
  let response;
  try {
    response = await fetch(url, {
      method: options.method ?? 'GET',
      headers: options.headers,
      body:
        options.body === undefined ? undefined : JSON.stringify(options.body),
      redirect: 'error',
      signal: AbortSignal.timeout(requestTimeoutMs),
    });
  } catch {
    throw coded('Staging identity mirror network request failed');
  }
  if (response.redirected)
    throw coded('Staging identity mirror redirect was refused');
  if (!response.ok)
    throw coded(`Staging identity mirror provider request failed: HTTP ${response.status}`);
  if (response.status === 204) return null;
  try {
    return await response.json();
  } catch {
    throw coded('Staging identity mirror provider response was invalid');
  }
}

function managementHeaders(token) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/json',
    'Content-Type': 'application/json',
  };
}

async function main() {
  const token = process.env.SUPABASE_ACCESS_TOKEN;
  if (
    process.env.GITHUB_ACTIONS !== 'true' ||
    process.env.GITHUB_REPOSITORY !== REPOSITORY ||
    process.env.GITHUB_REF !== 'refs/heads/main' ||
    !token
  )
    throw new Error('Trusted staging identity mirror environment is incomplete');

  const mgmtHeaders = managementHeaders(token);
  const branches = await requestJson(
    `https://api.supabase.com/v1/projects/${PRODUCTION_REF}/branches`,
    { headers: mgmtHeaders },
  );
  assertStagingBranch(branches);

  const keyRows = await requestJson(
    `https://api.supabase.com/v1/projects/${STAGING_REF}/api-keys?reveal=true`,
    { headers: mgmtHeaders },
  );
  if (!Array.isArray(keyRows))
    throw new Error('Staging API key response is invalid');
  const secretKeys = keyRows.filter(
    (key) =>
      key?.type === 'secret' &&
      key?.name === 'default' &&
      typeof key.api_key === 'string' &&
      key.api_key.startsWith('sb_secret_'),
  );
  if (secretKeys.length !== 1)
    throw new Error('Staging default secret key is unavailable');
  const stagingSecret = secretKeys[0].api_key;
  const stagingHeaders = {
    apikey: stagingSecret,
    Authorization: `Bearer ${stagingSecret}`,
    Accept: 'application/json',
    'Content-Type': 'application/json',
  };
  const stagingBase = `https://${STAGING_REF}.supabase.co`;

  const source = {
    users: async ({ limit, offset }) => {
      if (
        !Number.isSafeInteger(limit) ||
        !Number.isSafeInteger(offset) ||
        limit !== PAGE_SIZE ||
        offset < 0 ||
        offset >= MAX_USERS
      )
        throw new Error('Production user page request is invalid');
      const sql = `
        select
          u.id::text as id,
          u.email,
          u.phone,
          u.encrypted_password as password_hash,
          (u.email_confirmed_at is not null) as email_confirmed,
          (u.phone_confirmed_at is not null) as phone_confirmed,
          coalesce(u.raw_user_meta_data, '{}'::jsonb) as user_metadata,
          coalesce(u.raw_app_meta_data, '{}'::jsonb) as app_metadata,
          coalesce(
            (
              select jsonb_agg(i.provider order by i.provider)
              from auth.identities i
              where i.user_id = u.id
            ),
            '[]'::jsonb
          ) as providers,
          m.display_name,
          m.role as member_role,
          m.active as member_active,
          m.can_manage_configuration
        from auth.users u
        inner join public.app_members m on m.user_id = u.id
        where u.deleted_at is null
        order by u.id
        limit $1 offset $2
      `;
      const rows = await requestJson(
        `https://api.supabase.com/v1/projects/${PRODUCTION_REF}/database/query`,
        {
          method: 'POST',
          headers: mgmtHeaders,
          body: {
            query: sql,
            parameters: [limit, offset],
            read_only: true,
          },
        },
      );
      if (!Array.isArray(rows))
        throw new Error('Production user query response is invalid');
      return rows;
    },
  };

  const staging = {
    users: async () => {
      const users = [];
      for (let page = 1; page <= Math.ceil(MAX_USERS / 100); page += 1) {
        const result = await requestJson(
          `${stagingBase}/auth/v1/admin/users?page=${page}&per_page=100`,
          { headers: stagingHeaders },
        );
        if (!Array.isArray(result?.users))
          throw new Error('Staging Auth user listing is invalid');
        users.push(...result.users);
        if (users.length > MAX_USERS)
          throw new Error('Staging Auth listing exceeds its safety bound');
        if (result.users.length < 100) return users;
      }
      throw new Error('Staging Auth listing exceeds its safety bound');
    },
    createUser: async (payload) =>
      requestJson(`${stagingBase}/auth/v1/admin/users`, {
        method: 'POST',
        headers: stagingHeaders,
        body: payload,
      }),
    updateUser: async (id, payload) =>
      requestJson(
        `${stagingBase}/auth/v1/admin/users/${encodeURIComponent(id)}`,
        {
          method: 'PUT',
          headers: stagingHeaders,
          body: payload,
        },
      ),
    upsertMember: async (membership) => {
      const rows = await requestJson(
        `${stagingBase}/rest/v1/app_members?on_conflict=user_id`,
        {
          method: 'POST',
          headers: {
            ...stagingHeaders,
            Prefer: 'resolution=merge-duplicates,return=representation',
          },
          body: [membership],
        },
      );
      if (
        !Array.isArray(rows) ||
        rows.length !== 1 ||
        rows[0]?.user_id !== membership.user_id
      )
        throw new Error('Staging membership upsert was not verified');
    },
    deactivateMember: async (id) => {
      const rows = await requestJson(
        `${stagingBase}/rest/v1/app_members?user_id=eq.${encodeURIComponent(id)}`,
        {
          method: 'PATCH',
          headers: {
            ...stagingHeaders,
            Prefer: 'return=representation',
          },
          body: {
            active: false,
            can_manage_configuration: false,
          },
        },
      );
      if (!Array.isArray(rows) || rows.length > 1)
        throw new Error('Staging membership deactivation was not verified');
    },
  };

  const result = await syncStagingUsers({ source, staging });
  process.stdout.write(
    `Staging identity mirror complete: source=${result.source} created=${result.created} updated=${result.updated} deactivated=${result.deactivated}\n`,
  );
}

await main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
