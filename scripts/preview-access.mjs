import { previewAccessTarget } from './preview-access-target.mjs';
import { provisionPreviewFiles } from './preview-file-keys.mjs';
import { fileProviders } from './preview-file-providers.mjs';
import { createPreviewRequest } from './preview-access-request.mjs';
import { readFile } from 'node:fs/promises';
import {
  provisionPreview,
  PARENT_REF,
  CHECK_NAME,
  previewFailureGuidance,
} from './preview-access-core.mjs';

async function main() {
  const repository = 'PHead2001/IT-Inventory-System';
  const githubToken = process.env.GITHUB_TOKEN;
  const managementToken = process.env.PREVIEW_SUPABASE_MANAGEMENT_TOKEN;
  const password = process.env.PREVIEW_STAFF_PASSWORD;
  const eventName = process.env.GITHUB_EVENT_NAME;
  const eventPath = process.env.GITHUB_EVENT_PATH;
  const allowMinimumReduction =
    process.env.PREVIEW_ALLOW_SIX_DIGIT_MINIMUM === 'true';
  if (
    !githubToken ||
    !managementToken ||
    !password ||
    !eventName ||
    !eventPath ||
    process.env.GITHUB_REPOSITORY !== repository ||
    process.env.GITHUB_REF !== 'refs/heads/main'
  ) {
    throw new Error(
      'Trusted default-branch preview-access environment is incomplete',
    );
  }
  const coded = (code) =>
    Object.assign(new Error('Preview access request failed'), { code });
  let event;
  try {
    event = JSON.parse(await readFile(eventPath, 'utf8'));
  } catch {
    throw coded('EVENT_INVALID_JSON');
  }
  const request = createPreviewRequest();
  const ghHeaders = {
    Authorization: `Bearer ${githubToken}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  const mgmtHeaders = {
    Authorization: `Bearer ${managementToken}`,
    Accept: 'application/json',
    'Content-Type': 'application/json',
  };
  const github = {
    pull: (number) =>
      request(`https://api.github.com/repos/${repository}/pulls/${number}`, {
        headers: ghHeaders,
      }),
    checks: (sha) =>
      request(
        `https://api.github.com/repos/${repository}/commits/${sha}/check-runs?check_name=${encodeURIComponent(CHECK_NAME)}&filter=all&per_page=100&page=1`,
        { headers: ghHeaders },
      ),
  };
  const management = {
    branches: (ref) =>
      request(`https://api.supabase.com/v1/projects/${ref}/branches`, {
        headers: mgmtHeaders,
      }),
    authConfig: (ref) =>
      request(`https://api.supabase.com/v1/projects/${ref}/config/auth`, {
        headers: mgmtHeaders,
      }),
    patchAuthConfig: (ref, patch) =>
      request(`https://api.supabase.com/v1/projects/${ref}/config/auth`, {
        method: 'PATCH',
        headers: mgmtHeaders,
        body: patch,
      }),
    keys: (ref) =>
      request(
        `https://api.supabase.com/v1/projects/${ref}/api-keys?reveal=true`,
        { headers: mgmtHeaders },
      ),
  };
  const project = (ref) => {
    if (!/^[a-z0-9]{20}$/.test(ref) || ref === PARENT_REF)
      throw new Error('Invalid preview project reference');
    const base = `https://${ref}.supabase.co`;
    const adminHeaders = (key) => ({
      apikey: key,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    });
    const rest = (path, key, options = {}) =>
      request(`${base}${path}`, {
        ...options,
        headers: { ...adminHeaders(key), ...options.headers },
      });
    return {
      probeSchema: async (key) => {
        let data;
        try {
          data = await rest(
            '/rest/v1/app_members?select=user_id,role,active,can_manage_configuration&limit=0',
            key,
          );
        } catch (error) {
          if (error?.code === 'HTTP_400' || error?.code === 'HTTP_404')
            error.code = 'SCHEMA_PENDING';
          throw error;
        }
        if (!Array.isArray(data))
          throw new Error('Required preview membership schema is unavailable');
      },
      listUsers: async (key) => {
        const users = [];
        for (let page = 1; page <= 20; page += 1) {
          const result = await rest(
            `/auth/v1/admin/users?page=${page}&per_page=50`,
            key,
          );
          if (!Array.isArray(result?.users))
            throw new Error('Auth user listing is invalid');
          users.push(...result.users);
          if (result.users.length < 50) return users;
        }
        throw new Error('Auth user listing exceeds the bounded collision scan');
      },
      createUser: (key, body) =>
        rest('/auth/v1/admin/users', key, { method: 'POST', body }),
      updateUser: (key, id, body) =>
        rest(`/auth/v1/admin/users/${encodeURIComponent(id)}`, key, {
          method: 'PUT',
          body,
        }),
      upsertMember: (key, body) =>
        rest('/rest/v1/app_members?on_conflict=user_id', key, {
          method: 'POST',
          headers: {
            Prefer: 'resolution=merge-duplicates,return=representation',
          },
          body: [body],
        }),
      signIn: (key, email, secret) =>
        rest('/auth/v1/token?grant_type=password', key, {
          method: 'POST',
          body: { email, password: secret },
        }),
      memberAsUser: async (jwt, key, id) => {
        const rows = await rest(
          `/rest/v1/app_members?select=role,active,can_manage_configuration&user_id=eq.${encodeURIComponent(id)}`,
          key,
          { headers: { Authorization: `Bearer ${jwt}` } },
        );
        if (!Array.isArray(rows) || rows.length !== 1)
          throw new Error(
            'Fixture membership is not visible to the signed-in user',
          );
        return rows[0];
      },
    };
  };

  const targetNumber = Number(process.env.PREVIEW_TARGET_PR);
  const expectedSha = previewAccessTarget({
    eventName,
    event,
    targetNumber,
    repository,
  });
  const result = await provisionPreview({
    repository,
    number: targetNumber,
    expectedSha,
    password,
    allowMinimumReduction,
    github,
    management,
    project,
    attempts: 12,
    pause: () => new Promise((resolve) => setTimeout(resolve, 10000)),
  });
  process.stdout.write(
    `Preview staff ready for PR #${result.pr} at ${result.sha.slice(0, 12)}\n`,
  );
  const vercelToken = process.env.PREVIEW_VERCEL_TOKEN;
  const pins = {
    projectId: process.env.PREVIEW_VERCEL_PROJECT_ID,
    teamId: process.env.PREVIEW_VERCEL_TEAM_ID,
  };
  if (!vercelToken || !pins.projectId || !pins.teamId) {
    process.stdout.write(
      'Preview files: configuration missing; staff provisioning succeeded\n',
    );
    return;
  }
  const providers = fileProviders({ managementToken, vercelToken, pins });
  await provisionPreviewFiles({
    repository,
    number: result.pr,
    expectedSha: result.sha,
    github,
    management,
    pins,
    ...providers,
    pause: () => new Promise((resolve) => setTimeout(resolve, 5000)),
  });
  process.stdout.write(
    `Preview files ready for PR #${result.pr} at ${result.sha.slice(0, 12)}\n`,
  );
}
await main().catch((error) => {
  const code =
    typeof error?.code === 'string' && /^[A-Z0-9_]{3,40}$/.test(error.code)
      ? error.code
      : 'UNEXPECTED';
  process.stderr.write(`Preview staff setup failed: ${code}\n`);
  const guidance = previewFailureGuidance(error);
  if (guidance) process.stderr.write(`${guidance}\n`);
  process.exitCode = 1;
});
