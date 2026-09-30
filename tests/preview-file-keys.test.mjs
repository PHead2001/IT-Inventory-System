import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  provisionPreviewFiles,
  fingerprint,
  intentFor,
  selectFileEnv,
  selectDeployment,
} from '../scripts/preview-file-keys.mjs';
import {
  fileProviders,
  SQL,
  boundedJsonRequest,
} from '../scripts/preview-file-providers.mjs';
import { PARENT_REF } from '../scripts/preview-access-core.mjs';

const repository = 'PHead2001/IT-Inventory-System';
const sha = 'a'.repeat(40);
const child = 'b'.repeat(20);
const secret = 'c'.repeat(64); // Synthetic, never a provider credential.
const backend = { fingerprint: 'd'.repeat(64), updatedAt: 10 };
const keyId = `pvf${child}`;
const marker = intentFor(child, fingerprint(secret), sha, backend.fingerprint);

function fixture() {
  const writes = [];
  const pr = {
    number: 9,
    state: 'open',
    head: { ref: 'feature', sha, repo: { full_name: repository, id: 123 } },
    base: { ref: 'main', repo: { full_name: repository, id: 123 } },
  };
  const state = {
    key: null,
    foreignActive: 0,
    env: null,
    deployments: [],
    backend: { ...backend },
    pr,
    branch: {
      project_ref: child,
      parent_project_ref: PARENT_REF,
      is_default: false,
      git_branch: 'feature',
      pr_number: 9,
      status: 'ACTIVE_HEALTHY',
    },
    project: {
      id: 'prj_test',
      accountId: 'team_test',
      link: {
        type: 'github',
        org: 'PHead2001',
        repo: 'IT-Inventory-System',
        repoId: 123,
        productionBranch: 'main',
      },
    },
  };
  const options = {
    repository,
    number: 9,
    expectedSha: sha,
    pins: { projectId: 'prj_test', teamId: 'team_test' },
    random: () => Buffer.from(secret, 'hex'),
    pause: async () => {},
    attempts: 2,
    github: {
      pull: async () => structuredClone(state.pr),
      checks: async () => ({
        total_count: 1,
        check_runs: [
          {
            id: 41,
            head_sha: state.pr.head.sha,
            name: 'Supabase Preview',
            app: { slug: 'supabase' },
            details_url: `https://supabase.com/dashboard/project/${state.branch.project_ref}`,
            status: 'completed',
            conclusion: 'success',
          },
        ],
      }),
    },
    management: { branches: async () => [structuredClone(state.branch)] },
    database: {
      schema: async () => {},
      read: async () => ({
        rows: state.key ? [structuredClone(state.key)] : [],
        foreignActive: state.foreignActive,
      }),
      stage: async (_child, id, value) => {
        writes.push('stage');
        state.key ??= {
          key_id: id,
          secret: value,
          accepts_new: false,
          verify_until: '-infinity',
        };
      },
      activate: async (_child, id, value) => {
        writes.push('activate');
        if (
          state.key.key_id === id &&
          state.key.secret === value &&
          !state.key.accepts_new &&
          state.key.verify_until === '-infinity' &&
          !state.foreignActive
        )
          Object.assign(state.key, {
            accepts_new: true,
            verify_until: 'infinity',
          });
      },
    },
    vercel: {
      project: async () => structuredClone(state.project),
      assertBackend: async () => structuredClone(state.backend),
      envs: async () => ({
        envs: state.env ? [structuredClone(state.env)] : [],
      }),
      writeEnv: async (_id, body) => {
        writes.push('env');
        state.env = { ...body, id: 'env_test', updatedAt: 20 };
      },
      deployments: async () => ({
        deployments: structuredClone(state.deployments),
      }),
      createDeployment: async (context) => {
        writes.push('deploy');
        const row = {
          id: 'dpl_test',
          projectId: 'prj_test',
          target: null,
          createdAt: 30,
          readyState: 'READY',
          gitSource: {
            type: 'github',
            repoId: 123,
            ref: 'feature',
            sha: context.sha,
          },
          meta: { inventoryPreviewFiles: context.intent },
        };
        state.deployments.push(row);
        return structuredClone(row);
      },
      deployment: async (id) =>
        structuredClone(state.deployments.find((row) => row.id === id)),
    },
  };
  return { state, options, writes };
}
const staged = () => ({
  key_id: keyId,
  secret,
  accepts_new: false,
  verify_until: '-infinity',
});
const ownedEnv = (comment = marker) => ({
  id: 'env_test',
  key: 'INVENTORY_FILE_KEYS_JSON',
  gitBranch: 'feature',
  type: 'sensitive',
  visibility: 'secret',
  target: ['preview'],
  comment,
  updatedAt: 20,
});

