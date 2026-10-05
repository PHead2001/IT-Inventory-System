import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { boundedJsonRequest, SQL } from '../scripts/preview-file-providers.mjs';
import {
  provisionStagingFiles,
  STAGING_PINS,
  STAGING_KEY_ID,
  parseStagingIntent,
  selectStagingFileEnv,
  stagingIntentFor,
} from '../scripts/staging-file-keys.mjs';
import {
  stagingFileProviders,
  migrationRevision,
  STAGING_SCHEMA_SQL,
  STAGING_FILE_MIGRATIONS,
} from '../scripts/staging-file-keys-providers.mjs';
import { fingerprint } from '../scripts/preview-file-keys.mjs';
import {
  STAGING_REF,
  PRODUCTION_REF,
} from '../scripts/staging-user-sync-core.mjs';

const sha = 'a'.repeat(40);
const secret = 'b'.repeat(64); // Synthetic fixture only.
const backend = { fingerprint: 'c'.repeat(64), updatedAt: 10 };
const revision = migrationRevision(
  STAGING_FILE_MIGRATIONS.map((version) => ({ version })),
);
function fixture() {
  const writes = [];
  const original = {
    id: 'dpl_baseline',
    projectId: STAGING_PINS.projectId,
    target: null,
    readyState: 'READY',
    gitSource: {
      type: 'github',
      repoId: STAGING_PINS.repoId,
      ref: 'staging',
      sha: 'd'.repeat(40),
    },
  };
  const state = {
    key: null,
    foreignActive: 0,
    envs: [],
    deployments: [],
    current: original,
    backend: { ...backend },
    revision,
    nextState: 'READY',
    missingRuntime: null,
    schemaReady: true,
    branch: {
      name: 'staging',
      project_ref: STAGING_REF,
      parent_project_ref: PRODUCTION_REF,
      persistent: true,
      is_default: false,
      git_branch: 'staging',
      status: 'ACTIVE_HEALTHY',
    },
    project: {
      id: STAGING_PINS.projectId,
      accountId: STAGING_PINS.teamId,
      link: {
        type: 'github',
        org: 'PHead2001',
        repo: 'IT-Inventory-System',
        repoId: STAGING_PINS.repoId,
        productionBranch: 'main',
      },
    },
  };
  const options = {
    expectedSha: sha,
    expectedMigrationRevision: revision,
    expectedCurrentDeployment: original.id,
    random: () => Buffer.from(secret, 'hex'),
    attempts: 2,
    pause: async () => {},
    management: {
      branches: async (parent) => {
        assert.equal(parent, PRODUCTION_REF);
        return [structuredClone(state.branch)];
      },
      keys: async (child) => {
        assert.equal(child, STAGING_REF);
        return [{ type: 'publishable', api_key: 'synthetic-public' }];
      },
    },
    database: {
      schema: async (child) => {
        assert.equal(child, STAGING_REF);
        return state.schemaReady;
      },
      migrationRevision: async (child) => {
        assert.equal(child, STAGING_REF);
        return state.revision;
      },
      read: async (child, id) => {
        assert.equal(child, STAGING_REF);
        assert.equal(id, STAGING_KEY_ID);
        return {
          rows: state.key ? [structuredClone(state.key)] : [],
          foreignActive: state.foreignActive,
        };
      },
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
        assert.equal(id, state.key.key_id);
        assert.equal(value, state.key.secret);
        writes.push('activate');
        Object.assign(state.key, {
          accepts_new: true,
          verify_until: 'infinity',
        });
      },
    },
    vercel: {
      project: async () => structuredClone(state.project),
      assertBackend: async () => structuredClone(state.backend),
      currentDeployment: async () => structuredClone(state.current),
      runtimeBinding: async (id) => {
        if (id === state.missingRuntime) return null;
        const row = [original, ...state.deployments].find(
          (row) => row.id === id,
        );
        return {
          hostname: STAGING_PINS.hostname,
          deploymentId: id,
          sha: row.gitSource.sha,
          branch: 'staging',
          backendRef: STAGING_REF,
          backendUrl: `https://${STAGING_REF}.supabase.co`,
          servedAssetVerified: true,
        };
      },
      envs: async () => ({ envs: structuredClone(state.envs) }),
      writeEnv: async (id, body) => {
        writes.push('env');
        state.envs = [
          {
            ...body,
            id: id ?? 'env_staging',
            updatedAt: Math.max(
              (state.envs[0]?.updatedAt ?? 19) + 1,
              state.backend.updatedAt + 1,
            ),
          },
        ];
      },
      deployments: async () => ({
        deployments: structuredClone(state.deployments),
      }),
      createDeployment: async (context) => {
        writes.push('deploy');
        const row = {
          id: `dpl_candidate_${state.deployments.length}`,
          projectId: STAGING_PINS.projectId,
          target: null,
          createdAt: state.envs[0].updatedAt + 10,
          readyState: state.nextState,
          gitSource: {
            type: 'github',
            repoId: STAGING_PINS.repoId,
            ref: 'staging',
            sha: context.sha,
          },
          meta: { inventoryStagingFiles: context.intent },
        };
        state.deployments.push(row);
        if (state.nextState === 'READY') state.current = row;
        return structuredClone(row);
      },
      deployment: async (id) =>
        structuredClone(state.deployments.find((row) => row.id === id)),
    },
  };
  return { options, state, writes, original };
}
const rejectsCode = (action, code) =>
  assert.rejects(action, (error) => error.code === code);

