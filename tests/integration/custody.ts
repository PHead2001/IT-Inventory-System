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
const owner = new Client({
  connectionString: db,
  application_name: 'custody-integration-owner',
});
const uuid = () => randomUUID();

async function mutation(
  operation: string,
  payload: Record<string, unknown>,
  requestId = uuid(),
) {
  return staff.rpc(
    operation as never,
    { p_request_id: requestId, p_payload: payload } as never,
  );
}
async function succeeds(
  operation: string,
  payload: Record<string, unknown>,
  requestId = uuid(),
) {
  const { data, error } = await mutation(operation, payload, requestId);
  assert.equal(error, null, `${operation}: ${error?.code} ${error?.message}`);
  assert.ok(data && typeof data === 'object');
  return data as Record<string, unknown>;
}
async function fails(
  operation: string,
  payload: Record<string, unknown>,
  code: string,
  requestId = uuid(),
) {
  const { error } = await mutation(operation, payload, requestId);
  assert.equal(error?.code, code, `${operation}: ${error?.message}`);
}
async function connection(actor: string) {
  const client = new Client({
    connectionString: db,
    application_name: 'custody-race-' + uuid(),
  });
  await client.connect();
  await client.query('begin');
  await client.query('set local role authenticated');
  await client.query('select set_config($1,$2,true)', [
    'request.jwt.claims',
    JSON.stringify({ sub: actor, role: 'authenticated' }),
  ]);
  return client;
}
async function blockedBy(pid: number, blockerPid: number) {
  const deadline = Date.now() + 1500;
  while (Date.now() < deadline) {
    const { rows } = await owner.query(
      'select pg_blocking_pids($1) as blockers',
      [pid],
    );
    if ((rows[0].blockers as number[]).includes(blockerPid)) return;
    await delay(25);
  }
  assert.fail(`expected backend ${pid} to wait for ${blockerPid}`);
}

