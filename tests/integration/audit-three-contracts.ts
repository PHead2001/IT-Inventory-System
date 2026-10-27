import assert from 'node:assert/strict';
import { randomUUID as uid } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { Client } from 'pg';

const target = new URL(process.env.LOCAL_DB_URL!);
assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(target.hostname));
assert.equal(
  target.port,
  '45322',
  'Only the canonical local database is allowed',
);
const owner = new Client({
  connectionString: target.href,
  application_name: 'audit-three-contracts-owner',
});
const connections: Client[] = [];
const suffix = uid().replaceAll('-', '').slice(0, 12).toUpperCase();
type Receipt = {
  entity_id: string;
  version: string | number;
  event_id: string;
};
async function caller(role: 'staff' | 'viewer', active = true) {
  const id = uid();
  await owner.query('insert into auth.users(id,email) values($1,$2)', [
    id,
    `${id}@audit-three.example.test`,
  ]);
  await owner.query(
    'insert into public.app_members(user_id,display_name,role,active,can_manage_configuration) values($1,$2,$3,$4,$5)',
    [id, 'Audit three contract fixture', role, active, role === 'staff'],
  );
  const connection = new Client({
    connectionString: target.href,
    application_name: 'audit-three-contracts-caller',
  });
  await connection.connect();
  await connection.query("select set_config('request.jwt.claims',$1,false)", [
    JSON.stringify({ sub: id, role: 'authenticated' }),
  ]);
  await connection.query('set role authenticated');
  connections.push(connection);
  return { id, connection };
}
async function rpc<T = Receipt>(
  connection: Client,
  operation: string,
  payload: Record<string, unknown>,
  request = uid(),
): Promise<T> {
  assert.match(operation, /^[a-z_0-9]+$/);
  return (
    await connection.query(
      `select public.${operation}($1::uuid,$2::jsonb) result`,
      [request, JSON.stringify(payload)],
    )
  ).rows[0].result;
}
async function failure(
  action: () => Promise<unknown>,
  code: string,
  message?: string,
) {
  await assert.rejects(action, (error: unknown) => {
    const actual = error as { code: string; message: string };
    assert.equal(actual.code, code, actual.message);
    if (message) assert.equal(actual.message, message);
    return true;
  });
}
async function blockedOnLock(pid: number) {
  const deadline = Date.now() + 1500;
  do {
    const state = (
      await owner.query(
        'select wait_event_type from pg_stat_activity where pid=$1',
        [pid],
      )
    ).rows[0];
    if (state?.wait_event_type === 'Lock') return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  } while (Date.now() < deadline);
  assert.fail(
    'The independent connection did not overlap the uncommitted mutation',
  );
}
async function existingSiblingCollisionPreflight(
  leaves: { id: string; code: string }[],
) {
  const migration = readFileSync(
    new URL(
      '../../supabase/migrations/20261008011523_audit_three_location_names.sql',
      import.meta.url,
    ),
    'utf8',
  );
  // Exercise the actual upgrade prerequisite, without replaying the migration's
  // COMMIT or installing its subsequent schema changes in this shared database.
  const blocks = Array.from(
    migration.matchAll(
      /^(lock table public\.locations in share row exclusive mode;\r?\ndo \$\$[\s\S]*?^end; \$\$;)\r?$/gm,
    ),
  );
  assert.equal(blocks.length, 1, 'Migration preflight must remain unambiguous');
  const block = blocks[0];
  assert.match(migration.slice(0, block.index).trimEnd(), /\bbegin;$/);
  assert.match(
    migration.slice(block.index! + block[0].length).trimStart(),
    /^create unique index locations_active_sibling_name_key\b/,
    'Extract the entire prerequisite before enforcement installation',
  );
  const preflight = block[1];
  const snapshot = async () =>
    (
      await owner.query(
        `select jsonb_build_object(
          'locations', (select jsonb_agg(to_jsonb(l) order by l.id)
            from public.locations l where l.id=any($1::uuid[])),
          'history', (select jsonb_agg(to_jsonb(e) order by e.id)
            from public.location_configuration_events e
            where e.location_id=any($1::uuid[]))
        ) result`,
        [leaves.map((leaf) => leaf.id)],
      )
    ).rows[0].result;
  const guards = async () =>
    (
      await owner.query(
        `select jsonb_build_object(
          'index', pg_get_indexdef('public.locations_active_sibling_name_key'::regclass),
          'trigger', (select jsonb_build_object('definition',pg_get_triggerdef(oid),
            'enabled',tgenabled) from pg_trigger
            where tgrelid='public.locations'::regclass and tgname='locations_sibling_name')
        ) result`,
      )
    ).rows[0].result;
  const original = await snapshot();
  const originalGuards = await guards();
  assert.ok(original.history?.length, 'Preservation fixture includes history');
  assert.ok(originalGuards.index);
  assert.equal(originalGuards.trigger?.enabled, 'O');
  await owner.query('begin');
  try {
    await owner.query("set local statement_timeout='5s'");
    await owner.query(preflight);
    await owner.query(
      'drop trigger locations_sibling_name on public.locations',
    );
    await owner.query('drop index public.locations_active_sibling_name_key');
    await owner.query(
      'update public.locations set name=upper((select name from public.locations where id=$1)) where id=$2',
      [leaves[0].id, leaves[1].id],
    );
    const colliding = await snapshot();
    assert.equal(colliding.locations[0].active, true);
    assert.equal(colliding.locations[1].active, true);
    await owner.query('savepoint preflight_collision');
    await assert.rejects(
      () => owner.query(preflight),
      (error: unknown) => {
        const actual = error as {
          code: string;
          message: string;
          detail: string;
        };
        assert.equal(actual.code, 'P1012');
        assert.equal(
          actual.message,
          'active_sibling_name_collision_prerequisite',
        );
        assert.equal(
          actual.detail,
          [leaves[0].code, leaves[1].code].sort().join(', '),
        );
        return true;
      },
    );
    await owner.query('rollback to savepoint preflight_collision');
    assert.deepEqual(
      await snapshot(),
      colliding,
      'Preflight refuses without data repair',
    );
  } finally {
    // Transactional DDL restores both enforcement objects even if an assertion
    // fails; no deliberately colliding fixture is ever committed.
    await owner.query('rollback');
  }
  assert.deepEqual(
    await snapshot(),
    original,
    'Rollback restores rows and history',
  );
  assert.deepEqual(
    await guards(),
    originalGuards,
    'Rollback restores both guards',
  );
}
async function main() {
  await owner.connect();
  const staff = await caller('staff');
  const two = await caller('staff');
  const secondPid = (await two.connection.query('select pg_backend_pid() pid'))
    .rows[0].pid as number;
  const viewer = await caller('viewer');
  const inactive = await caller('staff', false);
  const category = (
    await owner.query(
      "select id,published_form_revision_id from public.categories where code='OTHER'",
    )
  ).rows[0];
  const root = (
    await owner.query(
      "insert into public.locations(code,name,kind,can_hold_inventory) values($1,$2,'room',false) returning id",
      [`AUDIT3-${suffix}`, `Audit three ${suffix}`],
    )
  ).rows[0].id;
  const leaves: { id: string; code: string }[] = [];
  for (const [i, name] of ['First', 'Second', 'Empty'].entries()) {
    leaves.push(
      (
        await owner.query(
          "insert into public.locations(code,name,parent_id,kind,can_hold_inventory) values($1,$2,$3,'storage_area',true) returning id,code",
          [`AUDIT3-${suffix}-L${i}`, name, root],
        )
      ).rows[0],
    );
  }
  const create = (tag: string | null) => ({
    name: 'Audit mixed tag',
    category_id: category.id,
    expected_published_revision_id: category.published_form_revision_id,
    custom_patch: {},
    location_id: leaves[0].id,
    asset_tag: tag,
  });
  const tag = `000${suffix}-Ab/C.02`;
  const request = uid();
  const created = await rpc(
    staff.connection,
    'asset_create_v3',
    create(`  ${tag}  `),
    request,
  );
  assert.deepEqual(
    await rpc(staff.connection, 'asset_create_v3', create(tag), request),
    created,
    'Uncertain retry replays exactly',
  );
  await failure(
    () =>
      rpc(
        staff.connection,
        'asset_create_v3',
        create(tag.toLowerCase()),
        request,
      ),
    'P1009',
  );
  const stored = (
    await owner.query(
      'select asset_tag,asset_tag_normalized from public.serialized_assets where id=$1',
      [created.entity_id],
    )
  ).rows[0];
  assert.deepEqual(stored, {
    asset_tag: tag,
    asset_tag_normalized: tag.toLowerCase(),
  });
  const search = (
    await viewer.connection.query(
      "select public.inventory_search_v3(p_query=>$1,p_status=>'all') result",
      [tag.toUpperCase()],
    )
  ).rows[0].result;
  assert.ok(
    search.rows.some(
      (row: { entity_id: string; asset_tag: string }) =>
        row.entity_id === created.entity_id && row.asset_tag === tag,
    ),
  );
  const label = (
    await viewer.connection.query(
      'select public.inventory_label_resolve($1) result',
      [JSON.stringify([{ kind: 'asset', key: created.entity_id }])],
    )
  ).rows[0].result[0];
  assert.equal(label.tag, tag);
  assert.equal(
    label.key,
    created.entity_id,
    'Permanent QR identity remains the asset UUID',
  );
  const exported = (
    await viewer.connection.query(
      "select public.inventory_export_snapshot_v3(p_query=>$1,p_type=>'asset',p_status=>'all',p_export_type=>'inventory',p_include_custom=>false,p_category_id=>null,p_location_code=>null,p_site_id=>null,p_low_stock=>false) result",
      [tag.toUpperCase()],
    )
  ).rows[0].result;
  assert.equal(exported.rows[0].asset_tag, tag);
  const updatePayload = {
    ...create(tag.toLowerCase()),
    asset_id: created.entity_id,
    expected_version: 1,
  };
  delete (updatePayload as Partial<ReturnType<typeof create>>).location_id;
  const editRequest = uid();
  const edited = await rpc(
    staff.connection,
    'asset_update_v3',
    updatePayload,
    editRequest,
  );
  assert.equal(edited.version, 2);
  assert.deepEqual(
    await rpc(staff.connection, 'asset_update_v3', updatePayload, editRequest),
    edited,
  );
  const event = (
    await owner.query(
      'select before_metadata,after_metadata from public.asset_events where id=$1',
      [edited.event_id],
    )
  ).rows[0];
  assert.equal(event.before_metadata.asset_tag, tag);
  assert.equal(event.after_metadata.asset_tag, tag.toLowerCase());
  assert.equal(
    (
      await owner.query(
        'select count(*)::int n from public.asset_events where asset_id=$1',
        [created.entity_id],
      )
    ).rows[0].n,
    2,
  );
  await failure(
    () => rpc(staff.connection, 'asset_create_v3', create(tag.toUpperCase())),
    'P1007',
  );
  await rpc(staff.connection, 'asset_retire', {
    asset_id: created.entity_id,
    expected_version: 2,
    reason: 'Fixture retirement',
  });
  await failure(
    () => rpc(staff.connection, 'asset_create_v3', create(tag)),
    'P1007',
  );
  await failure(
    () => rpc(viewer.connection, 'asset_create_v3', create(null)),
    'P1001',
  );
  await owner.query(
    'update public.app_members set active=false where user_id=$1',
    [staff.id],
  );
  await failure(
    () => rpc(staff.connection, 'asset_create_v3', create(tag), request),
    'P1001',
    'forbidden',
  );
  await owner.query(
    'update public.app_members set active=true where user_id=$1',
    [staff.id],
  );

  const rollbackRequest = uid();
  const rollbackTag = `Rollback-${uid()}`;
  await owner.query(
    "create function pg_temp.reject_audit_three_asset_event() returns trigger language plpgsql as $$ begin raise exception using errcode='P1999',message='fixture_audit_failure'; end; $$",
  );
  await owner.query(
    'create trigger test_audit_three_failure before insert on public.asset_events for each row execute function pg_temp.reject_audit_three_asset_event()',
  );
  try {
    await failure(
      () =>
        rpc(
          staff.connection,
          'asset_create_v3',
          create(rollbackTag),
          rollbackRequest,
        ),
      'P1999',
    );
    assert.equal(
      (
        await owner.query(
          'select count(*)::int n from public.serialized_assets where asset_tag_normalized=lower($1)',
          [rollbackTag],
        )
      ).rows[0].n,
      0,
    );
    assert.equal(
      (
        await owner.query(
          'select count(*)::int n from private.mutation_requests where actor_id=$1 and request_id=$2',
          [staff.id, rollbackRequest],
        )
      ).rows[0].n,
      0,
    );
  } finally {
    await owner.query(
      'drop trigger test_audit_three_failure on public.asset_events',
    );
  }

  // Legacy receipts retain their normalized identity, including uppercase retry.
  for (const operation of ['asset_create', 'asset_create_v2']) {
    const oldTag = `Old-${uid()}`;
    const legacyPayload =
      operation === 'asset_create'
        ? {
            name: 'Old client',
            category_id: category.id,
            location_id: leaves[0].id,
            asset_tag: oldTag,
          }
        : create(oldTag);
    const oldRequest = uid();
    const result = await rpc(
      staff.connection,
      operation,
      legacyPayload,
      oldRequest,
    );
    assert.deepEqual(
      await rpc(
        staff.connection,
        operation,
        { ...legacyPayload, asset_tag: oldTag.toUpperCase() },
        oldRequest,
      ),
      result,
    );
    assert.equal(
      (
        await owner.query(
          'select asset_tag from public.serialized_assets where id=$1',
          [result.entity_id],
        )
      ).rows[0].asset_tag,
      oldTag.toLowerCase(),
    );
    const correction = {
      ...create(oldTag),
      asset_id: result.entity_id,
      expected_version: 1,
    };
    delete (correction as Partial<ReturnType<typeof create>>).location_id;
    await rpc(staff.connection, 'asset_update_v3', correction);
    assert.deepEqual(
      await rpc(
        staff.connection,
        operation,
        { ...legacyPayload, asset_tag: oldTag.toUpperCase() },
        oldRequest,
      ),
      result,
      'An old normalized receipt still replays after a later display correction',
    );
  }
  const site = await rpc(staff.connection, 'site_create', {
    code: `AUDIT3-${suffix}`,
    name: `Audit site ${suffix}`,
    notes: null,
  });
  for (const operation of ['asset_site_open', 'asset_site_open_v3']) {
    const siteTag = `00Site-${uid()}-A/B`;
    const sitePayload = { ...create(siteTag), site_id: site.entity_id };
    delete (sitePayload as Partial<ReturnType<typeof create>>).location_id;
    const siteRequest = uid();
    const result = await rpc(
      staff.connection,
      operation,
      sitePayload,
      siteRequest,
    );
    const caseChanged = { ...sitePayload, asset_tag: siteTag.toUpperCase() };
    if (operation.endsWith('_v3'))
      await failure(
        () => rpc(staff.connection, operation, caseChanged, siteRequest),
        'P1009',
      );
    else
      assert.deepEqual(
        await rpc(staff.connection, operation, caseChanged, siteRequest),
        result,
      );
    assert.deepEqual(
      await rpc(staff.connection, operation, sitePayload, siteRequest),
      result,
    );
    assert.equal(
      (
        await owner.query(
          'select asset_tag from public.serialized_assets where id=$1',
          [result.entity_id],
        )
      ).rows[0].asset_tag,
      operation.endsWith('_v3') ? siteTag : siteTag.toLowerCase(),
    );
  }

  // Independent connections overlap before commit, proving the index blocks a
  // differently cased duplicate instead of relying on an application precheck.
  const raceTag = `00Race-${uid()}`;
  await staff.connection.query('begin');
  await rpc(staff.connection, 'asset_create_v3', create(raceTag));
  const duplicate = failure(
    () => rpc(two.connection, 'asset_create_v3', create(raceTag.toLowerCase())),
    'P1007',
  );
  await blockedOnLock(secondPid);
  await staff.connection.query('commit');
  await duplicate;

  const rename = (leaf: number, name: string) => ({
    location_id: leaves[leaf].id,
    expected_version: '1',
    name,
  });
  await staff.connection.query('begin');
  const renamed = await rpc(
    staff.connection,
    'location_rename',
    rename(0, ' Shared shelf '),
  );
  const siblingRace = failure(
    () => rpc(two.connection, 'location_rename', rename(1, 'shared SHELF')),
    'P1007',
    'location_name_conflict',
  );
  await blockedOnLock(secondPid);
  await staff.connection.query('commit');
  await siblingRace;
  assert.equal(renamed.version, '2');
  assert.equal(
    (
      await owner.query('select version from public.locations where id=$1', [
        leaves[1].id,
      ])
    ).rows[0].version,
    '1',
  );
  await existingSiblingCollisionPreflight(leaves.slice(0, 2));
  await failure(
    () =>
      owner.query(
        "update public.locations set name='SHARED SHELF' where id=$1",
        [leaves[1].id],
      ),
    'P1007',
  );
  await failure(
    () =>
      owner.query(
        "insert into public.locations(code,name,kind) values($1,$2,'room')",
        [`AUDIT3-${suffix}-ROOT-DUP`, `audit THREE ${suffix}`],
      ),
    'P1007',
  );
  const inactiveLeaf = (
    await owner.query(
      "insert into public.locations(code,name,parent_id,kind,can_hold_inventory,active) values($1,'SHARED SHELF',$2,'storage_area',true,false) returning id",
      [`AUDIT3-${suffix}-INACTIVE`, root],
    )
  ).rows[0].id;
  await failure(
    () =>
      owner.query('update public.locations set active=true where id=$1', [
        inactiveLeaf,
      ]),
    'P1007',
  );
  await owner.query(
    "update public.locations set name='Corrected inactive',active=true where id=$1",
    [inactiveLeaf],
  );
  const otherRoot = (
    await owner.query(
      "insert into public.locations(code,name,kind) values($1,$2,'room') returning id",
      [`AUDIT3-${suffix}-OTHER`, `Other root ${suffix}`],
    )
  ).rows[0].id;
  await owner.query(
    "insert into public.locations(code,name,parent_id,kind,can_hold_inventory) values($1,'shared shelf',$2,'storage_area',true)",
    [`AUDIT3-${suffix}-OTHER-LEAF`, otherRoot],
  );

  const quantity = await rpc(staff.connection, 'quantity_create_v2', {
    name: 'Count as one entry',
    category_id: category.id,
    expected_published_revision_id: category.published_form_revision_id,
    custom_patch: {},
    initial_location_id: leaves[0].id,
    initial_quantity: 1700,
  });
  const counts = (
    await viewer.connection.query(
      'select * from public.inventory_location_entry_counts($1)',
      [
        [
          leaves[0].code,
          leaves[1].code,
          leaves[2].code,
          'UNKNOWN',
          `AUDIT3-${suffix}`,
        ],
      ],
    )
  ).rows;
  assert.equal(
    counts.find((row) => row.location_code === leaves[0].code).entry_count,
    '4',
    'One quantity holding plus three active storage assets, excluding retired/site assets',
  );
  assert.equal(
    counts.find((row) => row.location_code === leaves[2].code).entry_count,
    '0',
  );
  assert.equal(counts.length, 3, 'Unknown and aggregate locations are omitted');
  await failure(
    () =>
      inactive.connection.query(
        'select * from public.inventory_location_entry_counts($1)',
        [[leaves[0].code]],
      ),
    'P1001',
  );
  await failure(
    () =>
      viewer.connection.query(
        'select * from public.inventory_location_entry_counts($1)',
        [[leaves[0].code, leaves[0].code]],
      ),
    'P1012',
  );
  await failure(
    () =>
      viewer.connection.query('select public.metadata_preview_batch($1)', [
        JSON.stringify(
          Array.from({ length: 26 }, () => ({
            kind: 'quantity',
            id: quantity.entity_id,
          })),
        ),
      ]),
    'P1012',
  );
  for (const lookupTag of [`00İΣ-${uid()}`, `00%_\\Ab-${uid()}`]) {
    const asset = await rpc(
      staff.connection,
      'asset_create_v3',
      create(lookupTag),
    );
    const databaseLower = (
      await owner.query('select lower($1) value', [lookupTag])
    ).rows[0].value;
    const resolved = (
      await viewer.connection.query(
        'select public.inventory_asset_tag_lookup($1) result',
        [`  ${databaseLower}  `],
      )
    ).rows[0].result;
    assert.equal(resolved.id, asset.entity_id);
    assert.equal(resolved.asset_tag, lookupTag);
    const unknown = (
      await viewer.connection.query(
        'select public.inventory_asset_tag_lookup($1) result',
        [lookupTag.replace('%', 'X') + '-missing'],
      )
    ).rows[0].result;
    assert.equal(
      unknown,
      null,
      'Percent, underscore and backslash are literal tag characters',
    );
  }
  await failure(
    () =>
      inactive.connection.query(
        'select public.inventory_asset_tag_lookup($1)',
        ['anything'],
      ),
    'P1001',
  );
  await failure(
    () =>
      viewer.connection.query('select public.inventory_asset_tag_lookup($1)', [
        'x'.repeat(101),
      ]),
    'P1012',
  );
  const previewKey = [{ kind: 'quantity', id: quantity.entity_id }];
  assert.deepEqual(
    (
      await viewer.connection.query(
        'select public.metadata_preview_batch($1) result',
        [JSON.stringify(previewKey)],
      )
    ).rows[0].result,
    { [`quantity:${quantity.entity_id}`]: { answers: [], truncated: false } },
  );
  await failure(
    () =>
      inactive.connection.query('select public.metadata_preview_batch($1)', [
        JSON.stringify(previewKey),
      ]),
    'P1001',
  );

  // Publish a real form through the existing configuration workflow. User text
  // that resembles an internal ID remains literal; choice IDs become paths.
  const previewCategory = await rpc<{ category_id: string }>(
    staff.connection,
    'category_create',
    {
      code: `AUDIT3-${suffix}`,
      name: `Audit preview ${suffix}`,
      sort_order: 500,
    },
  );
  const form = (
    await staff.connection.query(
      'select public.metadata_form_get_v2($1) result',
      [previewCategory.category_id],
    )
  ).rows[0].result;
  const fields = [uid(), uid(), uid(), uid()].sort();
  const parentChoice = uid();
  const childChoice = uid();
  const definitions = fields.map((id, i) => ({
    id,
    label: ['User reference', 'Shelf choice', 'Unicode note', 'Fourth answer'][
      i
    ],
    type: i === 1 ? 'hierarchical_select' : 'long_text',
    applies_to: ['quantity', 'asset'],
    required: false,
    rules: {},
    options:
      i === 1
        ? [
            {
              id: parentChoice,
              label: 'Parent shelf',
              parent_id: null,
              active: true,
            },
            {
              id: childChoice,
              label: 'Child bin',
              parent_id: parentChoice,
              active: true,
            },
          ]
        : [],
  }));
  const definition = structuredClone(form.published_definition);
  definition.fields = definitions;
  definition.layout[0].controls.push(
    ...fields.map((id) => ({
      id: uid(),
      kind: 'field',
      field_id: id,
      width: 'Auto',
    })),
  );
  const baseline = {
    category_id: previewCategory.category_id,
    expected_actor_id: staff.id,
    expected_published_revision_id: form.published_revision_id,
  };
  const savePayload = {
    ...baseline,
    expected_draft_id: null,
    expected_draft_version: '0',
    definition,
  };
  type FormSaved = {
    status: string;
    token?: string;
    published_revision_id: string;
  };
  let saved = await rpc<FormSaved>(
    staff.connection,
    'metadata_form_save',
    savePayload,
  );
  if (saved.status === 'confirmation_required')
    saved = await rpc<FormSaved>(staff.connection, 'metadata_form_save', {
      ...savePayload,
      review_token: saved.token,
    });
  assert.equal(saved.status, 'saved');
  const literal = uid();
  const withAnswers = await rpc(staff.connection, 'quantity_create_v2', {
    name: 'Readable preview',
    category_id: previewCategory.category_id,
    expected_published_revision_id: saved.published_revision_id,
    initial_quantity: 0,
    custom_patch: {
      set: {
        [fields[0]]: literal,
        [fields[1]]: childChoice,
        [fields[2]]: '界'.repeat(160),
        [fields[3]]: 'Open the record for this answer',
      },
      unset: [],
    },
  });
  const answerKeys = JSON.stringify([
    { kind: 'quantity', id: withAnswers.entity_id },
  ]);
  const previews = (
    await viewer.connection.query(
      'select public.metadata_preview_batch($1) result',
      [answerKeys],
    )
  ).rows[0].result;
  const preview = previews[`quantity:${withAnswers.entity_id}`];
  assert.equal(preview.answers.length, 3);
  assert.equal(
    preview.answers[0].displayValue,
    literal,
    'User UUID text survives without regex damage',
  );
  assert.equal(preview.answers[1].displayValue, 'Parent shelf / Child bin');
  assert.ok(Buffer.byteLength(preview.answers[2].displayValue, 'utf8') <= 256);
  assert.equal(preview.answers[2].truncated, true);
  assert.equal(preview.truncated, true);
  assert.deepEqual(Object.keys(preview.answers[0]).sort(), [
    'displayValue',
    'label',
    'truncated',
    'type',
  ]);
  assert.ok(!JSON.stringify(preview).includes(saved.published_revision_id));
  assert.ok(!JSON.stringify(preview).includes(childChoice));
  const legacy = (
    await viewer.connection.query(
      "select public.metadata_describe_batch('search',$1) result",
      [answerKeys],
    )
  ).rows[0].result;
  assert.ok(
    legacy[`quantity:${withAnswers.entity_id}`].includes(
      saved.published_revision_id,
    ),
    'Technical legacy preview keeps provenance',
  );
  await rpc(staff.connection, 'quantity_update_v2', {
    item_id: withAnswers.entity_id,
    expected_version: 1,
    name: 'Readable preview',
    category_id: previewCategory.category_id,
    expected_published_revision_id: saved.published_revision_id,
    custom_patch: { set: { [fields[2]]: '\u0001'.repeat(200) }, unset: [] },
  });
  const escapedPreview = (
    await viewer.connection.query(
      'select public.metadata_preview_batch($1) result',
      [answerKeys],
    )
  ).rows[0].result[`quantity:${withAnswers.entity_id}`];
  assert.ok(
    Buffer.byteLength(
      JSON.stringify(escapedPreview.answers[2].displayValue),
      'utf8',
    ) <= 258,
    'Escaped user content consumes the encoded response budget',
  );
  assert.equal(escapedPreview.answers[2].truncated, true);
  await failure(
    () =>
      viewer.connection.query('select public.metadata_preview_batch($1)', [
        JSON.stringify([
          { kind: 'quantity', id: withAnswers.entity_id },
          { kind: 'quantity', id: withAnswers.entity_id },
        ]),
      ]),
    'P1012',
  );
  await failure(
    () =>
      viewer.connection.query('select public.metadata_preview_batch($1)', [
        JSON.stringify([
          {
            kind: 'quantity',
            id: withAnswers.entity_id,
            injected: 'x'.repeat(4096),
          },
        ]),
      ]),
    'P1012',
  );
  console.log(
    'Audit three database contracts passed: display/retry/retirement, legacy clients, independent-connection tag and sibling races, activation/root conflicts, entry counts and bounded reads.',
  );
}
try {
  await main();
} finally {
  await Promise.all(connections.map((connection) => connection.end()));
  await owner.end();
}
await import('./audit-four-edit-integrity');
