import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { Client } from 'pg';
import authFixture from '../fixtures/auth.json' with { type: 'json' };
import { localCommandPaletteTarget } from '../helpers/local-command-palette-target';
import {
  legacyReceiveVersion,
  remainingReadinessMs,
} from '../helpers/overview-integration-contract';
import {
  parseOverviewProjection,
  overviewReadError,
  type OverviewProjection,
} from '../../src/features/overview/contracts';

import {
  isActiveMember,
  mayMutateInventory,
} from '../../src/lib/auth/membership';

// Validate both URLs before constructing any client, including the admin client.
const api = localCommandPaletteTarget(process.env.LOCAL_API_URL, 'api');
const database = localCommandPaletteTarget(
  process.env.LOCAL_DB_URL,
  'database',
);
assert.ok(process.env.LOCAL_ANON_KEY && process.env.LOCAL_SERVICE_ROLE_KEY);
const run = randomUUID();
const probeName = 'overview_timeout_probe_' + run.replaceAll('-', '');
const actors: { id: string; client: SupabaseClient }[] = [];
const snapshots: { stage: string; value: OverviewProjection }[] = [];
const evidence: Record<string, unknown> = { run };
const options = {
  auth: { persistSession: false, autoRefreshToken: false },
  global: {
    fetch: (input: RequestInfo | URL, init?: RequestInit) => {
      const supplied =
        init?.signal ?? (input instanceof Request ? input.signal : undefined);
      const deadline = AbortSignal.timeout(12000);
      return fetch(input, {
        ...init,
        signal: supplied ? AbortSignal.any([supplied, deadline]) : deadline,
      });
    },
  },
};
const admin = createClient(api, process.env.LOCAL_SERVICE_ROLE_KEY, options);
const connection = (name: string) =>
  new Client({
    connectionString: database,
    application_name: 'overview-integration-' + name + '-' + run,
    connectionTimeoutMillis: 3000,
    query_timeout: 4000,
  });
const owner = connection('owner');
let ownerConnected = false;
let probeCreated = false;
let fixture: { itemId: string; staff: SupabaseClient } | undefined;

async function actor(
  role: 'staff' | 'viewer',
  fixtureOptions: {
    canManageConfiguration?: boolean;
    label?: 'revocation' | 'independent';
  } = {},
) {
  const { label, canManageConfiguration = false } = fixtureOptions;
  const email =
    'overview-' +
    role +
    (label ? '-' + label : '') +
    '-' +
    run +
    '@example.test';
  const created = await admin.auth.admin.createUser({
    email,
    password: authFixture.password,
    email_confirm: true,
  });
  assert.equal(created.error, null);
  assert.ok(created.data.user);
  const account = {
    id: created.data.user.id,
    client: createClient(api, process.env.LOCAL_ANON_KEY!, options),
  };
  // Track immediately so setup failures still deactivate the owned account.
  actors.push(account);
  await owner.query(
    'insert into public.app_members(user_id,display_name,role,active,can_manage_configuration) values($1,$2,$3,true,$4)',
    [
      account.id,
      'Fictional Overview ' + role + ' ' + run,
      role,
      canManageConfiguration,
    ],
  );
  const signed = await account.client.auth.signInWithPassword({
    email,
    password: authFixture.password,
  });
  assert.equal(signed.error, null);
  return account;
}

async function snapshot(client: SupabaseClient, stage: string) {
  const result = await client.rpc('overview_snapshot_v1', {
    p_time_zone: 'UTC',
  });
  assert.equal(
    result.error,
    null,
    'Overview ' + stage + ': ' + result.error?.code,
  );
  const value = parseOverviewProjection(result.data);
  assert.equal(value.timeZone, 'UTC');
  assert.equal(
    value.window.endDate,
    new Date(value.asOf).toISOString().slice(0, 10),
  );
  snapshots.push({ stage, value });
  return value;
}

function firstProbeEvidence(row: {
  pid?: unknown;
  backendStart?: unknown;
  timeout?: unknown;
}) {
  return {
    pid:
      typeof row.pid === 'number' &&
      Number.isSafeInteger(row.pid) &&
      row.pid > 0 &&
      row.pid <= 2147483647
        ? row.pid
        : null,
    pidType: typeof row.pid,
    backendStart:
      typeof row.backendStart === 'string' &&
      row.backendStart.length <= 40 &&
      /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}(?::?\d{2})?)$/.test(
        row.backendStart,
      ) &&
      Number.isFinite(Date.parse(row.backendStart))
        ? row.backendStart
        : null,
    backendStartType: typeof row.backendStart,
    timeout:
      typeof row.timeout === 'string' &&
      row.timeout.length <= 32 &&
      /^[0-9]{1,10}(?:\.[0-9]{1,6})?(?:ms|s|min|h|d)?$/.test(row.timeout)
        ? row.timeout
        : null,
    timeoutType: typeof row.timeout,
  };
}

type Probe = { pid: number; backendStart: string; timeout: string };
async function probe(client: SupabaseClient): Promise<Probe> {
  const result = await client.rpc(probeName);
  assert.equal(result.error, null, 'local pooled-session probe');
  const value: unknown = result.data;
  assert.ok(value && typeof value === 'object');
  const row = value as Probe;
  if (evidence.firstProbe === undefined)
    evidence.firstProbe = firstProbeEvidence(row);
  assert.ok(Number.isSafeInteger(row.pid) && row.pid > 0);
  assert.equal(typeof row.backendStart, 'string');
  assert.ok(Number.isFinite(Date.parse(row.backendStart)));
  assert.equal(typeof row.timeout, 'string');
  return row;
}

