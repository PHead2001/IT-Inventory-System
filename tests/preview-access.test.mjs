import './preview-file-keys.test.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { previewAccessTarget } from '../scripts/preview-access-target.mjs';
import { createPreviewRequest } from '../scripts/preview-access-request.mjs';
import {
  provisionPreview,
  PARENT_REF,
  CHECK_NAME,
  CHECK_APP,
  authPolicyPatch,
  selectDeploymentCheck,
  previewFailureGuidance,
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
  let authCalls = 0;
  const reads = [];
  const rejectAuth = () => {
    const error = overrides.authErrors?.[authCalls++];
    if (error) {
      overrides.onAuthError?.({ state, pr });
      throw error;
    }
  };
  const github = {
    pull: async () => {
      reads.push('pr');
      return overrides.pullSequence?.[pullCalls++] ?? overrides.pr ?? pr;
    },
    checks: async () => {
      reads.push('checks');
      return overrides.checks ?? listing(successfulCheck);
    },
  };
  const management = {
    branches: async () => {
      reads.push('branch');
      return (
        overrides.branchSequence?.[branchCalls++] ??
        overrides.branches ?? [state.branch]
      );
    },
    authConfig: async () => {
      reads.push('policy');
      return overrides.config ?? state.policy;
    },
    patchAuthConfig: async (_ref, patch) => {
      writes.push(['policy', patch]);
      if (overrides.patchError) throw overrides.patchError;
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
    listUsers: async () => {
      reads.push('users');
      return (
        overrides.listUsers?.(state) ??
        overrides.users ??
        (state.user ? [state.user] : [])
      );
    },
    createUser: async (_key, data) => {
      writes.push(['create', data]);
      rejectAuth();
      state.user = {
        id: 'u1',
        email: data.email,
        app_metadata: data.app_metadata,
      };
      return state.user;
    },
    updateUser: async (_key, id, data) => {
      writes.push(['update', data]);
      rejectAuth();
      return { ...state.user, id };
    },
    upsertMember: async (_key, member) => {
      writes.push(['member', member]);
      state.member = member;
    },
    signIn: async () =>
      overrides.signedIn ?? {
        user: { id: state.user.id },
        access_token: 'token',
      },
    memberAsUser: async () => overrides.memberAsUser ?? state.member,
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
  return { run, writes, state, reads };
}

const weakPassword = () =>
  Object.assign(new Error('Preview access request failed'), {
    code: 'AUTH_PASSWORD_LENGTH_PENDING',
  });

test('missing and unhealthy native branches retain pending compatibility with distinct recovery guidance', async () => {
  for (const [reason, overrides] of [
    ['BRANCH_ABSENT', { branches: [] }],
    [
      'BRANCH_UNHEALTHY',
      {
        branches: [
          {
            project_ref: ref,
            parent_project_ref: PARENT_REF,
            is_default: false,
            git_branch: 'feature',
            pr_number: 9,
            status: 'COMING_UP',
          },
        ],
      },
    ],
  ]) {
    const { run, writes } = fixture(overrides);
    let pauses = 0;
    await assert.rejects(
      run({
        attempts: 2,
        pause: async () => {
          pauses++;
        },
      }),
      (error) => {
        assert.equal(error.code, 'BRANCH_PENDING');
        assert.equal(error.reason, reason);
        assert.equal(error.pending, true);
        const guidance = previewFailureGuidance(error);
        assert.match(guidance, new RegExp(reason));
        if (reason === 'BRANCH_ABSENT') {
          assert.match(guidance, /cannot create one/);
          assert.match(guidance, /not established by absence alone/);
        } else assert.match(guidance, /exists but is not healthy/);
        return true;
      },
    );
    assert.equal(pauses, 1);
    assert.deepEqual(writes, []);
  }
});

test('native deployment guidance is fixed and never renders provider error content', async () => {
  const { run, writes } = fixture({
    checks: listing({ ...successfulCheck, conclusion: 'failure' }),
  });
  await assert.rejects(run(), (error) => {
    assert.equal(error.code, 'DEPLOYMENT_PENDING');
    assert.match(previewFailureGuidance(error), /exact PR revision/);
    return true;
  });
  assert.deepEqual(writes, []);
  const sentinel = 'PRIVATE_PROVIDER_BODY';
  assert.equal(
    previewFailureGuidance({
      code: sentinel,
      reason: sentinel,
      message: sentinel,
    }),
    '',
  );
  assert.doesNotMatch(
    previewFailureGuidance({
      code: 'BRANCH_PENDING',
      reason: 'BRANCH_ABSENT',
      message: sentinel,
    }),
    /PRIVATE_PROVIDER_BODY/,
  );
});

test('retries delayed Auth policy propagation for create and update after fresh guards', async (t) => {
  for (const existing of [false, true])
    await t.test(existing ? 'update' : 'create', async () => {
      const { run, writes, state, reads } = fixture({
        authErrors: [weakPassword(), weakPassword()],
      });
      if (existing)
        state.user = {
          id: 'u1',
          email: 'test@gmail.com',
          app_metadata: { inventory_preview_fixture: true },
        };
      const snapshots = [];
      await run({ pause: async () => snapshots.push(reads.length) });
      assert.equal(snapshots.length, 2);
      const operation = existing ? 'update' : 'create';
      assert.deepEqual(
        writes.map(([name]) => name),
        ['policy', operation, operation, operation, 'member'],
      );
      for (const offset of snapshots)
        assert.deepEqual(reads.slice(offset, offset + 5), [
          'pr',
          'branch',
          'checks',
          'policy',
          'users',
        ]);
    });
});

test('policy propagation retry exhausts at four Auth attempts without membership', async () => {
  const { run, writes } = fixture({
    authErrors: Array.from({ length: 4 }, weakPassword),
  });
  let pauses = 0;
  await assert.rejects(run({ pause: async () => pauses++ }), {
    code: 'AUTH_PASSWORD_LENGTH_PENDING',
  });
  assert.equal(pauses, 3);
  assert.deepEqual(
    writes.map(([name]) => name),
    ['policy', 'create', 'create', 'create', 'create'],
  );
});

test('retry eligibility requires a successful minimum patch in this invocation', async (t) => {
  for (const code of [
    'AUTH_PASSWORD_LENGTH_PENDING',
    'HTTP_422',
    'HTTP_500',
    'NETWORK_ERROR',
  ])
    await t.test(code, async () => {
      const { run, writes, state } = fixture({
        authErrors: [Object.assign(new Error('request failed'), { code })],
      });
      if (code === 'AUTH_PASSWORD_LENGTH_PENDING')
        state.policy.password_min_length = 6;
      let pauses = 0;
      await assert.rejects(run({ pause: async () => pauses++ }), { code });
      assert.equal(pauses, 0);
      assert.equal(writes.filter(([name]) => name === 'create').length, 1);
      assert.equal(
        writes.some(([name]) => name === 'member'),
        false,
      );
    });
});

test('an uncertain policy patch is never retried or followed by Auth or membership writes', async () => {
  const { run, writes } = fixture({
    patchError: Object.assign(new Error('request failed'), {
      code: 'NETWORK_ERROR',
    }),
  });
  let pauses = 0;
  await assert.rejects(run({ pause: async () => pauses++ }), {
    code: 'NETWORK_ERROR',
  });
  assert.equal(pauses, 0);
  assert.deepEqual(
    writes.map(([name]) => name),
    ['policy'],
  );
});

test('successful retry still requires final password sign-in verification', async () => {
  const { run, writes } = fixture({
    authErrors: [weakPassword()],
    signedIn: { user: { id: 'another' }, access_token: 'token' },
  });
  await assert.rejects(run(), /sign-in verification failed/);
  assert.deepEqual(
    writes.map(([name]) => name),
    ['policy', 'create', 'create', 'member'],
  );
});

test('fresh identity, policy, and collision failures stop retries before another mutation', async (t) => {
  const cases = [
    [
      'closed PR',
      ({ pr }) => {
        pr.state = 'closed';
      },
    ],
    [
      'stale PR',
      ({ pr }) => {
        pr.head.sha = 'c'.repeat(40);
      },
    ],
    [
      'replaced branch',
      ({ state }) => {
        state.branch.project_ref = 'c'.repeat(20);
      },
    ],
    [
      'failed check',
      () => {
        successfulCheck.conclusion = 'failure';
      },
    ],
    [
      'foreign fixture',
      ({ state }) => {
        state.user = {
          id: 'foreign',
          email: 'test@gmail.com',
          app_metadata: {},
        };
      },
    ],
    [
      'minimum drift',
      ({ state }) => {
        state.policy.password_min_length = 12;
      },
    ],
    [
      'lower minimum drift',
      ({ state }) => {
        state.policy.password_min_length = 5;
      },
    ],
    [
      'signup drift',
      ({ state }) => {
        state.policy.disable_signup = false;
      },
    ],
    [
      'character drift',
      ({ state }) => {
        state.policy.password_required_characters = 'a-z';
      },
    ],
    [
      'HIBP drift',
      ({ state }) => {
        state.policy.password_hibp_enabled = true;
      },
    ],
  ];
  for (const [name, onAuthError] of cases)
    await t.test(name, async () => {
      const { run, writes } = fixture({
        authErrors: [weakPassword()],
        onAuthError,
      });
      try {
        await assert.rejects(run());
        assert.deepEqual(
          writes.map(([operation]) => operation),
          ['policy', 'create'],
        );
      } finally {
        successfulCheck.conclusion = 'success';
      }
    });
});

test('a concurrent marked fixture is reused rather than duplicated after a length rejection', async () => {
  const { run, writes } = fixture({
    authErrors: [weakPassword()],
    onAuthError: ({ state }) => {
      state.user = {
        id: 'u1',
        email: 'test@gmail.com',
        app_metadata: { inventory_preview_fixture: true },
      };
    },
  });
  await run();
  assert.deepEqual(
    writes.map(([name]) => name),
    ['policy', 'create', 'update', 'member'],
  );
});

test('a removed/replaced marked user or duplicate fixtures stops an update retry', async (t) => {
  for (const variant of ['removed', 'replaced', 'duplicate'])
    await t.test(variant, async () => {
      let duplicate = false;
      const { run, writes, state } = fixture({
        authErrors: [weakPassword()],
        listUsers: (current) =>
          duplicate ? [current.user, { ...current.user, id: 'u2' }] : undefined,
        onAuthError: ({ state: current }) => {
          if (variant === 'removed') current.user = null;
          if (variant === 'replaced')
            current.user = { ...current.user, id: 'u2' };
          if (variant === 'duplicate') duplicate = true;
        },
      });
      state.user = {
        id: 'u1',
        email: 'test@gmail.com',
        app_metadata: { inventory_preview_fixture: true },
      };
      await assert.rejects(run());
      assert.deepEqual(
        writes.map(([name]) => name),
        ['policy', 'update'],
      );
    });
});

test('retargeted or mismatched PR identity stops a policy propagation retry', async (t) => {
  for (const change of [
    (pr) => {
      pr.number = 10;
    },
    (pr) => {
      pr.head.ref = 'replacement';
    },
    (pr) => {
      pr.base.ref = 'other-base';
    },
  ])
    await t.test(change.toString(), async () => {
      const { run, writes } = fixture({
        authErrors: [weakPassword()],
        onAuthError: ({ pr }) => change(pr),
      });
      await assert.rejects(run(), /identity changed/);
      assert.deepEqual(
        writes.map(([name]) => name),
        ['policy', 'create'],
      );
    });
});

test('Auth error transport recognizes only bounded unambiguous admin length rejections', async (t) => {
  const url = `https://${ref}.supabase.co/auth/v1/admin/users`;
  const detail = { weak_password: { reasons: ['length'] } };
  for (const data of [
    { code: 'weak_password', message: 'REDACTED_SENTINEL', ...detail },
    {
      code: 422,
      error_code: 'weak_password',
      msg: 'REDACTED_SENTINEL',
      ...detail,
    },
  ])
    for (const [method, path] of [
      ['POST', url],
      ['PUT', `${url}/11111111-1111-4111-8111-111111111111`],
    ])
      await t.test(`${method} ${typeof data.code}`, async () => {
        const request = createPreviewRequest(
          async () => new Response(JSON.stringify(data), { status: 422 }),
        );
        await assert.rejects(request(path, { method }), (error) => {
          assert.equal(error.code, 'AUTH_PASSWORD_LENGTH_PENDING');
          assert.equal(error.message, 'Preview access request failed');
          assert.doesNotMatch(
            error.stack,
            /REDACTED_SENTINEL|11111111|supabase\.co/,
          );
          return true;
        });
      });
  const bodies = [
    '{malformed',
    JSON.stringify({ code: 'weak_password' }),
    JSON.stringify({ code: 'weak_password', error_code: 'other', ...detail }),
    JSON.stringify({
      code: 'weak_password',
      error_code: 'weak_password',
      ...detail,
    }),
    JSON.stringify({ code: 'other', ...detail }),
    JSON.stringify({
      code: 'weak_password',
      weak_password: { reasons: ['characters'] },
    }),
    JSON.stringify({
      code: 'weak_password',
      weak_password: { reasons: ['pwned'] },
    }),
    JSON.stringify({
      code: 'weak_password',
      weak_password: { reasons: ['length', 'characters'] },
    }),
    JSON.stringify({
      code: 'weak_password',
      weak_password: { reasons: ['unknown'] },
    }),
    JSON.stringify({ code: 'weak_password', weak_password: { reasons: [] } }),
    JSON.stringify({
      code: 'weak_password',
      weak_password: { reasons: 'length' },
    }),
    JSON.stringify({
      code: 'weak_password',
      message: 'x'.repeat(4096),
      ...detail,
    }),
    '{"code":"other","code":"weak_password","weak_password":{"reasons":["length"]}}',
    '{"code":"other","\\u0063ode":"weak_password","weak_password":{"reasons":["length"]}}',
    '{"code":"weak_password","weak_password":{"reasons":["pwned"],"reasons":["length"]}}',
    new Uint8Array([255]),
  ];
  for (const body of bodies) {
    const request = createPreviewRequest(
      async () => new Response(body, { status: 422 }),
    );
    await assert.rejects(request(url, { method: 'POST' }), {
      code: 'HTTP_422',
    });
  }
  for (const [method, path, status = 422] of [
    ['GET', url],
    ['POST', `${url}?unexpected=true`],
    ['POST', `${url}/`],
    ['PATCH', `https://api.supabase.com/v1/projects/${ref}/config/auth`],
    ['POST', `https://${ref}.supabase.co/rest/v1/app_members`],
    ['POST', `https://${ref}.supabase.co/auth/v1/token?grant_type=password`],
    ['POST', `https://${PARENT_REF}.supabase.co/auth/v1/admin/users`],
    ['POST', `https://${ref}.supabase.co.evil.example/auth/v1/admin/users`],
    ['POST', url, 500],
  ]) {
    let bodyReads = 0;
    const request = createPreviewRequest(async () => ({
      status,
      ok: false,
      body: {
        getReader: () => {
          bodyReads++;
          throw new Error('secret');
        },
      },
    }));
    await assert.rejects(request(path, { method }), { code: `HTTP_${status}` });
    assert.equal(bodyReads, 0);
  }
});

test('Auth transport refuses redirects, caps streamed error bytes, and redacts uncertain failures', async () => {
  let reads = 0;
  let cancelled = false;
  const response = {
    status: 422,
    ok: false,
    body: {
      getReader: () => ({
        read: async () => {
          reads++;
          return { done: false, value: new Uint8Array(4097) };
        },
        cancel: async () => {
          cancelled = true;
        },
        releaseLock: () => {},
      }),
    },
  };
  const request = createPreviewRequest(async () => response);
  const url = `https://${ref}.supabase.co/auth/v1/admin/users`;
  await assert.rejects(request(url, { method: 'POST' }), { code: 'HTTP_422' });
  assert.equal(reads, 1);
  assert.equal(cancelled, true);
  const redirect = createPreviewRequest(async (_url, options) => {
    assert.equal(options.redirect, 'error');
    // Native fetch rejects redirects with this option before following them.
    throw new TypeError('fetch failed: PRIVATE_REDIRECT_LOCATION');
  });
  await assert.rejects(redirect(url, { method: 'POST' }), {
    code: 'NETWORK_ERROR',
  });
  const redirectedResponse = createPreviewRequest(async () => ({
    ok: false,
    status: 422,
    redirected: true,
    body: {
      getReader: () => {
        throw new Error('must not parse redirected body');
      },
    },
  }));
  await assert.rejects(redirectedResponse(url, { method: 'POST' }), {
    code: 'REDIRECT_DENIED',
  });
  const uncertain = createPreviewRequest(async () => {
    throw new Error('SECRET_PASSWORD USER_UUID PATH');
  });
  await assert.rejects(uncertain(url, { method: 'POST' }), (error) => {
    assert.equal(error.code, 'NETWORK_ERROR');
    assert.doesNotMatch(error.stack, /SECRET_PASSWORD|USER_UUID|PATH/);
    return true;
  });
});

test('CLI prints only sanitized failure after bounded delayed-policy retries', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'preview-access-http-test-'));
  try {
    const eventPath = join(directory, 'event.json');
    const mockPath = join(directory, 'mock-fetch.mjs');
    const sentinel = 'PRIVATE_PASSWORD_PATH_USER_UUID';
    writeFileSync(eventPath, JSON.stringify({ inputs: { pr_number: '9' } }));
    writeFileSync(
      mockPath,
      `
      globalThis.setTimeout = (callback) => { queueMicrotask(callback); return 0; };
      let minimum = 12;
      let mutations = 0;
      globalThis.fetch = async (url, options = {}) => {
        const path = new URL(url).pathname;
        let data;
        if (path.endsWith('/pulls/9')) data = ${JSON.stringify({ number: 9, state: 'open', head: { ref: 'feature', sha, repo: { full_name: repository } }, base: { ref: 'main', repo: { full_name: repository } } })};
        else if (path.endsWith('/check-runs')) data = ${JSON.stringify(listing(successfulCheck))};
        else if (path.endsWith('/branches')) data = ${JSON.stringify([fixture().state.branch])};
        else if (path.endsWith('/api-keys')) data = [{type:'secret',name:'default',api_key:'secret-test'}, {type:'publishable',name:'default',api_key:'public-test'}];
        else if (path.endsWith('/config/auth')) {
          if (options.method === 'PATCH') minimum = JSON.parse(options.body).password_min_length;
          data = {disable_signup:true,password_min_length:minimum,password_required_characters:'',password_hibp_enabled:false};
        } else if (path === '/rest/v1/app_members' && options.method === 'GET') data = [];
        else if (path === '/auth/v1/admin/users' && options.method === 'GET') data = {users:[]};
        else if (path === '/auth/v1/admin/users' && options.method === 'POST') {
          mutations++;
          if (mutations > 4) throw new Error('${sentinel} excessive retry');
          return new Response(JSON.stringify({code:'weak_password',message:'${sentinel}',weak_password:{reasons:['length']}}), {status:422});
        } else throw new Error('${sentinel} unexpected endpoint');
        return new Response(JSON.stringify(data), {status:200});
      };
    `,
    );
    const result = spawnSync(
      process.execPath,
      ['--import', pathToFileURL(mockPath).href, 'scripts/preview-access.mjs'],
      {
        cwd: new URL('..', import.meta.url),
        encoding: 'utf8',
        timeout: 5000,
        env: {
          ...process.env,
          GITHUB_REPOSITORY: repository,
          GITHUB_REF: 'refs/heads/main',
          GITHUB_EVENT_NAME: 'workflow_dispatch',
          GITHUB_EVENT_PATH: eventPath,
          GITHUB_TOKEN: sentinel,
          PREVIEW_SUPABASE_MANAGEMENT_TOKEN: sentinel,
          PREVIEW_STAFF_PASSWORD: password,
          PREVIEW_TARGET_PR: '9',
          PREVIEW_ALLOW_SIX_DIGIT_MINIMUM: 'true',
        },
      },
    );
    assert.equal(result.status, 1, result.stderr);
    assert.equal(
      result.stderr,
      'Preview staff setup failed: AUTH_PASSWORD_LENGTH_PENDING\n',
    );
    assert.equal(result.stdout, '');
    assert.doesNotMatch(
      result.stderr,
      new RegExp(`${sentinel}|${password}|${ref}|u1|weak_password`),
    );
  } finally {
    await rm(directory, {
      recursive: true,
      force: true,
      maxRetries: 3,
      retryDelay: 100,
    });
  }
});

