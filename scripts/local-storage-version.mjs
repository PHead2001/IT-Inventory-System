import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

// The CLI's bundled Storage image predates the fix for closing a connection
// before an upload body is sent. This override affects only the local stack.
export const LOCAL_STORAGE_VERSION = 'v1.77.9';
export const LOCAL_STORAGE_IMAGE = `public.ecr.aws/supabase/storage-api:${LOCAL_STORAGE_VERSION}`;
const STORAGE_CONTAINER = 'supabase_storage_it-inventory';

export function localStorageVersionPath(cwd = process.cwd()) {
  return resolve(cwd, 'supabase/.temp/storage-version');
}

export function installLocalStorageVersion(cwd = process.cwd()) {
  const target = localStorageVersionPath(cwd);
  mkdirSync(resolve(cwd, 'supabase/.temp'), { recursive: true });
  const existing = existsSync(target)
    ? readFileSync(target, 'utf8').trim()
    : null;
  if (existing !== LOCAL_STORAGE_VERSION)
    writeFileSync(target, `${LOCAL_STORAGE_VERSION}\n`);
  return existing === LOCAL_STORAGE_VERSION ? 'already-pinned' : 'pinned';
}

export function assertLocalStorageVersion(cwd = process.cwd()) {
  const target = localStorageVersionPath(cwd);
  if (
    !existsSync(target) ||
    readFileSync(target, 'utf8').trim() !== LOCAL_STORAGE_VERSION
  )
    throw new Error(
      'Local Storage version pin is missing or changed. Run npm run db:stop, then npm run db:start.',
    );
}

export function assertLocalStorageImage(configuredImage) {
  if (configuredImage !== LOCAL_STORAGE_IMAGE)
    throw new Error(
      'Local Storage container is not using the pinned image. Run npm run db:stop, then npm run db:start.',
    );
}

export function verifyLocalStorageRuntime({
  cwd = process.cwd(),
  inspect = spawnSync,
} = {}) {
  assertLocalStorageVersion(cwd);
  const result = inspect(
    'docker',
    ['inspect', '--format', '{{.Config.Image}}', STORAGE_CONTAINER],
    {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  if (result.error || result.status !== 0)
    throw new Error(
      'Could not inspect the local Storage container. Run npm run db:stop, then npm run db:start.',
    );
  assertLocalStorageImage(result.stdout.trim());
}