function ownedViewerProbeDefinition(name: string, viewerId: string): string {
  assert.match(name, /^overview_timeout_probe_[0-9a-f]{32}$/);
  assert.match(
    viewerId,
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
  );
  return (
    'create function public.' +
    name +
    '() returns jsonb language plpgsql stable security definer ' +
    "set search_path='' as $probe$ begin " +
    "if auth.uid() is distinct from '" +
    viewerId +
    "'::pg_catalog.uuid " +
    "or not exists(select 1 from public.app_members as m where m.user_id='" +
    viewerId +
    "'::pg_catalog.uuid and m.active) then " +
    "raise exception using errcode='42501',message='forbidden'; end if; " +
    "return pg_catalog.jsonb_build_object('pid',pg_catalog.pg_backend_pid()," +
    "'backendStart',(select s.backend_start::pg_catalog.text from pg_catalog.pg_stat_activity as s " +
    'where s.pid=pg_catalog.pg_backend_pid()),' +
    "'timeout',pg_catalog.current_setting('statement_timeout')); end; $probe$"
  );
}

async function timeoutProof(
  viewer: SupabaseClient,
  viewerId: string,
  otherCaller: SupabaseClient,
) {
  const definition = ownedViewerProbeDefinition(probeName, viewerId);
  await snapshot(viewer, 'timeout-baseline');
  // This isolated, uniquely named probe has NO statement_timeout SET clause.
  // PID plus backend_start prevents a recycled PID from satisfying the proof.
  await owner.query('begin');
  try {
    await owner.query(definition);
    await owner.query(
      'revoke all on function public.' +
        probeName +
        '() from public,anon,service_role',
    );
    await owner.query(
      'grant execute on function public.' + probeName + '() to authenticated',
    );
    const installed = await owner.query(
      'select p.prosecdef,p.proconfig,' +
        'pg_catalog.pg_get_userbyid(p.proowner) as owner,' +
        'current_user::pg_catalog.text as expected_owner ' +
        'from pg_catalog.pg_proc as p where p.oid=$1::pg_catalog.regprocedure',
      ['public.' + probeName + '()'],
    );
    assert.equal(installed.rows.length, 1);
    assert.equal(installed.rows[0].owner, installed.rows[0].expected_owner);
    assert.equal(installed.rows[0].prosecdef, true);
    assert.deepEqual(installed.rows[0].proconfig, ['search_path=""']);
    await owner.query('commit');
    probeCreated = true;
  } catch (error) {
    await owner.query('rollback');
    throw error;
  }
  await owner.query("notify pgrst, 'reload schema'");
  // Schema-cache readiness is not timeout evidence and has a separate 2s bound.
  const readyBy = performance.now() + 2000;
  for (;;) {
    const ready = await viewer
      .rpc(probeName)
      .abortSignal(
        AbortSignal.timeout(remainingReadinessMs(readyBy, performance.now())),
      );
    assert.ok(
      performance.now() < readyBy,
      'local probe schema cache unavailable',
    );
    if (!ready.error) break;
    assert.equal(
      ready.error.code,
      'PGRST202',
      'only schema-cache propagation is retried',
    );
    await delay(Math.min(50, remainingReadinessMs(readyBy, performance.now())));
  }
  const denied = await otherCaller.rpc(probeName);
  assert.equal(
    denied.error?.code,
    '42501',
    'only the owned viewer may use the probe',
  );
  const baseline = new Map<string, string>();
  for (let i = 0; i < 16; i++) {
    const row = await probe(viewer);
    baseline.set(row.pid + '/' + row.backendStart, row.timeout);
  }
  const blocker = connection('blocker');
  let connected = false;
  let release: ReturnType<typeof setTimeout> | undefined;
  let forcedRelease = false;
  let pending: PromiseLike<unknown> | undefined;
  try {
    await blocker.connect();
    connected = true;
    await blocker.query("set idle_in_transaction_session_timeout='10s'");
    await blocker.query("set lock_timeout='2s'");
    await blocker.query('begin');
    await blocker.query(
      'lock table public.quantity_items in access exclusive mode',
    );
    const blockerPid: number = (
      await blocker.query('select pg_backend_pid() pid')
    ).rows[0].pid;
    release = setTimeout(() => {
      forcedRelease = true;
      void blocker
        .query('rollback')
        .catch(() => blocker.end().catch(() => undefined));
    }, 9000);
    const deadline = AbortSignal.timeout(12000);
    const started = performance.now();
    const request = Promise.resolve(
      viewer
        .rpc('overview_snapshot_v1', { p_time_zone: 'UTC' })
        .abortSignal(deadline),
    );
    pending = request;
    let observed:
      { pid: number; backend_start: string; query_start: string } | undefined;
    const observeBy = performance.now() + 2000;
    while (performance.now() < observeBy) {
      const rows = (
        await owner.query(
          'select pid,backend_start::text,query_start::text from pg_stat_activity ' +
            "where state='active' and wait_event_type='Lock' and pid<>pg_backend_pid() " +
            "and $1=any(pg_blocking_pids(pid)) and query like '%overview_snapshot_v1%'",
          [blockerPid],
        )
      ).rows;
      assert.ok(rows.length <= 1, 'ambiguous blocked Overview request');
      if (rows.length === 1) {
        observed = rows[0];
        break;
      }
      await delay(25);
    }
    const result = await request;
    const elapsedMs = performance.now() - started;
    assert.ok(observed, 'specific blocker PID must witness the REST request');
    assert.equal(result.error?.code, '57014');
    assert.match(result.error?.message ?? '', /statement timeout/i);
    assert.equal(deadline.aborted, false, 'client deadline is not the proof');
    assert.equal(forcedRelease, false, 'forced rollback is not the proof');
    assert.ok(
      elapsedMs >= 4500 && elapsedMs <= 7500,
      'server timeout must be near 5s',
    );
    const current = (
      await owner.query(
        'select backend_start::text,query_start::text,state from pg_stat_activity where pid=$1',
        [observed.pid],
      )
    ).rows[0];
    assert.ok(
      !current ||
        current.backend_start !== observed.backend_start ||
        current.query_start !== observed.query_start ||
        current.state !== 'active',
      'observed backend must no longer execute the blocked request',
    );
    clearTimeout(release);
    release = undefined;
    await blocker.query('rollback');
    await snapshot(viewer, 'timeout-after-release');
    // Compare only the affected exact backend to its own prior observation.
    const backendStart = observed.backend_start;
    const before = baseline.get(observed.pid + '/' + backendStart);
    let reused: Probe | undefined;
    for (let i = 0; i < 16; i++) {
      const row = await probe(viewer);
      if (row.pid === observed.pid && row.backendStart === backendStart) {
        reused = row;
        break;
      }
    }
    const stillPresent = (
      await owner.query(
        'select exists(select 1 from pg_stat_activity where pid=$1 and backend_start=$2::timestamptz) present',
        [observed.pid, observed.backend_start],
      )
    ).rows[0].present;
    if (before !== undefined && reused)
      assert.equal(reused.timeout, before, 'no pooled timeout leak');
    evidence.timeout = {
      elapsedMs,
      sqlstate: result.error.code,
      backendPid: observed.pid,
      backendStart: observed.backend_start,
      pool:
        before !== undefined && reused
          ? 'verified'
          : !stillPresent
            ? 'unavailable-backend-terminated'
            : before === undefined
              ? 'unavailable-baseline-backend-not-observed'
              : 'unavailable-exact-backend-not-reused',
    };
  } finally {
    if (release) clearTimeout(release);
    if (connected) {
      await blocker.query('rollback').catch(() => undefined);
      // Drain the bounded REST request before ending/cleaning the fixture.
      if (pending) await Promise.resolve(pending).catch(() => undefined);
    }
    await blocker.end().catch(() => undefined);
  }
}