test('older file schema with a matching old migration digest cannot stage, deploy or activate', async () => {
  const f = fixture();
  f.state.schemaReady = false;
  f.state.revision = migrationRevision([{ version: '20261001000000' }]);
  f.options.expectedMigrationRevision = f.state.revision;
  await rejectsCode(
    () => provisionStagingFiles(f.options),
    'STAGING_SCHEMA_DENIED',
  );
  assert.deepEqual(f.writes, []);
  assert.equal(f.state.key, null);
});
test('base-only adapter without explicit CP5 readiness cannot write', async () => {
  const f = fixture();
  f.options.database.schema = async () => {};
  await rejectsCode(
    () => provisionStagingFiles(f.options),
    'STAGING_SCHEMA_DENIED',
  );
  assert.deepEqual(f.writes, []);
});
test('CP5 schema without the pending-capacity followup and matching digest cannot write', async () => {
  const f = fixture();
  f.state.schemaReady = false;
  f.state.revision = migrationRevision([
    { version: STAGING_FILE_MIGRATIONS[0] },
  ]);
  f.options.expectedMigrationRevision = f.state.revision;
  await rejectsCode(
    () => provisionStagingFiles(f.options),
    'STAGING_SCHEMA_DENIED',
  );
  assert.deepEqual(f.writes, []);
});
test('schema contract drift after staging prevents environment/deployment/activation writes', async () => {
  const f = fixture();
  const stage = f.options.database.stage;
  f.options.database.stage = async (...args) => {
    await stage(...args);
    f.state.schemaReady = false;
  };
  await rejectsCode(
    () => provisionStagingFiles(f.options),
    'STAGING_SCHEMA_DENIED',
  );
  assert.deepEqual(f.writes, ['stage']);
  assert.equal(f.state.key.accepts_new, false);
});

test('staging provider requires base schema and the full canonical RPC/grant contract', async () => {
  for (const response of [
    [{ ready: false }],
    [{ ready: null }],
    [],
    [{ ready: true }, { ready: true }],
    [{ ready: true }],
  ]) {
    const calls = [];
    const providers = stagingFileProviders({
      managementToken: 'synthetic-management',
      vercelToken: 'synthetic-vercel',
      currentDeployment: async () => {},
      runtimeBinding: async () => {},
      request: async (url, options) => {
        calls.push({ url, ...options });
        assert.equal(options.body.read_only, true);
        assert.deepEqual(options.body.parameters, []);
        return options.body.query === SQL.schema ? [{ ready: true }] : response;
      },
    });
    if (response.length === 1 && response[0].ready === true)
      assert.equal(await providers.database.schema(STAGING_REF), true);
    else
      await rejectsCode(
        () => providers.database.schema(STAGING_REF),
        'STAGING_SCHEMA_DENIED',
      );
    assert.deepEqual(
      calls.map((call) => call.body.query),
      [SQL.schema, STAGING_SCHEMA_SQL],
    );
    assert.ok(
      calls.every((call) =>
        call.url.includes(`/projects/${STAGING_REF}/database/query`),
      ),
    );
  }
});

