import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import http from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  decodeTemplateExecOutput,
  localAuthDockerApi,
  localDockerSocket,
  passwordPolicyConfig,
  verifyLocalAuthTemplates,
  withLocalPasswordPolicy,
} from '../scripts/local-auth-password-policy.mjs';
const templateBody = (kind) =>
  readFileSync(new URL(`../supabase/templates/${kind}.html`, import.meta.url));
const frame = (body, stream = 1) => {
  const bytes = Buffer.from(body);
  const header = Buffer.alloc(8);
  header[0] = stream;
  header.writeUInt32BE(bytes.length, 4);
  return Buffer.concat([header, bytes]);
};
function templateApi(api) {
  const kinds = new Map();
  return async (method, path, body, options) => {
    if (path.endsWith('/exec')) {
      const kind = body.Cmd.at(-1).includes('/invite.html')
        ? 'invite'
        : 'recovery';
      const id = 'template-' + kind;
      kinds.set(id, kind);
      return { Id: id };
    }
    const id = path.split('/')[2];
    if (path.startsWith('/exec/') && kinds.has(id))
      return path.endsWith('/start')
        ? Buffer.concat([
            frame(templateBody(kinds.get(id))),
            frame('HTTP/1.1 200 OK\n', 2),
          ])
        : { Running: false, ExitCode: 0 };
    return api(method, path, body, options);
  };
}
const snapshot = () => ({
  Id: 'original-id',
  Name: '/supabase_auth_it-inventory',
  State: { Running: true },
  Config: {
    Image: 'public.ecr.aws/supabase/gotrue:v2.196.0',
    Env: [
      'GOTRUE_DB_DATABASE_URL=postgres://fixture@supabase_db_it-inventory:5432/postgres',
      'EXISTING=value',
      'GOTRUE_MAILER_TEMPLATES_INVITE=http://supabase_kong_it-inventory:8088/email/invite.html',
      'GOTRUE_MAILER_TEMPLATES_RECOVERY=http://supabase_kong_it-inventory:8088/email/recovery.html',
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
  assert.equal(original.Config.Env.length, 4);
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
for (const failAt of ['none', 'stop', 'rename', 'create', 'start', 'run'])
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
      { api: templateApi(api) },
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
    if (['none', 'start', 'run'].includes(failAt))
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
        { api: templateApi(api) },
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
    api: templateApi(api),
  }).catch((error) => error);
  assert.ok(error instanceof Error);
  assert.equal(error instanceof AggregateError, false);
  assert.match(error.message, /Local Auth fixture restoration needs attention/);
  assert.doesNotMatch(String(error), /PRIVATE_DOCKER_CONFIG_RESPONSE/);
  assert.equal(calls.at(-1).path, '/containers/original-id/json');
});

test('fetches exact templates from the Auth network with bounded non-TTY exec and verifies completion', async () => {
  const calls = [];
  const api = templateApi(() => assert.fail('Unexpected Docker operation'));
  await verifyLocalAuthTemplates(
    async (...args) => {
      calls.push(args);
      return api(...args);
    },
    'replacement-id',
    snapshot().Config,
  );
  assert.equal(calls.length, 6);
  for (const [offset, kind] of ['invite', 'recovery'].entries()) {
    const [method, path, body, options] = calls[offset * 3];
    assert.equal(method, 'POST');
    assert.equal(path, '/containers/replacement-id/exec');
    assert.deepEqual(body, {
      AttachStdout: true,
      AttachStderr: true,
      Tty: false,
      Cmd: [
        'busybox',
        'timeout',
        '-k',
        '1',
        '5',
        'busybox',
        'wget',
        '-T',
        '3',
        '-Y',
        'off',
        '-q',
        '-S',
        '-O',
        '-',
        `http://supabase_kong_it-inventory:8088/email/${kind}.html`,
      ],
    });
    assert.equal(options.timeoutMs, 2_000);
    assert.deepEqual(calls[offset * 3 + 1][3], {
      raw: true,
      maxBytes: 32_768,
      timeoutMs: 8_000,
    });
    assert.equal(calls[offset * 3 + 2][0], 'GET');
    assert.match(calls[offset * 3 + 2][1], /\/json$/);
  }
});