async function mutate(
  client: SupabaseClient,
  operation: string,
  payload: Record<string, unknown>,
  requestId = randomUUID(),
) {
  const result = await client.rpc(operation, {
    p_request_id: requestId,
    p_payload: payload,
  });
  assert.equal(result.error, null, operation + ': ' + result.error?.code);
  assert.ok(result.data && typeof result.data === 'object');
  return result.data as {
    entity_id: string;
    version: string | number;
    event_id: string;
    changed: boolean;
  };
}

function sameWindow(a: OverviewProjection, b: OverviewProjection) {
  // Crossing UTC midnight changes the chart bucket. Preserve both snapshots and
  // report unavailable, rather than treating different windows as equivalent.
  assert.deepEqual(
    a.window,
    b.window,
    'snapshot proof unavailable: UTC window rolled over',
  );
}
function comparable(value: OverviewProjection) {
  return {
    ...value,
    asOf: '<statement-time>',
    stockTrends: value.stockTrends.map((trend) => ({
      ...trend,
      points: trend.points.map((point, index) => ({
        ...point,
        at: index === 13 ? '<statement-time>' : point.at,
      })),
    })),
  };
}
async function authoritative(itemId: string) {
  return (
    await owner.query(
      'select i.version::text,coalesce((select sum(quantity::bigint) from public.stock_balances where item_id=i.id),0)::text available,' +
        '(select count(*)::text from public.quantity_events where item_id=i.id) events ' +
        'from public.quantity_items i where i.id=$1',
      [itemId],
    )
  ).rows[0] as { version: string; available: string; events: string };
}
async function receiptCount(actorId: string, requestId: string) {
  return (
    await owner.query(
      'select count(*)::text n from private.mutation_requests where actor_id=$1 and request_id=$2',
      [actorId, requestId],
    )
  ).rows[0].n as string;
}

