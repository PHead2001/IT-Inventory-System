import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { createClient } from '@supabase/supabase-js';
import { Client } from 'pg';
import authFixture from '../fixtures/auth.json' with { type: 'json' };

function local(value: string | undefined, port: number) {
  assert.ok(value);
  const url = new URL(value);
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(url.hostname));
  assert.equal(Number(url.port), port);
  return value;
}
const api = local(process.env.LOCAL_API_URL, 54321);
const db = local(process.env.LOCAL_DB_URL, 54322);
assert.ok(process.env.LOCAL_ANON_KEY && process.env.LOCAL_SERVICE_ROLE_KEY);
const options = { auth: { persistSession: false, autoRefreshToken: false } };
const admin = createClient(api, process.env.LOCAL_SERVICE_ROLE_KEY, options);
const staff = createClient(api, process.env.LOCAL_ANON_KEY, options);
const owner = new Client({ connectionString: db, application_name: 'custody-integration-owner' });
const uuid = () => randomUUID();

async function mutation(operation: string, payload: Record<string, unknown>, requestId = uuid()) {
  return staff.rpc(operation as never, { p_request_id: requestId, p_payload: payload } as never);
}
async function succeeds(operation: string, payload: Record<string, unknown>, requestId = uuid()) {
  const { data, error } = await mutation(operation, payload, requestId);
  assert.equal(error, null, `${operation}: ${error?.code} ${error?.message}`);
  assert.ok(data && typeof data === 'object');
  return data as Record<string, unknown>;
}
async function fails(operation: string, payload: Record<string, unknown>, code: string,
  requestId = uuid()) {
  const { error } = await mutation(operation, payload, requestId);
  assert.equal(error?.code, code, `${operation}: ${error?.message}`);
}
async function connection(actor: string) {
  const client = new Client({ connectionString: db, application_name: 'custody-race-' + uuid() });
  await client.connect();
  await client.query('begin');
  await client.query('set local role authenticated');
  await client.query('select set_config($1,$2,true)', ['request.jwt.claims',
    JSON.stringify({ sub: actor, role: 'authenticated' })]);
  return client;
}
async function blockedBy(pid: number, blockerPid: number) {
  const deadline = Date.now() + 1500;
  while (Date.now() < deadline) {
    const { rows } = await owner.query('select pg_blocking_pids($1) as blockers', [pid]);
    if ((rows[0].blockers as number[]).includes(blockerPid)) return;
    await delay(25);
  }
  assert.fail(`expected backend ${pid} to wait for ${blockerPid}`);
}

