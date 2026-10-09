import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { Client } from 'pg';
import type { SupabaseClient } from '@supabase/supabase-js';
import fixtures from '../fixtures/print-media.json' with { type: 'json' };
import { printLayoutSchema } from '../../src/features/labels/print-layout';

export async function testPrintMediaConfiguration(
  owner: Client,
  client: SupabaseClient,
  actorId: string,
  db: string,
) {
  for (const fixture of fixtures) {
    const sql = await owner.query(
      'select private.valid_print_layout($1::jsonb) as valid',
      [JSON.stringify(fixture.layout)],
    );
    assert.equal(sql.rows[0].valid, fixture.valid, fixture.name);
    assert.equal(
      sql.rows[0].valid,
      printLayoutSchema.safeParse(fixture.layout).success,
      fixture.name + ' TS/SQL agreement',
    );
  }
  const current = async () =>
    (
      await owner.query(
        'select size,page,format,layout,version::text as version from public.label_defaults where singleton',
      )
    ).rows[0];
  const base = (version: string) => ({
    expected_version: version,
    size: '90x50',
    page: 'letter',
    format: 'qr',
  });
  const rpc = (payload: Record<string, unknown>, id: string = randomUUID()) =>
    client.rpc('label_defaults_update', {
      p_request_id: id,
      p_payload: payload,
    });
  const success = async (payload: Record<string, unknown>, id?: string) => {
    const response = await rpc(payload, id);
    assert.equal(response.error, null, JSON.stringify(response.error));
    return response.data;
  };
  const legacy = base((await current()).version);
  const legacyId = randomUUID();
  const oldResult = {
    version: legacy.expected_version,
    event_id: null,
    changed: false,
  };
  // This is the exact pre-migration receipt shape, deliberately not rewritten.
  await owner.query(
    "insert into private.mutation_requests(actor_id,request_id,operation,request_payload,result) values($1,$2,'label_defaults_update',$3,$4)",
    [actorId, legacyId, legacy, oldResult],
  );
  const custom = {
    version: 1,
    mode: 'single',
    labelWidth: 700,
    labelHeight: 350,
  };
  const first = await success({ ...legacy, layout: custom });
  assert.equal(first.changed, true);
  assert.deepEqual(
    await success(legacy, legacyId),
    oldResult,
    'old receipt replays after a later custom update',
  );
  assert.deepEqual(
    (
      await owner.query(
        'select request_payload from private.mutation_requests where actor_id=$1 and request_id=$2',
        [actorId, legacyId],
      )
    ).rows[0].request_payload,
    legacy,
  );
  assert.equal(
    (await rpc({ ...legacy, layout: null }, legacyId)).error?.code,
    'P1009',
    'omitted layout differs from explicit clear for retry identity',
  );
  const state = await current();
  const beforeEvents = (
    await owner.query(
      "select count(*)::integer as count from public.configuration_events where kind='label_defaults_updated'",
    )
  ).rows[0].count;
  const omittedId = randomUUID();
  const omitted = await success(base(state.version), omittedId);
  assert.deepEqual(omitted, {
    version: state.version,
    event_id: null,
    changed: false,
  });
  assert.deepEqual(
    (await current()).layout,
    custom,
    'omission preserves custom layout',
  );
  assert.equal(
    (
      await owner.query(
        "select count(*)::integer as count from public.configuration_events where kind='label_defaults_updated'",
      )
    ).rows[0].count,
    beforeEvents,
    'noop appends no event',
  );
  assert.equal(
    (await rpc({ ...base(state.version), layout: null }, omittedId)).error
      ?.code,
    'P1009',
  );
  const cleared = await success({ ...base(state.version), layout: null });
  assert.equal(cleared.changed, true);
  assert.equal(cleared.version, String(BigInt(state.version) + 1n));
  assert.equal((await current()).layout, null);
  const event = (
    await owner.query(
      'select before_state,after_state from public.configuration_events where id=$1',
      [cleared.event_id],
    )
  ).rows[0];
  assert.deepEqual(event.before_state.layout, custom);
  assert.equal(event.after_state.layout, null);
  assert.ok(!Object.hasOwn(event.after_state, 'expected_version'));
  const clearedState = await current();
  assert.deepEqual(
    await success({ ...base(clearedState.version), layout: null }),
    { version: clearedState.version, event_id: null, changed: false },
  );
  assert.equal(
    (await rpc({ ...base(state.version), layout: custom })).error?.code,
    'P1002',
  );
  const duplicateId = randomUUID();
  const duplicatePayload = { ...base(clearedState.version), layout: custom };
  const [left, right] = await Promise.all([
    rpc(duplicatePayload, duplicateId),
    rpc(duplicatePayload, duplicateId),
  ]);
  assert.equal(left.error, null);
  assert.equal(right.error, null);
  assert.deepEqual(left.data, right.data);
  const blocker = new Client({
    connectionString: db,
    application_name: 'print-media-race',
  });
  await blocker.connect();
  const waitForBlocked = async () => {
    const pid = (await blocker.query('select pg_backend_pid() as pid')).rows[0]
      .pid;
    for (let attempt = 0; attempt < 60; attempt++) {
      const rows = await owner.query(
        "select query from pg_stat_activity where $1=any(pg_blocking_pids(pid)) and state='active'",
        [pid],
      );
      if (rows.rows.length) return;
      await delay(25);
    }
    throw new Error(
      'Expected print-media RPC to wait on the independent transaction',
    );
  };
  try {
    await blocker.query('begin');
    const changed = { ...custom, labelWidth: 900 };
    const locked = await blocker.query(
      'update public.label_defaults set layout=$1,version=version+1 where singleton returning version::text as version',
      [changed],
    );
    const pending = rpc(base(locked.rows[0].version));
    await waitForBlocked();
    await blocker.query('commit');
    assert.equal((await pending).error, null);
    assert.deepEqual(
      (await current()).layout,
      changed,
      'omission uses the locked current row, not an earlier snapshot',
    );
    await blocker.query('begin');
    const isolation = await blocker.query(
      'set transaction isolation level repeatable read',
    );
    assert.ok(isolation);
    await blocker.query('set local role authenticated');
    await blocker.query("select set_config('request.jwt.claims',$1,true)", [
      JSON.stringify({ sub: actorId, role: 'authenticated' }),
    ]);
    assert.deepEqual(
      (
        await blocker.query(
          'select public.label_defaults_update($1,$2) as result',
          [legacyId, legacy],
        )
      ).rows[0].result,
      oldResult,
      'completed legacy replay precedes fresh-isolation restriction',
    );
    await blocker.query('rollback');
    await blocker.query('begin');
    await blocker.query(
      'select display_name from public.app_members where user_id=$1 for update',
      [actorId],
    );
    const revokedReplay = rpc(legacy, legacyId);
    await waitForBlocked();
    await blocker.query(
      'update public.app_members set active=false where user_id=$1',
      [actorId],
    );
    await blocker.query('commit');
    assert.equal(
      (await revokedReplay).error?.code,
      'P1001',
      'authorization and membership lock precede receipt replay',
    );
  } finally {
    await blocker.query('rollback');
    await blocker.end();
    await owner.query(
      'update public.app_members set active=true where user_id=$1',
      [actorId],
    );
    await success({ ...base((await current()).version), layout: null });
  }
}