test('creates a marked confirmed staff user, verifies sign-in, and reconciles password after reset', async () => {
  const { run, writes, state } = fixture();
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
  assert.deepEqual(writes[2][1], {
    user_id: 'u1',
    display_name: 'Preview Staff',
    role: 'staff',
    active: true,
    can_manage_configuration: true,
  });
  state.member = { ...state.member, can_manage_configuration: false };
  await run();
  assert.deepEqual(
    writes.map(([operation]) => operation),
    ['policy', 'create', 'member', 'update', 'member'],
  );
  assert.equal(writes[3][1].ban_duration, 'none');
  assert.deepEqual(writes[4][1], writes[2][1]);
  assert.equal(state.member.can_manage_configuration, true);
});

test('requires caller-visible active staff configuration permission after provisioning', async (t) => {
  const member = {
    role: 'staff',
    active: true,
    can_manage_configuration: true,
  };
  for (const [name, change] of [
    ['missing grant', { can_manage_configuration: false }],
    ['absent grant', { can_manage_configuration: undefined }],
    ['viewer', { role: 'viewer' }],
    ['inactive staff', { active: false }],
  ])
    await t.test(name, async () => {
      const { run } = fixture({ memberAsUser: { ...member, ...change } });
      await assert.rejects(run(), /Fixture membership verification failed/);
    });
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

test('malformed event JSON cannot print a secret or parser text', async () => {
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
    await rm(directory, {
      recursive: true,
      force: true,
      maxRetries: 3,
      retryDelay: 100,
    });
  }
});

test('preview workflow coalesces pending PR events before provisioning without cancelling active provisioning', () => {
  const workflow = readFileSync(
    new URL('../.github/workflows/preview-access.yml', import.meta.url),
    'utf8',
  );
  const workflowHeader = workflow.split('\njobs:')[0];
  const workflowConcurrency = workflowHeader.match(
    /^concurrency:\s*\n\s+group: ([^\r\n]+)\s*\n\s+cancel-in-progress: false\s*$/m,
  );
  assert.ok(
    workflowConcurrency,
    'coalescing must apply to the whole workflow before provisioning can request a VM',
  );
  assert.equal(
    workflowConcurrency[1],
    'preview-staff-access-workflow-${{ github.ref }}-${{ github.event.pull_request.number || inputs.pr_number }}',
    'trusted main PR events and main dispatches must share a per-PR group while non-main dispatches remain separate',
  );
  const groupFor = ({ ref, pr, input }) =>
    workflowConcurrency[1]
      .replace('${{ github.ref }}', ref)
      .replace(
        '${{ github.event.pull_request.number || inputs.pr_number }}',
        pr || input,
      );
  const mainPrGroup = groupFor({ ref: 'refs/heads/main', pr: 27 });
  assert.equal(mainPrGroup, groupFor({ ref: 'refs/heads/main', input: 27 }));
  assert.notEqual(
    mainPrGroup,
    groupFor({ ref: 'refs/heads/feature', input: 27 }),
    'a skipped non-main dispatch must not evict a pending trusted main run',
  );
  assert.notEqual(mainPrGroup, groupFor({ ref: 'refs/heads/main', pr: 28 }));
  assert.doesNotMatch(workflowHeader, /^\s+queue:/m);
  const provisionConcurrency = workflow
    .split('  provision:')[1]
    ?.match(
      /concurrency:\s*\n\s*group: ([^\r\n]+)\s*\n\s*cancel-in-progress: false/,
    );
  assert.ok(
    provisionConcurrency,
    'retain the provisioning lock for older runs',
  );
  assert.equal(
    provisionConcurrency[1],
    'preview-staff-access-${{ github.event.pull_request.number || inputs.pr_number }}',
  );
  assert.notEqual(
    workflowConcurrency[1],
    provisionConcurrency[1],
    'workflow and job groups must be distinct to avoid cancelling or blocking their own run',
  );
});

const targetEvent = (action = 'opened') => ({
  action,
  number: 9,
  pull_request: {
    number: 9,
    state: 'open',
    head: { sha, repo: { full_name: repository } },
    base: { repo: { full_name: repository } },
  },
});
const target = (eventName, event, targetNumber = 9) =>
  previewAccessTarget({ eventName, event, targetNumber, repository });

test('direct event target preserves the event SHA fence for each provisioning action', () => {
  for (const action of ['opened', 'reopened', 'ready_for_review'])
    assert.equal(target('pull_request_target', targetEvent(action)), sha);
  assert.equal(
    target('workflow_dispatch', { inputs: { pr_number: '9' } }),
    undefined,
  );
});

test('ordinary pushes, schedules and untrusted or inconsistent targets never provision', () => {
  for (const action of [
    'synchronize',
    'converted_to_draft',
    'labeled',
    undefined,
  ]) {
    const event = targetEvent();
    event.action = action;
    assert.throws(
      () => target('pull_request_target', event),
      /Unsupported PR action/,
    );
  }
  for (const name of ['schedule', 'push', 'pull_request'])
    assert.throws(() => target(name, targetEvent()), /Unsupported event/);
  for (const mutate of [
    (event) => {
      event.number = 10;
    },
    (event) => {
      event.pull_request.number = 10;
    },
    (event) => {
      event.pull_request.state = 'closed';
    },
    (event) => {
      event.pull_request.head.repo.full_name = 'foreign/repo';
    },
    (event) => {
      event.pull_request.base.repo.full_name = 'foreign/repo';
    },
    (event) => {
      event.pull_request.head.sha = 'invalid';
    },
  ]) {
    const event = targetEvent();
    mutate(event);
    assert.throws(() => target('pull_request_target', event));
  }
  assert.throws(() => target('pull_request_target', targetEvent(), 10), {
    code: 'TARGET_MISMATCH',
  });
  assert.throws(
    () => target('workflow_dispatch', { inputs: { pr_number: 10 } }),
    { code: 'TARGET_MISMATCH' },
  );
  for (const number of [0, -1, 1.5, '9'])
    assert.throws(
      () => target('workflow_dispatch', { inputs: { pr_number: 9 } }, number),
      { code: 'TARGET_INVALID' },
    );
});

test('missing target refuses before provisioning', () => {
  assert.throws(
    () =>
      previewAccessTarget({
        eventName: 'workflow_dispatch',
        event: { inputs: { pr_number: 9 } },
        repository,
      }),
    { code: 'TARGET_INVALID' },
  );
});

test('one trusted light job provisions only opening, reopening, readiness or manual targets', () => {
  const workflow = readFileSync(
    new URL('../.github/workflows/preview-access.yml', import.meta.url),
    'utf8',
  );
  assert.match(workflow, /types: \[opened, reopened, ready_for_review\]/);
  assert.doesNotMatch(
    workflow,
    /synchronize|schedule:|discover:|strategy:|matrix:|npm ci|Foundation/,
  );
  assert.deepEqual(
    [...workflow.matchAll(/^  ([a-z_]+):\s*$/gm)]
      .map((match) => match[1])
      .filter(
        (name) => !['pull_request_target', 'workflow_dispatch'].includes(name),
      ),
    ['provision'],
  );
  assert.match(workflow, /runs-on: \[self-hosted, it-inventory-light\]/);
  assert.match(workflow, /timeout-minutes: 15/);
  assert.match(workflow, /ref: refs\/heads\/main/);
  assert.match(
    workflow,
    /PREVIEW_TARGET_PR: \$\{\{ github.event.pull_request.number \|\| inputs.pr_number \}\}/,
  );
  const source = readFileSync(
    new URL('../scripts/preview-access.mjs', import.meta.url),
    'utf8',
  );
  assert.match(source, /attempts: 12/);
  assert.match(source, /setTimeout\(resolve, 10000\)/);
});
