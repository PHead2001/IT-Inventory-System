import test from 'node:test';
import assert from 'node:assert/strict';
import {
  linkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import {
  localAuthTemplateFiles,
  localAuthTemplateDocker,
  localAuthTemplateResponse,
  verifyLocalAuthTemplates,
  prepareLocalAuthTemplates,
} from '../scripts/local-auth-templates.mjs';
import {
  localDockerSocket,
  passwordPolicyConfig,
  withLocalPasswordPolicy,
} from '../scripts/local-auth-password-policy.mjs';
const snapshot = () => ({
  Id: 'original-id',
  Name: '/supabase_auth_it-inventory',
  State: { Running: true },
  Config: {
    Image: 'public.ecr.aws/supabase/gotrue:v2.196.0',
    Env: [
      'GOTRUE_DB_DATABASE_URL=postgres://fixture@supabase_db_it-inventory:5432/postgres',
      'EXISTING=value',
    ],
    Labels: { 'com.supabase.cli.project': 'it-inventory' },
    Healthcheck: { Test: ['CMD', 'fixture-health'] },
    Cmd: ['auth'],
    User: 'auth',
  },
  HostConfig: {
    AutoRemove: false,
    Privileged: false,
    Binds: ['fixture:/data'],
    PortBindings: {},
    NetworkMode: 'supabase_network_it-inventory',
  },
  NetworkSettings: {
    Networks: {
      'supabase_network_it-inventory': {
        Aliases: ['supabase_auth_it-inventory', 'auth'],
      },
    },
  },
});

function templateFixture(t) {
  const cwd = mkdtempSync(join(tmpdir(), 'local-auth-templates-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  mkdirSync(join(cwd, 'supabase/templates'), { recursive: true });
  writeFileSync(
    join(cwd, 'supabase/config.toml'),
    ['invite', 'recovery']
      .map(
        (kind) =>
          `[auth.email.template.${kind}]\ncontent_path = "./supabase/templates/${kind}.html"\n`,
      )
      .join('\n'),
  );
  for (const kind of ['invite', 'recovery'])
    writeFileSync(
      join(cwd, `supabase/templates/${kind}.html`),
      `${kind} public fixture`,
      { mode: 0o600 },
    );
  return cwd;
}

test(
  'restrictive Unix umask prepares only both public templates without changing bytes or mask',
  { skip: process.platform === 'win32' },
  (t) => {
    const cwd = templateFixture(t);
    const script = `
    import assert from 'node:assert/strict';
    import { writeFileSync, statSync } from 'node:fs';
    import { join } from 'node:path';
    import { localAuthTemplateFiles, prepareLocalAuthTemplates } from ${JSON.stringify(new URL('../scripts/local-auth-templates.mjs', import.meta.url).href)};
    const cwd = process.argv[1];
    process.umask(0o077);
    for (const kind of ['invite', 'recovery'])
      writeFileSync(join(cwd, 'supabase/templates/' + kind + '.html'), kind + ' public fixture', { mode: 0o600 });
    writeFileSync(join(cwd, '.env'), 'PRIVATE_SECRET', { mode: 0o600 });
    const before = localAuthTemplateFiles(cwd);
    for (const kind of ['invite', 'recovery']) assert.equal(statSync(join(cwd, 'supabase/templates/' + kind + '.html')).mode & 0o777, 0o600);
    const reports = [];
    prepareLocalAuthTemplates({ cwd, report: line => reports.push(line) });
    assert.equal(process.umask(), 0o077);
    assert.equal(statSync(join(cwd, '.env')).mode & 0o777, 0o600);
    const after = localAuthTemplateFiles(cwd);
    assert.deepEqual(after, before);
    for (const kind of ['invite', 'recovery']) assert.equal(statSync(join(cwd, 'supabase/templates/' + kind + '.html')).mode & 0o777, 0o644);
    assert.equal(reports.length, 2);
    for (const line of reports) assert.match(line, /^Local Auth template permissions: template=(invite|recovery) modeBefore=384 modeAfter=420 uid=\\d+ gid=\\d+ umask=63\\.$/);
    assert.ok(!reports.join('').includes(cwd));
    assert.ok(!reports.join('').includes('PRIVATE_SECRET'));
  `;
    execFileSync(process.execPath, ['--input-type=module', '-e', script, cwd], {
      stdio: 'pipe',
    });
  },
);

test('Windows preparation validates canonical files and leaves POSIX mode untouched', (t) => {
  const cwd = templateFixture(t);
  const before = localAuthTemplateFiles(cwd);
  const modes = ['invite', 'recovery'].map(
    (kind) => statSync(join(cwd, `supabase/templates/${kind}.html`)).mode,
  );
  const mask = process.umask(),
    reports = [];
  prepareLocalAuthTemplates({
    cwd,
    platform: 'win32',
    report: (line) => reports.push(line),
  });
  assert.deepEqual(localAuthTemplateFiles(cwd), before);
  assert.deepEqual(
    ['invite', 'recovery'].map(
      (kind) => statSync(join(cwd, `supabase/templates/${kind}.html`)).mode,
    ),
    modes,
  );
  assert.equal(process.umask(), mask);
  assert.equal(reports.length, 2);
});

for (const invalid of [
  'other-path',
  'traversal',
  'directory',
  'empty',
  'oversized',
  'hardlink',
])
  test(`rejects ${invalid} recovery before changing the valid invite file`, (t) => {
    const cwd = templateFixture(t);
    const recovery = join(cwd, 'supabase/templates/recovery.html');
    const invite = join(cwd, 'supabase/templates/invite.html');
    if (invalid === 'other-path' || invalid === 'traversal') {
      writeFileSync(join(cwd, 'supabase/templates/other.html'), 'other');
      const config = join(cwd, 'supabase/config.toml');
      writeFileSync(
        config,
        readFileSync(config, 'utf8').replace(
          './supabase/templates/recovery.html',
          invalid === 'traversal'
            ? './supabase/templates/../templates/recovery.html'
            : './supabase/templates/other.html',
        ),
      );
    } else {
      rmSync(recovery);
      if (invalid === 'directory') mkdirSync(recovery);
      if (invalid === 'empty') writeFileSync(recovery, '');
      if (invalid === 'oversized')
        writeFileSync(recovery, Buffer.alloc(65_537));
      if (invalid === 'hardlink') linkSync(invite, recovery);
    }
    const mode = statSync(invite).mode,
      reports = [];
    assert.throws(
      () =>
        prepareLocalAuthTemplates({
          cwd,
          report: (line) => reports.push(line),
        }),
      (error) => {
        assert.match(error.message, /category=template-permissions/);
        assert.ok(!error.message.includes(cwd));
        return true;
      },
    );
    assert.equal(statSync(invite).mode, mode);
    assert.deepEqual(reports, []);
  });

for (const target of ['file', 'directory'])
  test(
    `rejects symlink ${target} without changing the target mode`,
    { skip: process.platform === 'win32' },
    (t) => {
      const cwd = templateFixture(t);
      const external = join(cwd, 'external');
      mkdirSync(external);
      const secret = join(external, 'secret.html');
      writeFileSync(secret, 'PRIVATE_SECRET', { mode: 0o600 });
      if (target === 'file') {
        rmSync(join(cwd, 'supabase/templates/recovery.html'));
        symlinkSync(secret, join(cwd, 'supabase/templates/recovery.html'));
      } else {
        rmSync(join(cwd, 'supabase/templates'), { recursive: true });
        symlinkSync(external, join(cwd, 'supabase/templates'));
      }
      assert.throws(
        () =>
          prepareLocalAuthTemplates({
            cwd,
            report: () => assert.fail('Unsafe template reported success'),
          }),
        /category=template-permissions/,
      );
      assert.equal(statSync(secret).mode & 0o777, 0o600);
    },
  );

test('a template that grows after path stat is read within a fixed budget and rejected before chmod', (t) => {
  const cwd = templateFixture(t);
  const recovery = join(cwd, 'supabase/templates/recovery.html');
  const invite = join(cwd, 'supabase/templates/invite.html');
  writeFileSync(recovery, Buffer.alloc(1_048_576));
  const mode = statSync(invite).mode;
  const originalStat = fs.lstatSync,
    originalRead = fs.readSync;
  const reads = [];
  const pathStat = t.mock.method(fs, 'lstatSync', (path, ...args) => {
    const stat = originalStat(path, ...args);
    // Model an in-place append between lstat and descriptor read; identity stays
    // unchanged while the earlier path observation still sees a small file.
    if (path === recovery) stat.size = 1;
    return stat;
  });
  const descriptorRead = t.mock.method(fs, 'readSync', (...args) => {
    const count = originalRead(...args);
    reads.push({ capacity: args[1].length, count });
    return count;
  });
  syncBuiltinESMExports();
  try {
    assert.throws(
      () =>
        prepareLocalAuthTemplates({
          cwd,
          report: () => assert.fail('Oversized template prepared'),
        }),
      /category=template-permissions/,
    );
    assert.equal(statSync(invite).mode, mode);
    assert.ok(reads.every(({ capacity }) => capacity <= 65_537));
    assert.equal(reads.at(-1).count, 65_537);
  } finally {
    pathStat.mock.restore();
    descriptorRead.mock.restore();
    syncBuiltinESMExports();
  }
});

test('database start/reset prepare templates before CLI and permission failure blocks CLI', (t) => {
  const cwd = mkdtempSync(join(tmpdir(), 'local-auth-db-order-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const scripts = join(cwd, 'scripts');
  mkdirSync(scripts);
  writeFileSync(
    join(scripts, 'db.mjs'),
    readFileSync(new URL('../scripts/db.mjs', import.meta.url)),
  );
  writeFileSync(
    join(scripts, 'runtime.mjs'),
    `export const npm = args => console.log('cli:' + args.slice(3).join(' ')); export const localStatus = () => ({}); export const node = () => {}; export const localTestEnv = () => ({});`,
  );
  writeFileSync(
    join(scripts, 'local-storage-version.mjs'),
    `export const installLocalStorageVersion = () => {}; export const verifyLocalStorageRuntime = () => {};`,
  );
  writeFileSync(
    join(scripts, 'local-auth-templates.mjs'),
    `export const prepareLocalAuthTemplates = () => { console.log('prepare'); if (process.env.FIXTURE_REJECT) throw new Error('fixture rejected'); }; export const verifyLocalAuthTemplates = async phase => console.log('verify:' + phase);`,
  );
  for (const [command, cli, phase] of [
    ['start', 'start', 'startup'],
    ['reset', 'db reset --local', 'reset'],
  ]) {
    const output = execFileSync(
      process.execPath,
      [join(scripts, 'db.mjs'), command],
      { encoding: 'utf8', cwd },
    );
    assert.deepEqual(output.trim().split(/\r?\n/), [
      'prepare',
      'cli:' + cli,
      'verify:' + phase,
    ]);
    assert.throws(
      () =>
        execFileSync(process.execPath, [join(scripts, 'db.mjs'), command], {
          env: { ...process.env, FIXTURE_REJECT: '1' },
          encoding: 'utf8',
          stdio: 'pipe',
          cwd,
        }),
      (error) => {
        assert.equal(error.stdout.trim(), 'prepare');
        assert.match(error.stderr, /fixture rejected/);
        return true;
      },
    );
  }
});
test('preserves configuration, mounts, health check, aliases and existing environment', () => {
  const original = snapshot();
  const next = passwordPolicyConfig(original);
  assert.deepEqual(next.HostConfig, original.HostConfig);
  assert.deepEqual(next.Healthcheck, original.Config.Healthcheck);
  assert.deepEqual(
    next.NetworkingConfig.EndpointsConfig['supabase_network_it-inventory']
      .Aliases,
    ['supabase_auth_it-inventory', 'auth'],
  );
  assert.deepEqual(next.Env, [
    ...original.Config.Env,
    'GOTRUE_SECURITY_UPDATE_PASSWORD_REQUIRE_CURRENT_PASSWORD=true',
  ]);
  assert.equal(original.Config.Env.length, 2);
});
test('refuses hosted Docker endpoints and preserves context precedence', () => {
  assert.throws(() => localDockerSocket({ DOCKER_HOST: 'tcp://remote:2375' }));
  assert.throws(() =>
    localDockerSocket({ DOCKER_HOST: 'npipe:////remote/pipe/docker_engine' }),
  );
  assert.equal(
    localDockerSocket({ DOCKER_HOST: 'unix:///var/run/docker.sock' }),
    '/var/run/docker.sock',
  );
  const socket = localDockerSocket(
    { DOCKER_CONTEXT: 'local', DOCKER_HOST: 'tcp://remote:2375' },
    (_cmd, args, options) => {
      assert.equal(args[2], 'local');
      assert.equal(options.env.DOCKER_HOST, undefined);
      return JSON.stringify('npipe:////./pipe/docker_engine');
    },
  );
  assert.equal(socket, '\\\\.\\pipe\\docker_engine');
});
test('reuses existing anonymous volume names instead of creating empty mounts', () => {
  const original = snapshot();
  original.Mounts = [
    {
      Type: 'volume',
      Name: 'original-volume',
      Destination: '/mail',
      RW: false,
    },
  ];
  const next = passwordPolicyConfig(original);
  assert.deepEqual(next.HostConfig.Mounts, [
    {
      Type: 'volume',
      Source: 'original-volume',
      Target: '/mail',
      ReadOnly: true,
    },
  ]);
});
test('refuses wrong project, version, database, published ports and privilege', () => {
  for (const alter of [
    (value) => {
      value.Name = '/other';
    },
    (value) => {
      value.Config.Image = 'supabase/gotrue:latest';
    },
    (value) => {
      value.Config.Labels['com.supabase.cli.project'] = 'other';
    },
    (value) => {
      value.Config.Env[0] =
        'GOTRUE_DB_DATABASE_URL=postgres://fixture@hosted.example/postgres';
    },
    (value) => {
      value.HostConfig.Privileged = true;
    },
    (value) => {
      value.HostConfig.PortBindings = {
        '9999/tcp': [{ HostIp: '0.0.0.0', HostPort: '9999' }],
      };
    },
  ]) {
    const value = snapshot();
    alter(value);
    assert.throws(() => passwordPolicyConfig(value));
  }
});
for (const failAt of [
  'none',
  'stop',
  'rename',
  'create',
  'start',
  'templates',
  'run',
])
  test('restores original container after ' + failAt, async () => {
    const calls = [];
    const originalState = snapshot();
    const api = async (method, path, body) => {
      calls.push({ method, path, body });
      if (path === '/containers/supabase_auth_it-inventory/json')
        return snapshot();
      if (path === '/containers/original-id/json')
        return structuredClone(originalState);
      if (path === '/containers/original-id/stop?t=10') {
        originalState.State.Running = false;
        if (failAt === 'stop') throw new Error('lost stop response');
      }
      if (path.startsWith('/containers/original-id/rename?name=')) {
        originalState.Name = '/' + path.split('name=')[1];
        if (failAt === 'rename' && path.includes('_backup_'))
          throw new Error('lost rename response');
      }
      if (path === '/containers/original-id/start')
        originalState.State.Running = true;
      if (path.startsWith('/containers/create')) {
        if (failAt === 'create') throw new Error('fixture');
        return { Id: 'replacement-id' };
      }
      if (path === '/containers/replacement-id/start' && failAt === 'start')
        throw new Error('fixture');
      if (path === '/containers/replacement-id/json')
        return { State: { Running: true, Health: { Status: 'healthy' } } };
      return null;
    };
    const promise = withLocalPasswordPolicy(
      async () => {
        if (failAt === 'run') throw new Error('fixture');
        return 'done';
      },
      {
        api,
        verifyTemplates: async (phase) => {
          assert.equal(phase, 'password-policy-replacement');
          assert.equal(calls.at(-1).path, '/containers/replacement-id/json');
          if (failAt === 'templates')
            throw new Error('Local Auth template prerequisite failed');
        },
      },
    );
    if (failAt === 'none') assert.equal(await promise, 'done');
    else await assert.rejects(promise);
    assert.equal(calls.at(-1).path, '/containers/original-id/json');
    if (failAt !== 'stop')
      assert.ok(
        calls.some(
          (call) =>
            call.path ===
            '/containers/original-id/rename?name=supabase_auth_it-inventory',
        ),
      );
    if (['none', 'start', 'templates', 'run'].includes(failAt))
      assert.ok(
        calls.some(
          (call) =>
            call.method === 'DELETE' &&
            call.path === '/containers/replacement-id?force=true',
        ),
      );
  });

function simultaneousFailure({
  originalFailure,
  setupFailure = false,
  restoreFailure = true,
}) {
  const calls = [],
    original = snapshot();
  const api = async (method, path) => {
    calls.push({ method, path });
    if (path === '/containers/supabase_auth_it-inventory/json')
      return snapshot();
    if (path === '/containers/original-id/json')
      return structuredClone(original);
    if (path === '/containers/original-id/stop?t=10')
      original.State.Running = false;
    if (path.startsWith('/containers/original-id/rename?name=')) {
      if (restoreFailure && path.endsWith('name=supabase_auth_it-inventory'))
        throw new Error('PRIVATE_DOCKER_CONFIG_RESPONSE');
      original.Name = '/' + path.split('name=')[1];
    }
    if (path.startsWith('/containers/create')) return { Id: 'replacement-id' };
    if (path === '/containers/replacement-id/start' && setupFailure)
      throw originalFailure;
    if (path === '/containers/replacement-id/json')
      return { State: { Running: true, Health: { Status: 'healthy' } } };
    if (method === 'DELETE' && restoreFailure)
      throw new Error('PRIVATE_DOCKER_CONFIG_RESPONSE');
    if (path === '/containers/original-id/start') {
      if (restoreFailure) throw new Error('PRIVATE_DOCKER_CONFIG_RESPONSE');
      original.State.Running = true;
    }
    return null;
  };
  return {
    calls,
    run: () =>
      withLocalPasswordPolicy(
        async () => {
          throw originalFailure;
        },
        { api, verifyTemplates: async () => {} },
      ),
  };
}
for (const setupFailure of [false, true])
  for (const [label, originalFailure] of [
    ['Error', new Error('Original policy failure')],
    ['value', 'original-value'],
    ['undefined', undefined],
  ])
    test(`retains original ${label} from ${setupFailure ? 'setup' : 'run'} with sanitized restoration failure and attempts remaining steps`, async () => {
      const f = simultaneousFailure({ originalFailure, setupFailure });
      const error = await f.run().catch((error) => error);
      assert.ok(error instanceof AggregateError);
      assert.equal(error.errors[0], originalFailure);
      assert.equal(error.errors.length, 2);
      assert.match(
        error.errors[1].message,
        /Local Auth fixture restoration needs attention/,
      );
      assert.doesNotMatch(
        String(error) + String(error.errors[1]),
        /PRIVATE_DOCKER_CONFIG_RESPONSE/,
      );
      assert.ok(f.calls.some((c) => c.method === 'DELETE'));
      assert.ok(
        f.calls.some(
          (c) =>
            c.path ===
            '/containers/original-id/rename?name=supabase_auth_it-inventory',
        ),
      );
      assert.ok(
        f.calls.some((c) => c.path === '/containers/original-id/start'),
      );
      assert.equal(f.calls.at(-1).path, '/containers/original-id/json');
    });
test('rethrows even undefined unchanged when restoration succeeds', async () => {
  const f = simultaneousFailure({
    originalFailure: undefined,
    restoreFailure: false,
  });
  let rejected = false;
  await f.run().then(
    () => assert.fail('Expected original rejection'),
    (error) => {
      rejected = true;
      assert.equal(error, undefined);
    },
  );
  assert.equal(rejected, true);
});
test('restoration-only failure remains sanitized while later restoration steps still run', async () => {
  // The actual run succeeds while replacement deletion fails.
  const calls = [],
    original = snapshot();
  const api = async (method, path) => {
    calls.push({ method, path });
    if (path === '/containers/supabase_auth_it-inventory/json')
      return snapshot();
    if (path === '/containers/original-id/json')
      return structuredClone(original);
    if (path.endsWith('/stop?t=10')) original.State.Running = false;
    if (path.includes('/rename?name='))
      original.Name = '/' + path.split('name=')[1];
    if (path.startsWith('/containers/create')) return { Id: 'replacement-id' };
    if (path === '/containers/replacement-id/json')
      return { State: { Running: true, Health: { Status: 'healthy' } } };
    if (method === 'DELETE') throw new Error('PRIVATE_DOCKER_CONFIG_RESPONSE');
    if (path === '/containers/original-id/start') original.State.Running = true;
    return null;
  };
  const error = await withLocalPasswordPolicy(async () => 'result', {
    api,
    verifyTemplates: async () => {},
  }).catch((error) => error);
  assert.ok(error instanceof Error);
  assert.equal(error instanceof AggregateError, false);
  assert.match(error.message, /Local Auth fixture restoration needs attention/);
  assert.doesNotMatch(String(error), /PRIVATE_DOCKER_CONFIG_RESPONSE/);
  assert.equal(calls.at(-1).path, '/containers/original-id/json');
});

const files = localAuthTemplateFiles();
const service = (kind) => ({
  Name: `/supabase_${kind}_it-inventory`,
  State: { Running: true },
  Config: {
    Image: `public.ecr.aws/supabase/${kind === 'auth' ? 'gotrue:v2.196.0' : 'kong:2.8.1'}`,
    Labels: { 'com.supabase.cli.project': 'it-inventory' },
    Env: [
      'GOTRUE_DB_DATABASE_URL=postgres://fixture@supabase_db_it-inventory:5432/postgres',
      ...files.map(
        (file) =>
          `GOTRUE_MAILER_TEMPLATES_${file.kind.toUpperCase()}=${file.url}`,
      ),
    ],
  },
  HostConfig: { Privileged: false, PortBindings: {} },
  NetworkSettings: { Networks: { 'supabase_network_it-inventory': {} } },
});
function probe(fetch = (file) => file.body) {
  let time = 0;
  const reports = [];
  return {
    reports,
    options: {
      docker: {
        inspect: (name) => service(name.includes('_auth_') ? 'auth' : 'kong'),
        fetch,
      },
      now: () => time,
      sleep: async (ms) => {
        time += ms;
      },
      timeoutMs: 2_000,
      report: (line) => reports.push(line),
    },
  };
}
const response = (body, status = '200 OK', extra = '') =>
  Buffer.concat([
    Buffer.from(
      `HTTP/1.0 ${status}\r\nContent-Length: ${body.length}\r\n${extra}\r\n`,
    ),
    body,
  ]);

test('reads the actual canonical invite/recovery files and captures every phase without body output', async () => {
  assert.deepEqual(
    files.map((file) => file.kind),
    ['invite', 'recovery'],
  );
  for (const phase of ['startup', 'reset', 'password-policy-replacement']) {
    const f = probe();
    await verifyLocalAuthTemplates(phase, f.options);
    assert.deepEqual(f.reports, [
      `Local Auth templates: phase=${phase} invite=matched recovery=matched.`,
    ]);
    assert.doesNotMatch(f.reports.join(''), /token_hash|href|GOTRUE|postgres/);
  }
});
test('allows bounded transient listener readiness and validates both static bodies', async () => {
  const calls = [];
  const f = probe((file) => {
    calls.push(file.kind);
    if (calls.length === 1) throw new Error('PRIVATE_SOCKET_ERROR');
    return file.body;
  });
  await verifyLocalAuthTemplates('startup', f.options);
  assert.deepEqual(calls, ['invite', 'invite', 'recovery']);
});
for (const [category, fetch] of [
  [
    'listener-unavailable',
    () => {
      throw new Error('PRIVATE_TOKEN_RESPONSE');
    },
  ],
  ['content-mismatch', () => Buffer.from('PRIVATE_TOKEN_RESPONSE')],
  ['response-limit', () => Buffer.alloc(65_537)],
  [
    'http-redirect',
    () =>
      localAuthTemplateResponse(
        response(
          Buffer.from('secret'),
          '302 Found',
          'Location: https://hosted.example/?token=PRIVATE\r\n',
        ),
      ),
  ],
])
  test(`bounded ${category} identifies phase and omits response secrets`, async () => {
    const f = probe(fetch);
    await assert.rejects(
      verifyLocalAuthTemplates('reset', f.options),
      (error) => {
        assert.match(
          error.message,
          new RegExp(`phase=reset template=invite category=${category}`),
        );
        assert.doesNotMatch(
          error.message,
          /PRIVATE|hosted\.example|GOTRUE|token=/,
        );
        return true;
      },
    );
    assert.deepEqual(f.reports, []);
  });
test('response parser preserves only validated HTTP status through the verifier diagnostic', async () => {
  for (const status of [100, 199, 201, 299, 300, 302, 399, 400, 404, 599]) {
    const category =
      status >= 300 && status < 400 ? 'http-redirect' : 'http-status';
    const fetch = () =>
      localAuthTemplateResponse(
        response(
          Buffer.from('PRIVATE_BODY'),
          `${status} PRIVATE_REASON`,
          'Location: https://hosted.example/?token=PRIVATE\r\nX-Private: PRIVATE_HEADER\r\n',
        ),
      );
    assert.throws(fetch, (error) => {
      assert.equal(error.category, category);
      assert.equal(error.httpStatus, status);
      assert.doesNotMatch(String(error), /PRIVATE|hosted|token=/);
      return true;
    });
    const f = probe(fetch);
    await assert.rejects(
      verifyLocalAuthTemplates('startup', f.options),
      (error) => {
        assert.match(
          error.message,
          new RegExp(
            `phase=startup template=invite category=${category} status=${status}\\.`,
          ),
        );
        assert.doesNotMatch(error.message, /PRIVATE|hosted|token=/);
        return true;
      },
    );
    assert.deepEqual(f.reports, []);
  }
});

test('malformed and out-of-range HTTP status has a distinct sanitized category', async () => {
  for (const status of [
    '099 PRIVATE',
    '600 PRIVATE',
    '999 PRIVATE',
    '4040 PRIVATE',
    '200PRIVATE',
    'PRIVATE',
  ]) {
    const fetch = () =>
      localAuthTemplateResponse(response(Buffer.from('PRIVATE_BODY'), status));
    assert.throws(fetch, (error) => {
      assert.equal(error.category, 'http-status-malformed');
      assert.equal(error.httpStatus, undefined);
      assert.doesNotMatch(String(error), /PRIVATE/);
      return true;
    });
    const f = probe(fetch);
    await assert.rejects(
      verifyLocalAuthTemplates('reset', f.options),
      (error) => {
        assert.match(error.message, /category=http-status-malformed\./);
        assert.doesNotMatch(error.message, /status=|PRIVATE/);
        return true;
      },
    );
    assert.deepEqual(f.reports, []);
  }
});

test('forged fetch failures cannot inject status, category or private error details', async () => {
  for (const error of [
    ...[
      '404 PRIVATE',
      '404',
      99,
      600,
      NaN,
      Infinity,
      { toString: () => 'PRIVATE' },
    ].map((httpStatus) => ({
      category: 'http-status',
      httpStatus,
      message: 'PRIVATE_BODY',
      headers: 'PRIVATE_HEADER',
    })),
    { category: 'http-status-malformed', httpStatus: 404, message: 'PRIVATE' },
    { category: 'PRIVATE_CATEGORY', httpStatus: 404, message: 'PRIVATE' },
    null,
    undefined,
  ]) {
    const f = probe(() => {
      throw error;
    });
    await assert.rejects(
      verifyLocalAuthTemplates('reset', f.options),
      (failure) => {
        assert.match(
          failure.message,
          /category=(?:http-status|http-status-malformed|listener-unavailable)\./,
        );
        assert.doesNotMatch(failure.message, /status=|PRIVATE/);
        return true;
      },
    );
    assert.deepEqual(f.reports, []);
  }
});

test('wrong project, network, database port and template URL fail before any fetch', async () => {
  for (const alter of [
    (auth) => {
      auth.Config.Labels['com.supabase.cli.project'] = 'other';
    },
    (auth) => {
      auth.NetworkSettings.Networks = { hosted: {} };
    },
    (auth) => {
      auth.Config.Env[0] =
        'GOTRUE_DB_DATABASE_URL=postgres://secret@supabase_db_it-inventory:9999/postgres';
    },
    (auth) => {
      auth.Config.Env[1] =
        'GOTRUE_MAILER_TEMPLATES_INVITE=https://hosted.example/?token=PRIVATE';
    },
    (auth) => {
      auth.HostConfig.PortBindings = { '9999/tcp': [{ HostIp: '0.0.0.0' }] };
    },
  ]) {
    const f = probe(() => assert.fail('Unvalidated service fetched a URL'));
    f.options.docker.inspect = (name) => {
      const inspected = service(name.includes('_auth_') ? 'auth' : 'kong');
      if (name.includes('_auth_')) alter(inspected);
      return inspected;
    };
    await assert.rejects(
      verifyLocalAuthTemplates('startup', f.options),
      (error) => {
        assert.match(error.message, /category=service-config/);
        assert.doesNotMatch(error.message, /PRIVATE|hosted|postgres|secret/);
        return true;
      },
    );
  }
});
test('service inspection and invalid local daemon errors are sanitized', async () => {
  const f = probe();
  f.options.docker.inspect = () => {
    throw new Error('PRIVATE_ENV_VALUES');
  };
  await assert.rejects(
    verifyLocalAuthTemplates('startup', f.options),
    /category=service-inspection/,
  );
  await assert.rejects(
    verifyLocalAuthTemplates('startup', {
      environment: { DOCKER_HOST: 'https://hosted.example/?token=PRIVATE' },
    }),
    (error) => {
      assert.match(error.message, /category=local-docker/);
      assert.doesNotMatch(error.message, /PRIVATE|hosted/);
      return true;
    },
  );
});
test('fixed HTTP requests use pinned local Docker, bounded buffers/timeouts and never follow redirects', () => {
  const calls = [];
  const docker = localAuthTemplateDocker(
    { DOCKER_CONTEXT: 'fixture', DOCKER_HOST: 'tcp://hosted:2375' },
    (command, args, options) => {
      calls.push({ command, args, options });
      if (args[0] === 'context')
        return JSON.stringify('unix:///var/run/docker.sock');
      return response(files[0].body);
    },
  );
  assert.deepEqual(docker.fetch(files[0]), files[0].body);
  const call = calls[1];
  assert.deepEqual(call.args, [
    '--host',
    'unix:///var/run/docker.sock',
    'exec',
    '-i',
    'supabase_auth_it-inventory',
    'busybox',
    'nc',
    '-w',
    '3',
    'supabase_kong_it-inventory',
    '8088',
  ]);
  assert.equal(
    call.options.input,
    'GET /email/invite.html HTTP/1.0\r\nHost: supabase_kong_it-inventory:8088\r\nConnection: close\r\n\r\n',
  );
  assert.equal(call.options.timeout, 4_000);
  assert.equal(call.options.maxBuffer, 73_728);
  assert.equal(call.options.env.DOCKER_HOST, undefined);
  assert.equal(call.options.env.DOCKER_CONTEXT, undefined);
  assert.throws(() =>
    docker.fetch({ ...files[0], url: 'https://hosted.example' }),
  );
  assert.equal(calls.length, 2);
});
test('rejects redirect, truncated, encoded, oversized and non-success HTTP responses', () => {
  for (const raw of [
    response(
      Buffer.from(''),
      '302 Found',
      'Location: https://hosted.example\r\n',
    ),
    response(Buffer.from(''), '404 Not Found'),
    response(Buffer.from('secret'), '200 OK', 'Transfer-Encoding: chunked\r\n'),
    Buffer.from('HTTP/1.0 200 OK\r\nContent-Length: 9\r\n\r\nx'),
    Buffer.alloc(73_729),
  ])
    assert.throws(() => localAuthTemplateResponse(raw));
});

test('missing probe client is a fixed category without exposing its stderr', () => {
  const docker = localAuthTemplateDocker(
    { DOCKER_HOST: 'unix:///var/run/docker.sock' },
    () => {
      throw Object.assign(new Error('PRIVATE_DAEMON_ERROR'), {
        status: 127,
        stderr: Buffer.from('PRIVATE_RESPONSE'),
      });
    },
  );
  assert.throws(
    () => docker.fetch(files[0]),
    (error) => {
      assert.equal(error.category, 'probe-client');
      assert.doesNotMatch(String(error), /PRIVATE/);
      return true;
    },
  );
});

test('does not start another fetch at the exact readiness deadline', async () => {
  let time = 0;
  const calls = [];
  const f = probe((file, remainingMs) => {
    calls.push({ kind: file.kind, remainingMs });
    time += remainingMs;
    return file.body;
  });
  f.options.now = () => time;
  await assert.rejects(
    verifyLocalAuthTemplates('reset', f.options),
    /template=recovery category=readiness-deadline/,
  );
  assert.deepEqual(calls, [{ kind: 'invite', remainingMs: 2_000 }]);
  assert.deepEqual(f.reports, []);
});

test('passes the shrinking budget and rejects success at or beyond the deadline', async () => {
  for (const overrun of [0, 1]) {
    let time = 0;
    const calls = [];
    const f = probe((file, remainingMs) => {
      calls.push({ kind: file.kind, remainingMs });
      time += file.kind === 'invite' ? 1_200 : remainingMs + overrun;
      return file.body;
    });
    f.options.now = () => time;
    await assert.rejects(
      verifyLocalAuthTemplates('startup', f.options),
      /template=recovery category=readiness-deadline/,
    );
    assert.deepEqual(calls, [
      { kind: 'invite', remainingMs: 2_000 },
      { kind: 'recovery', remainingMs: 800 },
    ]);
    assert.deepEqual(f.reports, []);
  }
});

test('remaining subsecond budget bounds the actual command and nc timeout', () => {
  const calls = [];
  const docker = localAuthTemplateDocker(
    { DOCKER_HOST: 'unix:///var/run/docker.sock' },
    (_command, args, options) => {
      calls.push({ args, options });
      return response(files[0].body);
    },
  );
  assert.deepEqual(docker.fetch(files[0], 125), files[0].body);
  assert.equal(calls[0].options.timeout, 125);
  assert.equal(calls[0].args[calls[0].args.indexOf('-w') + 1], '1');
  assert.throws(() => docker.fetch(files[0], 0));
  assert.equal(calls.length, 1);
});
