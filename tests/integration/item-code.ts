import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
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
const api = local(process.env.LOCAL_API_URL, 45321);
const database = local(process.env.LOCAL_DB_URL, 45322);
assert.ok(process.env.LOCAL_ANON_KEY && process.env.LOCAL_SERVICE_ROLE_KEY);
const options = { auth: { persistSession: false, autoRefreshToken: false } };
const admin = createClient(api, process.env.LOCAL_SERVICE_ROLE_KEY, options);
const owner = new Client({
  connectionString: database,
  application_name: 'item-code-integration',
});
const clients: SupabaseClient[] = [];
const uid = randomUUID;
const code = (suffix: string) => `000${uid().slice(0, 8)}-${suffix}`;

async function actor(role: 'staff' | 'viewer') {
  const email = `${uid()}@example.test`;
  const created = await admin.auth.admin.createUser({
    email,
    password: authFixture.password,
    email_confirm: true,
  });
  if (created.error) throw created.error;
  await owner.query(
    'insert into public.app_members(user_id,display_name,role,active,can_manage_configuration) values($1,$2,$3,true,$4)',
    [created.data.user.id, 'Fictional item-code test', role, role === 'staff'],
  );
  const client = createClient(api, process.env.LOCAL_ANON_KEY!, options);
  const signed = await client.auth.signInWithPassword({
    email,
    password: authFixture.password,
  });
  if (signed.error) throw signed.error;
  clients.push(client);
  return client;
}
async function call(
  client: SupabaseClient,
  operation: string,
  payload: Record<string, unknown>,
  requestId = uid(),
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
  requestId = uid(),
) {
  const { data, error } = await call(client, operation, payload, requestId);
  assert.equal(error, null, `${operation}: ${error?.code} ${error?.message}`);
  return data as {
    entity_id: string;
    version: string | number;
    event_id: string;
  };
}
async function fail(
  client: SupabaseClient,
  operation: string,
  payload: Record<string, unknown>,
  errorCode: string,
) {
  const { error } = await call(client, operation, payload);
  assert.equal(error?.code, errorCode, `${operation}: ${error?.message}`);
}
async function main() {
  await owner.connect();
  const staff = await actor('staff');
  const staffTwo = await actor('staff');
  const viewer = await actor('viewer');
  const category = (
    await owner.query(
      "select id,published_form_revision_id from public.categories where code='CABLES'",
    )
  ).rows[0] as { id: string; published_form_revision_id: string };
  const create = (name: string, itemCode?: string | null) => ({
    name,
    category_id: category.id,
    expected_published_revision_id: category.published_form_revision_id,
    custom_patch: {},
    initial_quantity: 0,
    ...(itemCode === undefined ? {} : { item_code: itemCode }),
  });
  const display = code('A/B');
  const item = await success(
    staff,
    'quantity_create_v2',
    create('Fictional item-code stock', `  ${display}  `),
  );
  const row = (
    await owner.query(
      'select item_code,item_code_key,version from public.quantity_items where id=$1',
      [item.entity_id],
    )
  ).rows[0];
  assert.equal(row.item_code, display);
  assert.equal(row.item_code_key, display.toLowerCase());
  assert.equal(row.version, 1);
  const omittedId = uid();
  const old = await success(
    staff,
    'quantity_create',
    {
      name: 'Fictional legacy code',
      category_id: category.id,
      initial_quantity: 0,
    },
    omittedId,
  );
  const oldReceipt = (
    await owner.query(
      'select request_payload from private.mutation_requests where request_id=$1',
      [omittedId],
    )
  ).rows[0].request_payload;
  assert.equal(
    Object.hasOwn(oldReceipt, 'item_code'),
    false,
    'omitted legacy receipts retain historical normalized shape',
  );
  assert.deepEqual(
    await success(
      staff,
      'quantity_create',
      {
        name: 'Fictional legacy code',
        category_id: category.id,
        initial_quantity: 0,
      },
      omittedId,
    ),
    old,
  );
  const withCode = {
    item_id: old.entity_id,
    expected_version: 1,
    name: 'Fictional legacy code',
    category_id: category.id,
    item_code: code('LEGACY'),
  };
  const updated = await success(staff, 'quantity_update', withCode);
  const omittedUpdateId = uid();
  const omittedUpdate = {
    ...withCode,
    expected_version: updated.version,
    name: 'Fictional renamed legacy code',
  };
  delete (omittedUpdate as Partial<typeof omittedUpdate>).item_code;
  await success(staff, 'quantity_update', omittedUpdate, omittedUpdateId);
  assert.equal(
    (
      await owner.query(
        'select item_code from public.quantity_items where id=$1',
        [old.entity_id],
      )
    ).rows[0].item_code,
    withCode.item_code,
  );
  assert.equal(
    Object.hasOwn(
      (
        await owner.query(
          'select request_payload from private.mutation_requests where request_id=$1',
          [omittedUpdateId],
        )
      ).rows[0].request_payload,
      'item_code',
    ),
    false,
  );
  const clear = await success(staff, 'quantity_update', {
    ...omittedUpdate,
    expected_version: Number(updated.version) + 1,
    item_code: null,
  });
  assert.equal(
    (
      await owner.query(
        'select item_code from public.quantity_items where id=$1',
        [old.entity_id],
      )
    ).rows[0].item_code,
    null,
  );
  assert.equal(
    (
      await owner.query(
        'select before_metadata,after_metadata from public.quantity_events where id=$1',
        [clear.event_id],
      )
    ).rows[0].before_metadata.item_code,
    withCode.item_code,
  );

  await fail(
    staff,
    'quantity_create_v2',
    create('Duplicate code', display.toLowerCase()),
    'P1007',
  );
  await success(staff, 'quantity_archive', {
    item_id: item.entity_id,
    expected_version: 1,
    reason: 'Fictional archive',
  });
  await fail(
    staff,
    'quantity_create_v2',
    create('Archived duplicate', display.toUpperCase()),
    'P1007',
  );
  const invalid = [
    'X'.repeat(101),
    `ABC${String.fromCharCode(133)}D`,
    `ABC\nD`,
  ];
  for (const value of invalid)
    await fail(
      staff,
      'quantity_create_v2',
      create('Invalid code', value),
      'P1012',
    );
  const blank = await success(
    staff,
    'quantity_create_v2',
    create('Blank code', '\u3000  \u00A0'),
  );
  assert.equal(
    (
      await owner.query(
        'select item_code from public.quantity_items where id=$1',
        [blank.entity_id],
      )
    ).rows[0].item_code,
    null,
  );

  const duplicate = code('RACE');
  const races = await Promise.all([
    call(staff, 'quantity_create_v2', create('Fictional race A', duplicate)),
    call(
      staffTwo,
      'quantity_create_v2',
      create('Fictional race B', duplicate.toLowerCase()),
    ),
  ]);
  assert.equal(
    races.filter((r) => !r.error).length,
    1,
    'unique index serializes independent concurrent creates',
  );
  assert.equal(races.filter((r) => r.error?.code === 'P1007').length, 1);
  const retryId = uid();
  const retryPayload = create('Fictional retry', code('RETRY'));
  const retries = await Promise.all([
    call(staff, 'quantity_create_v2', retryPayload, retryId),
    call(staff, 'quantity_create_v2', retryPayload, retryId),
  ]);
  assert.deepEqual(
    retries[0].data,
    retries[1].data,
    'concurrent identical request IDs replay one result',
  );
  assert.equal(retries.filter((r) => !r.error).length, 2);
  assert.equal(
    (
      await owner.query(
        'select count(*)::integer n from public.quantity_events where item_id=$1',
        [(retries[0].data as { entity_id: string }).entity_id],
      )
    ).rows[0].n,
    1,
  );

  const site = await success(staff, 'site_create', {
    code: 'SITE-' + uid().replaceAll('-', '').slice(0, 12).toUpperCase(),
    name: 'Fictional item-code site',
  });
  const openingCode = code('SITE');
  const opened = await success(staff, 'quantity_site_open', {
    name: 'Fictional opening stock',
    category_id: category.id,
    expected_published_revision_id: category.published_form_revision_id,
    custom_patch: {},
    item_code: openingCode,
    site_id: site.entity_id,
    quantity: 3,
  });
  assert.equal(
    (
      await owner.query(
        'select item_code from public.quantity_items where id=$1',
        [opened.entity_id],
      )
    ).rows[0].item_code?.endsWith('-SITE'),
    true,
  );
  assert.equal(
    (
      await owner.query(
        'select after_metadata from public.quantity_events where id=$1',
        [opened.event_id],
      )
    ).rows[0].after_metadata.item_code?.endsWith('-SITE'),
    true,
  );

  // Seed the exact pre-migration receipt JSON shapes independently of the new normalizer.
  const staffId = (await staff.auth.getUser()).data.user?.id;
  assert.ok(staffId);
  async function historicalReplay(
    operation: string,
    raw: Record<string, unknown>,
    normalized: Record<string, unknown>,
    result: unknown,
  ) {
    assert.equal(Object.hasOwn(normalized, 'item_code'), false);
    const requestId = uid();
    await owner.query(
      'insert into private.mutation_requests(actor_id,request_id,operation,request_payload,result) values($1,$2,$3,$4,$5)',
      [staffId, requestId, operation, normalized, result],
    );
    const replay = await call(staff, operation, raw, requestId);
    assert.equal(replay.error, null, replay.error?.message);
    assert.deepEqual(replay.data, result);
    const conflict = await call(
      staff,
      operation,
      { ...raw, item_code: null },
      requestId,
    );
    assert.equal(
      conflict.error?.code,
      'P1009',
      'explicit clear is distinct from historical omitted key',
    );
  }
  await historicalReplay(
    'quantity_create',
    {
      name: 'Fictional legacy code',
      category_id: category.id,
      initial_quantity: 0,
    },
    {
      name: 'Fictional legacy code',
      description: null,
      category_id: category.id,
      manufacturer: null,
      model: null,
      initial_location_id: null,
      initial_quantity: 0,
    },
    old,
  );
  const v2Omitted = create('Fictional historical v2');
  const v2Prior = await success(staff, 'quantity_create_v2', v2Omitted);
  await historicalReplay(
    'quantity_create_v2',
    v2Omitted,
    {
      name: v2Omitted.name,
      description: null,
      category_id: category.id,
      manufacturer: null,
      model: null,
      expected_published_revision_id: category.published_form_revision_id,
      custom_patch: {},
      initial_location_id: null,
      initial_quantity: 0,
    },
    v2Prior,
  );
  const siteOmitted = {
    name: 'Fictional historical site',
    category_id: category.id,
    expected_published_revision_id: category.published_form_revision_id,
    custom_patch: {},
    site_id: site.entity_id,
    quantity: 1,
  };
  const sitePrior = await success(staff, 'quantity_site_open', siteOmitted);
  await historicalReplay(
    'quantity_site_open',
    siteOmitted,
    {
      name: siteOmitted.name,
      description: null,
      category_id: category.id,
      manufacturer: null,
      model: null,
      reorder_threshold: null,
      site_id: site.entity_id,
      quantity: 1,
      expected_published_revision_id: category.published_form_revision_id,
      custom_patch: {},
      reason: null,
      reference: null,
    },
    sitePrior,
  );
  for (const operation of ['quantity_update', 'quantity_update_v2'] as const) {
    const target = await success(
      staff,
      'quantity_create_v2',
      create(`Fictional historical ${operation}`),
    );
    const raw = {
      item_id: target.entity_id,
      expected_version: 1,
      name: `Fictional historical ${operation} renamed`,
      category_id: category.id,
      ...(operation === 'quantity_update_v2'
        ? {
            expected_published_revision_id: category.published_form_revision_id,
            custom_patch: {},
          }
        : {}),
    };
    const prior = await success(staff, operation, raw);
    const laterCode = code(operation);
    const later = await success(staff, operation, {
      ...raw,
      expected_version: 2,
      item_code: laterCode,
    });
    assert.equal(Number(later.version), 3);
    const normalized: Record<string, unknown> = {
      item_id: target.entity_id,
      expected_version: 1,
      name: raw.name,
      description: null,
      category_id: category.id,
      manufacturer: null,
      model: null,
    };
    if (operation === 'quantity_update_v2')
      Object.assign(normalized, {
        expected_published_revision_id: category.published_form_revision_id,
        custom_patch: {},
        acknowledge_legacy_values: false,
      });
    await historicalReplay(operation, raw, normalized, prior);
    const current = (
      await owner.query(
        'select item_code,version from public.quantity_items where id=$1',
        [target.entity_id],
      )
    ).rows[0];
    assert.deepEqual(
      current,
      { item_code: laterCode, version: 3 },
      'historical omitted update replay cannot erase a later code',
    );
  }

  const anon = createClient(api, process.env.LOCAL_ANON_KEY!, options);
  assert.ok(
    (
      await anon.rpc(
        'inventory_item_code_lookup' as never,
        { p_code: display } as never,
      )
    ).error,
  );
  assert.ok(
    (
      await anon.rpc(
        'inventory_normalize_item_code' as never,
        { p_value: display } as never,
      )
    ).error,
  );
  const normalizedRead = await viewer.rpc(
    'inventory_normalize_item_code' as never,
    { p_value: `\u3000 ${display} \u00A0` } as never,
  );
  assert.equal(normalizedRead.error, null);
  assert.equal(normalizedRead.data, display);
  const lookup = await viewer.rpc(
    'inventory_item_code_lookup' as never,
    { p_code: `\u3000 ${display.toLowerCase()} \u00A0` } as never,
  );
  assert.equal(lookup.error, null);
  assert.equal((lookup.data as { id: string }).id, item.entity_id);
  const search = await viewer.rpc(
    'inventory_search_v3' as never,
    { p_query: display.toLowerCase(), p_status: 'all' } as never,
  );
  assert.equal(search.error, null);
  assert.ok(
    (
      search.data as { rows: { entity_id: string; item_code: string }[] }
    ).rows.some(
      (r) => r.entity_id === item.entity_id && r.item_code === display,
    ),
  );
  const labels = await viewer.rpc(
    'inventory_label_resolve' as never,
    { p_selection: [{ kind: 'quantity', key: item.entity_id }] } as never,
  );
  assert.equal(labels.error, null);
  assert.equal((labels.data as { item_code: string }[])[0].item_code, display);
  const exportResult = await viewer.rpc(
    'inventory_export_snapshot_v3' as never,
    {
      p_query: display,
      p_type: 'quantity',
      p_status: 'all',
      p_category_id: null,
      p_location_code: null,
      p_site_id: null,
      p_low_stock: false,
      p_export_type: 'inventory',
      p_include_custom: false,
    } as never,
  );
  assert.equal(exportResult.error, null, exportResult.error?.message);
  assert.equal(
    (exportResult.data as { rows: { item_code: string }[] }).rows[0].item_code,
    display,
  );
  const viewerId = (await viewer.auth.getUser()).data.user?.id;
  assert.ok(viewerId);
  await owner.query(
    'update public.app_members set active=false where user_id=$1',
    [viewerId],
  );
  const revokedLookup = await viewer.rpc(
    'inventory_item_code_lookup' as never,
    { p_code: display } as never,
  );
  assert.equal(revokedLookup.error, null);
  assert.equal(
    revokedLookup.data,
    null,
    'invoker RLS hides item codes after membership revocation',
  );
  console.log(
    'Item code normalization, legacy/v2 omission and clear, archived uniqueness, concurrent create/replay, site opening, and read projections passed.',
  );
}
main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await Promise.allSettled(
      clients.map((client) => client.auth.signOut({ scope: 'local' })),
    );
    await owner.end().catch(() => undefined);
  });