test('staging stages inactive key, installs branch-only env, proves READY/runtime, activates; rerun makes no writes', async () => {
  const f = fixture();
  const result = await provisionStagingFiles(f.options);
  assert.deepEqual(f.writes, ['stage', 'env', 'deploy', 'activate']);
  assert.equal(result.backend, STAGING_REF);
  assert.equal(result.sha, sha);
  assert.equal(result.keyFingerprint, fingerprint(secret));
  assert.equal(f.state.key.verify_until, 'infinity');
  const env = f.state.envs[0];
  assert.deepEqual(env.target, ['preview']);
  assert.equal(env.gitBranch, 'staging');
  assert.equal(env.type, 'sensitive');
  assert.equal(env.visibility, 'secret');
  assert.deepEqual(JSON.parse(env.value), { [STAGING_KEY_ID]: secret });
  assert.equal(parseStagingIntent(env.comment).migration, revision);
  f.writes.length = 0;
  await provisionStagingFiles(f.options);
  assert.deepEqual(f.writes, []);
});
test('matching active key survives a new candidate SHA without automatic rotation', async () => {
  const f = fixture();
  await provisionStagingFiles(f.options);
  f.writes.length = 0;
  f.options.expectedCurrentDeployment = f.state.current.id;
  f.options.expectedSha = 'e'.repeat(40);
  await provisionStagingFiles(f.options);
  assert.deepEqual(f.writes, ['env', 'deploy']);
  assert.equal(f.state.key.secret, secret);
  assert.equal(f.state.key.accepts_new, true);
});
for (const [label, change, code] of [
  [
    'production/default child',
    (f) => {
      f.state.branch.is_default = true;
    },
    undefined,
  ],
  [
    'nonpersistent branch',
    (f) => {
      f.state.branch.persistent = false;
    },
    undefined,
  ],
  [
    'wrong project',
    (f) => {
      f.state.project.id = 'foreign';
    },
    'STAGING_PROJECT_DENIED',
  ],
  [
    'competing staging deployment',
    (f) => {
      f.state.current.id = 'dpl_competing';
    },
    'STAGING_DEPLOYMENT_CHANGED',
  ],
  [
    'wrong migration revision',
    (f) => {
      f.state.revision = 'f'.repeat(64);
    },
    'STAGING_MIGRATION_CHANGED',
  ],
  [
    'foreign active key',
    (f) => {
      f.state.foreignActive = 1;
    },
    'FILE_MANUAL_KEY',
  ],
  [
    'missing baseline runtime proof',
    (f) => {
      f.state.missingRuntime = f.original.id;
    },
    'STAGING_RUNTIME_PENDING',
  ],
])
  test(`${label} refuses every write`, async () => {
    const f = fixture();
    change(f);
    if (code) await rejectsCode(() => provisionStagingFiles(f.options), code);
    else await assert.rejects(() => provisionStagingFiles(f.options));
    assert.deepEqual(f.writes, []);
  });
for (const change of [
  (row) => {
    row.comment = 'manual';
  },
  (row) => {
    row.comment = 'inventory-preview-files:v2:foreign';
  },
  (row) => {
    row.gitBranch = null;
  },
  (row) => {
    row.target = ['preview', 'production'];
  },
  (row) => {
    row.type = 'plain';
  },
  (row) => {
    row.visibility = 'visible';
  },
  (row) => {
    row.customEnvironmentIds = ['custom'];
  },
  (row) => {
    row.updatedAt = -1;
  },
])
  test(`foreign/manual/global env is never taken over (${change.toString()})`, async () => {
    const f = fixture();
    await provisionStagingFiles(f.options);
    f.writes.length = 0;
    change(f.state.envs[0]);
    await assert.rejects(() => provisionStagingFiles(f.options));
    assert.deepEqual(f.writes, []);
  });
