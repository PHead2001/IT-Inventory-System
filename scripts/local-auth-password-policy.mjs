// Test-only fixture. Never used by the application or hosted deployment tooling.
// Keep the original container intact so finally restores its exact configuration.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import http from 'node:http';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';

const NAME = 'supabase_auth_it-inventory';
const POLICY = 'GOTRUE_SECURITY_UPDATE_PASSWORD_REQUIRE_CURRENT_PASSWORD';
const FIXTURE_LABEL = 'it-inventory.test.password-policy';
export function localDockerSocket(
  environment = process.env,
  execute = execFileSync,
) {
  const env = { ...environment };
  delete env.DOCKER_CONTEXT;
  delete env.DOCKER_HOST;
  const endpoint = environment.DOCKER_CONTEXT
    ? JSON.parse(
        execute(
          'docker',
          [
            'context',
            'inspect',
            environment.DOCKER_CONTEXT,
            '--format',
            '{{json .Endpoints.docker.Host}}',
          ],
          { env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
        ),
      )
    : environment.DOCKER_HOST ||
      JSON.parse(
        execute(
          'docker',
          ['context', 'inspect', '--format', '{{json .Endpoints.docker.Host}}'],
          { env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
        ),
      );
  if (/^npipe:\/\/\/\/\.\/pipe\/[A-Za-z0-9._-]+$/.test(endpoint))
    return endpoint.slice('npipe://'.length).replaceAll('/', '\\');
  const url = new URL(endpoint);
  assert.ok(
    url.protocol === 'unix:' &&
      !url.hostname &&
      !url.username &&
      !url.password &&
      !url.port &&
      !url.search &&
      !url.hash,
    'Auth fixture requires a local Docker socket',
  );
  return decodeURIComponent(url.pathname);
}

export function localAuthDockerApi(socketPath) {
  return (
    method,
    path,
    payload,
    { raw = false, maxBytes = 2_097_152, timeoutMs = 30_000 } = {},
  ) =>
    new Promise((resolve, reject) => {
      const body = payload ? JSON.stringify(payload) : '';
      let timer;
      const fail = (code, message) => {
        clearTimeout(timer);
        reject(Object.assign(new Error(message), { code }));
      };
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
          const chunks = [];
          let bytes = 0;
          response.on('data', (chunk) => {
            bytes += chunk.length;
            if (bytes > maxBytes) {
              fail(
                'AUTH_DOCKER_OUTPUT_LIMIT',
                'Local Auth fixture Docker output exceeded its bound',
              );
              request.destroy();
              return;
            }
            chunks.push(chunk);
          });
          response.on('aborted', () =>
            fail(
              'AUTH_DOCKER_TRANSPORT',
              'Local Auth fixture Docker transport failed',
            ),
          );
          response.on('error', () =>
            fail(
              'AUTH_DOCKER_TRANSPORT',
              'Local Auth fixture Docker transport failed',
            ),
          );
          response.on('end', () => {
            clearTimeout(timer);
            // Docker responses can contain environment secrets. Never echo bodies.
            if (response.statusCode < 200 || response.statusCode >= 300)
              return fail(
                [408, 429, 500, 502, 503, 504].includes(response.statusCode)
                  ? 'AUTH_DOCKER_TRANSIENT'
                  : 'AUTH_DOCKER_OPERATION',
                'Local Auth fixture Docker operation failed (HTTP ' +
                  response.statusCode +
                  ')',
              );
            const output = Buffer.concat(chunks);
            if (raw) return resolve(output);
            try {
              resolve(
                output.length ? JSON.parse(output.toString('utf8')) : null,
              );
            } catch {
              fail(
                'AUTH_DOCKER_RESPONSE',
                'Local Auth fixture Docker response was invalid',
              );
            }
          });
        },
      );
      // Absolute wall time, rather than an idle timeout reset by incoming bytes.
      timer = setTimeout(() => {
        fail(
          'AUTH_DOCKER_TRANSPORT',
          'Local Auth fixture Docker operation timed out',
        );
        request.destroy();
      }, timeoutMs);
      request.on('error', () =>
        fail(
          'AUTH_DOCKER_TRANSPORT',
          'Local Auth fixture Docker transport failed',
        ),
      );
      request.end(body);
    });
}

const TEMPLATE_BYTES = 16_384;
const EXEC_BYTES = 32_768; // Includes both streams and Docker framing.
const templateFailure = (kind, stage, retryable = false) =>
  Object.assign(
    new Error(
      `Local Auth template preflight: ${kind} ${stage}. Check local Kong template configuration, mounts and readiness; email E2E has not run.`,
    ),
    { retryable, stage },
  );

export function decodeTemplateExecOutput(output) {
  if (!Buffer.isBuffer(output) || output.length > EXEC_BYTES)
    throw new Error('Invalid bounded Docker exec output');
  const stdout = [],
    stderr = [];
  let offset = 0,
    stdoutBytes = 0;
  while (offset < output.length) {
    if (output.length - offset < 8)
      throw new Error('Invalid Docker exec framing');
    const stream = output[offset];
    const length = output.readUInt32BE(offset + 4);
    if (
      ![1, 2].includes(stream) ||
      output.readUIntBE(offset + 1, 3) !== 0 ||
      length > output.length - offset - 8
    )
      throw new Error('Invalid Docker exec framing');
    const chunk = output.subarray(offset + 8, offset + 8 + length);
    if (stream === 1) {
      stdoutBytes += length;
      if (stdoutBytes > TEMPLATE_BYTES)
        throw new Error('Template body exceeded its bound');
      stdout.push(chunk);
    } else stderr.push(chunk);
    offset += 8 + length;
  }
  return {
    stdout: Buffer.concat(stdout),
    stderr: Buffer.concat(stderr).toString('utf8'),
  };
}