async function main() {
  await owner.connect();
  // Topology triggers execute with the direct administrative invoker. The
  // narrowly granted private placement helper must work for service_role,
  // while ordinary authenticated writers remain denied by table grants.
  const service = new Client({
    connectionString: db,
    application_name: 'custody-service-topology',
  });
  await service.connect();
  try {
    await service.query('begin');
    await service.query('set local role service_role');
    const code =
      'TEST-SERVICE-' + uuid().replaceAll('-', '').slice(0, 12).toUpperCase();
    const inserted = await service.query(
      `insert into public.locations(code,name,parent_id,kind,can_hold_inventory)
       select $1,'Fictional direct admin location',id,'storage_area',false
       from public.locations where code='ITO' returning id`,
      [code],
    );
    assert.equal(
      inserted.rows.length,
      1,
      'service role INSERT passes topology guard',
    );
    await service.query('update public.locations set name=$2 where id=$1', [
      inserted.rows[0].id,
      'Fictional renamed direct admin location',
    ]);
    const renamed = await service.query(
      'select name from public.locations where id=$1',
      [inserted.rows[0].id],
    );
    assert.equal(
      renamed.rows[0].name,
      'Fictional renamed direct admin location',
    );
  } finally {
    await service.query('rollback');
    await service.end();
  }
  const email = `${uuid()}@example.test`;
  const created = await admin.auth.admin.createUser({
    email,
    password: authFixture.password,
    email_confirm: true,
  });
  if (created.error) throw created.error;
  const actor = created.data.user.id;
  await owner.query(
    'insert into public.app_members(user_id,display_name,role,active,can_manage_configuration) values($1,$2,$3,true,true)',
    [actor, 'Fictional custody integration', 'staff'],
  );
  const signed = await staff.auth.signInWithPassword({
    email,
    password: authFixture.password,
  });
  if (signed.error) throw signed.error;

  const site = await succeeds('site_create', {
    code: 'SITE-' + uuid().replaceAll('-', '').slice(0, 14).toUpperCase(),
    name: 'Fictional race site',
  });
  const secondSite = await succeeds('site_create', {
    code: 'SITE-' + uuid().replaceAll('-', '').slice(0, 14).toUpperCase(),
    name: 'Fictional empty site',
  });
  const otherSite = await succeeds('site_create', {
    code: 'SITE-' + uuid().replaceAll('-', '').slice(0, 14).toUpperCase(),
    name: 'Fictional transfer site',
  });
  const office = await owner.query(
    "select id from public.locations where code='ITO-GENERAL'",
  );
  const category = await owner.query(
    "select id,published_form_revision_id from public.categories where code='CABLES'",
  );
  const item = await succeeds('quantity_create_v2', {
    name: 'Fictional custody race stock ' + uuid().slice(0, 8),
    category_id: category.rows[0].id,
    expected_published_revision_id: category.rows[0].published_form_revision_id,
    custom_patch: {},
    initial_location_id: office.rows[0].id,
    initial_quantity: 10,
  });
  const payload = {
    action: 'issue',
    item_id: item.entity_id,
    expected_version: '1',
    source_location_id: office.rows[0].id,
    destination_site_id: site.entity_id,
    quantity: 7,
  };
  const requestId = uuid();
  const first = await succeeds('quantity_site_change', payload, requestId);
  const replay = await succeeds('quantity_site_change', payload, requestId);
  assert.deepEqual(
    replay,
    first,
    'completed receipt returns the original result',
  );
  assert.equal(typeof first.version, 'string');
  const count = await owner.query(
    'select count(*)::integer as n from public.assignment_events where item_id=$1',
    [item.entity_id],
  );
  assert.equal(
    count.rows[0].n,
    1,
    'replay appends no duplicate assignment event',
  );
  await fails(
    'quantity_site_change',
    { ...payload, quantity: 6 },
    'P1009',
    requestId,
  );

  const quantity = await owner.query(
    'select available_quantity,assigned_quantity,recorded_quantity from public.inventory_quantity_totals where item_id=$1',
    [item.entity_id],
  );
  assert.deepEqual(quantity.rows[0], {
    available_quantity: '3',
    assigned_quantity: '7',
    recorded_quantity: '10',
  });
  await fails(
    'quantity_site_change',
    { ...payload, expected_version: '2', quantity: 4 },
    'P1006',
  );
  await fails(
    'quantity_archive_and_clear',
    {
      item_id: item.entity_id,
      expected_version: '2',
      confirm_clear_stock: true,
      reason: 'Fictional test',
    },
    'P1008',
  );

  // Inclusive reorder boundary: 10 in storage, threshold 7, issue 3,
  // return 1 and transfer 1. Transfer never changes storage availability.
  const thresholdItem = await succeeds('quantity_create_v2', {
    name: 'Fictional threshold custody ' + uuid().slice(0, 8),
    category_id: category.rows[0].id,
    expected_published_revision_id: category.rows[0].published_form_revision_id,
    custom_patch: {},
    initial_location_id: office.rows[0].id,
    initial_quantity: 10,
    reorder_threshold: 7,
  });
  const issueThree = {
    action: 'issue',
    item_id: thresholdItem.entity_id,
    expected_version: '1',
    source_location_id: office.rows[0].id,
    destination_site_id: site.entity_id,
    quantity: 3,
  };
  await succeeds('quantity_site_change', issueThree);
  const totals = async () =>
    (
      await owner.query(
        `select available_quantity,assigned_quantity,recorded_quantity,stock_state
     from public.inventory_quantity_totals where item_id=$1`,
        [thresholdItem.entity_id],
      )
    ).rows[0] as Record<string, string>;
  assert.deepEqual(await totals(), {
    available_quantity: '7',
    assigned_quantity: '3',
    recorded_quantity: '10',
    stock_state: 'needs_restocking',
  });

  const overflowItem = await succeeds('quantity_create_v2', {
    name: 'Fictional overflow custody ' + uuid().slice(0, 8),
    category_id: category.rows[0].id,
    expected_published_revision_id: category.rows[0].published_form_revision_id,
    custom_patch: {},
    initial_location_id: office.rows[0].id,
    initial_quantity: 1,
  });
  await succeeds('quantity_site_change', {
    action: 'opening',
    item_id: overflowItem.entity_id,
    expected_version: '1',
    destination_site_id: site.entity_id,
    quantity: 2147483647,
    reason: 'Fictional maximum bounded opening',
  });
  const overflowSnapshotSql = `select q.version,h.quantity as assigned,b.quantity as stored,
       (select count(*)::integer from public.quantity_events e where e.item_id=q.id) as events,
       (select count(*)::integer from public.assignment_events e where e.item_id=q.id) as assignments
     from public.quantity_items q
     join public.site_quantity_holdings h on h.item_id=q.id and h.site_id=$2
     join public.stock_balances b on b.item_id=q.id and b.location_id=$3
     where q.id=$1`;
  const overflowParams = [
    overflowItem.entity_id,
    site.entity_id,
    office.rows[0].id,
  ];
  const overflowBefore = (
    await owner.query(overflowSnapshotSql, overflowParams)
  ).rows;
  await fails(
    'quantity_site_change',
    {
      action: 'issue',
      item_id: overflowItem.entity_id,
      expected_version: '2',
      source_location_id: office.rows[0].id,
      destination_site_id: site.entity_id,
      quantity: 1,
    },
    'P1006',
  );
  await fails(
    'quantity_site_change',
    {
      action: 'correct',
      item_id: overflowItem.entity_id,
      expected_version: '2',
      source_site_id: site.entity_id,
      observed_quantity: 2147483648,
      reason: 'Fictional invalid overflowing correction',
    },
    'P1006',
  );
  assert.deepEqual(
    (await owner.query(overflowSnapshotSql, overflowParams)).rows,
    overflowBefore,
    'overflow failures leave current state and both histories untouched',
  );
  await fails(
    'quantity_site_change',
    {
      action: 'return',
      item_id: thresholdItem.entity_id,
      expected_version: '2',
      source_site_id: site.entity_id,
      destination_location_id: office.rows[0].id,
      quantity: 4,
    },
    'P1006',
  );
  assert.deepEqual(
    await totals(),
    {
      available_quantity: '7',
      assigned_quantity: '3',
      recorded_quantity: '10',
      stock_state: 'needs_restocking',
    },
    'over-return preserves both current balances',
  );
  const beforeFailedEvents = (
    await owner.query(
      'select count(*)::integer as n from public.quantity_events where item_id=$1',
      [thresholdItem.entity_id],
    )
  ).rows[0].n;
  assert.equal(
    beforeFailedEvents,
    2,
    'failed over-return appended no quantity event',
  );
  await succeeds('quantity_site_change', {
    action: 'return',
    item_id: thresholdItem.entity_id,
    expected_version: '2',
    source_site_id: site.entity_id,
    destination_location_id: office.rows[0].id,
    quantity: 1,
  });
  assert.deepEqual(await totals(), {
    available_quantity: '8',
    assigned_quantity: '2',
    recorded_quantity: '10',
    stock_state: 'in_stock',
  });
  await succeeds('quantity_site_change', {
    action: 'transfer',
    item_id: thresholdItem.entity_id,
    expected_version: '3',
    source_site_id: site.entity_id,
    destination_site_id: otherSite.entity_id,
    quantity: 1,
  });
  assert.deepEqual(await totals(), {
    available_quantity: '8',
    assigned_quantity: '2',
    recorded_quantity: '10',
    stock_state: 'in_stock',
  });
  const summary = await staff.rpc(
    'site_activity_summary' as never,
    {
      p_site_id: site.entity_id,
      p_from: null,
      p_until: null,
    } as never,
  );
  assert.equal(summary.error, null);
  assert.equal(
    (summary.data as Record<string, Record<string, string>>).quantity
      .gross_issued_units,
    '10',
    'gross site issues include both distinct products without counting transfers as issues',
  );
  assert.equal(
    (summary.data as Record<string, Record<string, string>>).quantity
      .transfer_out_units,
    '1',
  );

  // Two live connections submit the *same* idempotency key while the first
  // transaction has not committed. The second waits for its receipt and gets
  // the original result, with exactly one new event and one stock decrement.
  const duplicatePayload = {
    action: 'issue',
    item_id: thresholdItem.entity_id,
    expected_version: '4',
    source_location_id: office.rows[0].id,
    destination_site_id: site.entity_id,
    quantity: 1,
  };
  const duplicateRequest = uuid();
  const initialEvents = (
    await owner.query(
      'select count(*)::integer as n from public.quantity_events where item_id=$1',
      [thresholdItem.entity_id],
    )
  ).rows[0].n as number;
  const receiptFirst = await connection(actor);
  const receiptSecond = await connection(actor);
  try {
    const firstPid = (
      await receiptFirst.query('select pg_backend_pid() as pid')
    ).rows[0].pid as number;
    const secondPid = (
      await receiptSecond.query('select pg_backend_pid() as pid')
    ).rows[0].pid as number;
    const resultOne = (
      await receiptFirst.query(
        'select public.quantity_site_change($1,$2::jsonb) as result',
        [duplicateRequest, JSON.stringify(duplicatePayload)],
      )
    ).rows[0].result;
    const pendingSecond = receiptSecond.query(
      'select public.quantity_site_change($1,$2::jsonb) as result',
      [duplicateRequest, JSON.stringify(duplicatePayload)],
    );
    await blockedBy(secondPid, firstPid);
    await receiptFirst.query('commit');
    const resultTwo = (await pendingSecond).rows[0].result;
    assert.deepEqual(
      resultTwo,
      resultOne,
      'concurrent identical retry replays first receipt',
    );
    await receiptSecond.query('commit');
  } finally {
    await Promise.allSettled([
      receiptFirst.query('rollback'),
      receiptSecond.query('rollback'),
    ]);
    await Promise.allSettled([receiptFirst.end(), receiptSecond.end()]);
  }
  assert.equal(
    (
      await owner.query(
        'select count(*)::integer as n from public.quantity_events where item_id=$1',
        [thresholdItem.entity_id],
      )
    ).rows[0].n,
    initialEvents + 1,
    'concurrent retry adds only one inventory event',
  );
  assert.deepEqual(await totals(), {
    available_quantity: '7',
    assigned_quantity: '3',
    recorded_quantity: '10',
    stock_state: 'needs_restocking',
  });

  // Two independent transactions contend for the same item. The loser sees
  // the newly committed version; no stale stock read or duplicate event.
  const one = await connection(actor);
  const two = await connection(actor);
  try {
    const onePid = (await one.query('select pg_backend_pid() as pid')).rows[0]
      .pid as number;
    const twoPid = (await two.query('select pg_backend_pid() as pid')).rows[0]
      .pid as number;
    const move = {
      action: 'return',
      item_id: item.entity_id,
      expected_version: '2',
      source_site_id: site.entity_id,
      destination_location_id: office.rows[0].id,
      quantity: 2,
    };
    await one.query('select public.quantity_site_change($1,$2::jsonb)', [
      uuid(),
      JSON.stringify(move),
    ]);
    const competing = two
      .query('select public.quantity_site_change($1,$2::jsonb)', [
        uuid(),
        JSON.stringify(move),
      ])
      .then(
        () => null,
        (error: { code?: string }) => error,
      );
    await blockedBy(twoPid, onePid);
    await one.query('commit');
    const error = await competing;
    assert.equal(
      error?.code,
      'P1002',
      'competing stale return must fail after first commits',
    );
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
    const pid = (await topology.query('select pg_backend_pid() as pid')).rows[0]
      .pid as number;
    const issuingPid = (await issuing.query('select pg_backend_pid() as pid'))
      .rows[0].pid as number;
    await topology.query('select public.site_set_active($1,$2::jsonb)', [
      uuid(),
      JSON.stringify({
        site_id: secondSite.entity_id,
        expected_version: '1',
        reason: 'Fictional property closure',
        active: false,
      }),
    ]);
    const attempt = issuing
      .query('select public.quantity_site_change($1,$2::jsonb)', [
        uuid(),
        JSON.stringify({
          action: 'issue',
          item_id: item.entity_id,
          expected_version: '3',
          source_location_id: office.rows[0].id,
          destination_site_id: secondSite.entity_id,
          quantity: 1,
        }),
      ])
      .then(
        () => null,
        (error: { code?: string }) => error,
      );
    await blockedBy(issuingPid, pid);
    await topology.query('commit');
    const error = await attempt;
    assert.equal(
      error?.code,
      'P1004',
      'assignment must observe newly inactive site',
    );
    await issuing.query('rollback');
  } finally {
    await Promise.allSettled([
      topology.query('rollback'),
      issuing.query('rollback'),
    ]);
    await Promise.allSettled([topology.end(), issuing.end()]);
  }

  const officeRoom = (
    await owner.query("select id from public.locations where code='ITO'")
  ).rows[0].id as string;
  const insertedLocation = await owner.query(
    `insert into public.locations(code,name,parent_id,kind,can_hold_inventory,active,sort_order)
     values($1,'Fictional race storage',$2,'storage_area',true,true,0) returning id`,
    [
      'TEST-PLACE-' + uuid().replaceAll('-', '').slice(0, 12).toUpperCase(),
      officeRoom,
    ],
  );
  const raceLocation = { entity_id: insertedLocation.rows[0].id as string };
  // Trusted code-managed topology fixture: ordinary clients cannot do this.
  const locationTopology = new Client({ connectionString: db });
  await locationTopology.connect();
  await locationTopology.query('begin');
  const receiving = await connection(actor);
  try {
    const topologyPid = (
      await locationTopology.query('select pg_backend_pid() as pid')
    ).rows[0].pid as number;
    const receivingPid = (
      await receiving.query('select pg_backend_pid() as pid')
    ).rows[0].pid as number;
    await locationTopology.query(
      'update public.locations set active=false,version=version+1 where id=$1',
      [raceLocation.entity_id],
    );
    const attempt = receiving
      .query('select public.quantity_receive($1,$2::jsonb)', [
        uuid(),
        JSON.stringify({
          item_id: item.entity_id,
          expected_version: 3,
          location_id: raceLocation.entity_id,
          quantity: 1,
          reason: 'Fictional concurrent placement',
        }),
      ])
      .then(
        () => null,
        (error: { code?: string }) => error,
      );
    await blockedBy(receivingPid, topologyPid);
    await locationTopology.query('commit');
    assert.equal(
      (await attempt)?.code,
      'P1004',
      'receive sees newly inactive location after placement lock wait',
    );
    await receiving.query('rollback');
  } finally {
    await Promise.allSettled([
      locationTopology.query('rollback'),
      receiving.query('rollback'),
    ]);
    await Promise.allSettled([locationTopology.end(), receiving.end()]);
  }

  // Concurrent name-only requests serialize by the existing receipt/placement
  // order; a later fresh stale request fails without changing structure/stock.
  const renameBefore = (
    await owner.query(
      'select to_jsonb(l) as state from public.locations l where id=$1',
      [raceLocation.entity_id],
    )
  ).rows[0].state as Record<string, unknown>;
  const renameCommand = {
    location_id: raceLocation.entity_id,
    expected_version: String(renameBefore.version),
    name: 'Fictional renamed storage',
  };
  const renameRequest = uuid();
  const renamer = await connection(actor);
  const duplicateRenamer = await connection(actor);
  try {
    const firstPid = (await renamer.query('select pg_backend_pid() as pid'))
      .rows[0].pid as number;
    const secondPid = (
      await duplicateRenamer.query('select pg_backend_pid() as pid')
    ).rows[0].pid as number;
    const first = await renamer.query(
      'select public.location_rename($1,$2::jsonb) as result',
      [renameRequest, JSON.stringify(renameCommand)],
    );
    const duplicate = duplicateRenamer.query(
      'select public.location_rename($1,$2::jsonb) as result',
      [renameRequest, JSON.stringify(renameCommand)],
    );
    await blockedBy(secondPid, firstPid);
    await renamer.query('commit');
    assert.deepEqual(
      (await duplicate).rows,
      first.rows,
      'concurrent duplicate rename returns one receipt',
    );
    await duplicateRenamer.query('commit');
  } finally {
    await Promise.allSettled([
      renamer.query('rollback'),
      duplicateRenamer.query('rollback'),
    ]);
    await Promise.allSettled([renamer.end(), duplicateRenamer.end()]);
  }
  await fails(
    'location_rename',
    { ...renameCommand, name: 'Fresh stale name' },
    'P1002',
  );
  const renameAfter = (
    await owner.query(
      'select to_jsonb(l) as state from public.locations l where id=$1',
      [raceLocation.entity_id],
    )
  ).rows[0].state as Record<string, unknown>;
  for (const key of ['name', 'version', 'updated_at']) {
    delete renameBefore[key];
    delete renameAfter[key];
  }
  assert.deepEqual(
    renameAfter,
    renameBefore,
    'rename preserves all structural fields and stable identity',
  );
  assert.equal(
    (
      await owner.query(
        'select count(*)::integer as n from public.location_configuration_events where location_id=$1',
        [raceLocation.entity_id],
      )
    ).rows[0].n,
    1,
    'one configuration event for duplicate rename',
  );

  // Quantity assignment wins first: the exclusive archive waits for its shared
  // placement lock and then sees committed holdings in a fresh statement.
  const quantityTarget = await succeeds('site_create', {
    code:
      'SITE-QUANTITY-' + uuid().replaceAll('-', '').slice(0, 10).toUpperCase(),
    name: 'Fictional quantity race site',
  });
  const quantityAssignment = await connection(actor);
  const quantityArchive = await connection(actor);
  try {
    const assignmentPid = (
      await quantityAssignment.query('select pg_backend_pid() as pid')
    ).rows[0].pid as number;
    const archivePid = (
      await quantityArchive.query('select pg_backend_pid() as pid')
    ).rows[0].pid as number;
    await quantityAssignment.query(
      'select public.quantity_site_change($1,$2::jsonb)',
      [
        uuid(),
        JSON.stringify({
          action: 'issue',
          item_id: item.entity_id,
          expected_version: '3',
          source_location_id: office.rows[0].id,
          destination_site_id: quantityTarget.entity_id,
          quantity: 1,
        }),
      ],
    );
    const attempt = quantityArchive
      .query('select public.site_set_active($1,$2::jsonb)', [
        uuid(),
        JSON.stringify({
          site_id: quantityTarget.entity_id,
          expected_version: '1',
          active: false,
          reason: 'Fictional quantity closure race',
        }),
      ])
      .then(
        () => null,
        (error: { code?: string }) => error,
      );
    await blockedBy(archivePid, assignmentPid);
    await quantityAssignment.query('commit');
    assert.equal(
      (await attempt)?.code,
      'P1008',
      'archive observes racing quantity holdings',
    );
    const current = await owner.query(
      'select s.active,h.quantity from public.sites s join public.site_quantity_holdings h on h.site_id=s.id where s.id=$1 and h.item_id=$2',
      [quantityTarget.entity_id, item.entity_id],
    );
    assert.equal(current.rows[0].active, true);
    assert.equal(current.rows[0].quantity, 1);
  } finally {
    await Promise.allSettled([
      quantityAssignment.query('rollback'),
      quantityArchive.query('rollback'),
    ]);
    await Promise.allSettled([quantityAssignment.end(), quantityArchive.end()]);
  }

  const assetCategory = await owner.query(
    "select id,published_form_revision_id from public.categories where code='COMPUTERS'",
  );
  const asset = await succeeds('asset_create_v2', {
    name: 'Fictional custody rollback asset ' + uuid().slice(0, 8),
    category_id: assetCategory.rows[0].id,
    expected_published_revision_id:
      assetCategory.rows[0].published_form_revision_id,
    custom_patch: {},
    location_id: office.rows[0].id,
  });
  await succeeds('asset_site_change', {
    action: 'assign',
    asset_id: asset.entity_id,
    expected_version: '1',
    source_location_id: office.rows[0].id,
    destination_site_id: site.entity_id,
  });
  const assetSnapshotSql = `select a.location_id,a.site_id,a.status,a.version,
      (select count(*)::integer from public.asset_events e where e.asset_id=a.id) as events,
      (select count(*)::integer from public.assignment_events e where e.asset_id=a.id) as assignments
    from public.serialized_assets a where a.id=$1`;
  const assetBefore = (await owner.query(assetSnapshotSql, [asset.entity_id]))
    .rows;
  const failedAssetRequest = uuid();
  await fails(
    'asset_move',
    {
      asset_id: asset.entity_id,
      expected_version: 2,
      location_id: office.rows[0].id,
      reason: 'Must not bypass custody',
    },
    'P1008',
    failedAssetRequest,
  );
  await fails(
    'asset_site_change',
    {
      action: 'write_off',
      asset_id: asset.entity_id,
      expected_version: '2',
      source_site_id: otherSite.entity_id,
      reason: 'Wrong reviewed source',
    },
    'P1002',
  );
  await fails(
    'asset_site_change',
    {
      action: 'correct',
      asset_id: asset.entity_id,
      expected_version: '2',
      source_site_id: site.entity_id,
      destination_site_id: otherSite.entity_id,
    },
    'P1012',
  );
  assert.deepEqual(
    (await owner.query(assetSnapshotSql, [asset.entity_id])).rows,
    assetBefore,
    'invalid asset operations roll back state and both histories',
  );
  assert.equal(
    (
      await owner.query(
        'select count(*)::integer as n from private.mutation_requests where actor_id=$1 and request_id=$2',
        [actor, failedAssetRequest],
      )
    ).rows[0].n,
    0,
    'failed asset operation leaves no completed receipt',
  );

  // Both orderings of serialized transfer versus site archival use independent
  // connections. A winning archive rejects transfer; a winning transfer blocks
  // archive atomically without returning/deleting the assigned equipment.
  for (const archiveFirst of [true, false]) {
    const target = await succeeds('site_create', {
      code:
        'SITE-ASSET-' + uuid().replaceAll('-', '').slice(0, 10).toUpperCase(),
      name: 'Fictional serialized race site',
    });
    const lifecycle = await connection(actor);
    const assignment = await connection(actor);
    try {
      const lifecyclePid = (
        await lifecycle.query('select pg_backend_pid() as pid')
      ).rows[0].pid as number;
      const assignmentPid = (
        await assignment.query('select pg_backend_pid() as pid')
      ).rows[0].pid as number;
      const transfer = {
        action: 'transfer',
        asset_id: asset.entity_id,
        expected_version: '2',
        source_site_id: site.entity_id,
        destination_site_id: target.entity_id,
      };
      const archive = {
        site_id: target.entity_id,
        expected_version: '1',
        active: false,
        reason: 'Fictional closure race',
      };
      if (archiveFirst) {
        await lifecycle.query('select public.site_set_active($1,$2::jsonb)', [
          uuid(),
          JSON.stringify(archive),
        ]);
        const attempt = assignment
          .query('select public.asset_site_change($1,$2::jsonb)', [
            uuid(),
            JSON.stringify(transfer),
          ])
          .then(
            () => null,
            (error: { code?: string }) => error,
          );
        await blockedBy(assignmentPid, lifecyclePid);
        await lifecycle.query('commit');
        assert.equal(
          (await attempt)?.code,
          'P1004',
          'asset transfer observes archived destination',
        );
      } else {
        await assignment.query(
          'select public.asset_site_change($1,$2::jsonb)',
          [uuid(), JSON.stringify(transfer)],
        );
        const attempt = lifecycle
          .query('select public.site_set_active($1,$2::jsonb)', [
            uuid(),
            JSON.stringify(archive),
          ])
          .then(
            () => null,
            (error: { code?: string }) => error,
          );
        await blockedBy(lifecyclePid, assignmentPid);
        await assignment.query('commit');
        assert.equal(
          (await attempt)?.code,
          'P1008',
          'archive observes racing active assigned asset',
        );
        const current = await owner.query(
          'select s.active,a.site_id from public.sites s join public.serialized_assets a on a.site_id=s.id where s.id=$1 and a.id=$2',
          [target.entity_id, asset.entity_id],
        );
        assert.equal(
          current.rows[0].active,
          true,
          'rejected archive leaves assignment and active site intact',
        );
      }
    } finally {
      await Promise.allSettled([
        lifecycle.query('rollback'),
        assignment.query('rollback'),
      ]);
      await Promise.allSettled([lifecycle.end(), assignment.end()]);
    }
  }

  const isolation = new Client({ connectionString: db });
  await isolation.connect();
  try {
    await isolation.query('begin isolation level repeatable read');
    await isolation.query('set local role authenticated');
    await isolation.query('select set_config($1,$2,true)', [
      'request.jwt.claims',
      JSON.stringify({ sub: actor, role: 'authenticated' }),
    ]);
    await assert.rejects(
      isolation.query('select public.quantity_site_change($1,$2::jsonb)', [
        uuid(),
        JSON.stringify({ ...payload, expected_version: '3', quantity: 1 }),
      ]),
      { code: 'P1016' },
    );
  } finally {
    await isolation.query('rollback');
    await isolation.end();
  }

  await owner.query(
    'update public.app_members set active=false where user_id=$1',
    [actor],
  );
  await fails('quantity_site_change', payload, 'P1001', requestId);
  await owner.query(
    'update public.app_members set active=true where user_id=$1',
    [actor],
  );
  console.log(
    'Custody receipt, accounting, rollback, independent-connection races, topology barrier and isolation passed.',
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await staff.auth.signOut({ scope: 'local' });
    await owner.end();
  });