async function main() {
  await owner.connect();
  const email = `${uuid()}@example.test`;
  const created = await admin.auth.admin.createUser({
    email, password: authFixture.password, email_confirm: true,
  });
  if (created.error) throw created.error;
  const actor = created.data.user.id;
  await owner.query(
    'insert into public.app_members(user_id,display_name,role,active,can_manage_configuration) values($1,$2,$3,true,true)',
    [actor, 'Fictional custody integration', 'staff'],
  );
  const signed = await staff.auth.signInWithPassword({ email, password: authFixture.password });
  if (signed.error) throw signed.error;

  const site = await succeeds('site_create', {
    code: 'SITE-' + uuid().replaceAll('-', '').slice(0, 14).toUpperCase(),
    name: 'Fictional race site',
  });
  const secondSite = await succeeds('site_create', {
    code: 'SITE-' + uuid().replaceAll('-', '').slice(0, 14).toUpperCase(),
    name: 'Fictional empty site',
  });
  const office = await owner.query("select id from public.locations where code='ITO-GENERAL'");
  const category = await owner.query(
    "select id,published_form_revision_id from public.categories where code='CABLES'",
  );
  const item = await succeeds('quantity_create_v2', {
    name: 'Fictional custody race stock ' + uuid().slice(0, 8),
    category_id: category.rows[0].id,
    expected_published_revision_id: category.rows[0].published_form_revision_id,
    custom_patch: {}, initial_location_id: office.rows[0].id, initial_quantity: 10,
  });
  const payload = {
    action: 'issue', item_id: item.entity_id, expected_version: '1',
    source_location_id: office.rows[0].id, destination_site_id: site.entity_id,
    quantity: 7,
  };
  const requestId = uuid();
  const first = await succeeds('quantity_site_change', payload, requestId);
  const replay = await succeeds('quantity_site_change', payload, requestId);
  assert.deepEqual(replay, first, 'completed receipt returns the original result');
  assert.equal(typeof first.version, 'string');
  const count = await owner.query(
    'select count(*)::integer as n from public.assignment_events where item_id=$1',
    [item.entity_id],
  );
  assert.equal(count.rows[0].n, 1, 'replay appends no duplicate assignment event');
  await fails('quantity_site_change', { ...payload, quantity: 6 }, 'P1009', requestId);

  const quantity = await owner.query(
    'select available_quantity,assigned_quantity,recorded_quantity from public.inventory_quantity_totals where item_id=$1',
    [item.entity_id],
  );
  assert.deepEqual(quantity.rows[0], {
    available_quantity: '3', assigned_quantity: '7', recorded_quantity: '10',
  });
  await fails('quantity_site_change', { ...payload, expected_version: '2', quantity: 4 }, 'P1006');
  await fails('quantity_archive_and_clear', {
    item_id: item.entity_id, expected_version: '2', confirm_clear_stock: true,
    reason: 'Fictional test',
  }, 'P1008');

  // Two independent transactions contend for the same item. The loser sees
  // the newly committed version; no stale stock read or duplicate event.
  const one = await connection(actor);
  const two = await connection(actor);
  try {
    const onePid = (await one.query('select pg_backend_pid() as pid')).rows[0].pid as number;
    const twoPid = (await two.query('select pg_backend_pid() as pid')).rows[0].pid as number;
    const move = {
      action: 'return', item_id: item.entity_id, expected_version: '2',
      source_site_id: site.entity_id, destination_location_id: office.rows[0].id,
      quantity: 2,
    };
    await one.query('select public.quantity_site_change($1,$2::jsonb)', [uuid(), JSON.stringify(move)]);
    const competing = two.query('select public.quantity_site_change($1,$2::jsonb)',
      [uuid(), JSON.stringify(move)]).then(() => null, (error: { code?: string }) => error);
    await blockedBy(twoPid, onePid);
    await one.query('commit');
    const error = await competing;
    assert.equal(error?.code, 'P1002', 'competing stale return must fail after first commits');
    await two.query('rollback');
  } finally {
    await Promise.allSettled([one.query('rollback'), two.query('rollback')]);
    await Promise.allSettled([one.end(), two.end()]);
  }

  // An exclusive site lifecycle change blocks a later assignment, then its
  // committed inactive state is visible in the fresh READ COMMITTED statement.
  const topology = await connection(actor);
  const issuing = await connection(actor);
  try {
    const pid = (await topology.query('select pg_backend_pid() as pid')).rows[0].pid as number;
    const issuingPid = (await issuing.query('select pg_backend_pid() as pid')).rows[0].pid as number;
    await topology.query('select public.site_update($1,$2::jsonb)', [uuid(), JSON.stringify({
      site_id: secondSite.entity_id, expected_version: '1', name: 'Fictional empty site', active: false,
    })]);
    const attempt = issuing.query('select public.quantity_site_change($1,$2::jsonb)',
      [uuid(), JSON.stringify({ action: 'issue', item_id: item.entity_id,
        expected_version: '3', source_location_id: office.rows[0].id,
        destination_site_id: secondSite.entity_id, quantity: 1 })])
      .then(() => null, (error: { code?: string }) => error);
    await blockedBy(issuingPid, pid);
    await topology.query('commit');
    const error = await attempt;
    assert.equal(error?.code, 'P1004', 'assignment must observe newly inactive site');
    await issuing.query('rollback');
  } finally {
    await Promise.allSettled([topology.query('rollback'), issuing.query('rollback')]);
    await Promise.allSettled([topology.end(), issuing.end()]);
  }

  const isolation = new Client({ connectionString: db });
  await isolation.connect();
  try {
    await isolation.query('begin isolation level repeatable read');
    await isolation.query('set local role authenticated');
    await isolation.query('select set_config($1,$2,true)', ['request.jwt.claims',
      JSON.stringify({ sub: actor, role: 'authenticated' })]);
    await assert.rejects(
      isolation.query('select public.quantity_site_change($1,$2::jsonb)',
        [uuid(), JSON.stringify({ ...payload, expected_version: '3', quantity: 1 })]),
      { code: 'P1016' },
    );
  } finally {
    await isolation.query('rollback');
    await isolation.end();
  }

  await owner.query('update public.app_members set active=false where user_id=$1', [actor]);
  await fails('quantity_site_change', payload, 'P1001', requestId);
  await owner.query('update public.app_members set active=true where user_id=$1', [actor]);
  console.log('Custody receipt, accounting, rollback, independent-connection races, topology barrier and isolation passed.');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(async () => {
  await staff.auth.signOut({ scope: 'local' });
  await owner.end();
});