async function snapshotProof(
  staff: { id: string; client: SupabaseClient },
  viewer: SupabaseClient,
) {
  const refs = (
    await owner.query(
      "select (select id from public.locations where code='ITC-S1A' and active and can_hold_inventory) location," +
        "(select id from public.categories where code='CABLES') category," +
        "(select published_form_revision_id from public.categories where code='CABLES') revision",
    )
  ).rows[0];
  assert.ok(refs.location && refs.category && refs.revision);
  const created = await mutate(staff.client, 'quantity_create_v2', {
    name: '000 Fictional Overview snapshot ' + run,
    category_id: refs.category,
    expected_published_revision_id: refs.revision,
    custom_patch: {},
    initial_quantity: 0,
    reorder_threshold: 100,
  });
  fixture = { itemId: created.entity_id, staff: staff.client };
  const itemId = created.entity_id;
  const old = await snapshot(viewer, 'receive-baseline');
  function stock(value: OverviewProjection, amount: '0' | '1') {
    const trend = value.stockTrends.find((row) => row.itemId === itemId);
    const attention = value.stock.attention.find(
      (row) => row.itemId === itemId,
    );
    assert.ok(
      trend && attention,
      'owned fixture must actually be featured; do not change unrelated records',
    );
    assert.notEqual(trend.coverage, 'unavailable');
    assert.equal(trend.available, amount);
    assert.equal(trend.threshold, '100');
    assert.equal(trend.points[13]!.state, 'recorded');
    assert.equal(trend.points[13]!.value, amount);
    assert.equal(attention.available, amount);
    assert.equal(attention.shortfall, amount === '0' ? '100' : '99');
  }
  stock(old, '0');
  assert.equal(
    old.activity.coverage,
    'complete',
    'activity sentinel must allow this proof',
  );
  const oldDb = await authoritative(itemId);
  assert.equal(oldDb.available, '0');
  const writer = connection('authenticated-writer');
  let inTransaction = false;
  async function begin() {
    await writer.query('begin');
    inTransaction = true;
    await writer.query("set local idle_in_transaction_session_timeout='10s'");
    await writer.query('set local role authenticated');
    await writer.query('select set_config($1,$2,true)', [
      'request.jwt.claims',
      JSON.stringify({ sub: staff.id, role: 'authenticated' }),
    ]);
  }
  const requestId = randomUUID();
  const payload = {
    item_id: itemId,
    expected_version: legacyReceiveVersion(String(created.version)),
    location_id: refs.location,
    quantity: 1,
    reason: 'Fictional Overview atomic receive',
  };
  try {
    await writer.connect();
    await begin();
    // The completed mutation inside this held transaction is the barrier.
    const received = (
      await writer.query(
        'select public.quantity_receive($1,$2::jsonb) result',
        [requestId, JSON.stringify(payload)],
      )
    ).rows[0].result;
    const held = await snapshot(viewer, 'receive-held');
    sameWindow(old, held);
    assert.deepEqual(
      comparable(held),
      comparable(old),
      'held writes expose the complete old projection',
    );
    assert.deepEqual(await authoritative(itemId), oldDb);
    assert.equal(await receiptCount(staff.id, requestId), '0');
    await writer.query('commit');
    inTransaction = false;
    const committed = await snapshot(viewer, 'receive-committed');
    sameWindow(old, committed);
    stock(committed, '1');
    assert.deepEqual(
      committed.atSites,
      old.atSites,
      'closet receive leaves site holdings unchanged',
    );
    assert.equal(
      BigInt(committed.stock.zeroAvailable),
      BigInt(old.stock.zeroAvailable) - 1n,
    );
    assert.equal(committed.stock.monitoredItems, old.stock.monitoredItems);
    assert.equal(committed.stock.needsAttention, old.stock.needsAttention);
    assert.equal(committed.stock.unmonitoredItems, old.stock.unmonitoredItems);
    assert.equal(committed.activity.coverage, 'complete');
    assert.equal(
      BigInt(committed.activity.points[13]!.value!),
      BigInt(old.activity.points[13]!.value!) + 1n,
    );
    assert.deepEqual(
      committed.activity.points.slice(0, 13),
      old.activity.points.slice(0, 13),
    );
    assert.equal(
      committed.recentEvents.filter(
        (event) => event.eventId === received.event_id,
      ).length,
      1,
    );
    const committedDb = await authoritative(itemId);
    assert.equal(committedDb.available, '1');
    assert.equal(BigInt(committedDb.events), BigInt(oldDb.events) + 1n);
    assert.equal(await receiptCount(staff.id, requestId), '1');
    const event = (
      await owner.query(
        'select e.id as "eventId",\'quantity\' as "recordKind",e.item_id as "entityId",e.kind,' +
          'i.name,e.actor_name as "actorName",to_jsonb(e.created_at)#>>\'{}\' as at ' +
          'from public.quantity_events e join public.quantity_items i on i.id=e.item_id where e.id=$1',
        [received.event_id],
      )
    ).rows[0];
    assert.ok(event);
    // Assert the entire committed projection, including untouched rows, rather
    // than allowing a mixture that merely has the right headline quantities.
    const expected: OverviewProjection = {
      ...old,
      asOf: committed.asOf,
      stock: {
        ...old.stock,
        zeroAvailable: (BigInt(old.stock.zeroAvailable) - 1n).toString(),
        attention: old.stock.attention.map((row) =>
          row.itemId === itemId
            ? { ...row, available: '1', shortfall: '99' }
            : row,
        ),
      },
      recentEvents: [event, ...old.recentEvents].slice(0, 10),
      activity: {
        ...old.activity,
        points: old.activity.points.map((point, index) =>
          index === 13
            ? { ...point, value: (BigInt(point.value!) + 1n).toString() }
            : point,
        ),
      },
      stockTrends: old.stockTrends.map((trend) => ({
        ...trend,
        available: trend.itemId === itemId ? '1' : trend.available,
        points: trend.points.map((point, index) =>
          index === 13
            ? {
                ...point,
                at: committed.asOf,
                value: trend.itemId === itemId ? '1' : point.value,
              }
            : point,
        ),
      })),
    };
    assert.deepEqual(
      comparable(committed),
      comparable(expected),
      'complete committed projection',
    );
    const rolledBackId = randomUUID();
    await begin();
    await writer.query('select public.quantity_receive($1,$2::jsonb)', [
      rolledBackId,
      JSON.stringify({
        ...payload,
        expected_version: legacyReceiveVersion(String(received.version)),
      }),
    ]);
    const rollbackHeld = await snapshot(viewer, 'rollback-held');
    sameWindow(committed, rollbackHeld);
    assert.deepEqual(comparable(rollbackHeld), comparable(committed));
    assert.deepEqual(await authoritative(itemId), committedDb);
    await writer.query('rollback');
    inTransaction = false;
    const rolledBack = await snapshot(viewer, 'rollback-released');
    sameWindow(committed, rolledBack);
    assert.deepEqual(comparable(rolledBack), comparable(committed));
    assert.deepEqual(await authoritative(itemId), committedDb);
    assert.equal(await receiptCount(staff.id, rolledBackId), '0');
    const replay = await mutate(
      staff.client,
      'quantity_receive',
      payload,
      requestId,
    );
    assert.deepEqual(
      replay,
      received,
      'real REST replay returns the committed receipt',
    );
    const replayed = await snapshot(viewer, 'receive-replayed');
    sameWindow(committed, replayed);
    assert.deepEqual(comparable(replayed), comparable(committed));
    assert.deepEqual(await authoritative(itemId), committedDb);
    assert.equal(await receiptCount(staff.id, requestId), '1');
    evidence.snapshot = {
      itemId,
      staffId: staff.id,
      requestId,
      rolledBackId,
      status: 'verified',
    };
  } finally {
    if (inTransaction) await writer.query('rollback').catch(() => undefined);
    await writer.end();
  }
}

type MutationResult = Awaited<ReturnType<typeof mutate>>;
const custodyFixtures: {
  staff?: SupabaseClient;
  sites: string[];
  quantities: string[];
  assets: string[];
} = { sites: [], quantities: [], assets: [] };

async function baseEvent(eventId: string) {
  const result = await owner.query(
    'select e.id as "eventId",\'quantity\' as "recordKind",e.item_id as "entityId",e.kind,' +
      'i.name,e.actor_name as "actorName",to_jsonb(e.created_at)#>>\'{}\' as at ' +
      'from public.quantity_events e join public.quantity_items i on i.id=e.item_id where e.id=$1 ' +
      "union all select e.id,'asset',e.asset_id,e.kind,a.name,e.actor_name,to_jsonb(e.created_at)#>>'{}' " +
      'from public.asset_events e join public.serialized_assets a on a.id=e.asset_id where e.id=$1',
    [eventId],
  );
  assert.equal(result.rows.length, 1, 'one canonical base event');
  return result.rows[0] as OverviewProjection['recentEvents'][number];
}

