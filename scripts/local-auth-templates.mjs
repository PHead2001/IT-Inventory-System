// Disposable-local prerequisite diagnostics. Never fetch Auth emails or log bodies.
import assert from 'node:assert/strict';
import { readFileSync, realpathSync, statSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { localDockerSocket } from './local-docker-socket.mjs';

const AUTH = 'supabase_auth_it-inventory';
const KONG = 'supabase_kong_it-inventory';
const NETWORK = 'supabase_network_it-inventory';
const LIMIT = 65_536;
const PHASES = new Set(['startup', 'reset', 'password-policy-replacement']);
const digest = (body) => createHash('sha256').update(body).digest('hex');

export function localAuthTemplateFiles(cwd = process.cwd()) {
  const config = readFileSync(resolve(cwd, 'supabase/config.toml'), 'utf8');
  const root = realpathSync(resolve(cwd, 'supabase/templates')) + sep;
  return ['invite', 'recovery'].map((kind) => {
    const sections = [
      ...config.matchAll(
        new RegExp(
          `^\\[auth\\.email\\.template\\.${kind}\\]\\s*$([\\s\\S]*?)(?=^\\[|$(?![\\s\\S]))`,
          'gm',
        ),
      ),
    ];
    assert.equal(sections.length, 1);
    const paths = [
      ...sections[0][1].matchAll(/^content_path\s*=\s*("[^"\r\n]+")\s*$/gm),
    ];
    assert.equal(paths.length, 1);
    const file = realpathSync(resolve(cwd, JSON.parse(paths[0][1])));
    assert.ok(file.startsWith(root) && file.endsWith('.html'));
    assert.ok(statSync(file).size > 0 && statSync(file).size <= LIMIT);
    const body = readFileSync(file);
    assert.ok(body.length > 0 && body.length <= LIMIT);
    return {
      kind,
      body,
      hash: digest(body),
      url: `http://${KONG}:8088/email/${kind}.html`,
    };
  });
}

function validateContainer(container, name, image) {
  assert.equal(container.Name, '/' + name);
  assert.equal(
    container.Config.Labels['com.supabase.cli.project'],
    'it-inventory',
  );
  assert.match(container.Config.Image, image);
  assert.equal(container.State.Running, true);
  assert.equal(container.HostConfig.Privileged, false);
  assert.deepEqual(Object.keys(container.NetworkSettings.Networks), [NETWORK]);
}

export function validateLocalAuthTemplateServices(auth, kong, files) {
  validateContainer(
    auth,
    AUTH,
    /^(?:(?:public\.ecr\.aws|ghcr\.io|docker\.io)\/)?supabase\/gotrue:v2\.196\.0$/,
  );
  validateContainer(
    kong,
    KONG,
    /^(?:(?:public\.ecr\.aws|ghcr\.io)\/supabase\/|(?:docker\.io\/)?library\/|(?:docker\.io\/)?)kong:2\.8\.1$/,
  );
  for (const bindings of Object.values(auth.HostConfig.PortBindings ?? {}))
    for (const binding of bindings ?? [])
      assert.ok(['127.0.0.1', '::1'].includes(binding.HostIp));
  const database = auth.Config.Env.filter((value) =>
    value.startsWith('GOTRUE_DB_DATABASE_URL='),
  );
  assert.equal(database.length, 1);
  const db = new URL(database[0].slice('GOTRUE_DB_DATABASE_URL='.length));
  assert.equal(db.hostname, 'supabase_db_it-inventory');
  assert.equal(db.port, '5432');
  for (const file of files) {
    const name = `GOTRUE_MAILER_TEMPLATES_${file.kind.toUpperCase()}=`;
    assert.deepEqual(
      auth.Config.Env.filter((value) => value.startsWith(name)),
      [name + file.url],
    );
  }
}

function responseFailure(category) {
  const error = new Error('Static local template response rejected');
  error.category = category;
  throw error;
}

export function localAuthTemplateResponse(response) {
  if (response.length > LIMIT + 8_192) responseFailure('response-limit');
  const raw = Buffer.from(response);
  const end = raw.indexOf('\r\n\r\n');
  if (end < 0 || end > 8_192) responseFailure('http-response');
  const headers = raw.subarray(0, end).toString('ascii');
  const status = /^HTTP\/1\.[01] (\d{3})(?: |\r\n)/.exec(headers)?.[1];
  if (status?.startsWith('3')) responseFailure('http-redirect');
  if (status !== '200') responseFailure('http-status');
  // HTTP/1.0 with Connection: close gives an unencoded static file body.
  if (/^transfer-encoding:|^content-encoding:/im.test(headers))
    responseFailure('http-response');
  const body = raw.subarray(end + 4);
  if (body.length > LIMIT) responseFailure('response-limit');
  const length = /^content-length:\s*(\d+)\s*$/im.exec(headers)?.[1];
  if (!length || Number(length) !== body.length)
    responseFailure('http-response');
  return body;
}

// Pin every daemon command to the resolved local endpoint, even when ambient
// DOCKER_HOST and DOCKER_CONTEXT disagree. Never print inspect/exec errors.
export function localAuthTemplateDocker(
  environment = process.env,
  execute = execFileSync,
) {
  const socket = localDockerSocket(environment, execute);
  const endpoint = socket.startsWith('\\\\.\\pipe\\')
    ? 'npipe:////./pipe/' + socket.slice('\\\\.\\pipe\\'.length)
    : 'unix://' + socket;
  const env = { ...environment };
  delete env.DOCKER_HOST;
  delete env.DOCKER_CONTEXT;
  const run = (args, maxBuffer = LIMIT, input, timeout = 4_000) =>
    execute('docker', ['--host', endpoint, ...args], {
      env,
      timeout,
      maxBuffer,
      input,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  return {
    inspect: (name) => JSON.parse(run(['inspect', name], 262_144))[0],
    // BusyBox nc -w bounds socket inactivity. No HTTP client follows redirects:
    // only these fixed bytes go to the validated local Kong service.
    fetch: (file, remainingMs = 4_000) => {
      assert.ok(['invite', 'recovery'].includes(file.kind));
      assert.equal(file.url, `http://${KONG}:8088/email/${file.kind}.html`);
      assert.ok(Number.isInteger(remainingMs) && remainingMs > 0);
      let response;
      try {
        response = run(
          [
            'exec',
            '-i',
            AUTH,
            'busybox',
            'nc',
            '-w',
            String(Math.min(3, Math.ceil(remainingMs / 1_000))),
            KONG,
            '8088',
          ],
          LIMIT + 8_192,
          `GET /email/${file.kind}.html HTTP/1.0\r\nHost: ${KONG}:8088\r\nConnection: close\r\n\r\n`,
          Math.min(4_000, remainingMs),
        );
      } catch (error) {
        responseFailure(
          error.code === 'ENOBUFS'
            ? 'response-limit'
            : [126, 127].includes(error.status)
              ? 'probe-client'
              : 'listener-unavailable',
        );
      }
      return localAuthTemplateResponse(response);
    },
  };
}

export async function verifyLocalAuthTemplates(
  phase,
  {
    cwd = process.cwd(),
    environment = process.env,
    docker,
    now = Date.now,
    sleep = (ms) => new Promise((done) => setTimeout(done, ms)),
    report = console.log,
    timeoutMs = 30_000,
  } = {},
) {
  assert.ok(PHASES.has(phase), 'Unknown local Auth template diagnostic phase');
  assert.ok(
    Number.isInteger(timeoutMs) && timeoutMs > 0 && timeoutMs <= 30_000,
  );
  const fail = (kind, category) => {
    throw new Error(
      `Local Auth templates: phase=${phase} template=${kind} category=${category}. Inspect the disposable local Auth/Kong template service; application confirmation links must remain enabled.`,
    );
  };
  let files;
  try {
    files = localAuthTemplateFiles(cwd);
  } catch {
    fail('configuration', 'template-file');
  }
  try {
    docker ??= localAuthTemplateDocker(environment);
  } catch {
    fail('configuration', 'local-docker');
  }
  let auth, kong;
  try {
    [auth, kong] = [docker.inspect(AUTH), docker.inspect(KONG)];
  } catch {
    fail('configuration', 'service-inspection');
  }
  try {
    validateLocalAuthTemplateServices(auth, kong, files);
  } catch {
    fail('configuration', 'service-config');
  }
  const deadline = now() + timeoutMs;
  let failure;
  do {
    failure = undefined;
    for (const file of files) {
      const remainingMs = Math.floor(deadline - now());
      if (remainingMs <= 0) fail(file.kind, 'readiness-deadline');
      let body;
      try {
        body = await docker.fetch(file, remainingMs);
      } catch (error) {
        const allowed = new Set([
          'response-limit',
          'listener-unavailable',
          'http-response',
          'http-redirect',
          'http-status',
          'probe-client',
        ]);
        failure = [
          file.kind,
          allowed.has(error.category) ? error.category : 'listener-unavailable',
        ];
        break;
      }
      if (!Buffer.isBuffer(body)) body = Buffer.from(body);
      if (body.length > LIMIT) {
        failure = [file.kind, 'response-limit'];
        break;
      }
      if (digest(body) !== file.hash || !body.equals(file.body)) {
        failure = [file.kind, 'content-mismatch'];
        break;
      }
    }
    if (!failure) {
      if (now() >= deadline) fail('recovery', 'readiness-deadline');
      report(
        `Local Auth templates: phase=${phase} invite=matched recovery=matched.`,
      );
      return;
    }
    if (now() >= deadline) break;
    await sleep(Math.min(1_000, deadline - now()));
  } while (now() < deadline);
  fail(...failure);
}
