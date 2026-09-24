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
} from '../scripts/preview-access-core.mjs';

const repository = 'PHead2001/IT-Inventory-System';
const sha = 'a'.repeat(40);
const ref = 'b'.repeat(20);
const password = '123456'; // Dummy test value; production secret is never embedded.

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
      latest_check_run_id: 41,
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
    check: async () =>
      overrides.check ?? {
        id: 41,
        head_sha: sha,
        name: CHECK_NAME,
        app: { slug: CHECK_APP },
        status: 'completed',
        conclusion: 'success',
      },
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
    latest_check_run_id: 41,
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

test('waits for a check-run ID without querying an undefined check', async () => {
  const baseBranch = {
    project_ref: ref,
    parent_project_ref: PARENT_REF,
    is_default: false,
    git_branch: 'feature',
    pr_number: 9,
    status: 'ACTIVE_HEALTHY',
  };
  const { run, writes } = fixture({
    branchSequence: [
      [baseBranch],
      [{ ...baseBranch, latest_check_run_id: 41 }],
    ],
  });
  const checked = [];
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
      check: async (id) => {
        checked.push(id);
        return {
          id: 41,
          head_sha: sha,
          name: CHECK_NAME,
          app: { slug: CHECK_APP },
          status: 'completed',
          conclusion: 'success',
        };
      },
    },
  });
  assert.deepEqual(checked, [41, 41, 41, 41, 41]);
  assert.deepEqual(
    writes.map(([operation]) => operation),
    ['policy', 'create', 'member'],
  );
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
        check: {
          id: 41,
          head_sha: sha,
          name: CHECK_NAME,
          app: { slug: 'other' },
          status: 'completed',
          conclusion: 'success',
        },
      },
    },
    {
      name: 'stale check',
      overrides: {
        check: {
          id: 41,
          head_sha: 'c'.repeat(40),
          name: CHECK_NAME,
          app: { slug: CHECK_APP },
          status: 'completed',
          conclusion: 'success',
        },
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
      /timeout-minutes: 5[\s\S]*environment: preview-access/,
    );
    assert.match(workflow, /fail-fast: false/);
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