async function assertOneCustodyEvent(
  before: OverviewProjection,
  after: OverviewProjection,
  eventId: string,
) {
  sameWindow(before, after);
  assert.equal(before.activity.coverage, 'complete');
  assert.equal(after.activity.coverage, 'complete');
  assert.deepEqual(
    after.activity.points.slice(0, 13),
    before.activity.points.slice(0, 13),
  );
  assert.equal(
    BigInt(after.activity.points[13]!.value!),
    BigInt(before.activity.points[13]!.value!) + 1n,
    'linked assignment event must not double-count activity',
  );
  const event = await baseEvent(eventId);
  assert.equal(
    after.recentEvents.filter((row) => row.eventId === eventId).length,
    1,
  );
  assert.deepEqual(
    after.recentEvents,
    [event, ...before.recentEvents].slice(0, 10),
  );
  const paired = await owner.query(
    'select id::text from public.assignment_events where quantity_event_id=$1 or asset_event_id=$1',
    [eventId],
  );
  assert.equal(
    paired.rows.length,
    1,
    'canonical mutation records its assignment evidence',
  );
  assert.ok(
    !after.recentEvents.some((row) => row.eventId === paired.rows[0].id),
  );
}

function assertUnchangedStorage(
  before: OverviewProjection,
  after: OverviewProjection,
) {
  assert.deepEqual(
    after.stock,
    before.stock,
    'site transfer does not change available storage',
  );
  const normalize = (value: OverviewProjection) =>
    comparable(value).stockTrends;
  assert.deepEqual(
    normalize(after),
    normalize(before),
    'site transfer does not fabricate stock history',
  );
}

