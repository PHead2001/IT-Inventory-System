import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
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
const owner = new Client({
  connectionString: db,
  application_name: 'configuration-integration',
});
type Actor = { id: string; client: SupabaseClient };
const actors: Actor[] = [];
const prefix = 'Configuration-' + randomUUID();
const uuid = () => randomUUID();

async function actor(
  role: 'staff' | 'viewer',
  active: boolean,
  config: boolean,
): Promise<Actor> {
  const email = `${uuid()}@example.test`;
  const created = await admin.auth.admin.createUser({
    email,
    password: authFixture.password,
    email_confirm: true,
  });
  if (created.error) throw created.error;
  const id = created.data.user.id;
  await owner.query(
    'insert into public.app_members(user_id,display_name,role,active,can_manage_configuration) values($1,$2,$3,$4,$5)',
    [id, prefix + role, role, active, config],
  );
  const client = createClient(api, process.env.LOCAL_ANON_KEY!, options);
  const signed = await client.auth.signInWithPassword({
    email,
    password: authFixture.password,
  });
  if (signed.error) throw signed.error;
  const result = { id, client };
  actors.push(result);
  return result;
}
async function rpc(
  client: SupabaseClient,
  operation: string,
  payload: Record<string, unknown>,
  requestId = uuid(),
) {
  return client.rpc(
    operation as never,
    { p_request_id: requestId, p_payload: payload } as never,
  );
}
async function success(
  client: SupabaseClient,
  operation: string,
  payload: Record<string, unknown>,
  requestId = uuid(),
) {
  const { data, error } = await rpc(client, operation, payload, requestId);
  assert.equal(error, null, `${operation}: ${error?.code} ${error?.message}`);
  return data as Record<string, unknown>;
}
async function failure(
  client: SupabaseClient,
  operation: string,
  payload: Record<string, unknown>,
  code: string,
  requestId = uuid(),
) {
  const { error } = await rpc(client, operation, payload, requestId);
  assert.equal(error?.code, code, `${operation}: ${error?.message}`);
}
async function newCategory(client: SupabaseClient, name: string) {
  const code = 'CFG-' + uuid().replaceAll('-', '').slice(0, 16).toUpperCase();
  const result = await success(client, 'category_create', {
    code,
    name,
    sort_order: 100,
  });
  assert.equal(result.version, '1');
  return { id: result.category_id as string, code, name };
}
async function review(
  client: SupabaseClient,
  source: string,
  target: string | null,
) {
  const { data, error } = await client.rpc(
    'category_removal_review' as never,
    { p_category_id: source, p_replacement_id: target } as never,
  );
  assert.equal(error, null, error?.message);
  return data as {
    token: string;
    quantity_count: string;
    asset_count: string;
    source_version: string;
    expires_at: string;
  };
}
async function count(query: string, params: unknown[]) {
  const result = await owner.query(query, params);
  return Number(result.rows[0].count);
}
async function waitForBlockedRpc(blockerPid: number, operations: string[]) {
  const deadline = Date.now() + 1500;
  while (Date.now() < deadline) {
    const { rows } = await owner.query(
      `select query from pg_stat_activity
       where $1=any(pg_blocking_pids(pid)) and state='active'`,
      [blockerPid],
    );
    if (
      operations.every((operation) =>
        rows.some((row) => String(row.query).includes(operation)),
      )
    )
      return;
    await delay(25);
  }
  throw new Error(
    `RPCs were not visibly blocked by the independent writer: ${operations.join(', ')}`,
  );
}

