import assert from 'node:assert/strict';
import { randomUUID as uid } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { Client } from 'pg';

// This suite is part of the canonical local database gate, via audit-three-contracts.
const target = new URL(process.env.LOCAL_DB_URL!);
assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(target.hostname));
assert.equal(target.port, '54322');
const owner = new Client({ connectionString: target.href });
const connections: Client[] = [];
const suffix = uid().replaceAll('-', '').slice(0, 12).toUpperCase();
type Receipt = {
  entity_id: string;
  version: string | number;
  event_id: string | null;
  changed: boolean;
};
async function caller(role: 'staff' | 'viewer', active = true) {
  const id = uid();
  await owner.query('insert into auth.users(id,email) values($1,$2)', [
    id,
    `${id}@audit-four.example.test`,
  ]);
  await owner.query(
    'insert into public.app_members(user_id,display_name,role,active,can_manage_configuration) values($1,$2,$3,$4,$5)',
    [id, 'Edit integrity fixture', role, active, role === 'staff'],
  );
  const db = new Client({ connectionString: target.href });
  await db.connect();
  connections.push(db);
  await db.query("select set_config('request.jwt.claims',$1,false)", [
    JSON.stringify({ sub: id, role: 'authenticated' }),
  ]);
  await db.query('set role authenticated');
  return { id, db };
}
async function rpc<T = Receipt>(
  db: Client,
  operation: string,
  payload: Record<string, unknown>,
  request = uid(),
): Promise<T> {
  assert.match(operation, /^[a-z_0-9]+$/);
  return (
    await db.query(`select public.${operation}($1::uuid,$2::jsonb) result`, [
      request,
      JSON.stringify(payload),
    ])
  ).rows[0].result;
}
async function failure(action: () => Promise<unknown>, code: string) {
  await assert.rejects(action, (error: unknown) => {
    assert.equal((error as { code: string }).code, code);
    return true;
  });
}
async function snapshot(kind: 'quantity' | 'asset', id: string) {
  const table = kind === 'quantity' ? 'quantity_items' : 'serialized_assets';
  const eventTable = kind === 'quantity' ? 'quantity_events' : 'asset_events';
  const key = kind === 'quantity' ? 'item_id' : 'asset_id';
  return (
    await owner.query(
      `select to_jsonb(t) record,(select count(*) from public.${eventTable} where ${key}=$1) events from public.${table} t where id=$1`,
      [id],
    )
  ).rows[0];
}
async function blocked(pid: number) {
  const deadline = Date.now() + 2000;
  do {
    const row = (
      await owner.query(
        'select wait_event_type from pg_stat_activity where pid=$1',
        [pid],
      )
    ).rows[0];
    if (row?.wait_event_type === 'Lock') return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  } while (Date.now() < deadline);
  assert.fail(
    'Independent metadata calls did not overlap under the inventory row lock',
  );
}
async function priorImplementationReceipt(
  actor: string,
  payload: Record<string, unknown>,
) {
  const extract = (filename: string) => {
    const sql = readFileSync(
      new URL(`../../supabase/migrations/${filename}`, import.meta.url),
      'utf8',
    );
    const definitions = Array.from(
      sql.matchAll(
        /^create or replace function public\.quantity_update\(p_request_id uuid,p_payload jsonb\) returns jsonb\r?\n[\s\S]*?^\$\$;\r?$/gm,
      ),
    );
    assert.equal(
      definitions.length,
      1,
      'Extract exactly one complete quantity_update definition',
    );
    return definitions[0][0];
  };
  const previous = extract('20260928212820_quantity_item_code.sql');
  const candidate = extract('20261009065920_audit_four_edit_integrity.sql');
  assert.notEqual(previous, candidate);
  const request = uid(),
    freshRequest = uid();
  const functionState = async () =>
    (
      await owner.query(
        "select pg_get_functiondef(oid) definition,to_jsonb(proacl) acl,proowner from pg_proc where oid='public.quantity_update(uuid,jsonb)'::regprocedure",
      )
    ).rows[0];
  const state = async () =>
    (
      await owner.query(
        `select jsonb_build_object(
    'item',(select to_jsonb(q) from public.quantity_items q where id=$1),
    'history',(select coalesce(jsonb_agg(to_jsonb(e) order by e.id),'[]'::jsonb) from public.quantity_events e where item_id=$1),
    'receipts',(select coalesce(jsonb_agg(to_jsonb(r) order by r.request_id),'[]'::jsonb) from private.mutation_requests r where actor_id=$2 and request_id=any($3::uuid[])),
    'membership',(select to_jsonb(m) from public.app_members m where user_id=$2)) result`,
        [payload.item_id, actor, [request, freshRequest]],
      )
    ).rows[0].result;
  const authorize = async () => {
    await owner.query('set local role authenticated');
    await owner.query("select set_config('request.jwt.claims',$1,true)", [
      JSON.stringify({ sub: actor, role: 'authenticated' }),
    ]);
  };
  const originalFunction = await functionState();
  const originalState = await state();
  await owner.query('begin');
  try {
    await owner.query("set local statement_timeout='5s'");
    await owner.query("set local lock_timeout='2s'");
    await owner.query("set local idle_in_transaction_session_timeout='10s'");
    // Install only the actual previous function, never migration BEGIN/COMMIT.
    // The old RPC produces its own ordinary receipt and metadata event.
    await owner.query(previous);
    await authorize();
    const oldResult = await rpc(owner, 'quantity_update', payload, request);
    assert.equal(oldResult.changed, true);
    assert.equal(oldResult.version, 2);
    assert.ok(oldResult.event_id);
    await owner.query('reset role');
    const oldState = await state();
    assert.equal(oldState.history.length, originalState.history.length + 1);
    assert.deepEqual(oldState.receipts[0].result, oldResult);
    await owner.query(candidate);
    assert.deepEqual(
      await functionState(),
      originalFunction,
      'Candidate definition and ACL match the installed migration',
    );
    await authorize();
    assert.deepEqual(
      await rpc(owner, 'quantity_update', payload, request),
      oldResult,
      'New implementation replays the exact previous implementation response, including changed=true and event',
    );
    await owner.query('reset role');
    assert.deepEqual(
      await state(),
      oldState,
      'Replay preserves complete row, history, receipt and member snapshot',
    );
    await authorize();
    const noOp = await rpc(
      owner,
      'quantity_update',
      { ...payload, expected_version: 2 },
      freshRequest,
    );
    assert.equal(noOp.changed, false);
    assert.equal(noOp.event_id, null);
    assert.equal(noOp.version, 2);
    await owner.query('reset role');
    const afterNoOp = await state();
    assert.deepEqual(afterNoOp.item, oldState.item);
    assert.deepEqual(afterNoOp.history, oldState.history);
    assert.deepEqual(
      afterNoOp.receipts.find(
        (row: { request_id: string }) => row.request_id === request,
      ),
      oldState.receipts[0],
    );
    await owner.query(
      'update public.app_members set active=false where user_id=$1',
      [actor],
    );
    await owner.query('savepoint denied_old_receipt');
    await authorize();
    await failure(
      () => rpc(owner, 'quantity_update', payload, request),
      'P1001',
    );
    await owner.query('rollback to savepoint denied_old_receipt');
    await owner.query('reset role');
    const denied = await state();
    assert.deepEqual(denied.item, afterNoOp.item);
    assert.deepEqual(denied.history, afterNoOp.history);
    assert.deepEqual(denied.receipts, afterNoOp.receipts);
  } finally {
    // Neither the old definition nor its receipt/event is globally committed.
    await owner.query('rollback');
  }
  assert.deepEqual(
    await functionState(),
    originalFunction,
    'Rollback restores definition, owner and ACL',
  );
  assert.deepEqual(
    await state(),
    originalState,
    'Rollback restores all fixture state',
  );
}
async function main() {
  await owner.connect();
  const staff = await caller('staff');
  const second = await caller('staff');
  const viewer = await caller('viewer');
  const inactive = await caller('staff', false);
  const category = await rpc<{ category_id: string }>(
    staff.db,
    'category_create',
    {
      code: `AUDIT4-${suffix}`,
      name: `Edit integrity ${suffix}`,
      sort_order: 800,
    },
  );
  const otherCategory = await rpc<{ category_id: string }>(
    staff.db,
    'category_create',
    {
      code: `AUDIT4-${suffix}-OTHER`,
      name: `Other edit integrity ${suffix}`,
      sort_order: 801,
    },
  );
  const form = (
    await staff.db.query('select public.metadata_form_get_v2($1) result', [
      category.category_id,
    ])
  ).rows[0].result;
  const location = (
    await owner.query(
      'select id from public.locations where active and can_hold_inventory order by code limit 1',
    )
  ).rows[0].id;
  const common = {
    name: 'No-op fixture',
    description: 'Details',
    category_id: category.category_id,
    manufacturer: 'Maker',
    model: 'Model',
  };
  const previousFixture = await rpc(staff.db, 'quantity_create', {
    ...common,
    initial_quantity: 0,
  });
  await priorImplementationReceipt(staff.id, {
    ...common,
    item_id: previousFixture.entity_id,
    expected_version: 1,
  });
  const fixtures: {
    kind: 'quantity' | 'asset';
    op: string;
    id: string;
    payload: Record<string, unknown>;
  }[] = [];
  for (const op of [
    'quantity_update',
    'asset_update',
    'quantity_update_v2',
    'asset_update_v2',
    'asset_update_v3',
  ]) {
    const kind = op.startsWith('quantity') ? 'quantity' : 'asset';
    const modern = op.endsWith('_v2') || op.endsWith('_v3');
    const core: Record<string, unknown> = {
      ...common,
      ...(kind === 'asset'
        ? { asset_tag: `Tag-${op}-${suffix}`, serial_number: 'Serial' }
        : { reorder_threshold: 2, item_code: `Sku-${op}-${suffix}` }),
    };
    const create = await rpc(staff.db, op.replace('update', 'create'), {
      ...core,
      ...(kind === 'asset'
        ? { location_id: location }
        : { initial_quantity: 0 }),
      ...(modern
        ? {
            expected_published_revision_id: form.published_revision_id,
            custom_patch: {},
          }
        : {}),
    });
    const payload: Record<string, unknown> = {
      ...core,
      [kind === 'quantity' ? 'item_id' : 'asset_id']: create.entity_id,
      expected_version: 1,
      ...(modern
        ? {
            expected_published_revision_id: form.published_revision_id,
            custom_patch: {},
          }
        : {}),
    };
    if (kind === 'asset' && op !== 'asset_update_v3')
      payload.asset_tag = String(core.asset_tag).toUpperCase();
    const before = await snapshot(kind, create.entity_id);
    const request = uid();
    const noOp = await rpc(
      staff.db,
      op,
      { ...payload, name: '  No-op fixture  ' },
      request,
    );
    assert.equal(noOp.changed, false, `${op} must not invent an edit`);
    assert.equal(noOp.version, 1);
    assert.equal(noOp.event_id, null);
    assert.deepEqual(
      await snapshot(kind, create.entity_id),
      before,
      `${op} preserves all inventory columns, provenance, timestamp and events`,
    );
    assert.deepEqual(
      await rpc(staff.db, op, payload, request),
      noOp,
      'Normalized receipt replay is exact',
    );
    const receipt = (
      await owner.query(
        'select result from private.mutation_requests where actor_id=$1 and request_id=$2',
        [staff.id, request],
      )
    ).rows[0];
    assert.deepEqual(
      receipt.result,
      noOp,
      'The ordinary idempotency receipt commits',
    );
    await failure(
      () =>
        rpc(staff.db, op, { ...payload, name: 'Different intent' }, request),
      'P1009',
    );
    await failure(() => rpc(viewer.db, op, payload), 'P1001');
    await failure(() => rpc(inactive.db, op, payload), 'P1001');
    await owner.query(
      'update public.app_members set active=false where user_id=$1',
      [staff.id],
    );
    try {
      await failure(() => rpc(staff.db, op, payload, request), 'P1001');
    } finally {
      await owner.query(
        'update public.app_members set active=true where user_id=$1',
        [staff.id],
      );
    }
    await failure(
      () => rpc(staff.db, op, { ...payload, expected_version: 2 }),
      'P1002',
    );
    if (modern) {
      await failure(
        () =>
          rpc(staff.db, op, {
            ...payload,
            expected_published_revision_id: uid(),
          }),
        'P1024',
      );
      await failure(
        () =>
          rpc(staff.db, op, {
            ...payload,
            custom_patch: { set: {}, unset: [uid()] },
          }),
        'P1021',
      );
    }
    const real = await rpc(staff.db, op, {
      ...payload,
      name: 'Changed fixture',
    });
    assert.equal(real.changed, true);
    assert.equal(real.version, 2);
    assert.ok(real.event_id);
    assert.deepEqual(
      await rpc(staff.db, op, payload, request),
      noOp,
      'Committed no-op replays even after the record changes',
    );
    await failure(
      () => rpc(staff.db, op, { ...payload, name: 'Changed fixture' }),
      'P1002',
    );
    fixtures.push({
      kind,
      op,
      id: create.entity_id,
      payload: { ...payload, name: 'Changed fixture', expected_version: 2 },
    });
  }
  // Quantity omission preserves threshold/SKU, explicit null clears them.
  for (const fixture of fixtures.filter((row) => row.kind === 'quantity')) {
    const omitted = { ...fixture.payload };
    delete omitted.reorder_threshold;
    delete omitted.item_code;
    assert.equal((await rpc(staff.db, fixture.op, omitted)).changed, false);
    const cleared = await rpc(staff.db, fixture.op, {
      ...omitted,
      reorder_threshold: null,
      item_code: null,
    });
    assert.equal(cleared.changed, true);
    assert.equal(
      (await snapshot('quantity', fixture.id)).record.item_code,
      null,
    );
    fixture.payload = {
      ...omitted,
      reorder_threshold: null,
      item_code: null,
      expected_version: 3,
    };
  }
  // V3 treats display case as actual business intent, never normalized lookup equality.
  const v3 = fixtures.find((row) => row.op === 'asset_update_v3')!;
  const casing = {
    ...v3.payload,
    asset_tag: String(v3.payload.asset_tag).toLowerCase(),
  };
  assert.equal((await rpc(staff.db, v3.op, casing)).changed, true);
  assert.equal(
    (await snapshot('asset', v3.id)).record.asset_tag,
    casing.asset_tag,
  );
  v3.payload = { ...casing, expected_version: 3 };
  // Category identity is real intent even if all other displayed values match.
  const legacyAsset = fixtures.find((row) => row.op === 'asset_update')!;
  assert.equal(
    (
      await rpc(staff.db, legacyAsset.op, {
        ...legacyAsset.payload,
        category_id: otherCategory.category_id,
      })
    ).changed,
    true,
  );
  legacyAsset.payload = {
    ...legacyAsset.payload,
    category_id: otherCategory.category_id,
    expected_version: 3,
  };
  // Integer version exhaustion rejects real edits, while no-op remains readable.
  for (const fixture of fixtures) {
    const table =
      fixture.kind === 'quantity' ? 'quantity_items' : 'serialized_assets';
    await owner.query(
      `update public.${table} set version=2147483647 where id=$1`,
      [fixture.id],
    );
    const payload = { ...fixture.payload, expected_version: 2147483647 };
    const before = await snapshot(fixture.kind, fixture.id);
    assert.equal((await rpc(staff.db, fixture.op, payload)).changed, false);
    await failure(
      () => rpc(staff.db, fixture.op, { ...payload, name: 'Cannot advance' }),
      'P1008',
    );
    assert.deepEqual(await snapshot(fixture.kind, fixture.id), before);
  }
  // Publish actual historical datetime/text definitions, then tighten text rules.
  const dateId = uid(),
    textId = uid(),
    booleanId = uid(),
    integerId = uid(),
    emptyTextId = uid();
  const definition = structuredClone(form.published_definition);
  definition.fields = [
    {
      id: dateId,
      label: 'Exact instant',
      type: 'datetime',
      applies_to: ['quantity', 'asset'],
      required: false,
      rules: {},
      options: [],
    },
    {
      id: textId,
      label: 'Retained note',
      type: 'short_text',
      applies_to: ['quantity', 'asset'],
      required: false,
      rules: { maxLength: 100 },
      options: [],
    },
    ...[
      { id: booleanId, label: 'Explicit false', type: 'boolean' },
      { id: integerId, label: 'Explicit zero', type: 'integer' },
      { id: emptyTextId, label: 'Explicit empty text', type: 'short_text' },
    ].map((field) => ({
      ...field,
      applies_to: ['quantity', 'asset'],
      required: false,
      rules: {},
      options: [],
    })),
  ];
  definition.layout[0].controls.push(
    ...[dateId, textId, booleanId, integerId, emptyTextId].map((field_id) => ({
      id: uid(),
      kind: 'field',
      field_id,
      width: 'Auto',
    })),
  );
  async function publish(expected: string) {
    const payload = {
      category_id: category.category_id,
      expected_actor_id: staff.id,
      expected_published_revision_id: expected,
      expected_draft_id: null,
      expected_draft_version: '0',
      definition,
    };
    let result = await rpc<{
      status: string;
      token?: string;
      published_revision_id: string;
    }>(staff.db, 'metadata_form_save', payload);
    if (result.status === 'confirmation_required')
      result = await rpc(staff.db, 'metadata_form_save', {
        ...payload,
        review_token: result.token,
      });
    assert.equal(result.status, 'saved');
    return result.published_revision_id;
  }
  const historical = await publish(form.published_revision_id);
  const dated = await rpc(staff.db, 'quantity_create_v2', {
    ...common,
    expected_published_revision_id: historical,
    custom_patch: {
      set: {
        [dateId]: '2026-10-09T12:00:00.123456Z',
        [textId]: 'Grandfathered note',
        [booleanId]: false,
        [integerId]: 0,
        [emptyTextId]: '',
      },
    },
    initial_quantity: 0,
  });
  definition.fields[1].rules = { maxLength: 2 };
  const current = await publish(historical);
  const datePayload = {
    ...common,
    item_id: dated.entity_id,
    expected_version: 1,
    expected_published_revision_id: current,
    custom_patch: {
      set: {
        [dateId]: '2026-10-09T07:00:00.123456-05:00',
        [textId]: 'Grandfathered note',
      },
      unset: [],
    },
  };
  const prior = await snapshot('quantity', dated.entity_id);
  assert.equal(
    (await rpc(staff.db, 'quantity_update_v2', datePayload)).changed,
    false,
  );
  assert.deepEqual(
    await snapshot('quantity', dated.entity_id),
    prior,
    'Equivalent instants retain the complete historical answer envelope',
  );
  for (const bad of [
    '2026-10-09T12:00:00.1234561Z',
    '2026-10-09T12:00:00.123456+24:00',
    '2026-02-30T12:00:00.123456Z',
    '2026-10-09T12:00:00.123456',
  ]) {
    await failure(
      () =>
        rpc(staff.db, 'quantity_update_v2', {
          ...datePayload,
          custom_patch: { set: { [dateId]: bad } },
        }),
      'P1021',
    );
  }
  await failure(
    () =>
      rpc(staff.db, 'quantity_update_v2', {
        ...datePayload,
        custom_patch: { set: { [textId]: 'Changed long note' } },
      }),
    'P1021',
  );
  assert.equal(
    (
      await rpc(staff.db, 'quantity_update_v2', {
        ...datePayload,
        custom_patch: { set: { [dateId]: '2026-10-09T12:00:00.123457Z' } },
      })
    ).changed,
    true,
  );
  // Null versus omitted full-form nullable metadata keeps its existing clear semantics.
  const withoutDescription = {
    ...datePayload,
    expected_version: 2,
    custom_patch: {},
  } as Record<string, unknown>;
  delete withoutDescription.description;
  assert.equal(
    (await rpc(staff.db, 'quantity_update_v2', withoutDescription)).changed,
    true,
  );
  assert.equal(
    (await snapshot('quantity', dated.entity_id)).record.description,
    null,
  );
  // Falsy answers are present values, never absent answers. Identical raw sets
  // preserve the old complete envelope after a new publication; unset changes
  // state once, repeated unset is a no-op, and restoring a falsy value is real.
  let falsyVersion = 3;
  for (const [field, value] of [
    [booleanId, false],
    [integerId, 0],
    [emptyTextId, ''],
  ] as const) {
    const base = { ...withoutDescription, expected_version: falsyVersion };
    const before = await snapshot('quantity', dated.entity_id);
    assert.ok(Object.hasOwn(before.record.custom_values, field));
    assert.deepEqual(before.record.custom_values[field], {
      value,
      validated_revision_id: historical,
    });
    assert.equal(
      (
        await rpc(staff.db, 'quantity_update_v2', {
          ...base,
          custom_patch: { set: { [field]: value } },
        })
      ).changed,
      false,
    );
    assert.deepEqual(
      await snapshot('quantity', dated.entity_id),
      before,
      'Identical false/zero/empty-string preserves provenance, version, timestamp and events',
    );
    assert.equal(
      (
        await rpc(staff.db, 'quantity_update_v2', {
          ...base,
          custom_patch: { unset: [field] },
        })
      ).changed,
      true,
    );
    falsyVersion++;
    const absent = await snapshot('quantity', dated.entity_id);
    assert.equal(Object.hasOwn(absent.record.custom_values, field), false);
    assert.equal(
      (
        await rpc(staff.db, 'quantity_update_v2', {
          ...base,
          expected_version: falsyVersion,
          custom_patch: { unset: [field] },
        })
      ).changed,
      false,
    );
    assert.deepEqual(
      await snapshot('quantity', dated.entity_id),
      absent,
      'Already absent unset preserves all state',
    );
    assert.equal(
      (
        await rpc(staff.db, 'quantity_update_v2', {
          ...base,
          expected_version: falsyVersion,
          custom_patch: { set: { [field]: value } },
        })
      ).changed,
      true,
    );
    falsyVersion++;
    const restored = await snapshot('quantity', dated.entity_id);
    assert.deepEqual(restored.record.custom_values[field], {
      value,
      validated_revision_id: current,
    });
    assert.equal(
      (
        await rpc(staff.db, 'quantity_update_v2', {
          ...base,
          expected_version: falsyVersion,
          custom_patch: { set: { [field]: value } },
        })
      ).changed,
      false,
    );
    assert.deepEqual(await snapshot('quantity', dated.entity_id), restored);
  }
  // Independent connections prove a stale edit never rebases to an apparent no-op.
  const race = await rpc(staff.db, 'quantity_create_v2', {
    ...common,
    expected_published_revision_id: current,
    custom_patch: {},
    initial_quantity: 0,
  });
  const base = {
    ...common,
    item_id: race.entity_id,
    expected_version: 1,
    expected_published_revision_id: current,
    custom_patch: {},
  };
  const pid = (await second.db.query('select pg_backend_pid() pid')).rows[0]
    .pid;
  await staff.db.query('begin');
  try {
    await rpc(staff.db, 'quantity_update_v2', {
      ...base,
      name: 'Concurrent real edit',
    });
    const stale = failure(
      () =>
        rpc(second.db, 'quantity_update_v2', {
          ...base,
          name: 'Concurrent real edit',
        }),
      'P1002',
    );
    await blocked(pid);
    await staff.db.query('commit');
    await stale;
  } finally {
    await staff.db.query('rollback');
  }
  await staff.db.query('begin');
  try {
    const stable = {
      ...base,
      expected_version: 2,
      name: 'Concurrent real edit',
    };
    assert.equal(
      (await rpc(staff.db, 'quantity_update_v2', stable)).changed,
      false,
    );
    const changed = rpc(second.db, 'quantity_update_v2', {
      ...stable,
      name: 'Edit following no-op',
    });
    await blocked(pid);
    await staff.db.query('commit');
    assert.equal((await changed).version, 3);
  } finally {
    await staff.db.query('rollback');
  }
  const archived = await rpc(staff.db, 'quantity_create_v2', {
    ...common,
    expected_published_revision_id: current,
    custom_patch: {},
    initial_quantity: 0,
  });
  await rpc(staff.db, 'quantity_archive', {
    item_id: archived.entity_id,
    expected_version: 1,
    reason: 'Lifecycle regression',
  });
  await failure(
    () =>
      rpc(staff.db, 'quantity_update_v2', {
        ...common,
        item_id: archived.entity_id,
        expected_version: 2,
        expected_published_revision_id: current,
        custom_patch: {},
      }),
    'P1008',
  );
  await failure(
    () =>
      rpc(staff.db, 'quantity_update', {
        ...common,
        item_id: archived.entity_id,
        expected_version: 2,
      }),
    'P1008',
  );
  // F308 uses the same authorized, version-bounded boundary read as the server.
  // Transfers/corrections never truncate the current episode to the last 25 events.
  const sites = [];
  for (const n of [1, 2])
    sites.push(
      (
        await rpc(staff.db, 'site_create', {
          code: `AUDIT4-${suffix}-SITE${n}`,
          name: `Origin site ${suffix} ${n}`,
        })
      ).entity_id,
    );
  const assigned = await rpc(staff.db, 'asset_create_v3', {
    ...common,
    location_id: location,
    expected_published_revision_id: current,
    custom_patch: {},
  });
  const issued = await rpc(staff.db, 'asset_site_change', {
    asset_id: assigned.entity_id,
    expected_version: '1',
    action: 'assign',
    source_location_id: location,
    destination_site_id: sites[0],
  });
  let assetVersion = 2,
    sourceSite = sites[0];
  for (let i = 0; i < 30; i++) {
    const destinationSite = sourceSite === sites[0] ? sites[1] : sites[0];
    await rpc(staff.db, 'asset_site_change', {
      asset_id: assigned.entity_id,
      expected_version: String(assetVersion),
      action: i % 2 ? 'correct' : 'transfer',
      source_site_id: sourceSite,
      destination_site_id: destinationSite,
      reason: 'Episode fixture',
    });
    assetVersion++;
    sourceSite = destinationSite;
  }
  const boundary = async (assetId: string, version: number) =>
    (
      await staff.db.query(
        "select id,asset_id,version,kind,from_location_id from public.asset_events where asset_id=$1 and version<=$2 and kind not in ('metadata_updated','site_transferred','site_corrected') order by version desc limit 1",
        [assetId, version],
      )
    ).rows[0];
  assert.equal(
    (await boundary(assigned.entity_id, assetVersion)).id,
    issued.event_id,
  );
  assert.equal(
    (await boundary(assigned.entity_id, assetVersion)).from_location_id,
    location,
  );
  const alternate = (
    await owner.query(
      'select id from public.locations where active and can_hold_inventory and id<>$1 order by code limit 1',
      [location],
    )
  ).rows[0].id;
  await rpc(staff.db, 'asset_site_change', {
    asset_id: assigned.entity_id,
    expected_version: String(assetVersion++),
    action: 'return',
    source_site_id: sourceSite,
    destination_location_id: alternate,
  });
  const reissued = await rpc(staff.db, 'asset_site_change', {
    asset_id: assigned.entity_id,
    expected_version: String(assetVersion++),
    action: 'assign',
    source_location_id: alternate,
    destination_site_id: sites[0],
  });
  assert.equal(
    (await boundary(assigned.entity_id, assetVersion)).id,
    reissued.event_id,
    'A new assignment uses its own storage origin',
  );
  assert.equal(
    (await boundary(assigned.entity_id, assetVersion)).from_location_id,
    alternate,
  );
  const opened = await rpc(staff.db, 'asset_site_open_v3', {
    ...common,
    site_id: sites[0],
    expected_published_revision_id: current,
    custom_patch: {},
  });
  assert.equal((await boundary(opened.entity_id, 1)).kind, 'site_opened');
  assert.equal((await boundary(opened.entity_id, 1)).from_location_id, null);
  console.log(
    'Audit four edit integrity database contracts passed: all legacy/v2/v3 updates, authorized replay, stale intent, no-op timestamps/events/provenance, max versions, strict datetime precision and independent-connection races.',
  );
}
try {
  await main();
} finally {
  await Promise.all(connections.map((db) => db.end()));
  await owner.end();
}