async function custodySnapshotProof(
  staff: { id: string; client: SupabaseClient },
  viewer: SupabaseClient,
) {
  custodyFixtures.staff = staff.client;
  const refs = (
    await owner.query(
      "select id,published_form_revision_id revision from public.categories where code='CABLES' and active and removed_at is null",
    )
  ).rows[0];
  assert.ok(refs?.id && refs.revision);
  const siteNames = [
    '000 Fictional Overview custody A ',
    '000 Fictional Overview custody B ',
  ].map((prefix) => prefix + run);
  for (let index = 0; index < 2; index++) {
    const site = await mutate(staff.client, 'site_create', {
      code: 'OVERVIEW-' + run.toUpperCase() + '-' + index,
      name: siteNames[index],
      notes: 'Fictional local Overview integration fixture',
    });
    custodyFixtures.sites.push(site.entity_id);
  }
  const [sourceSite, targetSite] = custodyFixtures.sites;
  assert.ok(sourceSite && targetSite);
  const beforeOpening = await snapshot(viewer, 'site-opening-baseline');
  const name = '001 Fictional Overview site-only quantity ' + run;
  const opened = await mutate(staff.client, 'quantity_site_open', {
    name,
    category_id: refs.id,
    expected_published_revision_id: refs.revision,
    custom_patch: {},
    reorder_threshold: 100,
    site_id: sourceSite,
    quantity: 7,
    reason: 'Fictional site-only Overview opening',
  });
  custodyFixtures.quantities.push(opened.entity_id);
  const itemId = opened.entity_id;
  assert.equal(String(opened.version), '1');
  const openedView = await snapshot(viewer, 'site-opening-committed');
  await assertOneCustodyEvent(beforeOpening, openedView, opened.event_id);
  assert.equal(
    BigInt(openedView.stock.monitoredItems),
    BigInt(beforeOpening.stock.monitoredItems) + 1n,
  );
  assert.equal(
    BigInt(openedView.stock.needsAttention),
    BigInt(beforeOpening.stock.needsAttention) + 1n,
  );
  assert.equal(
    BigInt(openedView.stock.zeroAvailable),
    BigInt(beforeOpening.stock.zeroAvailable) + 1n,
  );
  assert.equal(
    openedView.stock.unmonitoredItems,
    beforeOpening.stock.unmonitoredItems,
  );
  assert.equal(openedView.atSites.assets, beforeOpening.atSites.assets);
  assert.equal(
    BigInt(openedView.atSites.quantityDefinitions),
    BigInt(beforeOpening.atSites.quantityDefinitions) + 1n,
  );
  assert.equal(
    BigInt(openedView.atSites.occupiedSites),
    BigInt(beforeOpening.atSites.occupiedSites) + 1n,
  );
  const openingTrend = openedView.stockTrends.find(
    (row) => row.itemId === itemId,
  );
  assert.ok(
    openingTrend,
    'owned site-only item must be featured without editing unrelated records',
  );
  assert.notEqual(openingTrend.coverage, 'unavailable');
  assert.equal(
    openingTrend.available,
    '0',
    'seven units at sites are not available closet stock',
  );
  assert.equal(openingTrend.points[13]!.value, '0');
  assert.ok(
    openingTrend.points
      .slice(0, 13)
      .every(
        (point) => point.value === null && point.state === 'not_yet_recorded',
      ),
  );
  assert.deepEqual(
    openedView.atSites.rows.filter((row) => row.entityId === itemId),
    [
      {
        siteId: sourceSite,
        siteName: siteNames[0],
        siteActive: true,
        entityId: itemId,
        kind: 'quantity',
        name,
        quantity: '7',
      },
    ],
  );
  assert.equal((await authoritative(itemId)).available, '0');

  const first = connection('custody-writer-first');
  // Permit the full held proof: 1.5s witness + 12s REST guard + 2 × 4s
  // receipt reads + 4s commit + 2.5s assertions = 28s. These isolated
  // backend-only fences exceed that path; they do not change any application
  // function or the separately tested effective REST execution timeout.
  const second = new Client({
    connectionString: database,
    application_name: 'overview-integration-custody-writer-second-' + run,
    connectionTimeoutMillis: 3000,
    query_timeout: 45000,
  });
  const transactions = new Set<Client>();
  let pending: Promise<{ result?: MutationResult; code?: string }> | undefined;
  async function begin(client: Client) {
    await client.connect();
    await client.query('begin isolation level read committed');
    transactions.add(client);
    await client.query("set local idle_in_transaction_session_timeout='45s'");
    await client.query("set local lock_timeout='35s'");
    if (client === second)
      await client.query("set local statement_timeout='40s'");
    await client.query('set local role authenticated');
    await client.query('select set_config($1,$2,true)', [
      'request.jwt.claims',
      JSON.stringify({ sub: staff.id, role: 'authenticated' }),
    ]);
    return (await client.query('select pg_backend_pid() pid')).rows[0]
      .pid as number;
  }
  const firstId = randomUUID();
  const secondId = randomUUID();
  const transfer = {
    action: 'transfer',
    item_id: itemId,
    expected_version: '1',
    source_site_id: sourceSite,
    destination_site_id: targetSite,
    quantity: 3,
    reason: 'Fictional concurrent Overview custody transfer',
  };
  let winner: MutationResult;
  try {
    const firstPid = await begin(first);
    const secondPid = await begin(second);
    assert.notEqual(firstPid, secondPid, 'independent backend connections');
    winner = (
      await first.query(
        'select public.quantity_site_change($1,$2::jsonb) result',
        [firstId, JSON.stringify(transfer)],
      )
    ).rows[0].result;
    assert.equal(winner.entity_id, itemId);
    assert.equal(String(winner.version), '2');
    pending = second
      .query('select public.quantity_site_change($1,$2::jsonb) result', [
        secondId,
        JSON.stringify(transfer),
      ])
      .then(
        (result) => ({ result: result.rows[0].result as MutationResult }),
        (error: unknown) => ({
          code:
            error && typeof error === 'object' && 'code' in error
              ? String(error.code)
              : 'unexpected',
        }),
      );
    // Exact second PID blocked by the first PID is the deterministic race barrier.
    // A short bounded observation interval is not used as an ordering assumption.
    let witnessed = false;
    const witnessDeadline = performance.now() + 1500;
    while (performance.now() < witnessDeadline) {
      const row = (
        await owner.query(
          "select state='active' and wait_event_type='Lock' and $2=any(pg_blocking_pids(pid)) witnessed from pg_stat_activity where pid=$1",
          [secondPid, firstPid],
        )
      ).rows[0];
      if (row?.witnessed) {
        witnessed = true;
        break;
      }
      await delay(25);
    }
    assert.ok(
      witnessed,
      'same-version second writer must be observed waiting on first writer',
    );
    const held = await snapshot(
      viewer,
      'custody-transfer-held-competing-writer',
    );
    sameWindow(openedView, held);
    assert.deepEqual(
      comparable(held),
      comparable(openedView),
      'held custody exposes complete old projection',
    );
    assert.equal(await receiptCount(staff.id, firstId), '0');
    assert.equal(await receiptCount(staff.id, secondId), '0');
    await first.query('commit');
    transactions.delete(first);
    const loser = await pending;
    assert.equal(
      loser.code,
      'P1002',
      'competing same-version request must fail stale, not silently rebase',
    );
    assert.equal(loser.result, undefined);
    await second.query('rollback');
    transactions.delete(second);
    const committed = await snapshot(viewer, 'custody-transfer-committed');
    await assertOneCustodyEvent(openedView, committed, winner.event_id);
    assertUnchangedStorage(openedView, committed);
    assert.equal(committed.atSites.assets, openedView.atSites.assets);
    assert.equal(
      committed.atSites.quantityDefinitions,
      openedView.atSites.quantityDefinitions,
    );
    assert.equal(
      BigInt(committed.atSites.occupiedSites),
      BigInt(openedView.atSites.occupiedSites) + 1n,
    );
    assert.deepEqual(
      committed.atSites.rows.filter((row) => row.entityId === itemId),
      [
        {
          siteId: sourceSite,
          siteName: siteNames[0],
          siteActive: true,
          entityId: itemId,
          kind: 'quantity',
          name,
          quantity: '4',
        },
        {
          siteId: targetSite,
          siteName: siteNames[1],
          siteActive: true,
          entityId: itemId,
          kind: 'quantity',
          name,
          quantity: '3',
        },
      ],
    );
    const holdings = await owner.query(
      'select site_id::text,quantity from public.site_quantity_holdings where item_id=$1 order by site_id',
      [itemId],
    );
    assert.deepEqual(
      holdings.rows,
      [
        { site_id: sourceSite, quantity: 4 },
        { site_id: targetSite, quantity: 3 },
      ].sort((a, b) => a.site_id.localeCompare(b.site_id)),
    );
    assert.deepEqual(await authoritative(itemId), {
      version: '2',
      available: '0',
      events: '2',
    });
    assert.equal(await receiptCount(staff.id, firstId), '1');
    assert.equal(await receiptCount(staff.id, secondId), '0');
    const replay = await mutate(
      staff.client,
      'quantity_site_change',
      transfer,
      firstId,
    );
    assert.deepEqual(replay, winner);
    const replayed = await snapshot(viewer, 'custody-transfer-replayed');
    sameWindow(committed, replayed);
    assert.deepEqual(comparable(replayed), comparable(committed));
    assert.deepEqual(await authoritative(itemId), {
      version: '2',
      available: '0',
      events: '2',
    });
    evidence.custodyQuantity = {
      status: 'verified',
      itemId,
      firstId,
      secondId,
      independentBackends: true,
      blockedWitness: true,
      staleLoser: true,
    };
  } finally {
    // Release the owner first, then drain any queued contender before its rollback.
    if (transactions.has(first))
      await first.query('rollback').catch(() => undefined);
    if (pending) await pending;
    if (transactions.has(second))
      await second.query('rollback').catch(() => undefined);
    // Both clients are owned before either connect attempt, including partial setup.
    for (const client of [first, second]) await client.end();
  }

  const asset = await mutate(staff.client, 'asset_site_open', {
    name: '001 Fictional Overview site-only asset ' + run,
    category_id: refs.id,
    expected_published_revision_id: refs.revision,
    custom_patch: {},
    site_id: sourceSite,
    reason: 'Fictional Overview asset opening',
  });
  custodyFixtures.assets.push(asset.entity_id);
  const beforeAsset = await snapshot(viewer, 'asset-site-transfer-baseline');
  const moved = await mutate(staff.client, 'asset_site_change', {
    action: 'transfer',
    asset_id: asset.entity_id,
    expected_version: String(asset.version),
    source_site_id: sourceSite,
    destination_site_id: targetSite,
    reason: 'Fictional Overview asset site transfer',
  });
  const afterAsset = await snapshot(viewer, 'asset-site-transfer-committed');
  await assertOneCustodyEvent(beforeAsset, afterAsset, moved.event_id);
  assertUnchangedStorage(beforeAsset, afterAsset);
  assert.equal(afterAsset.atSites.assets, beforeAsset.atSites.assets);
  assert.equal(
    afterAsset.atSites.quantityDefinitions,
    beforeAsset.atSites.quantityDefinitions,
  );
  assert.equal(
    afterAsset.atSites.occupiedSites,
    beforeAsset.atSites.occupiedSites,
  );
  const currentAsset = (
    await owner.query(
      'select version::text,status,location_id,site_id::text from public.serialized_assets where id=$1',
      [asset.entity_id],
    )
  ).rows[0];
  assert.deepEqual(currentAsset, {
    version: '2',
    status: 'active',
    location_id: null,
    site_id: targetSite,
  });
  const ownAssetRows = afterAsset.atSites.rows.filter(
    (row) => row.entityId === asset.entity_id,
  );
  assert.deepEqual(ownAssetRows, [
    {
      siteId: targetSite,
      siteName: siteNames[1],
      siteActive: true,
      entityId: asset.entity_id,
      kind: 'asset',
      name: '001 Fictional Overview site-only asset ' + run,
      quantity: '1',
    },
  ]);
  evidence.custodyAsset = {
    status: 'verified',
    assetId: asset.entity_id,
    eventId: moved.event_id,
    storageUnchanged: true,
  };
}