test('retired owned key cannot be revived', async () => {
  const f = fixture();
  await provisionStagingFiles(f.options);
  f.writes.length = 0;
  Object.assign(f.state.key, {
    accepts_new: false,
    verify_until: '2026-10-05 00:00:00+00',
  });
  await rejectsCode(() => provisionStagingFiles(f.options), 'FILE_KEY_RETIRED');
  assert.deepEqual(f.writes, []);
});
test('missing candidate runtime proof stays inactive and rerun recovers without another POST', async () => {
  const f = fixture();
  f.state.missingRuntime = 'dpl_candidate_0';
  await rejectsCode(
    () => provisionStagingFiles(f.options),
    'STAGING_RUNTIME_PENDING',
  );
  assert.deepEqual(f.writes, ['stage', 'env', 'deploy']);
  assert.equal(f.state.key.accepts_new, false);
  f.state.missingRuntime = null;
  f.writes.length = 0;
  await provisionStagingFiles(f.options);
  assert.deepEqual(f.writes, ['activate']);
});
test('candidate runtime backend mismatch cannot activate', async () => {
  const f = fixture();
  const runtime = f.options.vercel.runtimeBinding;
  f.options.vercel.runtimeBinding = async (id) => ({
    ...(await runtime(id)),
    backendRef: id === f.original.id ? STAGING_REF : PRODUCTION_REF,
  });
  await rejectsCode(
    () => provisionStagingFiles(f.options),
    'STAGING_RUNTIME_DENIED',
  );
  assert.equal(f.state.key.accepts_new, false);
  assert.equal(f.writes.includes('activate'), false);
});
test('fresh alias guard prevents POST after env install when another test takes staging', async () => {
  const f = fixture();
  const install = f.options.vercel.writeEnv;
  f.options.vercel.writeEnv = async (...args) => {
    await install(...args);
    f.state.current = { ...f.original, id: 'dpl_competing' };
  };
  await rejectsCode(
    () => provisionStagingFiles(f.options),
    'STAGING_DEPLOYMENT_CHANGED',
  );
  assert.deepEqual(f.writes, ['stage', 'env']);
  assert.equal(f.state.key.accepts_new, false);
});
test('fresh migration guard catches a revision change before env write', async () => {
  const f = fixture();
  const stage = f.options.database.stage;
  f.options.database.stage = async (...args) => {
    await stage(...args);
    f.state.revision = 'f'.repeat(64);
  };
  await rejectsCode(
    () => provisionStagingFiles(f.options),
    'STAGING_MIGRATION_CHANGED',
  );
  assert.deepEqual(f.writes, ['stage']);
});
test('one new POST per invocation; exactly three persisted terminal failure attempts', async () => {
  const f = fixture();
  f.state.nextState = 'ERROR';
  for (let attempt = 1; attempt <= 3; attempt++) {
    f.writes.length = 0;
    await rejectsCode(
      () => provisionStagingFiles(f.options),
      'STAGING_DEPLOYMENT_FAILED',
    );
    assert.equal(f.writes.filter((value) => value === 'deploy').length, 1);
    assert.equal(parseStagingIntent(f.state.envs[0].comment).attempt, attempt);
  }
  f.writes.length = 0;
  await rejectsCode(
    () => provisionStagingFiles(f.options),
    'STAGING_DEPLOYMENT_LIMIT',
  );
  assert.deepEqual(f.writes, []);
  assert.equal(f.state.key.accepts_new, false);
});
test('pending deployment never advances persisted attempt', async () => {
  const f = fixture();
  f.state.nextState = 'BUILDING';
  await rejectsCode(
    () => provisionStagingFiles(f.options),
    'STAGING_DEPLOYMENT_PENDING',
  );
  f.writes.length = 0;
  await rejectsCode(
    () => provisionStagingFiles(f.options),
    'STAGING_DEPLOYMENT_PENDING',
  );
  assert.deepEqual(f.writes, []);
  assert.equal(parseStagingIntent(f.state.envs[0].comment).attempt, 1);
});
for (const phase of ['BUILDING', 'QUEUED', 'INITIALIZING', 'UNKNOWN'])
  test(`new SHA cannot replace prior ${phase} operation`, async () => {
    const f = fixture();
    f.state.nextState = phase;
    await assert.rejects(() => provisionStagingFiles(f.options));
    const previousMarker = f.state.envs[0].comment;
    f.options.expectedSha = 'e'.repeat(40);
    f.writes.length = 0;
    await rejectsCode(
      () => provisionStagingFiles(f.options),
      phase === 'UNKNOWN'
        ? 'STAGING_DEPLOYMENT_UNCERTAIN'
        : 'STAGING_PRIOR_PENDING',
    );
    assert.deepEqual(f.writes, []);
    assert.equal(f.state.envs[0].comment, previousMarker);
    assert.equal(f.state.deployments.length, 1);
  });
