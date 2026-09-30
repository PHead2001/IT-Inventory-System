import './preview-file-keys.test.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { selectOpenSameRepositoryPrs } from '../scripts/preview-access-discover.mjs';
import {
  provisionPreview,
  PARENT_REF,
  CHECK_NAME,
  CHECK_APP,
  authPolicyPatch,
  selectDeploymentCheck,
} from '../scripts/preview-access-core.mjs';

const repository = 'PHead2001/IT-Inventory-System';
const sha = 'a'.repeat(40);
const ref = 'b'.repeat(20);
const password = '123456'; // Dummy test value; production secret is never embedded.
const successfulCheck = {
  id: 41,
  head_sha: sha,
  name: CHECK_NAME,
  app: { slug: CHECK_APP },
  details_url: `https://supabase.com/dashboard/project/${ref}`,
  status: 'completed',
  conclusion: 'success',
};
const listing = (...check_runs) => ({
  total_count: check_runs.length,
  check_runs,
});

function fixture(overrides = {}) {
  const writes = [];
  const state = {
    user: null,
    member: null,
    policy: {
      disable_signup: true,
      password_min_length: 12,
      password_required_characters: '',
      password_hibp_enabled: false,
    },
    branch: {
      project_ref: ref,
      parent_project_ref: PARENT_REF,
      is_default: false,
      git_branch: 'feature',
      pr_number: 9,
      status: 'ACTIVE_HEALTHY',
    },
  };
  const pr = {
    number: 9,
    state: 'open',
    head: { ref: 'feature', sha, repo: { full_name: repository } },
    base: { ref: 'main', repo: { full_name: repository } },
  };
  let pullCalls = 0;
  let branchCalls = 0;
  const github = {
    pull: async () =>
      overrides.pullSequence?.[pullCalls++] ?? overrides.pr ?? pr,
    checks: async () => overrides.checks ?? listing(successfulCheck),
  };
  const management = {
    branches: async () =>
      overrides.branchSequence?.[branchCalls++] ??
      overrides.branches ?? [state.branch],
    authConfig: async () => overrides.config ?? state.policy,
    patchAuthConfig: async (_ref, patch) => {
      writes.push(['policy', patch]);
      Object.assign(state.policy, patch);
    },
    keys: async () => [
      { type: 'secret', name: 'default', api_key: 'secret-test' },
      { type: 'publishable', name: 'default', api_key: 'publishable-test' },
    ],
  };
  const project = () => ({
    probeSchema: async () => {
      if (overrides.schemaError) throw new Error('schema unavailable');
    },
    listUsers: async () => overrides.users ?? (state.user ? [state.user] : []),
    createUser: async (_key, data) => {
      writes.push(['create', data]);
      state.user = {
        id: 'u1',
        email: data.email,
        app_metadata: data.app_metadata,
      };
      return state.user;
    },
    updateUser: async (_key, id, data) => {
      writes.push(['update', data]);
      return { ...state.user, id };
    },
    upsertMember: async (_key, member) => {
      writes.push(['member', member]);
      state.member = member;
    },
    signIn: async () => ({
      user: { id: state.user.id },
      access_token: 'token',
    }),
    memberAsUser: async () => state.member,
  });
  const run = (options = {}) =>
    provisionPreview({
      repository,
      number: 9,
      password,
      github,
      management,
      project,
      attempts: 1,
      allowMinimumReduction: true,
      ...options,
    });
  return { run, writes, state };
}

test('creates a marked confirmed staff user, verifies sign-in, and reconciles password after reset', async () => {
  const { run, writes } = fixture();
  await run();
  assert.deepEqual(
    writes.map(([operation]) => operation),
    ['policy', 'create', 'member'],
  );
  assert.deepEqual(writes[0][1], { password_min_length: 6 });
  assert.equal(writes[1][1].email_confirm, true);
  assert.deepEqual(writes[1][1].app_metadata, {
    inventory_preview_fixture: true,
  });
  assert.equal(writes[2][1].can_manage_configuration, false);
  await run();
  assert.deepEqual(
    writes.map(([operation]) => operation),
    ['policy', 'create', 'member', 'update', 'member'],
  );
  assert.equal(writes[3][1].ban_duration, 'none');
});