export async function verifyLocalAuthTemplates(
  api,
  containerId,
  config,
  {
    now = Date.now,
    pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  } = {},
) {
  const templates = ['invite', 'recovery'].map((kind) => {
    const key = `GOTRUE_MAILER_TEMPLATES_${kind.toUpperCase()}=`;
    const entries = config.Env.filter((value) => value.startsWith(key));
    const url = `http://supabase_kong_it-inventory:8088/email/${kind}.html`;
    if (entries.length !== 1 || entries[0] !== key + url)
      throw templateFailure(
        kind,
        'configuration is missing or differs from the required local Kong URL',
      );
    let body;
    try {
      body = readFileSync(
        new URL(`../supabase/templates/${kind}.html`, import.meta.url),
      );
    } catch {
      throw templateFailure(kind, 'checked-in template cannot be read');
    }
    if (!body.length || body.length > TEMPLATE_BYTES)
      throw templateFailure(
        kind,
        'checked-in template exceeds its bound or is empty',
      );
    return { kind, url, hash: createHash('sha256').update(body).digest('hex') };
  });
  const deadline = now() + 20_000;
  for (const { kind, url, hash } of templates) {
    let verified = false;
    let lastStage = 'template retrieval';
    // At most three attempts, with one shared deadline for both templates.
    for (
      let attempt = 0;
      attempt < 3 && now() + 12_000 <= deadline;
      attempt++
    ) {
      let stage = 'Docker exec creation';
      try {
        const exec = await api(
          'POST',
          `/containers/${containerId}/exec`,
          {
            AttachStdout: true,
            AttachStderr: true,
            Tty: false,
            // Alpine's BusyBox is in the pinned Auth image. No shell, credentials,
            // cookies or Auth headers. Redirect behavior matches GoTrue's fetch.
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
              url,
            ],
          },
          { timeoutMs: Math.min(2_000, deadline - now()) },
        );
        if (typeof exec?.Id !== 'string' || !/^[A-Za-z0-9_-]+$/.test(exec.Id))
          throw templateFailure(
            kind,
            'Docker exec creation returned an invalid identity',
          );
        stage = 'Docker exec start';
        const output = await api(
          'POST',
          `/exec/${exec.Id}/start`,
          { Detach: false, Tty: false },
          {
            raw: true,
            maxBytes: EXEC_BYTES,
            timeoutMs: Math.min(8_000, deadline - now()),
          },
        );
        stage = 'Docker exec completion inspection';
        const state = await api('GET', `/exec/${exec.Id}/json`, undefined, {
          timeoutMs: Math.min(2_000, deadline - now()),
        });
        if (state?.Running !== false || !Number.isInteger(state.ExitCode))
          throw templateFailure(
            kind,
            'Docker exec completion could not be verified',
          );
        let streams;
        try {
          streams = decodeTemplateExecOutput(output);
        } catch {
          throw templateFailure(
            kind,
            'Docker exec output is invalid or exceeds its bound',
          );
        }
        const statuses = [
          ...streams.stderr.matchAll(
            /^[\t ]*HTTP\/\d(?:\.\d)?[\t ]+(\d{3})(?:[\t ]+[^\r\n]*)?\r?$/gm,
          ),
        ];
        const status = Number(statuses.at(-1)?.[1]);
        if (state.ExitCode !== 0 || status !== 200) {
          if (status >= 400 && status < 500)
            throw templateFailure(kind, `Kong HTTP ${status}`);
          const transient =
            [124, 137, 143].includes(state.ExitCode) ||
            [500, 502, 503, 504].includes(status) ||
            /bad address|connection refused|network is unreachable|timed out|can't connect|connection reset/i.test(
              streams.stderr,
            );
          const stage = Number.isInteger(status)
            ? `Kong HTTP ${status}`
            : state.ExitCode === 0
              ? 'Kong HTTP status could not be verified'
              : 'template command failed';
          throw templateFailure(
            kind,
            transient ? 'template transport is not ready' : stage,
            transient,
          );
        }
        if (createHash('sha256').update(streams.stdout).digest('hex') !== hash)
          throw templateFailure(
            kind,
            'served bytes do not match the checked-in template',
          );
        verified = true;
        break;
      } catch (error) {
        const transient =
          error?.retryable === true ||
          ['AUTH_DOCKER_TRANSPORT', 'AUTH_DOCKER_TRANSIENT'].includes(
            error?.code,
          );
        if (!transient)
          throw error?.retryable === false
            ? error
            : templateFailure(
                kind,
                `${stage} failed or exceeded its output bound`,
              );
        lastStage = error?.retryable === true ? error.stage : stage;
        if (attempt < 2 && now() + 12_500 <= deadline) await pause(500);
      }
    }
    if (!verified)
      throw templateFailure(
        kind,
        `readiness deadline or attempt limit reached during ${lastStage}`,
      );
  }
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
  { api, environment = process.env, templateTiming } = {},
) {
  api ??= localAuthDockerApi(localDockerSocket(environment));
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
    await verifyLocalAuthTemplates(api, replacement.Id, config, templateTiming);
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
