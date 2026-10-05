// Explicit local maintenance action only; ordinary validation never rewrites
// the expected manifest or learns trusted definitions from a hosted database.
import { readFileSync, writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { Client } from 'pg';
import { format } from 'prettier';
import { localStatus, npm } from './runtime.mjs';
import {
  STAGING_ROUTINE_CATALOG_SQL,
  assertStagingRoutineManifest,
} from './staging-file-routines.mjs';

const args = process.argv.slice(2);
const write =
  args.length === 2 && args[0] === '--write' && args[1] === '--reset-local';
if (!write && !(args.length === 1 && args[0] === '--check'))
  throw new Error('Use --check or explicit --write --reset-local');
const target = new URL('./staging-file-routines.json', import.meta.url);
// localStatus rejects every nonloopback host/port before reset or connection.
localStatus();
if (write) npm(['run', 'db:reset']);
const status = localStatus();
const db = new Client({ connectionString: status.DB_URL });
try {
  await db.connect();
  await db.query('begin read only');
  const manifest = assertStagingRoutineManifest({
    version: 2,
    routines: (await db.query(STAGING_ROUTINE_CATALOG_SQL)).rows.map(
      (row) => row.routine,
    ),
  });
  await db.query('rollback');
  if (write)
    writeFileSync(
      target,
      await format(JSON.stringify(manifest), { parser: 'json' }),
    );
  else
    assert.deepEqual(
      manifest,
      JSON.parse(readFileSync(target, 'utf8')),
      'Canonical staging routine manifest drift; review an explicit local regeneration',
    );
  console.log(
    write
      ? 'Generated local staging routine manifest; review required.'
      : 'Canonical staging routine manifest matches.',
  );
} finally {
  await db.query('rollback').catch(() => undefined);
  await db.end();
}