test('supports a stacked same-repository PR and waits for its branch to appear', async () => {
  const stacked = {
    number: 9,
    state: 'open',
    head: { ref: 'feature', sha, repo: { full_name: repository } },
    base: { ref: 'another-feature', repo: { full_name: repository } },
  };
  const branch = {
    project_ref: ref,
    parent_project_ref: PARENT_REF,
    is_default: false,
    git_branch: 'feature',
    pr_number: 9,
    status: 'ACTIVE_HEALTHY',
  };
  const { run, writes } = fixture({
    pr: stacked,
    branchSequence: [[], [branch]],
  });
  let pauses = 0;
  await run({
    attempts: 2,
    pause: async () => {
      pauses += 1;
    },
  });
  assert.equal(pauses, 1);
  assert.deepEqual(
    writes.map(([operation]) => operation),
    ['policy', 'create', 'member'],
  );
});

test('waits for the current SHA check when the branch response has no check ID', async () => {
  const baseBranch = {
    project_ref: ref,
    parent_project_ref: PARENT_REF,
    is_default: false,
    git_branch: 'feature',
    pr_number: 9,
    status: 'ACTIVE_HEALTHY',
  };
  const { run, writes } = fixture({ branches: [baseBranch] });
  const checked = [];
  let calls = 0;
  await run({
    attempts: 2,
    pause: async () => {},
    github: {
      pull: async () => ({
        number: 9,
        state: 'open',
        head: { ref: 'feature', sha, repo: { full_name: repository } },
        base: { ref: 'main', repo: { full_name: repository } },
      }),
      checks: async (headSha) => {
        checked.push(headSha);
        return calls++ === 0 ? listing() : listing(successfulCheck);
      },
    },
  });
  assert.deepEqual(checked, Array(6).fill(sha));
  assert.deepEqual(
    writes.map(([operation]) => operation),
    ['policy', 'create', 'member'],
  );
});

test('latest Supabase check for the exact SHA controls readiness with no older green fallback', async (t) => {
  const cases = [
    {
      name: 'newer queued after green',
      checks: listing(successfulCheck, {
        ...successfulCheck,
        id: 42,
        status: 'queued',
        conclusion: null,
      }),
    },
    {
      name: 'newer failed after green',
      checks: listing(successfulCheck, {
        ...successfulCheck,
        id: 42,
        conclusion: 'failure',
      }),
    },
    {
      name: 'only an old SHA passed',
      checks: listing({ ...successfulCheck, head_sha: 'c'.repeat(40) }),
    },
    {
      name: 'newest check points at a different child',
      checks: listing(successfulCheck, {
        ...successfulCheck,
        id: 42,
        details_url: `https://supabase.com/dashboard/project/${'c'.repeat(20)}`,
      }),
    },
    {
      name: 'newest check has a deceptive URL',
      checks: listing({
        ...successfulCheck,
        details_url: `https://supabase.com.evil.example/dashboard/project/${ref}`,
      }),
    },
    {
      name: 'same ID is duplicated',
      checks: listing(successfulCheck, { ...successfulCheck }),
    },
    {
      name: 'listing exceeds the explicit one-page bound',
      checks: { total_count: 101, check_runs: [successfulCheck] },
    },
    {
      name: 'truncated listing hides a newer check',
      checks: { total_count: 2, check_runs: [successfulCheck] },
    },
  ];
  for (const { name, checks } of cases)
    await t.test(name, async () => {
      const { run, writes } = fixture({ checks });
      await assert.rejects(run());
      assert.equal(writes.length, 0);
    });
  const selected = selectDeploymentCheck(
    listing(successfulCheck, {
      ...successfulCheck,
      id: 42,
      status: 'completed',
    }),
    sha,
    ref,
  );
  assert.equal(selected.id, 42);
});