test('file key stages once, deploys branch with current generation, then activates; exact proof rerun has no writes', async () => {
  const f = fixture();
  await provisionPreviewFiles(f.options);
  assert.deepEqual(f.writes, ['stage', 'env', 'deploy', 'activate']);
  assert.equal(f.state.key.secret, secret);
  assert.equal(f.state.key.verify_until, 'infinity');
  f.writes.length = 0;
  await provisionPreviewFiles(f.options);
  assert.deepEqual(f.writes, []);
});

test('lost stage response uses persisted secret rather than generating a replacement', async () => {
  const f = fixture();
  const stage = f.options.database.stage;
  f.options.database.stage = async (...args) => {
    await stage(...args);
    throw new Error(secret);
  };
  await provisionPreviewFiles(f.options);
  assert.equal(f.state.key.secret, secret);
  assert.equal(f.writes.filter((x) => x === 'stage').length, 1);
});

test('lost deployment response recovers only one complete matching provider deployment', async () => {
  const f = fixture();
  const create = f.options.vercel.createDeployment;
  f.options.vercel.createDeployment = async (...args) => {
    await create(...args);
    throw new Error(secret);
  };
  await provisionPreviewFiles(f.options);
  assert.equal(f.writes.filter((x) => x === 'deploy').length, 1);
});

test('uncertain same intent never blindly repeats deployment POST; a new SHA may proceed', async () => {
  const f = fixture();
  f.state.key = staged();
  f.state.env = ownedEnv();
  await assert.rejects(provisionPreviewFiles(f.options), {
    code: 'FILE_DEPLOYMENT_UNCERTAIN',
  });
  assert.deepEqual(f.writes, []);
  f.state.pr.head.sha = 'e'.repeat(40);
  f.options.expectedSha = f.state.pr.head.sha;
  await provisionPreviewFiles(f.options);
  assert.deepEqual(f.writes, ['env', 'deploy', 'activate']);
});

test('reset child or new database generation replaces only strictly automation-owned branch env', async () => {
  for (const oldChild of [child, 'f'.repeat(20)]) {
    const f = fixture();
    f.state.env = ownedEnv(
      intentFor(oldChild, '1'.repeat(64), sha, '2'.repeat(64)),
    );
    await provisionPreviewFiles(f.options);
    assert.equal(f.state.env.comment, marker);
    assert.equal(f.state.key.accepts_new, true);
  }
});

for (const [name, modify, code] of [
  [
    'manual active DB key',
    (f) => {
      f.state.foreignActive = 1;
    },
    'FILE_MANUAL_KEY',
  ],
  [
    'retired key',
    (f) => {
      f.state.key = { ...staged(), verify_until: '2026-01-01 00:00:00+00' };
    },
    'FILE_KEY_RETIRED',
  ],
  [
    'manual env',
    (f) => {
      f.state.key = staged();
      f.state.env = ownedEnv('manual');
    },
    'FILE_ENV_OWNERSHIP',
  ],
  [
    'production scoped env',
    (f) => {
      f.state.key = staged();
      f.state.env = { ...ownedEnv(), target: ['preview', 'production'] };
    },
    'FILE_ENV_OWNERSHIP',
  ],
  [
    'custom env',
    (f) => {
      f.state.key = staged();
      f.state.env = { ...ownedEnv(), customEnvironmentIds: ['custom'] };
    },
    'FILE_ENV_OWNERSHIP',
  ],
  [
    'production branch',
    (f) => {
      f.state.project.link.productionBranch = 'feature';
    },
    'FILE_PROJECT_DENIED',
  ],
  [
    'foreign repo',
    (f) => {
      f.state.project.link.repoId = 456;
    },
    'FILE_PROJECT_DENIED',
  ],
  [
    'wrong team',
    (f) => {
      f.state.project.accountId = 'other';
    },
    'FILE_PROJECT_DENIED',
  ],
  [
    'fork',
    (f) => {
      f.state.pr.head.repo.full_name = 'foreign/repo';
    },
    'PR_DENIED',
  ],
  [
    'parent',
    (f) => {
      f.state.branch.project_ref = PARENT_REF;
    },
    'BRANCH_DENIED',
  ],
  [
    'stale SHA',
    (f) => {
      f.state.pr.head.sha = 'e'.repeat(40);
    },
    'PR_DENIED',
  ],
])
  test(`file flow refuses ${name}`, async () => {
    const f = fixture();
    modify(f);
    await assert.rejects(provisionPreviewFiles(f.options), { code });
    assert.equal(f.writes.includes('activate'), false);
    assert.equal(f.writes.includes('deploy'), false);
  });