async function cleanupCustodyFixtures(
  attempt: (action: () => Promise<unknown>) => Promise<void>,
) {
  const staff = custodyFixtures.staff;
  if (!staff) return;
  for (const assetId of custodyFixtures.assets)
    await attempt(async () => {
      const row = (
        await owner.query(
          'select version::text,status,site_id::text from public.serialized_assets where id=$1',
          [assetId],
        )
      ).rows[0];
      assert.ok(row);
      if (row.status !== 'retired') {
        assert.ok(
          row.site_id,
          'owned asset must still have its reviewed site custody',
        );
        await mutate(staff, 'asset_site_change', {
          action: 'retire',
          asset_id: assetId,
          expected_version: row.version,
          source_site_id: row.site_id,
          reason: 'Fictional Overview custody cleanup',
        });
      }
    });
  for (const itemId of custodyFixtures.quantities)
    await attempt(async () => {
      const holdings = await owner.query(
        'select site_id::text,quantity from public.site_quantity_holdings where item_id=$1 and quantity>0 order by site_id',
        [itemId],
      );
      for (const holding of holdings.rows) {
        const current = await authoritative(itemId);
        await mutate(staff, 'quantity_site_change', {
          action: 'write_off',
          item_id: itemId,
          expected_version: current.version,
          source_site_id: holding.site_id,
          quantity: holding.quantity,
          reason: 'Fictional Overview custody cleanup',
        });
      }
      const row = (
        await owner.query(
          'select version::text,archived from public.quantity_items where id=$1',
          [itemId],
        )
      ).rows[0];
      assert.ok(row);
      if (!row.archived)
        await mutate(staff, 'quantity_archive_and_clear', {
          item_id: itemId,
          expected_version: row.version,
          confirm_clear_stock: true,
          reason: 'Fictional Overview custody cleanup',
        });
    });
  for (const siteId of custodyFixtures.sites)
    await attempt(async () => {
      const row = (
        await owner.query(
          'select version::text,active from public.sites where id=$1',
          [siteId],
        )
      ).rows[0];
      assert.ok(row);
      if (row.active)
        await mutate(staff, 'site_set_active', {
          site_id: siteId,
          expected_version: row.version,
          active: false,
          reason: 'Fictional Overview custody cleanup',
        });
    });
}

