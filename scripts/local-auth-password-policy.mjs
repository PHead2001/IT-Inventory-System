// Test-only fixture. Never used by the application or hosted deployment tooling.
// Keep the original container intact so finally restores its exact configuration.
import assert from 'node:assert/strict';
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { verifyLocalAuthTemplates } from './local-auth-templates.mjs';
import { localDockerSocket } from './local-docker-socket.mjs';
export { localDockerSocket } from './local-docker-socket.mjs';

const NAME = 'supabase_auth_it-inventory';
const POLICY = 'GOTRUE_SECURITY_UPDATE_PASSWORD_REQUIRE_CURRENT_PASSWORD';
const FIXTURE_LABEL = 'it-inventory.test.password-policy';
function engine(socketPath) {
  return (method, path, payload) =>
    new Promise((resolve, reject) => {
      const body = payload ? JSON.stringify(payload) : '';
      const request = http.request(
        {
          socketPath,
          method,
          path,
          headers: body
            ? {
                'content-type': 'application/json',
                'content-length': Buffer.byteLength(body),
              }
            : {},
        },
        (response) => {
          let output = '';
          response.setEncoding('utf8');
          response.on('data', (chunk) => {
            output += chunk;
            if (output.length > 2_097_152) request.destroy();
          });
          response.on('end', () => {
            // Docker responses can contain environment secrets. Never echo bodies.
            if (response.statusCode < 200 || response.statusCode >= 300)
              return reject(
                new Error(
                  'Local Auth fixture Docker operation failed (HTTP ' +
                    response.statusCode +
                    ')',
                ),
              );
            try {
              resolve(output ? JSON.parse(output) : null);
            } catch {
              reject(
                new Error('Local Auth fixture Docker response was invalid'),
              );
            }
          });
        },
      );
      request.setTimeout(30_000, () =>
        request.destroy(
          new Error('Local Auth fixture Docker operation timed out'),
        ),
      );
      request.on('error', () =>
        reject(new Error('Local Auth fixture Docker transport failed')),
      );
      request.end(body);
    });
}

export function passwordPolicyConfig(inspected) {
  assert.equal(inspected.Name, '/' + NAME);
  assert.equal(
    inspected.Config.Labels['com.supabase.cli.project'],
    'it-inventory',
  );
  assert.match(inspected.Config.Image, /(?:^|\/)supabase\/gotrue:v2\.196\.0$/);
  assert.equal(inspected.State.Running, true);
  assert.equal(inspected.HostConfig.AutoRemove, false);
  assert.equal(inspected.HostConfig.Privileged, false);
  const db = inspected.Config.Env.find((value) =>
    value.startsWith('GOTRUE_DB_DATABASE_URL='),
  );
  assert.ok(db, 'Auth fixture requires local database configuration');
  assert.equal(
    new URL(db.slice(db.indexOf('=') + 1)).hostname,
    'supabase_db_it-inventory',
  );
  for (const bindings of Object.values(inspected.HostConfig.PortBindings ?? {}))
    for (const port of bindings ?? [])
      assert.ok(
        ['127.0.0.1', '::1'].includes(port.HostIp),
        'Auth fixture refuses nonloopback published ports',
      );
  const endpoints = {};
  for (const [name, endpoint] of Object.entries(
    inspected.NetworkSettings.Networks,
  )) {
    assert.equal(name, 'supabase_network_it-inventory');
    endpoints[name] = {
      Aliases: endpoint.Aliases,
      ...(endpoint.IPAMConfig ? { IPAMConfig: endpoint.IPAMConfig } : {}),
      ...(endpoint.DriverOpts ? { DriverOpts: endpoint.DriverOpts } : {}),
    };
  }
  assert.equal(Object.keys(endpoints).length, 1);
  const hostConfig = structuredClone(inspected.HostConfig);
  // Bind/Mounts entries preserve explicit mounts. Docker-created anonymous
  // volumes need their existing names supplied to avoid a fresh empty volume.
  const targets = new Set([
    ...(hostConfig.Mounts ?? []).map((mount) => mount.Target),
    ...Object.keys(hostConfig.Tmpfs ?? {}),
  ]);
  for (const mount of inspected.Mounts ?? []) {
    if (targets.has(mount.Destination)) continue;
    if (
      (hostConfig.Binds ?? []).some(
        (bind) =>
          bind.includes(':' + mount.Destination + ':') ||
          bind.endsWith(':' + mount.Destination),
      )
    )
      continue;
    assert.ok(
      ['bind', 'volume'].includes(mount.Type),
      'Auth fixture refuses unsupported mount configuration',
    );
    hostConfig.Mounts ??= [];
    hostConfig.Mounts.push({
      Type: mount.Type,
      Source: mount.Type === 'volume' ? mount.Name : mount.Source,
      Target: mount.Destination,
      ReadOnly: !mount.RW,
    });
  }
  return {
    ...structuredClone(inspected.Config),
    Env: [
      ...inspected.Config.Env.filter(
        (value) => !value.startsWith(POLICY + '='),
      ),
      POLICY + '=true',
    ],
    HostConfig: hostConfig,
    NetworkingConfig: { EndpointsConfig: endpoints },
  };
}