test('rejects missing, duplicate and wrong template URLs before exec without disclosing configuration', async () => {
  for (const alter of [
    (env) =>
      env.filter(
        (value) => !value.startsWith('GOTRUE_MAILER_TEMPLATES_INVITE='),
      ),
    (env) => [...env, env[3]],
    ...[
      'https://secret:password@hosted.example/SECRET',
      'http://supabase_kong_it-inventory:8088/email/invite.html?SECRET',
      'http://127.0.0.1:8088/email/invite.html',
      'http://supabase_kong_it-inventory:8088/email/recovery.html',
    ].map(
      (url) => (env) =>
        env.map((value) =>
          value.startsWith('GOTRUE_MAILER_TEMPLATES_INVITE=')
            ? 'GOTRUE_MAILER_TEMPLATES_INVITE=' + url
            : value,
        ),
    ),
  ]) {
    const config = snapshot().Config;
    config.Env = alter(config.Env);
    const error = await verifyLocalAuthTemplates(
      () => assert.fail('Probe must not run'),
      'replacement-id',
      config,
    ).catch((error) => error);
    assert.match(error.message, /configuration is missing or differs/);
    assert.doesNotMatch(String(error), /SECRET|password|hosted\.example/);
  }
});

test('validates Docker framing and counts stderr and framing against the byte bound', () => {
  assert.deepEqual(
    decodeTemplateExecOutput(
      Buffer.concat([frame('abc'), frame('secret stderr', 2), frame('def')]),
    ),
    { stdout: Buffer.from('abcdef'), stderr: 'secret stderr' },
  );
  for (const output of [
    Buffer.from('SECRET'),
    frame('abc').subarray(0, 9),
    frame('SECRET', 3),
    frame(Buffer.alloc(16_385)),
    Buffer.concat([frame('a'), frame(Buffer.alloc(32_768), 2)]),
  ])
    assert.throws(() => decodeTemplateExecOutput(output), /Invalid|exceeded/);
});

test('mismatched bytes and invalid exec completion fail immediately and redact stdout/stderr', async () => {
  for (const mode of [
    'mismatch',
    'running',
    'exit',
    'http',
    'framing',
    'api',
  ]) {
    let starts = 0;
    const base = templateApi(() => assert.fail('Unexpected Docker operation'));
    const error = await verifyLocalAuthTemplates(
      async (...args) => {
        const [, path] = args;
        if (path.endsWith('/start')) {
          starts++;
          if (mode === 'api') throw new Error('SECRET Docker response');
          if (mode === 'mismatch')
            return Buffer.concat([
              frame('SECRET template body'),
              frame('HTTP/1.1 200 OK\n', 2),
            ]);
          if (mode === 'http')
            return frame('HTTP/1.1 403 Forbidden SECRET redirect URL', 2);
          if (mode === 'framing')
            return Buffer.from('SECRET malformed framing');
        }
        if (path.startsWith('/exec/') && path.endsWith('/json')) {
          if (mode === 'running') return { Running: true, ExitCode: 0 };
          if (['exit', 'http'].includes(mode))
            return { Running: false, ExitCode: 1 };
        }
        return base(...args);
      },
      'replacement-id',
      snapshot().Config,
    ).catch((error) => error);
    assert.ok(error instanceof Error);
    assert.equal(starts, 1);
    assert.doesNotMatch(String(error), /SECRET/);
    if (mode === 'mismatch')
      assert.match(error.message, /served bytes do not match/);
    if (mode === 'http') assert.match(error.message, /Kong HTTP 403/);
  }
});

