import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { Client } from 'pg';
import type { SupabaseClient } from '@supabase/supabase-js';
import { localCommandPaletteTarget } from './local-command-palette-target';

type Witness = {
  pid: number;
  backend_start: string;
  query_start: string;
};
type Observation = Witness & {
  state: string;
  usename: string;
  wait_event_type: string;
  relation: string;
  blocker_pid: number;
};
export class GroupedTimeoutProofError extends Error {
  constructor(public readonly code: string) {
    super('Grouped timeout proof: ' + code);
  }
}

export function groupedConnectionFailure(
  client: Pick<Client, 'on'>,
  role: 'OWNER' | 'BLOCKER',
) {
  const failure = new AbortController();
  client.on('error', () => {
    failure.abort(new GroupedTimeoutProofError(role + '_CONNECTION_FAILED'));
  });
  return failure.signal;
}

export async function cleanupGroupedFixture(
  actions: (undefined | (() => Promise<unknown>))[],
) {
  let failed = false;
  for (const action of actions) {
    if (!action) continue;
    try {
      await action();
    } catch {
      failed = true;
    }
  }
  if (failed) throw new GroupedTimeoutProofError('FIXTURE_CLEANUP_UNPROVEN');
}

export function groupedBlockerRelease(
  rollback: () => Promise<unknown>,
  close: () => Promise<void>,
) {
  let release: Promise<void> | undefined;
  return () =>
    (release ??= (async () => {
      try {
        await rollback();
      } finally {
        // pg's end destroys the socket when the connection has failed or a
        // query remains active. Close before waiting on the REST request.
        await close();
      }
    })());
}

export function assertTargets(api: string, database: string) {
  localCommandPaletteTarget(api, 'api');
  localCommandPaletteTarget(database, 'database');
  // Match the stricter canonical runtime shape in addition to the shared
  // timeout helper's URL-option/host/port guard, without an untyped JS import.
  const apiUrl = new URL(api),
    databaseUrl = new URL(database);
  assert.equal(apiUrl.protocol, 'http:');
  assert.equal(apiUrl.username, '');
  assert.equal(apiUrl.password, '');
  assert.equal(apiUrl.pathname, '/');
  assert.equal(databaseUrl.pathname, '/postgres');
}

export function selectWitness(
  rows: Observation[],
  blockerPid: number,
): Witness | undefined {
  assert.ok(rows.length <= 1, 'ambiguous blocked grouped requests');
  if (!rows.length) return undefined;
  const row = rows[0];
  assert.ok(
    Number.isSafeInteger(row.pid) && row.pid > 0 && row.pid !== blockerPid,
  );
  assert.equal(row.blocker_pid, blockerPid);
  assert.equal(row.state, 'active');
  assert.equal(row.usename, 'authenticator');
  assert.equal(row.wait_event_type, 'Lock');
  assert.equal(row.relation, 'public.quantity_items');
  for (const field of [row.backend_start, row.query_start])
    assert.ok(
      typeof field === 'string' && field.length > 0 && field.length <= 64,
    );
  return {
    pid: row.pid,
    backend_start: row.backend_start,
    query_start: row.query_start,
  };
}

export function assertServerTimeout(input: {
  sqlstate: unknown;
  statementTimeout: boolean;
  elapsedMs: number;
  clientAborted: boolean;
  forcedRelease: boolean;
  blockerStillHeld: boolean;
}) {
  assert.equal(input.sqlstate, '57014');
  assert.equal(input.statementTimeout, true);
  assert.equal(
    input.clientAborted,
    false,
    'client abort is not server timeout proof',
  );
  assert.equal(
    input.forcedRelease,
    false,
    'safety rollback is not timeout proof',
  );
  assert.equal(
    input.blockerStillHeld,
    true,
    'blocker must remain held at server response',
  );
  assert.ok(
    input.elapsedMs >= 4500 && input.elapsedMs <= 7500,
    'server timeout must be near five seconds',
  );
}

export function assertWaiterRetired(
  observed: Witness,
  current?: Witness & { state: string },
) {
  assert.ok(
    !current ||
      current.backend_start !== observed.backend_start ||
      current.query_start !== observed.query_start ||
      current.state !== 'active',
    'exact observed request must no longer execute',
  );
}

