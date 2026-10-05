// Local-only independent-connection proof of the actual Management SQL statements.
// Never use this fixture against a hosted database.
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { Client } from 'pg';
import { SQL } from '../../scripts/preview-file-providers.mjs';
import { verifyStagingRoutineContract } from './staging-file-routines.mjs';

const connectionString = process.env.LOCAL_DB_URL;
assert.ok(connectionString);
const url = new URL(connectionString);
assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(url.hostname));
assert.equal(url.port, '54322');
const name = `preview-file-key-${randomBytes(8).toString('hex')}`;
const owner = new Client({ connectionString });
const worker = new Client({ connectionString, application_name: name });
const id = `pvtest${randomBytes(8).toString('hex')}`;
const foreign = `${id}f`;
const secret = randomBytes(32).toString('hex');
const alternative = randomBytes(32).toString('hex');
const read = async () => (await owner.query(SQL.read, [id])).rows[0];
async function waitForGuard() {
  const deadline = Date.now() + 1200;
  while (Date.now() < deadline) {
    const result = await owner.query(
      'select wait_event_type from pg_stat_activity where application_name=$1',
      [name],
    );
    if (result.rows[0]?.wait_event_type === 'Lock') return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error('Independent statement did not reach the held guard lock');
}
async function blockedActivation(change) {
  await owner.query('begin');
  await owner.query('select private.file_guard_lock()');
  const pending = worker.query(SQL.activate, [id, secret]).then(
    (result) => ({ result }),
    (error) => ({ error }),
  );
  await waitForGuard();
  await change();
  await owner.query('commit');
  return pending;
}

try {
  await owner.connect();
  await worker.connect();
  await verifyStagingRoutineContract(owner);
  assert.equal((await owner.query(SQL.schema)).rows[0].ready, true);
  assert.equal(
    (
      await owner.query(
        'select count(*)::int as count from private.file_keys where accepts_new',
      )
    ).rows[0].count,
    0,
    'Local fixture requires no existing active signing key',
  );
  await owner.query(SQL.stage, [id, secret]);
  await worker.query(SQL.stage, [id, alternative]);
  assert.equal(
    (await read()).rows[0].secret,
    secret,
    'Retry must preserve persisted secret',
  );
  let result = await blockedActivation(() =>
    owner.query(
      'update private.file_keys set verify_until=now() where key_id=$1',
      [id],
    ),
  );
  assert.equal(result.error, undefined);
  assert.equal(
    result.result.rowCount,
    0,
    'EPQ must not reactivate a concurrently retired row',
  );
  assert.equal((await read()).rows[0].accepts_new, false);
  // Fresh independent fixture generation; no lifecycle reset of a retired row.
  await owner.query('delete from private.file_keys where key_id=$1', [id]);
  await owner.query(SQL.stage, [id, secret]);
  result = await blockedActivation(() =>
    owner.query(
      "insert into private.file_keys(key_id,secret,accepts_new,verify_until) values($1,$2,true,'infinity')",
      [foreign, alternative],
    ),
  );
  assert.ok(
    result.error?.code === '23505' || result.result?.rowCount === 0,
    'Foreign activation must cause unique-index rollback or conservative refusal',
  );
  assert.equal((await read()).rows[0].accepts_new, false);
  assert.equal((await read()).foreignActive, 1);
  await owner.query('delete from private.file_keys where key_id=$1', [foreign]);
  await worker.query(SQL.activate, [id, secret]);
  const active = (await read()).rows[0];
  assert.equal(active.secret, secret);
  assert.equal(active.accepts_new, true);
  assert.equal(active.verify_until, 'infinity');
  console.log('Preview file-key guarded SQL concurrency proof passed');
} finally {
  await owner.query('rollback').catch(() => {});
  await owner
    .query('delete from private.file_keys where key_id=any($1::text[])', [
      [id, foreign],
    ])
    .catch(() => {});
  await Promise.all([owner.end(), worker.end()]);
}