test('new SHA cannot abandon a prior uncertain POST with no recoverable deployment', async () => {
  const f = fixture();
  f.options.vercel.createDeployment = async () => {
    throw new Error('synthetic lost POST');
  };
  await rejectsCode(
    () => provisionStagingFiles(f.options),
    'STAGING_DEPLOYMENT_UNCERTAIN',
  );
  f.options.expectedSha = 'e'.repeat(40);
  f.writes.length = 0;
  await rejectsCode(
    () => provisionStagingFiles(f.options),
    'STAGING_DEPLOYMENT_UNCERTAIN',
  );
  assert.deepEqual(f.writes, []);
});
test('new SHA allows explicitly expected migration/backend revision after verified prior READY, preserving active key', async () => {
  const f = fixture();
  await provisionStagingFiles(f.options);
  f.options.expectedCurrentDeployment = f.state.current.id;
  f.options.expectedSha = 'e'.repeat(40);
  f.state.revision = f.options.expectedMigrationRevision = 'f'.repeat(64);
  f.state.backend = { fingerprint: '1'.repeat(64), updatedAt: 40 };
  f.writes.length = 0;
  const result = await provisionStagingFiles(f.options);
  assert.deepEqual(f.writes, ['env', 'deploy']);
  assert.equal(result.migrationRevision, 'f'.repeat(64));
  assert.equal(result.backendRevision, '1'.repeat(64));
  assert.equal(f.state.key.secret, secret);
  assert.equal(f.state.key.accepts_new, true);
});
test('same SHA retry refuses changed migration/backend operation revisions', async () => {
  const f = fixture();
  await provisionStagingFiles(f.options);
  f.state.revision = f.options.expectedMigrationRevision = 'f'.repeat(64);
  f.writes.length = 0;
  await rejectsCode(
    () => provisionStagingFiles(f.options),
    'STAGING_CONFIGURATION_CHANGED',
  );
  assert.deepEqual(f.writes, []);
});
test('new SHA rechecks prior terminal state immediately before env write', async () => {
  const f = fixture();
  await provisionStagingFiles(f.options);
  f.options.expectedCurrentDeployment = f.state.current.id;
  f.options.expectedSha = 'e'.repeat(40);
  f.writes.length = 0;
  const hydrate = f.options.vercel.deployment;
  let priorReads = 0;
  f.options.vercel.deployment = async (id) => {
    const row = await hydrate(id);
    if (++priorReads >= 2) row.readyState = 'BUILDING';
    return row;
  };
  await rejectsCode(
    () => provisionStagingFiles(f.options),
    'STAGING_PRIOR_PENDING',
  );
  assert.deepEqual(f.writes, []);
});
test('lost POST response recovers the unique persisted candidate', async () => {
  const f = fixture();
  const post = f.options.vercel.createDeployment;
  f.options.vercel.createDeployment = async (context) => {
    await post(context);
    throw new Error('synthetic lost response');
  };
  await provisionStagingFiles(f.options);
  assert.deepEqual(f.writes, ['stage', 'env', 'deploy', 'activate']);
});
test('POST with no recoverable candidate refuses replay on later invocation', async () => {
  const f = fixture();
  f.options.vercel.createDeployment = async () => {
    f.writes.push('deploy');
    throw new Error('synthetic uncertain request');
  };
  await rejectsCode(
    () => provisionStagingFiles(f.options),
    'STAGING_DEPLOYMENT_UNCERTAIN',
  );
  f.writes.length = 0;
  await rejectsCode(
    () => provisionStagingFiles(f.options),
    'STAGING_DEPLOYMENT_UNCERTAIN',
  );
  assert.deepEqual(f.writes, []);
});
for (const [label, mutate] of [
  [
    'wrong SHA',
    (row) => {
      row.gitSource.sha = 'f'.repeat(40);
    },
  ],
  [
    'wrong ref',
    (row) => {
      row.gitSource.ref = 'main';
    },
  ],
  [
    'production target',
    (row) => {
      row.target = 'production';
    },
  ],
  [
    'custom environment',
    (row) => {
      row.customEnvironmentId = 'custom';
    },
  ],
])
  test(`actual deployment ${label} is rejected after POST`, async () => {
    const f = fixture();
    const post = f.options.vercel.createDeployment;
    f.options.vercel.createDeployment = async (context) => {
      const row = await post(context);
      mutate(row);
      return row;
    };
    await rejectsCode(
      () => provisionStagingFiles(f.options),
      'FILE_DEPLOYMENT_DENIED',
    );
    assert.equal(f.state.key.accepts_new, false);
    assert.equal(f.writes.filter((value) => value === 'deploy').length, 1);
  });