type ReadIdentity = { db_oid: number; relation_oid: number };
export function assertMigrationRecord(
  row: {
    db?: unknown;
    usr?: unknown;
    db_oid?: unknown;
    relation_oid?: unknown;
    versions?: unknown;
  },
  expectedVersions: string[],
): ReadIdentity {
  assert.ok(
    expectedVersions.length > 0 &&
      expectedVersions.every((v) => /^\d{14}$/.test(v)) &&
      new Set(expectedVersions).size === expectedVersions.length,
  );
  assert.equal(row.db, 'postgres');
  assert.equal(row.usr, 'postgres');
  assert.ok(Number.isSafeInteger(row.db_oid) && Number(row.db_oid) > 0);
  assert.ok(
    Number.isSafeInteger(row.relation_oid) && Number(row.relation_oid) > 0,
  );
  assert.deepEqual(row.versions, expectedVersions);
  return { db_oid: Number(row.db_oid), relation_oid: Number(row.relation_oid) };
}

/** Read-only version-list/connection preflight. This does not compare installed
 * routine bodies, ACLs, RLS or definitions to SQL. Exact-source clean replay
 * and its immutable candidate/runtime receipt are separate acceptance evidence. */
export async function assertGroupedTimeoutSchema(observer: Client) {
  const expectedVersions = readdirSync('supabase/migrations')
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((f) => f.slice(0, 14));
  const result = await observer.query(
    'select current_database() db, current_user usr, ' +
      '(select oid from pg_database where datname=current_database()) db_oid, ' +
      "'public.quantity_items'::regclass::oid relation_oid, " +
      '(select array_agg(version order by version) from supabase_migrations.schema_migrations) versions',
  );
  assert.equal(result.rows.length, 1);
  return assertMigrationRecord(result.rows[0], expectedVersions);
}

export type GroupedTimeoutEvidence = {
  kind: 'grouped-production-rpc-server-timeout';
  sqlstate: '57014';
  elapsedMs: number;
  relation: 'public.quantity_items';
  blockerPid: number;
  waiter: Witness;
  blockerHeldAtResponse: true;
  sameResultAfterRollback: true;
  poolTimeoutReset: 'pending-exact-backend-no-timeout-probe';
  schemaValidation: 'migration-version-list-only';
  installedDefinitionEquality: 'not-established-by-this-proof';
};

