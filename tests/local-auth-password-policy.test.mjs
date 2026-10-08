import test from 'node:test';
import assert from 'node:assert/strict';
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
      { api },
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