async function authorizationSnapshotProof() {
  // Separate fixture accounts and caller-scoped SDK clients. Neither reuses the
  // client or membership result belonging to the preceding inventory scenario.
  const revoked = await actor('staff', { label: 'revocation' });
  const independent = await actor('staff', { label: 'independent' });
  assert.notEqual(revoked.id, independent.id);
  assert.notEqual(revoked.client, independent.client);

  async function membershipPrecheck(account: typeof revoked) {
    // Match requireMember's real Auth and caller-authorized table-read sequence,
    // then use its actual active-membership predicate. This is not a mocked
    // server-render authorization decision or a privileged membership read.
    const auth = await account.client.auth.getUser();
    assert.equal(auth.error, null);
    assert.equal(auth.data.user?.id, account.id);
    const member = await account.client
      .from('app_members')
      .select('user_id, display_name, role, active, can_manage_configuration')
      .eq('user_id', account.id)
      .maybeSingle();
    assert.equal(member.error, null);
    assert.ok(isActiveMember(member.data));
    assert.equal(member.data.user_id, account.id);
    return member.data;
  }

  async function changeOwnedMembership(
    accountId: string,
    change: 'revoke' | 'downgrade',
  ) {
    // Only the two exact fixture identities are eligible for this test-only
    // administrator operation; no domain data or application grants change.
    assert.ok(accountId === revoked.id || accountId === independent.id);
    await owner.query('begin isolation level read committed');
    try {
      await owner.query("set local lock_timeout='2s'");
      await owner.query("set local statement_timeout='4s'");
      const changed = await owner.query(
        change === 'revoke'
          ? 'update public.app_members set active=false,can_manage_configuration=false where user_id=$1 and active returning user_id'
          : "update public.app_members set role='viewer',can_manage_configuration=false where user_id=$1 and active and role='staff' returning user_id",
        [accountId],
      );
      assert.equal(changed.rowCount, 1);
      // Awaiting this COMMIT is the deterministic precheck-to-RPC barrier. The
      // target RPC is not constructed/started until after this method returns.
      await owner.query('commit');
    } catch (error) {
      await owner.query('rollback');
      throw error;
    }
  }

  function deniedAfterPrecheck(result: {
    data: unknown;
    error: { code?: string } | null;
  }) {
    assert.equal(result.error?.code, 'P1001');
    assert.equal(result.data, null, 'revoked RPC returns no private snapshot');
    const mapped = overviewReadError(result.error?.code);
    assert.equal(mapped.code, 'forbidden');
    assert.equal(
      mapped.clearSnapshot,
      true,
      'actual adapter vocabulary requires clearing retained private data',
    );
  }

  const [revokedPrecheck, independentPrecheck] = await Promise.all([
    membershipPrecheck(revoked),
    membershipPrecheck(independent),
  ]);
  assert.equal(revokedPrecheck.role, 'staff');
  assert.equal(independentPrecheck.role, 'staff');
  const [beforeRevocation, independentBaseline] = await Promise.all([
    snapshot(revoked.client, 'authorization-active-account-a'),
    snapshot(independent.client, 'authorization-active-account-b'),
  ]);
  sameWindow(beforeRevocation, independentBaseline);
  assert.deepEqual(
    comparable(beforeRevocation),
    comparable(independentBaseline),
  );

  await changeOwnedMembership(revoked.id, 'revoke');
  assert.equal(
    revokedPrecheck.active,
    true,
    'retain the actual formerly successful precheck to exercise the race',
  );
  const [denied, allowed] = await Promise.all([
    revoked.client.rpc('overview_snapshot_v1', { p_time_zone: 'UTC' }),
    snapshot(independent.client, 'authorization-peer-during-revoked-read'),
  ]);
  deniedAfterPrecheck(denied);
  sameWindow(independentBaseline, allowed);
  assert.deepEqual(comparable(allowed), comparable(independentBaseline));
  const stillStaff = await membershipPrecheck(independent);
  assert.equal(stillStaff.role, 'staff');
  assert.equal(mayMutateInventory(stillStaff), true);

  await changeOwnedMembership(independent.id, 'downgrade');
  assert.equal(
    stillStaff.role,
    'staff',
    'old staff precheck cannot decide current edit authority',
  );
  const viewerMember = await membershipPrecheck(independent);
  assert.equal(viewerMember.role, 'viewer');
  assert.equal(mayMutateInventory(viewerMember), false);
  assert.equal(viewerMember.can_manage_configuration, false);
  const [deniedAgain, viewerRead] = await Promise.all([
    revoked.client.rpc('overview_snapshot_v1', { p_time_zone: 'UTC' }),
    snapshot(independent.client, 'authorization-viewer-after-downgrade'),
  ]);
  deniedAfterPrecheck(deniedAgain);
  sameWindow(allowed, viewerRead);
  assert.deepEqual(comparable(viewerRead), comparable(allowed));
  evidence.authorization = {
    status: 'verified',
    revokedActorId: revoked.id,
    independentActorId: independent.id,
    activePrecheckBeforeRevocation: true,
    revocationCommittedBeforeRpc: true,
    deniedSqlstate: denied.error!.code,
    deniedData: 'none',
    independentCallerStillAllowed: true,
    viewerReadAfterDowngrade: true,
    privateDataClearSignal: true,
    midStatementRevocationCancellation: 'not-claimed',
    lateRefreshUiSuppression: 'separate-component-evidence-only',
  };
}

async function main() {
  await owner.connect();
  ownerConnected = true;
  const viewer = await actor('viewer');
  const staff = await actor('staff', { canManageConfiguration: true });
  await timeoutProof(viewer.client, viewer.id, staff.client);
  await snapshotProof(staff, viewer.client);
  await custodySnapshotProof(staff, viewer.client);
  await authorizationSnapshotProof();
}

async function cleanup() {
  const failures: unknown[] = [];
  async function attempt(action: () => Promise<unknown>) {
    try {
      await action();
    } catch (error) {
      failures.push(error);
    }
  }
  if (ownerConnected) {
    if (probeCreated) {
      await attempt(() =>
        owner.query('drop function public.' + probeName + '()'),
      );
      await attempt(() => owner.query("notify pgrst, 'reload schema'"));
    }
    if (fixture) {
      const owned = fixture;
      await attempt(async () => {
        const current = await authoritative(owned.itemId);
        await mutate(owned.staff, 'quantity_archive_and_clear', {
          item_id: owned.itemId,
          expected_version: current.version,
          confirm_clear_stock: true,
          reason: 'Fictional Overview integration cleanup',
        });
      });
    }
    await cleanupCustodyFixtures(attempt);
    for (const account of actors) {
      await attempt(async () => {
        const result = await account.client.auth.signOut({ scope: 'local' });
        assert.equal(result.error, null);
      });
      await attempt(() =>
        owner.query(
          'update public.app_members set active=false where user_id=$1',
          [account.id],
        ),
      );
    }
  }
  await attempt(() => owner.end());
  // Append-only events, receipts and actor references are deliberately retained.
  evidence.retained = {
    actorIds: actors.map((account) => account.id),
    itemId: fixture?.itemId ?? null,
    custodySiteIds: custodyFixtures.sites,
    custodyQuantityIds: custodyFixtures.quantities,
    custodyAssetIds: custodyFixtures.assets,
  };
  evidence.snapshots = snapshots;
  console.log(JSON.stringify(evidence));
  assert.equal(
    failures.length,
    0,
    'Overview integration cleanup failed; inspect owned fixtures',
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      await cleanup();
    } catch (error) {
      console.error(error);
      process.exitCode = 1;
    }
  });
