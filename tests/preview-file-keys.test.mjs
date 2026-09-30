import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  provisionPreviewFiles,
  fingerprint,
  intentFor,
  selectFileEnv,
  selectDeployment,
  parseIntent,
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
const backend = {
  fingerprint: 'd'.repeat(64),
  updatedAt: 10,
  legacyFingerprint: '1'.repeat(64),
  legacyUpdatedAt: 5,
};
const publicKey = 'synthetic-child-publishable';
const publicKeys = [
  { type: 'publishable', name: 'default', api_key: publicKey },
];
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
    management: {
      branches: async () => [structuredClone(state.branch)],
      keys: async (ref) => {
        assert.equal(ref, child);
        return structuredClone(publicKeys);
      },
    },
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
        state.env = {
          ...body,
          id: 'env_test',
          updatedAt: (state.env?.updatedAt ?? 19) + 1,
        };
      },
      deployments: async () => ({
        deployments: structuredClone(state.deployments),
      }),
      createDeployment: async (context) => {
        writes.push('deploy');
        const row = {
          id: `dpl_test_${state.deployments.length}`,
          projectId: 'prj_test',
          target: null,
          createdAt: state.env.updatedAt + 10,
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

function backendFixture() {
  const state = {
    rows: [
      {
        id: 'url',
        key: 'NEXT_PUBLIC_SUPABASE_URL',
        target: ['preview'],
        gitBranch: 'feature',
        updatedAt: 5,
      },
      {
        id: 'public',
        key: 'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
        target: ['preview'],
        gitBranch: 'feature',
        updatedAt: 10,
      },
    ],
    values: { url: `https://${child}.supabase.co`, public: publicKey },
    keys: structuredClone(publicKeys),
    pagination: undefined,
  };
  const providers = fileProviders({
    pins: { projectId: 'prj_test', teamId: 'team_test' },
    request: async (url) =>
      url.includes('/env?')
        ? { envs: structuredClone(state.rows), pagination: state.pagination }
        : { value: state.values[new URL(url).pathname.split('/').at(-1)] },
  });
  return {
    state,
    check: () => providers.vercel.assertBackend('feature', child, state.keys),
    providers,
  };
}

function existingDeployment(
  f,
  readyState = 'ERROR',
  { legacy = false, attempt = 1 } = {},
) {
  const intent = legacy
    ? `inventory-preview-files:v1:${child}:${fingerprint(secret)}:${sha}:${backend.legacyFingerprint}`
    : intentFor(child, fingerprint(secret), sha, backend.fingerprint, attempt);
  f.state.key = staged();
  f.state.env = ownedEnv(intent);
  f.state.deployments = [
    {
      id: 'dpl_old',
      projectId: 'prj_test',
      target: null,
      createdAt: 30,
      readyState,
      gitSource: { type: 'github', repoId: 123, ref: 'feature', sha },
      meta: { inventoryPreviewFiles: intent },
    },
  ];
}

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

test('environment PATCH obeys strict v9 schema and preserves sensitive scope, intent and value', async () => {
  const calls = [];
  const documented = [
    'key',
    'target',
    'gitBranch',
    'type',
    'value',
    'customEnvironmentIds',
    'comment',
  ];
  const providers = fileProviders({
    managementToken: 'dummy',
    vercelToken: 'dummy',
    pins: { projectId: 'prj_test', teamId: 'team_test' },
    request: async (url, options) => {
      if (options.method === 'PATCH') {
        // Mirrors additionalProperties:false in Vercel's official OpenAPI.
        assert.deepEqual(
          Object.keys(options.body).filter((key) => !documented.includes(key)),
          [],
        );
        // Saved Sensitive/Secret names cannot be edited, even to the same name.
        assert.equal(Object.hasOwn(options.body, 'key'), false);
      }
      calls.push({ url, options });
      return {};
    },
  });
  const body = {
    key: 'INVENTORY_FILE_KEYS_JSON',
    value: JSON.stringify({ [keyId]: secret }),
    type: 'sensitive',
    visibility: 'secret',
    target: ['preview'],
    gitBranch: 'feature',
    comment: marker,
  };
  const before = structuredClone(body);
  await providers.vercel.writeEnv('env_test', body);
  const { visibility, key, ...expected } = body;
  assert.equal(visibility, 'secret');
  assert.equal(key, 'INVENTORY_FILE_KEYS_JSON');
  assert.deepEqual(calls[0].options.body, expected);
  assert.equal(calls[0].options.method, 'PATCH');
  assert.equal(
    new URL(calls[0].url).pathname,
    '/v9/projects/prj_test/env/env_test',
  );
  assert.equal(new URL(calls[0].url).searchParams.get('teamId'), 'team_test');
  assert.deepEqual(body, before);
  await providers.vercel.writeEnv(null, body);
  assert.equal(calls[1].options.method, 'POST');
  assert.deepEqual(calls[1].options.body, before);
});

test('environment ownership still requires secret visibility before writes and after readback', async () => {
  for (const visibility of [undefined, 'config']) {
    const before = fixture();
    before.state.key = staged();
    before.state.env = { ...ownedEnv(), visibility };
    await assert.rejects(provisionPreviewFiles(before.options), {
      code: 'FILE_ENV_OWNERSHIP',
    });
    assert.deepEqual(before.writes, []);
    const readback = fixture();
    const write = readback.options.vercel.writeEnv;
    readback.options.vercel.writeEnv = async (...args) => {
      await write(...args);
      readback.state.env.visibility = visibility;
    };
    await assert.rejects(provisionPreviewFiles(readback.options), {
      code: 'FILE_ENV_OWNERSHIP',
    });
    assert.deepEqual(readback.writes, ['stage', 'env']);
    assert.equal(readback.state.key.accepts_new, false);
  }
});

test('provider backend checks reject contradictory wider preview URL and track ID/revision', async () => {
  const f = backendFixture();
  const first = await f.check();
  f.state.rows[0].updatedAt = 6;
  assert.notEqual((await f.check()).fingerprint, first.fingerprint);
  f.state.values.url = `https://${PARENT_REF}.supabase.co`;
  await assert.rejects(f.check(), {
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

test('v2 marker parser bounds persisted attempts and retains strict v1 compatibility', () => {
  assert.equal(parseIntent(marker).attempt, 1);
  assert.equal(parseIntent(marker).version, 2);
  assert.equal(
    parseIntent(
      `inventory-preview-files:v1:${child}:${fingerprint(secret)}:${sha}:${backend.legacyFingerprint}`,
    ).attempt,
    1,
  );
  for (const invalid of [
    marker.replace(/:1$/, ':0'),
    marker.replace(/:1$/, ':4'),
    marker.replace(/:1$/, ''),
    marker.replace(':v2:', ':v1:'),
    marker + ':1',
  ])
    assert.equal(parseIntent(invalid), null);
});

test('authoritative child key classification accepts modern publishable and legacy anon without decoding', async () => {
  for (const key of [
    { type: 'publishable', name: 'custom', api_key: publicKey },
    {
      type: 'legacy',
      name: 'anon',
      api_key: 'opaque-authoritative-legacy-key',
    },
  ]) {
    const f = backendFixture();
    f.state.keys = [
      key,
      { type: 'secret', name: 'default', api_key: 'synthetic-private-key' },
    ];
    f.state.values.public = key.api_key;
    const result = await f.check();
    assert.match(result.fingerprint, /^[a-f0-9]{64}$/);
    assert.equal(JSON.stringify(result).includes(key.api_key), false);
  }
});

test('wrong-child, secret/service-role, missing and malformed public keys fail closed', async () => {
  for (const change of [
    (f) => {
      f.state.values.public = 'some-other-child-public-key';
    },
    (f) => {
      f.state.keys = [{ type: 'secret', name: 'default', api_key: publicKey }];
    },
    (f) => {
      f.state.keys = [
        { type: 'legacy', name: 'service_role', api_key: publicKey },
      ];
    },
    (f) => {
      f.state.keys = [];
    },
    (f) => {
      f.state.keys = { api_key: publicKey };
    },
    (f) => {
      f.state.keys = [{ type: 'publishable', api_key: '' }];
    },
    (f) => {
      f.state.keys = [
        { type: 'publishable', api_key: publicKey },
        { type: 'secret', api_key: publicKey },
      ];
    },
    (f) => {
      f.state.keys = Array.from({ length: 101 }, (_, i) => ({
        type: 'publishable',
        api_key: String(i),
      }));
    },
    (f) => {
      f.state.rows = f.state.rows.filter((row) => row.id !== 'public');
    },
  ]) {
    const f = backendFixture();
    change(f);
    await assert.rejects(f.check(), (error) =>
      ['FILE_BACKEND_DENIED', 'FILE_PUBLIC_KEYS_DENIED'].includes(error.code),
    );
  }
});

test('backend fingerprint binds public key revisions, IDs, scopes and value digests; legacy fingerprint stays URL-only', async () => {
  for (const change of [
    (f) => {
      f.state.rows[1].updatedAt++;
    },
    (f) => {
      f.state.rows[1].target = ['preview', 'production'];
    },
    (f) => {
      f.state.rows[1].gitBranch = null;
    },
    (f) => {
      f.state.rows[1].id = 'changed';
      f.state.values.changed = publicKey;
    },
    (f) => {
      f.state.keys.push({ type: 'publishable', api_key: 'rotated-public' });
      f.state.values.public = 'rotated-public';
    },
  ]) {
    const f = backendFixture();
    const first = await f.check();
    change(f);
    const next = await f.check();
    assert.notEqual(next.fingerprint, first.fingerprint);
    assert.equal(next.legacyFingerprint, first.legacyFingerprint);
  }
});

test('broader contradictory key, duplicate scopes, malformed scopes and bounded listings are denied', async () => {
  for (const change of [
    (f) => {
      f.state.rows.push({ ...f.state.rows[1], id: 'broader', gitBranch: null });
      f.state.values.broader = 'foreign-key';
    },
    (f) => {
      f.state.rows.push({ ...f.state.rows[1], id: 'duplicate' });
      f.state.values.duplicate = publicKey;
    },
    (f) => {
      f.state.rows[1].customEnvironmentIds = ['custom'];
    },
    (f) => {
      f.state.rows[1].target = 'preview';
    },
    (f) => {
      f.state.rows[1].target = ['preview', 'unknown'];
    },
    (f) => {
      f.state.rows[1].updatedAt = -1;
    },
    (f) => {
      f.state.pagination = { next: 1 };
    },
  ]) {
    const f = backendFixture();
    change(f);
    await assert.rejects(f.check());
  }
  const f = backendFixture();
  f.state.rows.push({
    ...f.state.rows[1],
    id: 'production-only',
    target: ['production'],
  });
  assert.match((await f.check()).fingerprint, /^[a-f0-9]{64}$/);
});

test('guard queries child keys every time and refuses a key-only revision change during build', async () => {
  const f = fixture(),
    b = backendFixture();
  let keyReads = 0;
  f.options.management.keys = async (ref) => {
    assert.equal(ref, child);
    keyReads++;
    return b.state.keys;
  };
  f.options.vercel.assertBackend = b.providers.vercel.assertBackend;
  const hydrate = f.options.vercel.deployment;
  f.options.vercel.deployment = async (id) => {
    const row = await hydrate(id);
    b.state.rows[1].updatedAt++;
    return row;
  };
  await assert.rejects(provisionPreviewFiles(f.options), {
    code: 'FILE_BACKEND_CHANGED',
  });
  assert.ok(keyReads >= 4);
  assert.equal(f.writes.includes('activate'), false);
});

test('wrong configured child public key refuses staging before any database or provider write', async () => {
  const f = fixture(),
    b = backendFixture();
  b.state.values.public = 'other-child-key';
  f.options.vercel.assertBackend = b.providers.vercel.assertBackend;
  await assert.rejects(provisionPreviewFiles(f.options), {
    code: 'FILE_BACKEND_DENIED',
  });
  assert.deepEqual(f.writes, []);
});

test('authoritative public-key revocation before retry prevents successor writes', async () => {
  const f = fixture(),
    b = backendFixture();
  const current = await b.check();
  existingDeployment(f);
  const intent = intentFor(
    child,
    fingerprint(secret),
    sha,
    current.fingerprint,
  );
  f.state.env.comment = intent;
  f.state.deployments[0].meta.inventoryPreviewFiles = intent;
  f.options.management.keys = async () => b.state.keys;
  f.options.vercel.assertBackend = b.providers.vercel.assertBackend;
  const hydrate = f.options.vercel.deployment;
  f.options.vercel.deployment = async (id) => {
    const row = await hydrate(id);
    b.state.keys = [];
    return row;
  };
  await assert.rejects(provisionPreviewFiles(f.options), {
    code: 'FILE_PUBLIC_KEYS_DENIED',
  });
  assert.deepEqual(f.writes, []);
});

test('conclusive failed/canceled attempt advances once, preserves secret and recovers READY without writes', async () => {
  for (const state of ['ERROR', 'CANCELED']) {
    const f = fixture();
    existingDeployment(f, state);
    await provisionPreviewFiles(f.options);
    assert.deepEqual(f.writes, ['env', 'deploy', 'activate']);
    assert.equal(parseIntent(f.state.env.comment).attempt, 2);
    assert.equal(f.state.key.secret, secret);
    f.writes.length = 0;
    await provisionPreviewFiles(f.options);
    assert.deepEqual(f.writes, []);
  }
});

test('three attempts persist across invocations and each invocation issues at most one deployment POST', async () => {
  const f = fixture();
  const create = f.options.vercel.createDeployment;
  f.options.vercel.createDeployment = async (context) => {
    const row = await create(context);
    f.state.deployments.find((d) => d.id === row.id).readyState = 'ERROR';
    return { ...row, readyState: 'ERROR' };
  };
  for (let attempt = 1; attempt <= 3; attempt++) {
    const previous = f.writes.filter((w) => w === 'deploy').length;
    await assert.rejects(provisionPreviewFiles(f.options), {
      code: 'FILE_DEPLOYMENT_FAILED',
    });
    assert.equal(f.writes.filter((w) => w === 'deploy').length, previous + 1);
    assert.equal(parseIntent(f.state.env.comment).attempt, attempt);
  }
  const writes = [...f.writes];
  await assert.rejects(provisionPreviewFiles(f.options), {
    code: 'FILE_DEPLOYMENT_LIMIT',
  });
  assert.deepEqual(f.writes, writes);
  assert.equal(f.state.key.secret, secret);
  assert.equal(f.state.key.accepts_new, false);
});

test('pending, unknown, missing, duplicate and inaccessible attempts never advance', async () => {
  for (const state of ['BUILDING', 'UNKNOWN', undefined]) {
    const f = fixture();
    existingDeployment(f, state);
    // Explicit undefined cannot use the helper's default.
    f.state.deployments[0].readyState = state;
    await assert.rejects(provisionPreviewFiles(f.options), (error) =>
      ['FILE_DEPLOYMENT_PENDING', 'FILE_DEPLOYMENT_UNCERTAIN'].includes(
        error.code,
      ),
    );
    assert.deepEqual(f.writes, []);
  }
  for (const change of [
    (f) => {
      f.state.deployments = [];
    },
    (f) => {
      f.state.deployments.push(structuredClone(f.state.deployments[0]));
    },
    (f) => {
      f.options.vercel.deployment = async () => {
        throw new Error('unavailable');
      };
    },
    (f) => {
      const hydrate = f.options.vercel.deployment;
      f.options.vercel.deployment = async (id) => ({
        ...(await hydrate(id)),
        id: 'dpl_foreign',
      });
    },
  ]) {
    const f = fixture();
    existingDeployment(f);
    change(f);
    await assert.rejects(provisionPreviewFiles(f.options));
    assert.deepEqual(f.writes, []);
  }
});

test('adapter hydration refuses a response for a different deployment ID', async () => {
  const providers = fileProviders({
    pins: { projectId: 'prj_test', teamId: 'team_test' },
    request: async () => ({ id: 'dpl_foreign' }),
  });
  await assert.rejects(providers.vercel.deployment('dpl_expected'), {
    code: 'FILE_DEPLOYMENT_DENIED',
  });
});

test('pending same marker waits for readiness and reuses its exact deployment', async () => {
  const f = fixture();
  existingDeployment(f, 'BUILDING');
  f.options.pause = async () => {
    f.state.deployments[0].readyState = 'READY';
  };
  await provisionPreviewFiles(f.options);
  assert.deepEqual(f.writes, ['activate']);
  assert.equal(parseIntent(f.state.env.comment).attempt, 1);
});

test('lost successor POST recovers only its exact marker; lost marker response remains uncertain', async () => {
  const f = fixture();
  existingDeployment(f);
  const create = f.options.vercel.createDeployment;
  f.options.vercel.createDeployment = async (context) => {
    await create(context);
    throw new Error('response lost');
  };
  await provisionPreviewFiles(f.options);
  assert.equal(f.writes.filter((w) => w === 'deploy').length, 1);
  assert.equal(parseIntent(f.state.env.comment).attempt, 2);
  const missing = fixture();
  existingDeployment(missing);
  missing.options.vercel.createDeployment = async () => {
    missing.writes.push('deploy');
    throw new Error('response lost');
  };
  await assert.rejects(provisionPreviewFiles(missing.options), {
    code: 'FILE_DEPLOYMENT_UNCERTAIN',
  });
  await assert.rejects(provisionPreviewFiles(missing.options), {
    code: 'FILE_DEPLOYMENT_UNCERTAIN',
  });
  assert.equal(missing.writes.filter((w) => w === 'deploy').length, 1);
  const lostMarker = fixture();
  existingDeployment(lostMarker);
  const write = lostMarker.options.vercel.writeEnv;
  lostMarker.options.vercel.writeEnv = async (...args) => {
    await write(...args);
    throw new Error('response lost');
  };
  await assert.rejects(provisionPreviewFiles(lostMarker.options), {
    code: 'FILE_ENV_WRITE_UNCERTAIN',
  });
  await assert.rejects(provisionPreviewFiles(lostMarker.options), {
    code: 'FILE_DEPLOYMENT_UNCERTAIN',
  });
  assert.equal(parseIntent(lostMarker.state.env.comment).attempt, 2);
  assert.equal(lostMarker.writes.includes('deploy'), false);
});

test('v1 READY and failed deployments migrate with the same secret to v2 attempt2 and a fresh deployment', async () => {
  for (const state of ['READY', 'ERROR', 'CANCELED']) {
    for (const active of [false, true]) {
      const f = fixture();
      existingDeployment(f, state, { legacy: true });
      if (active)
        Object.assign(f.state.key, {
          accepts_new: true,
          verify_until: 'infinity',
        });
      await provisionPreviewFiles(f.options);
      assert.deepEqual(
        f.writes,
        active ? ['env', 'deploy'] : ['env', 'deploy', 'activate'],
      );
      assert.equal(parseIntent(f.state.env.comment).version, 2);
      assert.equal(parseIntent(f.state.env.comment).attempt, 2);
      assert.equal(f.state.key.secret, secret);
    }
  }
});

test('v1 nonterminal waits; missing or mismatched legacy provenance is never adopted', async () => {
  const pending = fixture();
  existingDeployment(pending, 'BUILDING', { legacy: true });
  await assert.rejects(provisionPreviewFiles(pending.options), {
    code: 'FILE_DEPLOYMENT_PENDING',
  });
  assert.deepEqual(pending.writes, []);
  for (const change of [
    (f) => {
      f.state.backend.legacyFingerprint = '2'.repeat(64);
    },
    (f) => {
      f.state.deployments = [];
    },
    (f) => {
      f.state.deployments[0].gitSource.sha = 'f'.repeat(40);
    },
    (f) => {
      f.state.deployments[0].createdAt = 19;
    },
  ]) {
    const f = fixture();
    existingDeployment(f, 'READY', { legacy: true });
    change(f);
    await assert.rejects(provisionPreviewFiles(f.options));
    assert.deepEqual(f.writes, []);
  }
});

test('legacy same-generation URL mismatch also refuses a different SHA rather than overwriting provenance', async () => {
  const f = fixture();
  existingDeployment(f, 'READY', { legacy: true });
  f.state.pr.head.sha = 'e'.repeat(40);
  f.options.expectedSha = f.state.pr.head.sha;
  f.state.backend.legacyFingerprint = '2'.repeat(64);
  await assert.rejects(provisionPreviewFiles(f.options), {
    code: 'FILE_BACKEND_CHANGED',
  });
  assert.deepEqual(f.writes, []);
});

test('v2 same-generation backend drift refuses a new SHA while unchanged binding starts attempt1', async () => {
  for (const changed of [false, true]) {
    const f = fixture();
    existingDeployment(f);
    f.state.pr.head.sha = 'e'.repeat(40);
    f.options.expectedSha = f.state.pr.head.sha;
    if (changed) f.state.backend.fingerprint = '2'.repeat(64);
    if (changed) {
      await assert.rejects(provisionPreviewFiles(f.options), {
        code: 'FILE_BACKEND_CHANGED',
      });
      assert.deepEqual(f.writes, []);
    } else {
      await provisionPreviewFiles(f.options);
      assert.equal(parseIntent(f.state.env.comment).attempt, 1);
      assert.equal(parseIntent(f.state.env.comment).sha, f.state.pr.head.sha);
      assert.equal(f.state.key.secret, secret);
      assert.equal(f.writes.filter((w) => w === 'deploy').length, 1);
    }
  }
});

test('fresh source, backend, env revision and key retirement/revocation guards deny successor writes', async () => {
  for (const change of [
    (f) => {
      f.state.pr.head.sha = 'e'.repeat(40);
    },
    (f) => {
      f.state.backend.fingerprint = '2'.repeat(64);
    },
    (f) => {
      f.state.env.updatedAt++;
    },
    (f) => {
      f.state.key.verify_until = '2026-01-01';
    },
    (f) => {
      f.state.foreignActive = 1;
    },
    (f) => {
      f.state.key.secret = 'f'.repeat(64);
    },
  ]) {
    const f = fixture();
    existingDeployment(f);
    const hydrate = f.options.vercel.deployment;
    f.options.vercel.deployment = async (id) => {
      const row = await hydrate(id);
      change(f);
      return row;
    };
    await assert.rejects(provisionPreviewFiles(f.options));
    assert.deepEqual(f.writes, []);
  }
});