async function main() {
  await owner.connect();
  const maintainer = await actor('staff', true, true);
  const staff = await actor('staff', true, false);
  const viewer = await actor('viewer', true, false);
  const inactive = await actor('staff', false, true);
  const viewerUser = await admin.auth.admin.createUser({
    email: `${uuid()}@example.test`,
    password: authFixture.password,
    email_confirm: true,
  });
  assert.equal(viewerUser.error, null);
  await assert.rejects(
    owner.query(
      "insert into public.app_members(user_id,display_name,role,can_manage_configuration) values($1,'Invalid','viewer',true)",
      [viewerUser.data.user.id],
    ),
    (error: { code?: string }) => error.code === '23514',
  );
  const location = (
    await owner.query("select id from public.locations where code='ITC-D01'")
  ).rows[0].id as string;
  const defaults = await maintainer.client
    .from('configuration_label_defaults')
    .select('*')
    .single();
  assert.equal(defaults.error, null);
  assert.equal((defaults.data as { version: string }).version, '1');
  for (const forbidden of [staff, viewer, inactive]) {
    await failure(
      forbidden.client,
      'category_create',
      { code: 'DENIED', name: 'Denied' },
      'P1001',
    );
    assert.equal(
      (
        await forbidden.client.rpc(
          'category_removal_review' as never,
          { p_category_id: uuid() } as never,
        )
      ).error?.code,
      'P1001',
    );
  }
  assert.equal(
    (await viewer.client.from('configuration_categories').select('*')).error,
    null,
  );
  assert.equal(
    (await inactive.client.from('configuration_categories').select('*')).data
      ?.length,
    0,
  );
  assert.equal(
    (
      await viewer.client
        .from('categories')
        .insert({ code: 'SELF-GRANT', name: 'Denied' })
    ).error?.code,
    '42501',
  );
  assert.equal(
    (
      await staff.client
        .from('app_members')
        .update({ role: 'staff' })
        .eq('user_id', staff.id)
    ).error?.code,
    '42501',
  );
  assert.equal(
    (
      await staff.client
        .from('app_members')
        .update({ can_manage_configuration: true } as never)
        .eq('user_id', staff.id)
    ).error?.code,
    '42501',
  );
  assert.equal(
    (
      await viewer.client
        .from('configuration_events' as never)
        .insert({ kind: 'category_created' } as never)
    ).error?.code,
    '42501',
  );
  assert.equal(
    (
      await createClient(api, process.env.LOCAL_ANON_KEY!, options).rpc(
        'category_create' as never,
        { p_request_id: uuid(), p_payload: {} } as never,
      )
    ).error?.code,
    '42501',
  );

  const source = await newCategory(maintainer.client, prefix + ' Source');
  const target = await newCategory(maintainer.client, prefix + ' Target');
  const stateBeforeInvalid = await count(
    'select count(*) from private.mutation_requests where actor_id=$1',
    [maintainer.id],
  );
  const eventBeforeInvalid = await count(
    'select count(*) from public.configuration_events where actor_id=$1',
    [maintainer.id],
  );
  for (const expected of [undefined, null]) {
    await failure(
      maintainer.client,
      'category_rename',
      {
        category_id: target.id,
        ...(expected === undefined ? {} : { expected_version: expected }),
        name: prefix + ' Invalid',
      },
      'P1012',
    );
    await failure(
      maintainer.client,
      'label_defaults_update',
      {
        ...(expected === undefined ? {} : { expected_version: expected }),
        size: '90x50',
        page: 'letter',
        format: 'qr',
      },
      'P1012',
    );
  }
  await failure(
    maintainer.client,
    'category_remove',
    { category_id: target.id, replacement_id: null },
    'P1012',
  );
  await failure(
    maintainer.client,
    'category_remove',
    { category_id: target.id, replacement_id: null, review_token: null },
    'P1012',
  );
  assert.equal(
    await count(
      'select count(*) from private.mutation_requests where actor_id=$1',
      [maintainer.id],
    ),
    stateBeforeInvalid,
  );
  assert.equal(
    await count(
      'select count(*) from public.configuration_events where actor_id=$1',
      [maintainer.id],
    ),
    eventBeforeInvalid,
  );
  assert.equal(
    (
      await owner.query('select version from public.categories where id=$1', [
        target.id,
      ])
    ).rows[0].version,
    '1',
  );
  const expired = await review(maintainer.client, source.id, target.id);
  await owner.query(
    "update private.category_impact_reviews set expires_at=clock_timestamp()-interval '1 second' where token=$1",
    [expired.token],
  );
  await failure(
    maintainer.client,
    'category_remove',
    {
      category_id: source.id,
      replacement_id: target.id,
      review_token: expired.token,
    },
    'P1017',
  );
  const renamed = await success(maintainer.client, 'category_rename', {
    category_id: target.id,
    expected_version: '1',
    name: prefix + ' Destination',
  });
  assert.equal(renamed.version, '2');
  const repeatedId = uuid();
  const same = await success(
    maintainer.client,
    'category_rename',
    { category_id: target.id, expected_version: '2', name: prefix + ' Final' },
    repeatedId,
  );
  assert.deepEqual(
    await success(
      maintainer.client,
      'category_rename',
      { category_id: target.id, expected_version: 2, name: prefix + ' Final' },
      repeatedId,
    ),
    same,
  );
  assert.equal(
    (
      await rpc(
        maintainer.client,
        'category_rename',
        { category_id: target.id, expected_version: '2', name: 'Changed' },
        repeatedId,
      )
    ).error?.code,
    'P1009',
  );

  const item = await success(staff.client, 'quantity_create', {
    name: prefix + ' quantity',
    category_id: source.id,
    initial_quantity: 4,
    initial_location_id: location,
  });
  const archived = await success(staff.client, 'quantity_create', {
    name: prefix + ' archived',
    category_id: source.id,
    initial_quantity: 0,
    initial_location_id: null,
  });
  await success(staff.client, 'quantity_archive', {
    item_id: archived.entity_id,
    expected_version: archived.version,
    reason: 'Category integration test',
  });
  const asset = await success(staff.client, 'asset_create', {
    name: prefix + ' asset',
    category_id: source.id,
    location_id: location,
  });
  await success(staff.client, 'asset_retire', {
    asset_id: asset.entity_id,
    expected_version: asset.version,
    reason: 'Category integration test',
  });
  const impact = await review(maintainer.client, source.id, target.id);
  assert.equal(impact.quantity_count, '2');
  assert.equal(impact.asset_count, '1');
  await failure(
    maintainer.client,
    'category_remove',
    {
      category_id: source.id,
      replacement_id: null,
      review_token: impact.token,
    },
    'P1017',
  );
  const removed = await success(maintainer.client, 'category_remove', {
    category_id: source.id,
    replacement_id: target.id,
    review_token: impact.token,
  });
  assert.equal(removed.quantity_count, '2');
  assert.equal(removed.asset_count, '1');
  assert.equal(
    await count(
      'select count(*) from public.quantity_items where category_id=$1',
      [source.id],
    ),
    0,
  );
  assert.equal(
    await count(
      'select count(*) from public.serialized_assets where category_id=$1',
      [source.id],
    ),
    0,
  );
  assert.equal(
    (
      await owner.query(
        'select removed_at is not null as removed,active from public.categories where id=$1',
        [source.id],
      )
    ).rows[0].removed,
    true,
  );
  assert.equal(
    await count(
      'select count(*) from public.stock_balances where item_id=$1 and quantity=4',
      [item.entity_id],
    ),
    1,
  );
  assert.equal(
    await count(
      "select count(*) from public.quantity_event_lines l join public.quantity_events e on e.id=l.event_id where e.item_id=$1 and e.kind='metadata_updated'",
      [item.entity_id],
    ),
    0,
  );
  const exported = await viewer.client.rpc('inventory_export_snapshot', {
    p_query: prefix,
    p_status: 'all',
  });
  assert.equal(exported.error, null);
  assert.ok(JSON.stringify(exported.data).includes(prefix + ' Final'));
  const historical = await viewer.client
    .from('categories')
    .select('id,name,removed_at')
    .eq('id', source.id)
    .single();
  assert.equal(historical.error, null);
  assert.equal(historical.data?.name, source.name);

  const empty = await newCategory(maintainer.client, prefix + ' Empty');
  const emptyImpact = await review(maintainer.client, empty.id, null);
  assert.equal(
    Number(emptyImpact.quantity_count) + Number(emptyImpact.asset_count),
    0,
  );
  await success(maintainer.client, 'category_remove', {
    category_id: empty.id,
    replacement_id: null,
    review_token: emptyImpact.token,
  });
  assert.equal(
    await count('select count(*) from public.categories where id=$1', [
      empty.id,
    ]),
    0,
  );
  assert.equal(
    await count(
      "select count(*) from public.configuration_events where category_id=$1 and kind='category_removed'",
      [empty.id],
    ),
    1,
  );

  const stale = await newCategory(maintainer.client, prefix + ' Stale');
  const staleReview = await review(maintainer.client, stale.id, target.id);
  await success(staff.client, 'quantity_create', {
    name: prefix + ' New reference',
    category_id: stale.id,
    initial_quantity: 0,
    initial_location_id: null,
  });
  await failure(
    maintainer.client,
    'category_remove',
    {
      category_id: stale.id,
      replacement_id: target.id,
      review_token: staleReview.token,
    },
    'P1017',
  );
  const staleAgain = await review(maintainer.client, stale.id, target.id);
  const newRef = (
    await owner.query(
      'select id,version from public.quantity_items where category_id=$1',
      [stale.id],
    )
  ).rows[0];
  await success(staff.client, 'quantity_update', {
    item_id: newRef.id,
    expected_version: newRef.version,
    name: prefix + ' Updated',
    category_id: stale.id,
    description: null,
    manufacturer: null,
    model: null,
  });
  await failure(
    maintainer.client,
    'category_remove',
    {
      category_id: stale.id,
      replacement_id: target.id,
      review_token: staleAgain.token,
    },
    'P1017',
  );
  const targetVersionReview = await review(
    maintainer.client,
    stale.id,
    target.id,
  );
  const currentTarget = (
    await owner.query('select version from public.categories where id=$1', [
      target.id,
    ])
  ).rows[0].version as string;
  await success(maintainer.client, 'category_rename', {
    category_id: target.id,
    expected_version: currentTarget,
    name: prefix + ' Later target',
  });
  await failure(
    maintainer.client,
    'category_remove',
    {
      category_id: stale.id,
      replacement_id: target.id,
      review_token: targetVersionReview.token,
    },
    'P1017',
  );

  const firstCategory = await newCategory(maintainer.client, prefix + ' First');
  const middleCategory = await newCategory(
    maintainer.client,
    prefix + ' Middle',
  );
  const lastCategory = await newCategory(maintainer.client, prefix + ' Last');
  const switchingItem = await success(staff.client, 'quantity_create', {
    name: prefix + ' Switching item',
    category_id: firstCategory.id,
    initial_quantity: 0,
    initial_location_id: null,
  });
  const switchingAsset = await success(staff.client, 'asset_create', {
    name: prefix + ' Switching asset',
    category_id: firstCategory.id,
    location_id: location,
  });
  const writer = new Client({
    connectionString: db,
    application_name: 'configuration-metadata-interleave',
  });
  await writer.connect();
  try {
    await writer.query('begin');
    const writerPid = (await writer.query('select pg_backend_pid() as pid'))
      .rows[0].pid as number;
    await writer.query('set local role authenticated');
    await writer.query("select set_config('request.jwt.claims',$1,true)", [
      JSON.stringify({ sub: staff.id, role: 'authenticated' }),
    ]);
    await writer.query('select public.quantity_update($1,$2::jsonb)', [
      uuid(),
      JSON.stringify({
        item_id: switchingItem.entity_id,
        expected_version: 1,
        name: prefix + ' Switching item',
        description: null,
        category_id: middleCategory.id,
        manufacturer: null,
        model: null,
      }),
    ]);
    await writer.query('select public.asset_update($1,$2::jsonb)', [
      uuid(),
      JSON.stringify({
        asset_id: switchingAsset.entity_id,
        expected_version: 1,
        name: prefix + ' Switching asset',
        description: null,
        category_id: middleCategory.id,
        manufacturer: null,
        model: null,
        asset_tag: null,
        serial_number: null,
      }),
    ]);
    const itemUpdate = rpc(staff.client, 'quantity_update', {
      item_id: switchingItem.entity_id,
      expected_version: 2,
      name: prefix + ' Switching item',
      description: null,
      category_id: lastCategory.id,
      manufacturer: null,
      model: null,
    });
    const assetUpdate = rpc(staff.client, 'asset_update', {
      asset_id: switchingAsset.entity_id,
      expected_version: 2,
      name: prefix + ' Switching asset',
      description: null,
      category_id: lastCategory.id,
      manufacturer: null,
      model: null,
      asset_tag: null,
      serial_number: null,
    });
    await waitForBlockedRpc(writerPid, ['quantity_update', 'asset_update']);
    await writer.query('commit');
    assert.equal((await itemUpdate).error, null);
    assert.equal((await assetUpdate).error, null);
    const itemEvent = (
      await owner.query(
        'select before_metadata from public.quantity_events where item_id=$1 and version=3',
        [switchingItem.entity_id],
      )
    ).rows[0].before_metadata;
    const assetEvent = (
      await owner.query(
        'select before_metadata from public.asset_events where asset_id=$1 and version=3',
        [switchingAsset.entity_id],
      )
    ).rows[0].before_metadata;
    assert.equal(itemEvent.category_id, middleCategory.id);
    assert.equal(itemEvent.category_name, middleCategory.name);
    assert.equal(assetEvent.category_id, middleCategory.id);
    assert.equal(assetEvent.category_name, middleCategory.name);
  } finally {
    await writer.query('rollback').catch(() => undefined);
    await writer.end();
  }

  const rollback = await newCategory(maintainer.client, prefix + ' Rollback');
  const a = await success(staff.client, 'quantity_create', {
    name: prefix + ' A',
    category_id: rollback.id,
    initial_quantity: 0,
    initial_location_id: null,
  });
  const b = await success(staff.client, 'quantity_create', {
    name: prefix + ' B',
    category_id: rollback.id,
    initial_quantity: 0,
    initial_location_id: null,
  });
  const later = [a.entity_id as string, b.entity_id as string].sort()[1];
  await owner.query(
    'update public.quantity_items set version=2147483647 where id=$1',
    [later],
  );
  const before = await review(maintainer.client, rollback.id, target.id);
  await failure(
    maintainer.client,
    'category_remove',
    {
      category_id: rollback.id,
      replacement_id: target.id,
      review_token: before.token,
    },
    'P1008',
  );
  assert.equal(
    await count(
      'select count(*) from public.quantity_items where category_id=$1',
      [rollback.id],
    ),
    2,
  );
  assert.equal(
    await count(
      "select count(*) from public.quantity_events where item_id=any($1::uuid[]) and kind='metadata_updated'",
      [[a.entity_id, b.entity_id]],
    ),
    0,
  );

  const race = await newCategory(maintainer.client, prefix + ' Race');
  const raceReview = await review(maintainer.client, race.id, target.id);
  const independent = new Client({
    connectionString: db,
    application_name: 'configuration-create-race',
  });
  await independent.connect();
  try {
    await independent.query('begin');
    const independentPid = (
      await independent.query('select pg_backend_pid() as pid')
    ).rows[0].pid as number;
    await independent.query('set local role authenticated');
    await independent.query("select set_config('request.jwt.claims',$1,true)", [
      JSON.stringify({ sub: staff.id, role: 'authenticated' }),
    ]);
    await independent.query('select public.quantity_create($1,$2::jsonb)', [
      uuid(),
      JSON.stringify({
        name: prefix + ' Racing insertion',
        category_id: race.id,
        initial_quantity: 0,
        initial_location_id: null,
      }),
    ]);
    const competing = rpc(maintainer.client, 'category_remove', {
      category_id: race.id,
      replacement_id: target.id,
      review_token: raceReview.token,
    });
    await waitForBlockedRpc(independentPid, ['category_remove']);
    await independent.query('commit');
    assert.equal((await competing).error?.code, 'P1017');
  } finally {
    await independent.query('rollback').catch(() => undefined);
    await independent.end();
  }

  const originalDefaults = defaults.data as {
    size: string;
    page: string;
    format: string;
    version: string;
  };
  const defaultsRequest = uuid();
  const changes = {
    expected_version: originalDefaults.version,
    size: '70x35',
    page: 'A4',
    format: 'code128',
  };
  const changed = await success(
    maintainer.client,
    'label_defaults_update',
    changes,
    defaultsRequest,
  );
  assert.equal(changed.version, '2');
  assert.deepEqual(
    await success(
      maintainer.client,
      'label_defaults_update',
      { ...changes, expected_version: 1 },
      defaultsRequest,
    ),
    changed,
  );
  await failure(
    staff.client,
    'label_defaults_update',
    { expected_version: '2', size: '90x50', page: 'letter', format: 'qr' },
    'P1001',
  );
  assert.equal(
    (
      await viewer.client
        .from('configuration_label_defaults')
        .select('size,page,format')
        .single()
    ).data?.size,
    '70x35',
  );
  await success(maintainer.client, 'label_defaults_update', {
    expected_version: '2',
    size: originalDefaults.size,
    page: originalDefaults.page,
    format: originalDefaults.format,
  });

  const isolation = await newCategory(maintainer.client, prefix + ' Isolation');
  const receiptId = uuid();
  const receiptPayload = {
    category_id: isolation.id,
    expected_version: '1',
    name: prefix + ' Isolation renamed',
  };
  const receiptResult = await success(
    maintainer.client,
    'category_rename',
    receiptPayload,
    receiptId,
  );
  const transaction = new Client({
    connectionString: db,
    application_name: 'configuration-isolation',
  });
  await transaction.connect();
  try {
    await transaction.query('begin isolation level repeatable read');
    await transaction.query('set local role authenticated');
    await transaction.query("select set_config('request.jwt.claims',$1,true)", [
      JSON.stringify({ sub: maintainer.id, role: 'authenticated' }),
    ]);
    const replay = await transaction.query(
      'select public.category_rename($1,$2::jsonb) as value',
      [receiptId, JSON.stringify(receiptPayload)],
    );
    assert.deepEqual(replay.rows[0].value, receiptResult);
    await assert.rejects(
      transaction.query('select public.category_create($1,$2::jsonb)', [
        uuid(),
        JSON.stringify({
          code: 'ISO-' + uuid().replaceAll('-', '').slice(0, 16).toUpperCase(),
          name: 'Isolation',
          sort_order: 0,
        }),
      ]),
      (error: { code?: string }) => error.code === 'P1016',
    );
  } finally {
    await transaction.query('rollback');
    await transaction.end();
  }
  const blocker = new Client({
    connectionString: db,
    application_name: 'configuration-lock-budget',
  });
  await blocker.connect();
  try {
    await blocker.query('begin');
    await blocker.query('select pg_advisory_xact_lock(91081,5)');
    const started = Date.now();
    const blocked = await maintainer.client.rpc('category_removal_review', {
      p_category_id: isolation.id,
      p_replacement_id: target.id,
    });
    assert.equal(
      blocked.error?.code,
      '55P03',
      'catalog lock wait stops after the two-second budget',
    );
    assert.ok(
      Date.now() - started < 5000,
      'lock timeout precedes the execution budget',
    );
  } finally {
    await blocker.query('rollback');
    await blocker.end();
  }
  // This test-only RPC proves the Data API hoists function timeout before the main statement.
  await owner.query(
    "create function public.configuration_timeout_probe() returns text language plpgsql volatile set search_path='' set statement_timeout='100ms' as $$ begin perform pg_catalog.pg_sleep(1); return 'late'; end $$",
  );
  try {
    await owner.query(
      'revoke all on function public.configuration_timeout_probe() from public,anon,authenticated',
    );
    await owner.query(
      'grant execute on function public.configuration_timeout_probe() to authenticated',
    );
    await owner.query("notify pgrst, 'reload schema'");
    let probe: { error: { code?: string } | null } | null = null;
    for (let attempt = 0; attempt < 12; attempt++) {
      probe = await maintainer.client.rpc(
        'configuration_timeout_probe' as never,
      );
      if (probe.error?.code !== 'PGRST202') break;
      await delay(250);
    }
    assert.equal(
      probe?.error?.code,
      '57014',
      'Data API must apply the 100 ms function budget before pg_sleep',
    );
  } finally {
    await owner.query('drop function public.configuration_timeout_probe()');
    await owner.query("notify pgrst, 'reload schema'");
  }
  await owner.query(
    'update public.app_members set active=false where user_id=$1',
    [maintainer.id],
  );
  await failure(
    maintainer.client,
    'category_rename',
    receiptPayload,
    'P1001',
    receiptId,
  );
  await owner.query(
    'update public.app_members set active=true where user_id=$1',
    [maintainer.id],
  );
  console.log(
    'Configuration authorization, lifecycle, impact, rollback, receipt, isolation and race checks passed.',
  );
}
main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await Promise.allSettled(
      actors.map((entry) => entry.client.auth.signOut({ scope: 'local' })),
    );
    await owner.end();
  });