test('rejects a fork, closed PR, stale event, parent/default/wrong-parent branch, wrong check, and schema mismatch before writes', async (t) => {
  const baseline = fixture();
  const originalPr = await (async () => {
    const p = {
      number: 9,
      state: 'open',
      head: { ref: 'feature', sha, repo: { full_name: repository } },
      base: { ref: 'main', repo: { full_name: repository } },
    };
    return p;
  })();
  const cases = [
    {
      name: 'fork',
      overrides: {
        pr: {
          ...originalPr,
          head: { ...originalPr.head, repo: { full_name: 'other/fork' } },
        },
      },
    },
    { name: 'closed', overrides: { pr: { ...originalPr, state: 'closed' } } },
    {
      name: 'stale event',
      overrides: {},
      options: { expectedSha: 'c'.repeat(40) },
    },
    {
      name: 'parent target',
      overrides: {
        branches: [{ ...baseline.state.branch, project_ref: PARENT_REF }],
      },
    },
    {
      name: 'default target',
      overrides: { branches: [{ ...baseline.state.branch, is_default: true }] },
    },
    {
      name: 'wrong parent',
      overrides: {
        branches: [
          { ...baseline.state.branch, parent_project_ref: 'c'.repeat(20) },
        ],
      },
    },
    {
      name: 'wrong check app',
      overrides: {
        checks: listing({ ...successfulCheck, app: { slug: 'other' } }),
      },
    },
    {
      name: 'stale check',
      overrides: {
        checks: listing({ ...successfulCheck, head_sha: 'c'.repeat(40) }),
      },
    },
    { name: 'schema unavailable', overrides: { schemaError: true } },
  ];
  for (const { name, overrides, options } of cases)
    await t.test(name, async () => {
      const { run, writes } = fixture(overrides);
      await assert.rejects(run(options));
      assert.equal(writes.length, 0);
    });
});

test('unmarked account collision and unapproved policy reduction perform no writes', async () => {
  const collision = fixture({
    users: [{ id: 'another', email: 'test@gmail.com', app_metadata: {} }],
  });
  await assert.rejects(collision.run(), /unmarked/);
  assert.equal(collision.writes.length, 0);
  const noOptIn = fixture();
  await assert.rejects(noOptIn.run({ allowMinimumReduction: false }), /opt-in/);
  assert.equal(noOptIn.writes.length, 0);
});

test('fresh PR revision changes before mutation abort with zero writes', async () => {
  const current = {
    number: 9,
    state: 'open',
    head: { ref: 'feature', sha, repo: { full_name: repository } },
    base: { ref: 'main', repo: { full_name: repository } },
  };
  const changed = {
    ...current,
    head: { ...current.head, sha: 'c'.repeat(40) },
  };
  const { run, writes } = fixture({ pullSequence: [current, changed] });
  await assert.rejects(run(), /stale/);
  assert.equal(writes.length, 0);
});

test('rejects incompatible Auth strength settings without weakening them', () => {
  assert.throws(
    () =>
      authPolicyPatch(
        {
          disable_signup: true,
          password_min_length: 12,
          password_required_characters: 'a-z',
          password_hibp_enabled: false,
        },
        password,
        true,
      ),
    /incompatible/,
  );
  assert.throws(
    () =>
      authPolicyPatch(
        {
          disable_signup: true,
          password_min_length: 12,
          password_required_characters: '',
          password_hibp_enabled: true,
        },
        password,
        true,
      ),
    /incompatible/,
  );
});