test('lost stage and activation responses preserve persisted secret and prove readback', async () => {
  const f = fixture();
  for (const name of ['stage', 'activate']) {
    const action = f.options.database[name];
    f.options.database[name] = async (...args) => {
      await action(...args);
      throw new Error('synthetic lost response');
    };
  }
  await provisionStagingFiles(f.options);
  assert.equal(f.state.key.secret, secret);
  assert.equal(f.state.key.accepts_new, true);
});
test('invalid bounds refuse before stage', async () => {
  const f = fixture();
  f.options.attempts = 101;
  await rejectsCode(
    () => provisionStagingFiles(f.options),
    'STAGING_INPUT_DENIED',
  );
  assert.deepEqual(f.writes, []);
});
test('current baseline guard refuses retained proof even when its SHA differs from the candidate', async () => {
  const f = fixture();
  const runtime = f.options.vercel.runtimeBinding;
  const purposes = [];
  f.options.vercel.runtimeBinding = async (id, purpose) => {
    purposes.push(purpose);
    return { ...(await runtime(id)), verificationMode: 'retained' };
  };
  await rejectsCode(
    () => provisionStagingFiles(f.options),
    'STAGING_RUNTIME_PENDING',
  );
  assert.deepEqual(f.writes, []);
  assert.deepEqual(purposes, ['current']);
});
test('only prior completion reconciliation requests historical purpose; guard and activation request current', async () => {
  const f = fixture();
  await provisionStagingFiles(f.options);
  const priorId = f.state.current.id;
  f.options.expectedCurrentDeployment = priorId;
  f.options.expectedSha = 'e'.repeat(40);
  const runtime = f.options.vercel.runtimeBinding;
  const calls = [];
  f.options.vercel.runtimeBinding = async (id, purpose) => {
    calls.push({ id, purpose });
    return runtime(id);
  };
  await provisionStagingFiles(f.options);
  assert.ok(calls.some((call) => call.purpose === 'prior-completion'));
  assert.ok(
    calls
      .filter((call) => call.purpose === 'prior-completion')
      .every((call) => call.id === priorId),
  );
  assert.ok(
    calls
      .filter((call) => call.id === f.state.current.id)
      .every((call) => call.purpose === 'current'),
  );
});
test('ambiguous deployments refuse recovery and never activate', async () => {
  const f = fixture();
  await provisionStagingFiles(f.options);
  f.writes.length = 0;
  f.state.deployments.push({ ...f.state.deployments[0], id: 'dpl_duplicate' });
  await rejectsCode(
    () => provisionStagingFiles(f.options),
    'STAGING_DEPLOYMENT_AMBIGUOUS',
  );
  assert.deepEqual(f.writes, []);
});
test('provider pins DB target, reuses staged SQL, reads bounded migrations and sends staging ref plus exact candidate SHA', async () => {
  const calls = [];
  const providers = stagingFileProviders({
    managementToken: 'synthetic-management',
    vercelToken: 'synthetic-vercel',
    currentDeployment: async () => {},
    runtimeBinding: async () => {},
    request: async (url, options) => {
      calls.push({ url, ...options });
      return STAGING_FILE_MIGRATIONS.map((version) => ({ version }));
    },
  });
  await providers.database.stage(STAGING_REF, STAGING_KEY_ID, secret);
  assert.match(calls[0].body.query, /private.file_guard_lock/);
  assert.equal(calls[0].body.read_only, false);
  assert.equal(
    await providers.database.migrationRevision(STAGING_REF),
    revision,
  );
  assert.equal(calls[1].body.read_only, true);
  const intent = stagingIntentFor(
    fingerprint(secret),
    sha,
    backend.fingerprint,
    revision,
  );
  await providers.vercel.createDeployment({
    projectId: STAGING_PINS.projectId,
    repoId: STAGING_PINS.repoId,
    branch: 'staging',
    sha,
    intent,
  });
  assert.deepEqual(calls[2].body.gitSource, {
    type: 'github',
    repoId: STAGING_PINS.repoId,
    ref: 'staging',
    sha,
  });
  assert.deepEqual(calls[2].body.meta, { inventoryStagingFiles: intent });
  const count = calls.length;
  assert.throws(() =>
    providers.database.stage(PRODUCTION_REF, STAGING_KEY_ID, secret),
  );
  assert.throws(() => providers.database.read('z'.repeat(20), STAGING_KEY_ID));
  assert.throws(() => providers.database.stage(STAGING_REF, 'manual', secret));
  assert.equal(calls.length, count);
});
test('migration revision rejects duplicate/malformed/unbounded histories', () => {
  for (const rows of [
    [],
    [{ version: 'manual' }],
    [{ version: '20261001000000' }, { version: '20261001000000' }],
    Array(1001).fill({ version: '20261001000000' }),
  ])
    assert.throws(() => migrationRevision(rows));
});
test('production-only file env remains excluded from staging selection', () => {
  assert.equal(
    selectStagingFileEnv({
      envs: [{ key: 'INVENTORY_FILE_KEYS_JSON', target: ['production'] }],
    }),
    null,
  );
});
test('actual provisioning transport blocks redirects before forwarding the synthetic POST body', async (t) => {
  const received = [];
  const server = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    received.push({
      path: request.url,
      body: Buffer.concat(chunks).toString('utf8'),
    });
    if (request.url.startsWith('/redirect/')) {
      response.writeHead(Number(request.url.split('/').at(-1)), {
        Location: '/capture',
      });
      response.end();
    } else {
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end('{}');
    }
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  t.after(
    () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(resolve);
      }),
  );
  const origin = `http://127.0.0.1:${server.address().port}`;
  for (const status of [301, 302, 303, 307, 308]) {
    await rejectsCode(
      () =>
        boundedJsonRequest(`${origin}/redirect/${status}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: { synthetic: 'fixture-only-sensitive-body' },
        }),
      'FILE_REQUEST_FAILED',
    );
  }
  assert.equal(received.length, 5);
  assert.ok(received.every((row) => row.path.startsWith('/redirect/')));
  assert.ok(
    received.every(
      (row) =>
        row.body ===
        JSON.stringify({ synthetic: 'fixture-only-sensitive-body' }),
    ),
  );
  assert.equal(
    received.some((row) => row.path === '/capture'),
    false,
  );
});
