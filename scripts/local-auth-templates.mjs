// Disposable-local prerequisite diagnostics. Never fetch Auth emails or log bodies.
import assert from 'node:assert/strict';
import {
  closeSync,
  constants,
  fchmodSync,
  fstatSync,
  lstatSync,
  openSync,
  readFileSync,
  readSync,
  realpathSync,
} from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { localDockerSocket } from './local-docker-socket.mjs';

const AUTH = 'supabase_auth_it-inventory';
const KONG = 'supabase_kong_it-inventory';
const NETWORK = 'supabase_network_it-inventory';
const LIMIT = 65_536;
const PHASES = new Set(['startup', 'reset', 'password-policy-replacement']);
const digest = (body) => createHash('sha256').update(body).digest('hex');

const KINDS = ['invite', 'recovery'];
const sameIdentity = (a, b) => a.dev === b.dev && a.ino === b.ino;

function readBoundedTemplate(fd) {
  const buffer = Buffer.alloc(LIMIT + 1);
  let length = 0;
  while (length < buffer.length) {
    const count = readSync(fd, buffer, length, buffer.length - length, null);
    if (count === 0) break;
    length += count;
  }
  assert.ok(length > 0 && length <= LIMIT);
  return buffer.subarray(0, length);
}

// Keep descriptors open through preparation: chmod never follows a replacement
// pathname. Reject linked ancestors and hardlinks as well as final symlinks.
function openLocalAuthTemplates(cwd) {
  const opened = [];
  const base = realpathSync(cwd);
  const directories = ['supabase', 'supabase/templates'].map((relative) => {
    const path = resolve(base, relative);
    const stat = lstatSync(path);
    assert.ok(stat.isDirectory() && !stat.isSymbolicLink());
    return { path, stat };
  });
  const config = readFileSync(resolve(cwd, 'supabase/config.toml'), 'utf8');
  try {
    for (const kind of KINDS) {
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
      assert.equal(
        JSON.parse(paths[0][1]),
        `./supabase/templates/${kind}.html`,
      );
      const path = resolve(base, `supabase/templates/${kind}.html`);
      const stat = lstatSync(path);
      assert.ok(stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1);
      assert.ok(stat.size > 0 && stat.size <= LIMIT);
      const fd = openSync(
        path,
        constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
      );
      opened.push({ fd });
      const actual = fstatSync(fd);
      assert.ok(
        actual.isFile() && actual.nlink === 1 && sameIdentity(actual, stat),
      );
      const body = readBoundedTemplate(fd);
      Object.assign(opened.at(-1), {
        kind,
        path,
        stat: actual,
        body,
        hash: digest(body),
        url: `http://${KONG}:8088/email/${kind}.html`,
      });
    }
    // Recheck both paths and ancestors before allowing any permission mutation.
    for (const entry of [...directories, ...opened]) {
      const current = lstatSync(entry.path);
      assert.ok(!current.isSymbolicLink() && sameIdentity(current, entry.stat));
      if (entry.fd !== undefined) assert.equal(current.nlink, 1);
    }
    return opened;
  } catch (error) {
    for (const { fd } of opened) closeSync(fd);
    throw error;
  }
}

export function localAuthTemplateFiles(cwd = process.cwd()) {
  const opened = openLocalAuthTemplates(cwd);
  try {
    return opened.map(({ kind, body, hash, url }) => ({
      kind,
      body,
      hash,
      url,
    }));
  } finally {
    for (const { fd } of opened) closeSync(fd);
  }
}

export function prepareLocalAuthTemplates({
  cwd = process.cwd(),
  platform = process.platform,
  report = console.log,
} = {}) {
  let opened;
  try {
    opened = openLocalAuthTemplates(cwd);
    const umask = process.umask(); // Read only; never relax the process/runner mask.
    for (const file of opened) {
      if (platform !== 'win32') fchmodSync(file.fd, 0o644);
      const after = fstatSync(file.fd);
      report(
        `Local Auth template permissions: template=${file.kind} modeBefore=${file.stat.mode & 0o7777} modeAfter=${after.mode & 0o7777} uid=${after.uid} gid=${after.gid} umask=${umask}.`,
      );
    }
  } catch {
    throw new Error(
      'Local Auth templates: category=template-permissions. Validate the two canonical local static template files before starting or resetting Supabase.',
    );
  } finally {
    for (const { fd } of opened ?? []) closeSync(fd);
  }
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

function responseFailure(category, httpStatus) {
  const error = new Error('Static local template response rejected');
  error.category = category;
  if (httpStatus !== undefined) error.httpStatus = httpStatus;
  throw error;
}

export function localAuthTemplateResponse(response) {
  if (response.length > LIMIT + 8_192) responseFailure('response-limit');
  const raw = Buffer.from(response);
  const end = raw.indexOf('\r\n\r\n');
  if (end < 0 || end > 8_192) responseFailure('http-response');
  const headers = raw.subarray(0, end).toString('ascii');
  const status = /^HTTP\/1\.[01] ([1-5]\d{2})(?: |\r\n)/.exec(headers)?.[1];
  if (!status) responseFailure('http-status-malformed');
  const httpStatus = Number(status);
  if (httpStatus >= 300 && httpStatus < 400)
    responseFailure('http-redirect', httpStatus);
  if (httpStatus !== 200) responseFailure('http-status', httpStatus);
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
  const fail = (kind, category, httpStatus) => {
    throw new Error(
      `Local Auth templates: phase=${phase} template=${kind} category=${category}${httpStatus === undefined ? '' : ` status=${httpStatus}`}. Inspect the disposable local Auth/Kong template service; application confirmation links must remain enabled.`,
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
          'http-status-malformed',
          'probe-client',
        ]);
        const category = allowed.has(error?.category)
          ? error.category
          : 'listener-unavailable';
        const httpStatus =
          ['http-status', 'http-redirect'].includes(category) &&
          Number.isInteger(error?.httpStatus) &&
          error.httpStatus >= 100 &&
          error.httpStatus <= 599
            ? error.httpStatus
            : undefined;
        failure = [file.kind, category, httpStatus];
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