test('all split failures leave staged keys inactive and preserve an existing active generation', async () => {
  for (const active of [false, true])
    for (const phase of ['writeEnv', 'createDeployment', 'deployment']) {
      const f = fixture();
      f.state.key = {
        ...staged(),
        accepts_new: active,
        verify_until: active ? 'infinity' : '-infinity',
      };
      f.options.vercel[phase] = async () => {
        throw new Error(secret);
      };
      await assert.rejects(provisionPreviewFiles(f.options));
      assert.equal(f.state.key.accepts_new, active);
      assert.equal(f.state.key.secret, secret);
    }
});

test('revocation, foreign activation, stale head and child reset during deployment all refuse activation', async () => {
  for (const mutate of [
    (f) => {
      f.state.key.verify_until = '2026-01-01';
    },
    (f) => {
      f.state.foreignActive = 1;
    },
    (f) => {
      f.state.pr.head.sha = 'e'.repeat(40);
    },
    (f) => {
      f.state.branch.project_ref = 'f'.repeat(20);
    },
    (f) => {
      f.state.backend.fingerprint = '1'.repeat(64);
    },
  ]) {
    const f = fixture();
    const deployment = f.options.vercel.deployment;
    f.options.vercel.deployment = async (id) => {
      const result = await deployment(id);
      mutate(f);
      return result;
    };
    await assert.rejects(provisionPreviewFiles(f.options));
    assert.equal(f.writes.includes('activate'), false);
  }
});

test('bounded ready wait and failed build never activate', async () => {
  for (const readyState of ['BUILDING', 'ERROR', 'CANCELED']) {
    const f = fixture();
    const deployment = f.options.vercel.deployment;
    let reads = 0;
    f.options.vercel.deployment = async (id) => ({
      ...(await deployment(id)),
      readyState,
      ...(reads++ && {}),
    });
    await assert.rejects(provisionPreviewFiles(f.options));
    assert.ok(reads <= 2);
    assert.equal(f.state.key.accepts_new, false);
  }
});

test('env and deployment pagination/ambiguity fail closed', () => {
  assert.throws(
    () => selectFileEnv({ envs: [ownedEnv(), ownedEnv()] }, 'feature'),
    { code: 'FILE_ENV_AMBIGUOUS' },
  );
  assert.throws(
    () => selectFileEnv({ envs: [], pagination: { next: 123 } }, 'feature'),
    { code: 'FILE_ENV_BOUNDS' },
  );
  assert.throws(
    () => selectDeployment({ deployments: [], pagination: { next: 123 } }, {}),
    { code: 'FILE_DEPLOYMENT_BOUNDS' },
  );
});

test('provider adapter sends parameterized single guarded statements and fresh branch gitSource, never deploymentId or target', async () => {
  const calls = [];
  const providers = fileProviders({
    managementToken: 'dummy',
    vercelToken: 'dummy',
    pins: { projectId: 'prj_test', teamId: 'team_test' },
    request: async (url, options) => {
      calls.push({ url, options });
      return {};
    },
  });
  await providers.database.stage(child, keyId, secret);
  await providers.database.activate(child, keyId, secret);
  await providers.vercel.createDeployment({
    repoId: 123,
    branch: 'feature',
    sha,
    intent: marker,
  });
  assert.deepEqual(calls[0].options.body.parameters, [keyId, secret]);
  assert.equal(calls[0].options.body.read_only, false);
  assert.match(SQL.stage, /from guard/);
  assert.match(SQL.stage, /on conflict\(key_id\) do nothing/);
  assert.match(
    SQL.activate,
    /from guard where key_id=\$1 and secret=\$2 and not accepts_new/,
  );
  assert.equal(SQL.activate.includes('begin;'), false);
  assert.deepEqual(calls[2].options.body.gitSource, {
    type: 'github',
    repoId: 123,
    ref: 'feature',
    sha,
  });
  assert.equal('target' in calls[2].options.body, false);
  assert.equal('deploymentId' in calls[2].options.body, false);
  await assert.rejects(providers.database.stage(PARENT_REF, keyId, secret), {
    code: 'FILE_DATABASE_TARGET',
  });
});

