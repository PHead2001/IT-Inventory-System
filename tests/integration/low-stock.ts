import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { Client } from 'pg';
import authFixture from '../fixtures/auth.json' with { type: 'json' };

function local(value: string | undefined, port: number) {
  assert.ok(value, 'local test configuration required');
  const url = new URL(value);
  assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname));
  assert.equal(Number(url.port), port);
  return value;
}
const apiUrl = local(process.env.LOCAL_API_URL, 54321);
const dbUrl = local(process.env.LOCAL_DB_URL, 54322);
assert.ok(process.env.LOCAL_ANON_KEY && process.env.LOCAL_SERVICE_ROLE_KEY);
const options = { auth: { persistSession: false, autoRefreshToken: false } };
const client = () => createClient(apiUrl, process.env.LOCAL_ANON_KEY!, options);
const admin = createClient(
  apiUrl,
  process.env.LOCAL_SERVICE_ROLE_KEY!,
  options,
);
const owner = new Client({ connectionString: dbUrl });
const prefix = 'LowStock-' + randomUUID();
const actors: SupabaseClient[] = [];
let checks = 0;

async function actor(role: 'staff' | 'viewer' | 'nonmember') {
  const email = role + '-' + randomUUID() + '@example.test';
  const created = await admin.auth.admin.createUser({
    email,
    password: authFixture.password,
    email_confirm: true,
  });
  assert.equal(created.error, null);
  const id = created.data.user!.id;
  if (role !== 'nonmember') {
    await owner.query(
      'insert into public.app_members(user_id,display_name,role) values($1,$2,$3)',
      [id, prefix + ' ' + role, role],
    );
  }
  const account = client();
  const session = await account.auth.signInWithPassword({
    email,
    password: authFixture.password,
  });
  assert.equal(session.error, null);
  actors.push(account);
  return { id, client: account };
}

