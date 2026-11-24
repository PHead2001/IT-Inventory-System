import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Client } from 'pg';
import {
  assertTargets,
  cleanupGroupedFixture,
  groupedConnectionFailure,
  groupedBlockerRelease,
  selectWitness,
  assertServerTimeout,
  assertWaiterRetired,
  assertMigrationRecord,
} from '../helpers/grouped-timeout-proof';

const database = 'postgresql://postgres:fictional@127.0.0.1:45322/postgres';
const api = 'http://127.0.0.1:45321';
const goodVerdict = {
  sqlstate: '57014',
  statementTimeout: true,
  elapsedMs: 5000,
  clientAborted: false,
  forcedRelease: false,
  blockerStillHeld: true,
};
const observation = {
  pid: 111,
  backend_start: '2026-11-20 12:00:00+00',
  query_start: '2026-11-20 12:01:00+00',
  state: 'active',
  usename: 'authenticator',
  wait_event_type: 'Lock',
  relation: 'public.quantity_items',
  blocker_pid: 222,
};
test('canonical endpoints pass while host options and alternate destinations fail', () => {
  assert.doesNotThrow(() => assertTargets(api, database));
  for (const bad of [
    database + '?host=hosted.example',
    database + '?options=-c%20statement_timeout=0',
    database.replace('127.0.0.1', 'hosted.example'),
    database.replace(':45322', ':54322'),
    database.replace(/\/postgres$/, '/other'),
  ])
    assert.throws(() => assertTargets(api, bad));
  for (const bad of [
    api + '/rest',
    api.replace('http:', 'https:'),
    api.replace('127.0.0.1', 'hosted.example'),
    'http://user:password@127.0.0.1:45321',
  ])
    assert.throws(() => assertTargets(bad, database));
});

test('idle owner and blocker client errors report fixed failure without throwing from the emitter', () => {
  for (const role of ['OWNER', 'BLOCKER'] as const) {
    const client = new Client();
    const failure = groupedConnectionFailure(client, role);
    assert.equal(failure.aborted, false);
    assert.doesNotThrow(() => client.emit('error', new Error('raw pg error')));
    assert.throws(() => failure.throwIfAborted(), {
      message: 'Grouped timeout proof: ' + role + '_CONNECTION_FAILED',
    });
  }
});

test('a refused rollback closes the blocker before callers can drain the REST request', async () => {
  const actions: string[] = [];
  const release = groupedBlockerRelease(
    async () => {
      actions.push('rollback');
      throw new Error('rollback refused');
    },
    async () => {
      actions.push('close');
    },
  );
  const timerRelease = release();
  const finalRelease = release();
  assert.equal(timerRelease, finalRelease);
  await assert.rejects(finalRelease, /rollback refused/);
  actions.push('drain');
  assert.deepEqual(actions, ['rollback', 'close', 'drain']);
});

test('fixture cleanup skips unowned actions and runs later actions after a failure', async () => {
  const actions: string[] = [];
  await assert.rejects(
    cleanupGroupedFixture([
      async () => {
        actions.push('owned probe');
        throw new Error('drop failed');
      },
      undefined,
      async () => {
        actions.push('owned stock');
      },
      async () => {
        actions.push('owned item');
      },
    ]),
    { message: 'Grouped timeout proof: FIXTURE_CLEANUP_UNPROVEN' },
  );
  assert.deepEqual(actions, ['owned probe', 'owned stock', 'owned item']);
});

test('read-only schema preflight validates versions and connection identity without claiming routine equality', () => {
  const versions = ['20261119061421', '20261119061422'];
  const record = {
    db: 'postgres',
    usr: 'postgres',
    db_oid: 5,
    relation_oid: 42,
    versions,
  };
  assert.deepEqual(assertMigrationRecord(record, versions), {
    db_oid: 5,
    relation_oid: 42,
  });
  for (const bad of [
    { db: 'other' },
    { usr: 'other' },
    { db_oid: NaN },
    { relation_oid: 0 },
    { versions: [] },
    { versions: [...versions].reverse() },
    { versions: [...versions, '20261119061423'] },
  ])
    assert.throws(() => assertMigrationRecord({ ...record, ...bad }, versions));
  assert.throws(() => assertMigrationRecord(record, []));
  assert.throws(() => assertMigrationRecord(record, ['invalid']));
});

test('witness requires one exact active authenticator relation waiter and owned blocker', () => {
  assert.equal(selectWitness([], 222), undefined);
  assert.deepEqual(selectWitness([observation], 222), {
    pid: observation.pid,
    backend_start: observation.backend_start,
    query_start: observation.query_start,
  });
  assert.throws(() => selectWitness([observation, observation], 222));
  for (const bad of [
    { blocker_pid: 999 },
    { pid: 222 },
    { pid: NaN },
    { state: 'idle' },
    { usename: 'postgres' },
    { wait_event_type: 'Client' },
    { relation: 'public.other' },
    { backend_start: '' },
    { query_start: '' },
  ])
    assert.throws(() => selectWitness([{ ...observation, ...bad }], 222));
});

test('server timeout verdict rejects client cancellation, safety rollback, wrong error and timing', () => {
  assert.doesNotThrow(() => assertServerTimeout(goodVerdict));
  for (const bad of [
    { sqlstate: '55P03' },
    { sqlstate: '57014', statementTimeout: false },
    { clientAborted: true },
    { forcedRelease: true },
    { blockerStillHeld: false },
    { elapsedMs: 4499 },
    { elapsedMs: 7501 },
    { elapsedMs: NaN },
  ])
    assert.throws(() => assertServerTimeout({ ...goodVerdict, ...bad }));
});

test('retirement checks exact backend and query identity rather than requiring pool PID disappearance', () => {
  assert.throws(() => assertWaiterRetired(observation, observation));
  assert.doesNotThrow(() => assertWaiterRetired(observation));
  assert.doesNotThrow(() =>
    assertWaiterRetired(observation, { ...observation, state: 'idle' }),
  );
  assert.doesNotThrow(() =>
    assertWaiterRetired(observation, {
      ...observation,
      backend_start: 'new-backend',
    }),
  );
  assert.doesNotThrow(() =>
    assertWaiterRetired(observation, {
      ...observation,
      query_start: 'new-query',
    }),
  );
});