test('provider backend checks reject contradictory wider preview URL and track ID/revision', async () => {
  const rows = [
    {
      id: 'url',
      key: 'NEXT_PUBLIC_SUPABASE_URL',
      target: ['preview'],
      gitBranch: 'feature',
      updatedAt: 5,
    },
  ];
  let urlValue = `https://${child}.supabase.co`;
  const providers = fileProviders({
    pins: { projectId: 'prj_test', teamId: 'team_test' },
    request: async (url) =>
      url.includes('/env?') ? { envs: rows } : { value: urlValue },
  });
  const first = await providers.vercel.assertBackend('feature', child);
  rows[0].updatedAt = 6;
  assert.notEqual(
    (await providers.vercel.assertBackend('feature', child)).fingerprint,
    first.fingerprint,
  );
  urlValue = `https://${PARENT_REF}.supabase.co`;
  await assert.rejects(providers.vercel.assertBackend('feature', child), {
    code: 'FILE_BACKEND_DENIED',
  });
});

test('HTTP transport bounds content and suppresses raw provider error/secret', async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response(secret, { status: 403 });
    await assert.rejects(
      boundedJsonRequest('https://example.invalid'),
      (error) =>
        error.code === 'FILE_HTTP_403' && !error.message.includes(secret),
    );
    globalThis.fetch = async () => new Response('x'.repeat(1048577));
    await assert.rejects(boundedJsonRequest('https://example.invalid'), {
      code: 'FILE_RESPONSE_BOUNDS',
    });
  } finally {
    globalThis.fetch = original;
  }
});

test('file workflow credentials remain protected in trusted main provisioning only', () => {
  const workflow = readFileSync('.github/workflows/preview-access.yml', 'utf8');
  const [discover, provision] = workflow.split('  provision:');
  assert.equal(discover.includes('PREVIEW_VERCEL_TOKEN'), false);
  assert.match(
    provision,
    /PREVIEW_VERCEL_TOKEN: \$\{\{ secrets\.PREVIEW_VERCEL_TOKEN \}\}/,
  );
  assert.match(provision, /environment: preview-access/);
  assert.match(provision, /ref: refs\/heads\/main/);
  assert.equal(workflow.includes('schedule:'), false);
});

test('broader applicable preview file key is a collision; production-only key is untouched', async () => {
  for (const target of [['preview'], ['production']]) {
    const f = fixture();
    const envs = f.options.vercel.envs;
    f.options.vercel.envs = async () => ({
      envs: [
        { ...ownedEnv('manual'), gitBranch: null, target },
        ...(await envs()).envs,
      ],
    });
    if (target[0] === 'preview') {
      await assert.rejects(provisionPreviewFiles(f.options), {
        code: 'FILE_ENV_OWNERSHIP',
      });
      assert.deepEqual(f.writes, []);
    } else {
      await provisionPreviewFiles(f.options);
      assert.equal(f.state.key.accepts_new, true);
    }
  }
});

test('lost activation response accepts only a fresh exact secret active/infinity readback', async () => {
  const f = fixture();
  const activate = f.options.database.activate;
  f.options.database.activate = async (...args) => {
    await activate(...args);
    throw new Error(secret);
  };
  await provisionPreviewFiles(f.options);
  assert.equal(f.state.key.accepts_new, true);
  const denied = fixture();
  denied.options.database.activate = async () => {};
  await assert.rejects(provisionPreviewFiles(denied.options), {
    code: 'FILE_ACTIVATION_UNCERTAIN',
  });
});

test('lost environment response persists intent but cannot cause a blind deployment retry', async () => {
  const f = fixture();
  const write = f.options.vercel.writeEnv;
  f.options.vercel.writeEnv = async (...args) => {
    await write(...args);
    throw new Error(secret);
  };
  await assert.rejects(provisionPreviewFiles(f.options), {
    code: 'FILE_ENV_WRITE_UNCERTAIN',
  });
  f.options.vercel.writeEnv = write;
  await assert.rejects(provisionPreviewFiles(f.options), {
    code: 'FILE_DEPLOYMENT_UNCERTAIN',
  });
  assert.equal(f.writes.includes('deploy'), false);
  assert.equal(f.state.key.accepts_new, false);
});

test('recovery refuses deployments predating intent or backend revision and altered source/scope', async () => {
  for (const change of [
    (row) => {
      row.createdAt = 19;
    },
    (row) => {
      row.gitSource.sha = 'f'.repeat(40);
    },
    (row) => {
      row.gitSource.ref = 'main';
    },
    (row) => {
      row.target = 'production';
    },
    (row) => {
      row.customEnvironment = { id: 'custom' };
    },
    (row) => {
      row.projectId = 'foreign';
    },
  ]) {
    const f = fixture();
    await provisionPreviewFiles(f.options);
    f.state.key = staged();
    f.writes.length = 0;
    change(f.state.deployments[0]);
    await assert.rejects(provisionPreviewFiles(f.options), {
      code: 'FILE_DEPLOYMENT_DENIED',
    });
    assert.deepEqual(f.writes, []);
  }
});

