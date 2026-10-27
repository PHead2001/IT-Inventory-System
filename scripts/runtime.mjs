import { spawnSync } from 'node:child_process';
export function npm(args, { capture = false, env = process.env } = {}) {
  const cli = process.env.npm_execpath;
  if (!cli)
    throw new Error('Run this command through its package.json npm script.');
  const result = spawnSync(process.execPath, [cli, ...args], {
    env,
    encoding: 'utf8',
    stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
  });
  if (result.error || result.status !== 0)
    throw new Error(
      capture
        ? 'Tool failed: ' +
            args.slice(0, 3).join(' ') +
            '\n' +
            (result.stderr ?? '')
        : 'Command failed: ' + args.join(' '),
    );
  return result.stdout ?? '';
}
export function node(args, env = process.env) {
  const result = spawnSync(process.execPath, args, { env, stdio: 'inherit' });
  if (result.error || result.status !== 0)
    throw new Error('Node validation failed: ' + args[0]);
}
export function assertLocalUrl(value, port) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error('Refusing nonlocal database/test target: invalid URL');
  }
  if (
    ![45321, 45322].includes(port) ||
    !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) ||
    Number(url.port) !== port ||
    url.search ||
    url.hash ||
    (port === 45321 &&
      (url.protocol !== 'http:' ||
        url.username ||
        url.password ||
        url.pathname !== '/')) ||
    (port === 45322 &&
      (!['postgres:', 'postgresql:'].includes(url.protocol) ||
        url.pathname !== '/postgres'))
  )
    throw new Error(
      'Refusing nonlocal database/test target. Expected canonical loopback API 45321 or database 45322. If upgrading an existing local checkout, stop/start it with npm run db:stop and npm run db:start, then refresh only its local URL from status; do not reset the database or change hosted settings.',
    );
  return value;
}
export function localStatus() {
  const status = JSON.parse(
    npm(['exec', '--', 'supabase', 'status', '--output', 'json'], {
      capture: true,
    }),
  );
  assertLocalUrl(status.API_URL, 45321);
  assertLocalUrl(status.DB_URL, 45322);
  if (!status.ANON_KEY || !status.SERVICE_ROLE_KEY)
    throw new Error('Local Supabase credentials are unavailable');
  return status;
}
export function localTestEnv(status) {
  return {
    ...process.env,
    LOCAL_API_URL: status.API_URL,
    LOCAL_DB_URL: status.DB_URL,
    LOCAL_ANON_KEY: status.ANON_KEY,
    LOCAL_SERVICE_ROLE_KEY: status.SERVICE_ROLE_KEY,
  };
}