/** Uses only the integration fixture's viewer and item; no DDL or row writes. */
export async function proveGroupedStatementTimeout(input: {
  observer: Client;
  observerFailure: AbortSignal;
  viewer: SupabaseClient;
  api: string;
  database: string;
  prefix: string;
  itemId: string;
}): Promise<GroupedTimeoutEvidence> {
  const { observer, observerFailure, viewer, api, database, prefix, itemId } =
    input;
  assertTargets(api, database);
  observerFailure.throwIfAborted();
  const identity = await assertGroupedTimeoutSchema(observer);
  const session = await viewer.auth.getSession();
  assert.ok(!session.error && session.data.session?.access_token);
  const verified = await viewer.auth.getUser(session.data.session.access_token);
  assert.ok(!verified.error && verified.data.user);
  const member = await observer.query(
    'select role,active from public.app_members where user_id=$1',
    [verified.data.user.id],
  );
  assert.equal(member.rows.length, 1);
  assert.equal(member.rows[0].role, 'viewer');
  assert.equal(member.rows[0].active, true);
  const read = () => viewer.rpc('inventory_grouped_page', { p_query: prefix });
  const baseline = await read().abortSignal(
    AbortSignal.any([observerFailure, AbortSignal.timeout(12000)]),
  );
  observerFailure.throwIfAborted();
  assert.equal(baseline.error === null, true, 'grouped baseline must succeed');
  assert.equal(baseline.data?.rows?.length, 1);
  assert.equal(baseline.data.rows[0].row.entity_id, itemId);
  const blocker = new Client({
    connectionString: database,
    application_name: 'grouped-timeout-blocker-' + randomUUID(),
    connectionTimeoutMillis: 3000,
    query_timeout: 4000,
  });
  const failure = AbortSignal.any([
    observerFailure,
    groupedConnectionFailure(blocker, 'BLOCKER'),
  ]);
  let connected = false;
  let forcedRelease = false;
  const releaseBlocker = groupedBlockerRelease(
    async () => {
      if (connected) await blocker.query('rollback');
    },
    () => blocker.end(),
  );
  let release: ReturnType<typeof setTimeout> | undefined;
  let pending: PromiseLike<unknown> | undefined;
  try {
    await blocker.connect();
    connected = true;
    await blocker.query("set idle_in_transaction_session_timeout='12s'");
    await blocker.query("set lock_timeout='2s'");
    await blocker.query('begin');
    await blocker.query(
      'lock table public.quantity_items in access exclusive mode',
    );
    const lockIdentity = (
      await blocker.query(
        'select pg_backend_pid() pid, backend_start::text, clock_timestamp()::text watermark ' +
          'from pg_stat_activity where pid=pg_backend_pid()',
      )
    ).rows[0];
    const blockerPid: number = lockIdentity.pid;
    release = setTimeout(() => {
      forcedRelease = true;
      void releaseBlocker().catch(() => undefined);
    }, 9000);
    failure.throwIfAborted();
    const deadline = AbortSignal.timeout(12000);
    const started = performance.now();
    const request = Promise.resolve(
      read().abortSignal(AbortSignal.any([failure, deadline])),
    ).then((result) => ({ result, elapsedMs: performance.now() - started }));
    // Observe rejection immediately; cleanup below drains the same request.
    pending = request.then(
      () => undefined,
      () => undefined,
    );
    // Backend activity identifies the RPC and lock, not its JWT. The caller
    // runs this fixture serially against an exclusively leased test stack.
    let observed: Witness | undefined;
    const observeBy = performance.now() + 2000;
    while (performance.now() < observeBy && !observed) {
      failure.throwIfAborted();
      const rows = (
        await observer.query(
          'select a.pid,a.backend_start::text,a.query_start::text,a.state,a.usename,a.wait_event_type, ' +
            "'public.quantity_items'::text relation,$1::integer blocker_pid " +
            'from pg_stat_activity a join pg_locks w on w.pid=a.pid ' +
            "where a.state='active' and a.usename='authenticator' and a.wait_event_type='Lock' " +
            "and strpos(a.query,'inventory_grouped_page') > 0 and a.datid=$2::oid " +
            'and a.query_start >= $4::timestamptz ' +
            "and w.locktype='relation' and w.database=$2::oid and w.relation=$3::oid " +
            "and w.mode='AccessShareLock' and not w.granted and $1=any(pg_blocking_pids(a.pid)) " +
            "and exists(select 1 from pg_locks b where b.pid=$1 and b.locktype='relation' " +
            "and b.database=$2::oid and b.relation=$3::oid and b.mode='AccessExclusiveLock' and b.granted)",
          [
            blockerPid,
            identity.db_oid,
            identity.relation_oid,
            lockIdentity.watermark,
          ],
        )
      ).rows;
      observed = selectWitness(rows, blockerPid);
      if (!observed) await delay(25);
    }
    const { result, elapsedMs } = await request;
    failure.throwIfAborted();
    assert.ok(
      observed,
      'exact relation/blocker/role/RPC waiter must be witnessed',
    );
    const held = (
      await observer.query(
        'select exists(select 1 from pg_locks l join pg_stat_activity a on a.pid=l.pid ' +
          "where l.pid=$1 and a.backend_start=$2::timestamptz and l.locktype='relation' " +
          "and l.database=$3::oid and l.relation=$4::oid and l.mode='AccessExclusiveLock' and l.granted) held",
        [
          blockerPid,
          lockIdentity.backend_start,
          identity.db_oid,
          identity.relation_oid,
        ],
      )
    ).rows[0].held;
    assertServerTimeout({
      sqlstate: result.error?.code,
      statementTimeout: /statement timeout/i.test(result.error?.message ?? ''),
      elapsedMs,
      clientAborted: deadline.aborted,
      forcedRelease,
      blockerStillHeld: held,
    });
    const current = (
      await observer.query(
        'select pid,backend_start::text,query_start::text,state from pg_stat_activity where pid=$1',
        [observed.pid],
      )
    ).rows[0];
    assertWaiterRetired(observed, current);
    failure.throwIfAborted();
    assert.equal(forcedRelease, false, 'safety rollback must not have started');
    clearTimeout(release);
    release = undefined;
    await releaseBlocker();
    const after = await read().abortSignal(
      AbortSignal.any([failure, AbortSignal.timeout(12000)]),
    );
    failure.throwIfAborted();
    assert.equal(
      after.error === null,
      true,
      'grouped read must recover after rollback',
    );
    assert.deepEqual(after.data, baseline.data);
    return {
      kind: 'grouped-production-rpc-server-timeout',
      sqlstate: '57014',
      elapsedMs,
      relation: 'public.quantity_items',
      blockerPid,
      waiter: observed,
      blockerHeldAtResponse: true,
      sameResultAfterRollback: true,
      poolTimeoutReset: 'pending-exact-backend-no-timeout-probe',
      schemaValidation: 'migration-version-list-only',
      installedDefinitionEquality: 'not-established-by-this-proof',
    };
  } catch {
    failure.throwIfAborted();
    throw new GroupedTimeoutProofError('SERVER_TIMEOUT_PROOF_FAILED');
  } finally {
    if (release) clearTimeout(release);
    try {
      await releaseBlocker();
    } catch {
      throw new GroupedTimeoutProofError('BLOCKER_CLEANUP_UNPROVEN');
    } finally {
      await pending;
    }
    failure.throwIfAborted();
  }
}