test('fresh env ownership check refuses changed environment ID before write', async () => {
  const f = fixture();
  f.state.key = staged();
  f.state.env = ownedEnv(
    intentFor(child, fingerprint(secret), 'f'.repeat(40), backend.fingerprint),
  );
  let reads = 0;
  const envs = f.options.vercel.envs;
  f.options.vercel.envs = async () => {
    reads++;
    if (reads === 3) f.state.env.id = 'replacement';
    return envs();
  };
  await assert.rejects(provisionPreviewFiles(f.options), {
    code: 'FILE_ENV_CHANGED',
  });
  assert.deepEqual(f.writes, []);
});

test('same-ID/comment secret edit during build advances revision and refuses activation', async () => {
  const f = fixture();
  const deployment = f.options.vercel.deployment;
  f.options.vercel.deployment = async (id) => {
    const row = await deployment(id);
    f.state.env.updatedAt++;
    return row;
  };
  await assert.rejects(provisionPreviewFiles(f.options), {
    code: 'FILE_ENV_CHANGED',
  });
  assert.equal(f.writes.includes('activate'), false);
});

test('recovery rejects missing or invalid existing environment revision', async () => {
  for (const updatedAt of [undefined, -1, '20', NaN]) {
    const f = fixture();
    await provisionPreviewFiles(f.options);
    f.writes.length = 0;
    f.state.env.updatedAt = updatedAt;
    await assert.rejects(provisionPreviewFiles(f.options), {
      code: 'FILE_ENV_OWNERSHIP',
    });
    assert.deepEqual(f.writes, []);
  }
});

test('deployment listing uses current verified v7 API and hydrates metadata matches', async () => {
  const calls = [];
  const providers = fileProviders({
    pins: { projectId: 'prj_test', teamId: 'team_test' },
    request: async (url) => {
      calls.push(url);
      if (url.includes('/v7/deployments?'))
        return {
          deployments: [
            { uid: 'dpl_test', meta: { inventoryPreviewFiles: marker } },
          ],
          pagination: { next: null },
        };
      return { id: 'dpl_test' };
    },
  });
  await providers.vercel.deployments({
    branch: 'feature',
    sha,
    intent: marker,
  });
  assert.match(calls[0], /\/v7\/deployments\?/);
  assert.match(calls[1], /\/v13\/deployments\/dpl_test\?/);
});

test('normal preview build can become ready after sixty seconds within wall-clock deadline', async () => {
  const f = fixture();
  const deployment = f.options.vercel.deployment;
  let clock = 0;
  f.options.now = () => clock;
  f.options.attempts = 100;
  f.options.pause = async () => {
    clock += 5000;
  };
  f.options.vercel.deployment = async (id) => ({
    ...(await deployment(id)),
    readyState: clock >= 90000 ? 'READY' : 'BUILDING',
  });
  await provisionPreviewFiles(f.options);
  assert.equal(clock, 90000);
  assert.equal(f.state.key.accepts_new, true);
});

test('eight-minute wall-clock deadline stops readiness without activation', async () => {
  const f = fixture();
  const deployment = f.options.vercel.deployment;
  let clock = 0;
  let reads = 0;
  f.options.now = () => clock;
  f.options.attempts = 100;
  f.options.pause = async () => {
    clock += 5000;
  };
  f.options.vercel.deployment = async (id) => {
    reads++;
    return { ...(await deployment(id)), readyState: 'BUILDING' };
  };
  await assert.rejects(provisionPreviewFiles(f.options), {
    code: 'FILE_DEPLOYMENT_PENDING',
  });
  assert.equal(clock, 480000);
  assert.equal(reads, 96);
  assert.equal(f.state.key.accepts_new, false);
});

test('an exact-branch production-only file key never blocks or mutates preview state', async () => {
  const f = fixture();
  const envs = f.options.vercel.envs;
  f.options.vercel.envs = async () => ({
    envs: [
      { ...ownedEnv('manual'), id: 'prod_only', target: ['production'] },
      ...(await envs()).envs,
    ],
  });
  await provisionPreviewFiles(f.options);
  assert.equal(f.state.env.target[0], 'preview');
});