export async function withLocalPasswordPolicy(
  run,
  {
    api,
    environment = process.env,
    verifyTemplates = verifyLocalAuthTemplates,
  } = {},
) {
  api ??= engine(localDockerSocket(environment));
  const original = await api('GET', '/containers/' + NAME + '/json');
  const config = passwordPolicyConfig(original);
  const marker = randomUUID();
  config.Labels = { ...config.Labels, [FIXTURE_LABEL]: marker };
  const backup = NAME + '_password_policy_backup_' + randomUUID();
  let stopped = false,
    renamed = false,
    replacement = null;
  let runFailed = false;
  let originalFailure;
  let result;
  try {
    stopped = true;
    await api('POST', '/containers/' + original.Id + '/stop?t=10');
    renamed = true;
    await api('POST', '/containers/' + original.Id + '/rename?name=' + backup);
    replacement = await api('POST', '/containers/create?name=' + NAME, config);
    await api('POST', '/containers/' + replacement.Id + '/start');
    const deadline = Date.now() + 60_000;
    let healthy = false;
    while (Date.now() < deadline) {
      const state = await api('GET', '/containers/' + replacement.Id + '/json');
      if (!state.State.Running)
        throw new Error('Local Auth policy fixture stopped before readiness');
      if (state.State.Health?.Status === 'healthy') {
        healthy = true;
        break;
      }
      if (state.State.Health?.Status === 'unhealthy')
        throw new Error('Local Auth policy fixture health check failed');
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    assert.ok(healthy, 'Local Auth policy fixture readiness deadline reached');
    await verifyTemplates('password-policy-replacement', { environment });
    result = await run();
  } catch (error) {
    runFailed = true;
    originalFailure = error;
  } finally {
    // Remove only our replacement; do not touch database/volumes or another stack.
    let restoreFailed = false;
    // A create response may be lost after the daemon created the fixture.
    // Resolve only our uniquely labelled container before removing anything.
    if (renamed && !replacement) {
      try {
        const candidate = await api('GET', '/containers/' + NAME + '/json');
        if (candidate?.Config?.Labels?.[FIXTURE_LABEL] === marker)
          replacement = candidate;
      } catch {
        /* Missing replacement is normal if create was rejected. */
      }
    }
    if (replacement) {
      try {
        await api('DELETE', '/containers/' + replacement.Id + '?force=true');
      } catch {
        restoreFailed = true;
      }
    }
    if (renamed) {
      try {
        const current = await api(
          'GET',
          '/containers/' + original.Id + '/json',
        );
        if (current.Name !== original.Name) {
          assert.equal(
            current.Name,
            '/' + backup,
            'Original Auth name changed outside the fixture',
          );
          await api(
            'POST',
            '/containers/' + original.Id + '/rename?name=' + NAME,
          );
        }
      } catch {
        restoreFailed = true;
      }
    }
    if (stopped) {
      try {
        const current = await api(
          'GET',
          '/containers/' + original.Id + '/json',
        );
        if (!current.State.Running)
          await api('POST', '/containers/' + original.Id + '/start');
      } catch {
        restoreFailed = true;
      }
      // A failed/lost start response must not suppress the final identity and
      // configuration readback or replace an earlier run/setup failure.
      try {
        const restored = await api(
          'GET',
          '/containers/' + original.Id + '/json',
        );
        assert.ok(
          restored.Id === original.Id &&
            restored.Name === original.Name &&
            restored.State.Running &&
            JSON.stringify(restored.Config) === JSON.stringify(original.Config),
          'Original local Auth identity/configuration was not restored',
        );
      } catch {
        restoreFailed = true;
      }
    }
    if (restoreFailed) {
      const restorationError = new Error(
        'Local Auth fixture restoration needs attention; preserve the original password_policy_backup container',
      );
      if (runFailed)
        throw new AggregateError(
          [originalFailure, restorationError],
          'Local Auth policy run and fixture restoration failed',
        );
      throw restorationError;
    }
  }
  if (runFailed) throw originalFailure;
  return result;
}