test('malformed event JSON cannot print a secret or parser text', () => {
  const directory = mkdtempSync(join(tmpdir(), 'preview-access-test-'));
  try {
    const path = join(directory, 'event.json');
    const sentinel = 'SENSITIVE_FIXTURE_VALUE';
    writeFileSync(path, `{ "unexpected": "${sentinel}",`);
    const result = spawnSync(process.execPath, ['scripts/preview-access.mjs'], {
      cwd: new URL('..', import.meta.url),
      encoding: 'utf8',
      env: {
        ...process.env,
        GITHUB_REPOSITORY: repository,
        GITHUB_REF: 'refs/heads/main',
        GITHUB_EVENT_NAME: 'workflow_dispatch',
        GITHUB_EVENT_PATH: path,
        GITHUB_TOKEN: sentinel,
        PREVIEW_SUPABASE_MANAGEMENT_TOKEN: sentinel,
        PREVIEW_STAFF_PASSWORD: password,
      },
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /EVENT_INVALID_JSON/);
    assert.doesNotMatch(result.stderr, new RegExp(sentinel));
    assert.doesNotMatch(result.stderr, /SyntaxError/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('schedule discovery emits separate jobs for an early slow PR and a later ready PR', () => {
  const directory = mkdtempSync(join(tmpdir(), 'preview-discover-test-'));
  try {
    const eventPath = join(directory, 'event.json');
    const outputPath = join(directory, 'output.txt');
    const mockPath = join(directory, 'mock-fetch.mjs');
    const pull = (number) => ({
      number,
      state: 'open',
      head: { repo: { full_name: repository } },
      base: { repo: { full_name: repository } },
    });
    writeFileSync(eventPath, '{}');
    writeFileSync(outputPath, '');
    writeFileSync(
      mockPath,
      `globalThis.fetch = async () => ({ok:true,json:async()=>${JSON.stringify([pull(9), pull(10)])}});`,
    );
    const result = spawnSync(
      process.execPath,
      [
        '--import',
        pathToFileURL(mockPath).href,
        'scripts/preview-access-discover.mjs',
      ],
      {
        cwd: new URL('..', import.meta.url),
        encoding: 'utf8',
        env: {
          ...process.env,
          GITHUB_REPOSITORY: repository,
          GITHUB_REF: 'refs/heads/main',
          GITHUB_EVENT_NAME: 'schedule',
          GITHUB_EVENT_PATH: eventPath,
          GITHUB_OUTPUT: outputPath,
          GITHUB_TOKEN: 'test-token',
        },
      },
    );
    assert.equal(result.status, 0, result.stderr);
    assert.match(readFileSync(outputPath, 'utf8'), /targets=\[9,10\]/);
    const workflow = readFileSync(
      new URL('../.github/workflows/preview-access.yml', import.meta.url),
      'utf8',
    );
    assert.match(
      workflow,
      /needs: discover[\s\S]*max-parallel: 4[\s\S]*pr: \$\{\{ fromJSON\(needs\.discover\.outputs\.targets\) \}\}/,
    );
    assert.match(
      workflow,
      /timeout-minutes: 15[\s\S]*environment: preview-access/,
    );
    assert.match(workflow, /fail-fast: false/);
    assert.doesNotMatch(workflow.split('\njobs:')[0], /\bconcurrency:/);
    const provisionJob = workflow.split('  provision:')[1];
    assert.ok(provisionJob, 'the per-PR provisioning job must exist');
    assert.match(
      provisionJob,
      /concurrency:\s*\n\s*group: preview-staff-access-\$\{\{ matrix\.pr \}\}\s*\n\s*cancel-in-progress: false/,
    );
    const discoveryJob = workflow
      .split('  discover:')[1]
      ?.split('  provision:')[0];
    assert.ok(discoveryJob, 'the discovery job must be separate');
    assert.doesNotMatch(discoveryJob, /\benvironment:\s*preview-access\b/);
    assert.doesNotMatch(
      discoveryJob,
      /PREVIEW_SUPABASE_MANAGEMENT_TOKEN|PREVIEW_STAFF_PASSWORD|secrets\./,
    );
    assert.deepEqual(selectOpenSameRepositoryPrs([pull(9), pull(10)]), [9, 10]);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
