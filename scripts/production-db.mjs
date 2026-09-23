import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const PRODUCTION_PROJECT_REF = 'dndqydmuqoduwaoujfki';
const REPOSITORY = 'PHead2001/IT-Inventory-System';

function execute(command, args, env) {
  const result = spawnSync(command, args, {
    env,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  // CLI diagnostics can contain project connection details. Never pass raw output to Actions logs.
  if (result.error || result.status !== 0)
    throw new Error(
      `Production database command failed: ${command === 'git' ? 'git' : 'supabase'}`,
    );
  return result.stdout;
}

export function parseMigrationList(output) {
  let data;
  try {
    data = JSON.parse(output);
  } catch {
    throw new Error('Could not verify Supabase migration history');
  }
  if (!data || !Array.isArray(data.migrations))
    throw new Error('Could not verify Supabase migration history');
  const rows = data.migrations.map((row) => {
    const remote = row?.remote == null ? '' : row.remote;
    if (
      !row ||
      typeof row !== 'object' ||
      typeof row.local !== 'string' ||
      typeof remote !== 'string' ||
      (!/^\d{14}$/.test(row.local) && row.local !== '') ||
      (!/^\d{14}$/.test(remote) && remote !== '') ||
      (!row.local && !remote)
    )
      throw new Error('Invalid Supabase migration history row');
    return { local: row.local, remote };
  });
  const versions = rows.map((row) => row.local || row.remote);
  if (versions.some((version, i) => i > 0 && version <= versions[i - 1]))
    throw new Error('Supabase migration history is not strictly ordered');
  return rows;
}

export function assertMigrationHistory(rows, localVersions, complete = false) {
  if (
    rows.length !== localVersions.length ||
    rows.some((row, i) => row.local !== localVersions[i])
  )
    throw new Error(
      'Supabase migration list does not match checked-in migrations',
    );
  const remote = rows.filter((row) => row.remote).map((row) => row.remote);
  if (
    remote.some((version, i) => version !== localVersions[i]) ||
    rows.some((row) => row.remote && row.remote !== row.local)
  )
    throw new Error(
      'Production migration history is not a prefix of checked-in migrations',
    );
  if (complete && remote.length !== localVersions.length)
    throw new Error('Production migrations were not fully applied');
  return remote;
}

export function deliverDatabase({
  env = process.env,
  run = execute,
  migrationFiles = () => readdirSync('supabase/migrations'),
} = {}) {
  if (env.ENABLE_PRODUCTION_DB_DELIVERY !== 'true')
    throw new Error('Production database delivery is disabled');
  if (
    env.GITHUB_ACTIONS !== 'true' ||
    env.GITHUB_EVENT_NAME !== 'push' ||
    env.GITHUB_REF !== 'refs/heads/main' ||
    env.GITHUB_REPOSITORY !== REPOSITORY ||
    !/^[0-9a-f]{40}$/.test(env.GITHUB_SHA ?? '') ||
    env.TESTED_SHA !== env.GITHUB_SHA
  )
    throw new Error(
      'Production database delivery requires the exact main push SHA',
    );
  if (run('git', ['rev-parse', 'HEAD'], env).trim() !== env.GITHUB_SHA)
    throw new Error('Checked-out HEAD does not match the main push SHA');
  if (env.SUPABASE_PROJECT_REF !== PRODUCTION_PROJECT_REF)
    throw new Error(
      'Production Supabase project reference is missing or unexpected',
    );
  if (!env.SUPABASE_ACCESS_TOKEN || !env.SUPABASE_DB_PASSWORD)
    throw new Error('Production Supabase credentials are missing');

  const versions = migrationFiles()
    .filter((name) => name.endsWith('.sql'))
    .map((name) => {
      const match = /^(\d{14})_.+\.sql$/.exec(name);
      if (!match) throw new Error('Invalid migration filename');
      return match[1];
    })
    .sort();
  if (!versions.length || new Set(versions).size !== versions.length)
    throw new Error('Migration files are missing or duplicated');

  const cli = (...args) =>
    run(
      process.execPath,
      ['node_modules/supabase/dist/supabase.js', ...args],
      env,
    );
  cli('link', '--project-ref', PRODUCTION_PROJECT_REF);
  const list = () =>
    parseMigrationList(
      cli('migration', 'list', '--linked', '--output-format', 'json'),
    );
  const before = assertMigrationHistory(list(), versions);
  cli('db', 'push', '--linked', '--skip-vault', '--dry-run');
  const afterDryRun = assertMigrationHistory(list(), versions);
  if (afterDryRun.join(',') !== before.join(','))
    throw new Error('Production migration history changed before apply');
  cli('db', 'push', '--linked', '--skip-vault', '--yes');
  assertMigrationHistory(list(), versions, true);
  return `Production database ready at ${env.GITHUB_SHA}`;
}

if (
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
) {
  try {
    console.log(deliverDatabase());
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