async function rpc(
  account: SupabaseClient,
  name: string,
  parameters: object = {},
) {
  const result = await account.rpc(name, parameters);
  assert.equal(result.error, null, name + ': ' + result.error?.message);
  checks++;
  return result.data;
}
async function mutation(
  account: SupabaseClient,
  name: string,
  payload: Record<string, unknown>,
  requestId = randomUUID(),
) {
  return rpc(account, name, { p_request_id: requestId, p_payload: payload });
}
async function denied(
  account: SupabaseClient,
  name: string,
  parameters: object,
  code: string,
) {
  const result = await account.rpc(name, parameters);
  assert.equal(result.error?.code, code, name + ': ' + result.error?.message);
  checks++;
}
async function search(account: SupabaseClient, parameters: object = {}) {
  return rpc(account, 'inventory_search_v2', parameters);
}
async function exportRows(account: SupabaseClient, parameters: object = {}) {
  return rpc(account, 'inventory_export_snapshot', parameters);
}
async function row(id: string) {
  const result = await owner.query(
    'select reorder_threshold,version,archived from public.quantity_items where id=$1',
    [id],
  );
  return result.rows[0];
}
function definition(file: string, name: 'quantity_create' | 'quantity_update') {
  const source = readFileSync(file, 'utf8');
  const match = source.match(
    new RegExp(
      `create (?:or replace )?function public\\.${name}\\(p_request_id uuid,p_payload jsonb\\) returns jsonb[\\s\\S]*?\\n\\$\\$;`,
      'i',
    ),
  );
  assert.ok(match, `${name} definition exists in ${file}`);
  return match[0].replace(/^create function/i, 'create or replace function');
}
async function main() {
  await owner.connect();
  const staff = await actor('staff');
  const viewer = await actor('viewer');
  const nonmember = await actor('nonmember');
  const refs = await owner.query(`select
   (select id from public.categories where code='CABLES') category,
   (select id from public.locations where code='ITC-S1A') a,
   (select id from public.locations where code='ITC-S1B') b,
   (select id from public.locations where code='ITC-S4C') inactive_location`);
  const { category, a, b, inactive_location } = refs.rows[0];
  const oldSql = 'supabase/migrations/20260905000100_inventory_core.sql';
  const installed = await owner.query(`select
    pg_get_functiondef('public.quantity_create(uuid,jsonb)'::regprocedure) as create_definition,
    pg_get_functiondef('public.quantity_update(uuid,jsonb)'::regprocedure) as update_definition`);
  const beforeMigrationRequest = randomUUID();
  const beforeMigrationUpdateRequest = randomUUID();
  const beforeMigrationCreate = {
    name: prefix + ' before migration',
    category_id: category,
  };
  let beforeMigrationResult: { entity_id: string; version: number };
  let beforeMigrationUpdateResult: { entity_id: string; version: number };
  let beforeMigrationUpdate: Record<string, unknown>;
  // Exercise receipts written by the actual original RPC definitions, then restore
  // the exact installed definitions before replaying them. This local fixture never leaves
  // the disposable database and is serialized within the canonical DB test runner.
  await owner.query(definition(oldSql, 'quantity_create'));
  await owner.query(definition(oldSql, 'quantity_update'));
  try {
    beforeMigrationResult = await mutation(
      staff.client,
      'quantity_create',
      beforeMigrationCreate,
      beforeMigrationRequest,
    );
    beforeMigrationUpdate = {
      ...beforeMigrationCreate,
      name: prefix + ' before migration edited',
      item_id: beforeMigrationResult.entity_id,
      expected_version: beforeMigrationResult.version,
    };
    beforeMigrationUpdateResult = await mutation(
      staff.client,
      'quantity_update',
      beforeMigrationUpdate,
      beforeMigrationUpdateRequest,
    );
  } finally {
    await owner.query(installed.rows[0].create_definition);
    await owner.query(installed.rows[0].update_definition);
  }
  assert.deepEqual(
    await mutation(
      staff.client,
      'quantity_create',
      beforeMigrationCreate,
      beforeMigrationRequest,
    ),
    beforeMigrationResult,
  );
  assert.deepEqual(
    await mutation(
      staff.client,
      'quantity_update',
      beforeMigrationUpdate!,
      beforeMigrationUpdateRequest,
    ),
    beforeMigrationUpdateResult,
  );
  assert.equal(
    (await row(beforeMigrationResult!.entity_id)).version,
    beforeMigrationUpdateResult!.version,
  );
  const base = { name: prefix + ' monitored', category_id: category };
  const item = await mutation(staff.client, 'quantity_create', {
    ...base,
    reorder_threshold: 4,
    initial_quantity: 2,
    initial_location_id: a,
  });
  assert.equal((await row(item.entity_id)).reorder_threshold, 4);
  await mutation(staff.client, 'quantity_receive', {
    item_id: item.entity_id,
    expected_version: item.version,
    location_id: b,
    quantity: 2,
    reason: 'Second holding',
  });
  const observed = await search(viewer.client, { p_query: base.name });
  assert.equal(observed.total, 2);
  assert.ok(
    observed.rows.every(
      (r: { recorded_total: number }) => r.recorded_total === 4,
    ),
  );
  assert.ok(
    observed.rows.every(
      (r: { stock_state: string }) => r.stock_state === 'needs_restocking',
    ),
  );
  const filtered = await search(viewer.client, {
    p_query: base.name,
    p_location_code: 'ITC-S1A',
    p_low_stock: true,
  });
  assert.equal(filtered.total, 1);
  assert.equal(
    filtered.rows[0].recorded_total,
    4,
    'location filter does not redefine total',
  );
  const moved = await mutation(staff.client, 'quantity_move', {
    item_id: item.entity_id,
    expected_version: item.version + 1,
    source_location_id: a,
    destination_location_id: b,
    quantity: 1,
  });
  assert.equal(moved.version, item.version + 2);
  assert.equal(
    (await search(viewer.client, { p_query: base.name })).rows[0]
      .recorded_total,
    4,
  );

  const oldRequest = randomUUID();
  const oldPayload = {
    name: prefix + ' old caller',
    category_id: category,
  };
  const old = await mutation(
    staff.client,
    'quantity_create',
    oldPayload,
    oldRequest,
  );
  const receipt = await owner.query(
    'select request_payload from private.mutation_requests where actor_id=$1 and request_id=$2',
    [staff.id, oldRequest],
  );
  assert.ok(
    !Object.hasOwn(receipt.rows[0].request_payload, 'reorder_threshold'),
  );
  assert.deepEqual(
    await mutation(staff.client, 'quantity_create', oldPayload, oldRequest),
    old,
  );
  const enabled = await mutation(staff.client, 'quantity_update', {
    item_id: old.entity_id,
    expected_version: old.version,
    ...oldPayload,
    reorder_threshold: 0,
  });
  assert.equal((await row(old.entity_id)).reorder_threshold, 0);
  const legacyUpdateId = randomUUID();
  const legacyPayload = {
    item_id: old.entity_id,
    expected_version: enabled.version,
    name: prefix + ' old metadata edit',
    category_id: category,
  };
  const legacy = await mutation(
    staff.client,
    'quantity_update',
    legacyPayload,
    legacyUpdateId,
  );
  assert.equal(
    (await row(old.entity_id)).reorder_threshold,
    0,
    'omitted threshold is retained',
  );
  await mutation(staff.client, 'quantity_update', {
    ...legacyPayload,
    expected_version: legacy.version,
    reorder_threshold: null,
  });
  assert.equal(
    (await row(old.entity_id)).reorder_threshold,
    null,
    'explicit null clears',
  );
  assert.deepEqual(
    await mutation(
      staff.client,
      'quantity_update',
      legacyPayload,
      legacyUpdateId,
    ),
    legacy,
  );
  assert.equal(
    (await row(old.entity_id)).reorder_threshold,
    null,
    'old replay cannot overwrite newer state',
  );
  const history = await owner.query(
    `select e.before_metadata,e.after_metadata,
      (select count(*) from public.quantity_event_lines l where l.event_id=e.id)::int as lines
     from public.quantity_events e where e.item_id=$1 and e.kind='metadata_updated' order by e.version`,
    [old.entity_id],
  );
  assert.deepEqual(
    history.rows.map((e) => [
      e.before_metadata.reorder_threshold,
      e.after_metadata.reorder_threshold,
      e.lines,
    ]),
    [
      [null, 0, 0],
      [0, 0, 0],
      [0, null, 0],
    ],
  );
  for (const threshold of [-1, 2147483648, 1.5, '3', true]) {
    await denied(
      staff.client,
      'quantity_create',
      {
        p_request_id: randomUUID(),
        p_payload: { ...base, reorder_threshold: threshold },
      },
      'P1012',
    );
  }
  const boundary = await mutation(staff.client, 'quantity_create', {
    name: prefix + ' max threshold',
    category_id: category,
    reorder_threshold: 2147483647,
  });
  assert.equal((await row(boundary.entity_id)).reorder_threshold, 2147483647);

  const zero = await mutation(staff.client, 'quantity_create', {
    name: prefix + ' zero warning',
    category_id: category,
    reorder_threshold: 0,
  });
  assert.equal(
    (await search(viewer.client, { p_query: prefix + ' zero warning' })).rows[0]
      .stock_state,
    'out_of_stock',
  );
  const initialDashboard = await rpc(viewer.client, 'low_stock_dashboard');
  assert.ok(
    initialDashboard.needs_restocking_count >=
      initialDashboard.out_of_stock_count,
  );
  assert.ok(
    initialDashboard.rows.filter(
      (r: { entity_id: string }) => r.entity_id === item.entity_id,
    ).length <= 1,
  );
  assert.ok(
    initialDashboard.rows.some(
      (r: { entity_id: string }) => r.entity_id === zero.entity_id,
    ),
  );
  const archived = await mutation(staff.client, 'quantity_archive', {
    item_id: zero.entity_id,
    expected_version: zero.version,
    reason: 'Archive zero item',
  });
  assert.equal(
    (
      await search(viewer.client, {
        p_query: prefix + ' zero warning',
        p_low_stock: true,
      })
    ).total,
    0,
  );
  await mutation(staff.client, 'quantity_restore', {
    item_id: zero.entity_id,
    expected_version: archived.version,
    reason: 'Restore zero item',
  });
  assert.equal((await row(zero.entity_id)).reorder_threshold, 0);

  const inactive = await mutation(staff.client, 'quantity_create', {
    name: prefix + ' inactive holding',
    category_id: category,
    reorder_threshold: 1,
    initial_location_id: inactive_location,
    initial_quantity: 3,
  });
  await owner.query('update public.locations set active=false where id=$1', [
    inactive_location,
  ]);
  try {
    const state = await search(viewer.client, {
      p_query: prefix + ' inactive holding',
    });
    assert.equal(state.rows[0].recorded_total, 3);
    assert.equal(state.rows[0].stock_state, 'in_stock');
    assert.equal(
      (
        await search(viewer.client, {
          p_query: prefix + ' inactive holding',
          p_low_stock: true,
        })
      ).total,
      0,
    );
  } finally {
    await owner.query('update public.locations set active=true where id=$1', [
      inactive_location,
    ]);
  }
  assert.equal((await row(inactive.entity_id)).reorder_threshold, 1);

  const race = await mutation(staff.client, 'quantity_create', {
    name: prefix + ' race',
    category_id: category,
    reorder_threshold: 1,
  });
  const racePayload = (threshold: number) => ({
    item_id: race.entity_id,
    expected_version: race.version,
    name: prefix + ' race',
    category_id: category,
    reorder_threshold: threshold,
  });
  const competing = await Promise.all([
    staff.client.rpc('quantity_update', {
      p_request_id: randomUUID(),
      p_payload: racePayload(2),
    }),
    staff.client.rpc('quantity_update', {
      p_request_id: randomUUID(),
      p_payload: racePayload(3),
    }),
  ]);
  assert.deepEqual(competing.map((r) => r.error?.code ?? 'success').sort(), [
    'P1002',
    'success',
  ]);
  const current = await row(race.entity_id);
  const identicalId = randomUUID();
  const identicalPayload = {
    ...racePayload(4),
    expected_version: current.version,
  };
  const identical = await Promise.all([
    staff.client.rpc('quantity_update', {
      p_request_id: identicalId,
      p_payload: identicalPayload,
    }),
    staff.client.rpc('quantity_update', {
      p_request_id: identicalId,
      p_payload: identicalPayload,
    }),
  ]);
  assert.equal(identical[0].error, null);
  assert.equal(identical[1].error, null);
  assert.deepEqual(identical[0].data, identical[1].data);
  assert.equal((await row(race.entity_id)).version, current.version + 1);
  await denied(
    viewer.client,
    'quantity_update',
    {
      p_request_id: randomUUID(),
      p_payload: identicalPayload,
    },
    'P1001',
  );

  const literalName = prefix + ' %_\\ literal';
  await mutation(staff.client, 'quantity_create', {
    name: literalName,
    category_id: category,
  });
  const literalSearch = await search(viewer.client, {
    p_query: '%_\\ literal',
  });
  const literalExport = await exportRows(viewer.client, {
    p_query: '%_\\ literal',
  });
  assert.equal(literalSearch.total, 1);
  assert.equal(literalExport.total, literalSearch.total);
  assert.equal(literalExport.rows[0].name, literalName);
  const allSearch = await search(viewer.client, {
    p_query: prefix,
    p_page_size: 1,
  });
  const allExport = await exportRows(viewer.client, { p_query: prefix });
  assert.equal(allExport.total, allSearch.total, 'export includes every page');
  assert.ok(allExport.total > allSearch.rows.length);
  assert.ok(allExport.exported_at);
  assert.ok(
    allExport.rows.some(
      (r: { entity_id: string; location_code: null }) =>
        r.entity_id === zero.entity_id && r.location_code === null,
    ),
  );
  assert.ok(
    allExport.rows.every((r: object) => !Object.hasOwn(r, 'recorded_total')),
    'holding rows do not carry a repeated global total',
  );
  const lowSearch = await search(viewer.client, {
    p_query: prefix,
    p_low_stock: true,
  });
  const lowExport = await exportRows(viewer.client, {
    p_query: prefix,
    p_export_type: 'low_stock',
  });
  assert.equal(
    lowExport.total,
    new Set(lowSearch.rows.map((r: { entity_id: string }) => r.entity_id)).size,
  );
  assert.equal(
    lowExport.rows.filter(
      (r: { entity_id: string }) => r.entity_id === item.entity_id,
    ).length,
    1,
  );
  assert.ok(
    lowExport.rows.some(
      (r: { entity_id: string; holding_context: string }) =>
        r.entity_id === item.entity_id && r.holding_context.includes('ITC-S1B'),
    ),
  );
  const scopedLowExport = await exportRows(viewer.client, {
    p_query: base.name,
    p_location_code: 'ITC-S1A',
    p_export_type: 'low_stock',
  });
  assert.equal(scopedLowExport.total, 1);
  assert.equal(scopedLowExport.rows[0].recorded_total, 4);
  assert.match(scopedLowExport.rows[0].holding_context, /ITC-S1A/);
  assert.match(scopedLowExport.rows[0].holding_context, /ITC-S1B/);
  assert.deepEqual(
    (await exportRows(viewer.client, { p_query: prefix + ' no matches' })).rows,
    [],
  );
  await denied(client(), 'inventory_export_snapshot', {}, '42501');
  assert.equal((await search(nonmember.client, { p_query: prefix })).total, 0);
  assert.equal(
    (await exportRows(nonmember.client, { p_query: prefix })).total,
    0,
  );
  await owner.query(
    'update public.app_members set active=false where user_id=$1',
    [viewer.id],
  );
  assert.equal((await search(viewer.client, { p_query: prefix })).total, 0);
  assert.equal((await exportRows(viewer.client, { p_query: prefix })).total, 0);

  const capPrefix = prefix + ' cap-';
  await owner.query(
    `insert into public.quantity_items(name,category_id)
   select $1 || lpad(n::text,5,'0'),$2 from generate_series(1,10001) n`,
    [capPrefix, category],
  );
  await denied(
    staff.client,
    'inventory_export_snapshot',
    { p_query: capPrefix },
    'P1013',
  );
  console.log(
    `Low-stock metadata, stock state, dashboard, export snapshot, RLS, concurrency and cap passed (${checks} RPC checks).`,
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await Promise.allSettled(
      actors.map((account) => account.auth.signOut({ scope: 'local' })),
    );
    await owner.end();
  });