test('requires final HTTP 200 even with matching bytes and zero exit, while accepting trusted redirects to HTTP 200', async () => {
  for (const status of [201, 204, null, 200]) {
    const base = templateApi(() => assert.fail('Unexpected Docker operation'));
    const promise = verifyLocalAuthTemplates(
      async (...args) => {
        if (args[1].endsWith('/start')) {
          const kind = args[1].includes('template-invite')
            ? 'invite'
            : 'recovery';
          return Buffer.concat([
            frame(templateBody(kind)),
            frame(
              `HTTP/1.1 302 Found\nLocation: SECRET\n${status === null ? '' : `HTTP/1.1 ${status} OK\n`}`,
              2,
            ),
          ]);
        }
        return base(...args);
      },
      'replacement-id',
      snapshot().Config,
    );
    if (status === 200) await promise;
    else
      await assert.rejects(promise, (error) => {
        assert.match(error.message, /Kong HTTP/);
        assert.doesNotMatch(String(error), /SECRET/);
        return true;
      });
  }
});

test('header values cannot forge a success status or turn a real HTTP 200 into a retryable failure', async () => {
  for (const status of [201, 200]) {
    const base = templateApi(() => assert.fail('Unexpected Docker operation'));
    const promise = verifyLocalAuthTemplates(
      async (...args) => {
        if (args[1].endsWith('/start')) {
          const kind = args[1].includes('template-invite')
            ? 'invite'
            : 'recovery';
          const diagnosticStatus = status === 201 ? 200 : 503;
          return Buffer.concat([
            frame(templateBody(kind)),
            frame(
              `  HTTP/1.1 302 Found\r\n  Location: SECRET\r\n  HTTP/1.1 ${status} OK\r\n  X-Diagnostic: HTTP/1.1 ${diagnosticStatus} Forged\r\n`,
              2,
            ),
          ]);
        }
        return base(...args);
      },
      'replacement-id',
      snapshot().Config,
    );
    if (status === 200) await promise;
    else
      await assert.rejects(promise, (error) => {
        assert.match(error.message, /Kong HTTP 201/);
        assert.doesNotMatch(String(error), /SECRET/);
        return true;
      });
  }
});

test('retries only bounded temporary transport/readiness failures before verifying both templates', async () => {
  for (const mode of ['transport', 'wget', 'timeout', 'server']) {
    let starts = 0,
      clock = 0;
    const pauses = [];
    const base = templateApi(() => assert.fail('Unexpected Docker operation'));
    await verifyLocalAuthTemplates(
      async (...args) => {
        const [, path] = args;
        if (path.endsWith('/start')) {
          starts++;
          if (starts === 1) {
            if (mode === 'transport')
              throw Object.assign(new Error('SECRET transport body'), {
                code: 'AUTH_DOCKER_TRANSPORT',
              });
            return frame(
              mode === 'server'
                ? 'HTTP/1.1 503 Unavailable SECRET'
                : 'wget: bad address SECRET',
              2,
            );
          }
        }
        if (path.startsWith('/exec/') && path.endsWith('/json') && starts === 1)
          return { Running: false, ExitCode: mode === 'timeout' ? 143 : 1 };
        return base(...args);
      },
      'replacement-id',
      snapshot().Config,
      {
        now: () => clock,
        pause: async (ms) => {
          pauses.push(ms);
          clock += ms;
        },
      },
    );
    assert.equal(starts, 3);
    assert.deepEqual(pauses, [500]);
  }
});

test('attempt limit and shared deadline stop repeated probes with sanitized errors', async () => {
  for (const elapsed of [0, 20_000]) {
    let starts = 0,
      clock = 0;
    const base = templateApi(() => assert.fail('Unexpected Docker operation'));
    const error = await verifyLocalAuthTemplates(
      async (...args) => {
        if (args[1].endsWith('/start')) {
          starts++;
          clock += elapsed;
          throw Object.assign(new Error('SECRET transport response'), {
            code: 'AUTH_DOCKER_TRANSPORT',
          });
        }
        return base(...args);
      },
      'replacement-id',
      snapshot().Config,
      {
        now: () => clock,
        pause: async (ms) => {
          clock += ms;
        },
      },
    ).catch((error) => error);
    assert.equal(starts, elapsed ? 1 : 3);
    assert.match(error.message, /readiness deadline or attempt limit/);
    assert.doesNotMatch(String(error), /SECRET/);
  }
});

test('both templates share one readiness deadline rather than starting a fresh budget', async () => {
  let clock = 0;
  const calls = [];
  const base = templateApi(() => assert.fail('Unexpected Docker operation'));
  await assert.rejects(
    verifyLocalAuthTemplates(
      async (...args) => {
        calls.push(args);
        const result = await base(...args);
        if (args[1].startsWith('/exec/') && args[1].endsWith('/json'))
          clock = 9_000;
        return result;
      },
      'replacement-id',
      snapshot().Config,
      { now: () => clock },
    ),
    /recovery readiness deadline/,
  );
  assert.equal(calls.length, 3);
});

test(
  'Docker transport enforces absolute timeout, raw byte limit and sanitized response failures',
  { timeout: 3_000 },
  async () => {
    const socketPath =
      process.platform === 'win32'
        ? `\\\\.\\pipe\\auth-template-test-${randomUUID()}`
        : join(tmpdir(), `auth-template-test-${randomUUID()}.sock`);
    const server = http.createServer((request, response) => {
      if (request.url === '/trickle') {
        response.write('SECRET');
        const interval = setInterval(() => response.write('x'), 10);
        response.on('close', () => clearInterval(interval));
      } else if (request.url === '/oversize')
        response.end(Buffer.alloc(100, 65));
      else if (request.url === '/http') {
        response.statusCode = 403;
        response.end('SECRET environment');
      } else response.end('SECRET invalid JSON');
    });
    await new Promise((resolve) => server.listen(socketPath, resolve));
    try {
      const api = localAuthDockerApi(socketPath);
      for (const [path, options, code] of [
        ['/trickle', { raw: true, timeoutMs: 80 }, 'AUTH_DOCKER_TRANSPORT'],
        ['/oversize', { raw: true, maxBytes: 32 }, 'AUTH_DOCKER_OUTPUT_LIMIT'],
        ['/http', {}, 'AUTH_DOCKER_OPERATION'],
        ['/invalid', {}, 'AUTH_DOCKER_RESPONSE'],
      ]) {
        const error = await api('GET', path, undefined, options).catch(
          (error) => error,
        );
        assert.equal(error.code, code);
        assert.doesNotMatch(String(error), /SECRET/);
      }
    } finally {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    }
  },
);

test('preflight failure prevents run and still removes replacement and restores original configuration', async () => {
  for (const missing of [true, false]) {
    const original = snapshot(),
      calls = [];
    if (missing)
      original.Config.Env = original.Config.Env.filter(
        (value) => !value.startsWith('GOTRUE_MAILER_TEMPLATES_INVITE='),
      );
    const initial = structuredClone(original);
    let ran = false;
    const base = templateApi(async (method, path) => {
      calls.push({ method, path });
      if (
        path === '/containers/supabase_auth_it-inventory/json' ||
        path === '/containers/original-id/json'
      )
        return structuredClone(original);
      if (path.endsWith('/stop?t=10')) original.State.Running = false;
      if (path.includes('/rename?name='))
        original.Name = '/' + path.split('name=')[1];
      if (path === '/containers/original-id/start')
        original.State.Running = true;
      if (path.startsWith('/containers/create'))
        return { Id: 'replacement-id' };
      if (path === '/containers/replacement-id/json')
        return { State: { Running: true, Health: { Status: 'healthy' } } };
      return null;
    });
    const error = await withLocalPasswordPolicy(
      async () => {
        ran = true;
      },
      {
        api: async (...args) =>
          args[1].startsWith('/exec/') && args[1].endsWith('/start')
            ? Buffer.concat([
                frame('SECRET wrong template'),
                frame('HTTP/1.1 200 OK\n', 2),
              ])
            : base(...args),
      },
    ).catch((error) => error);
    assert.match(error.message, /Local Auth template preflight/);
    assert.doesNotMatch(String(error), /SECRET/);
    assert.equal(ran, false);
    assert.ok(
      calls.some(
        (call) =>
          call.method === 'DELETE' &&
          call.path === '/containers/replacement-id?force=true',
      ),
    );
    assert.equal(calls.at(-1).path, '/containers/original-id/json');
    assert.deepEqual(original, initial);
  }
});
