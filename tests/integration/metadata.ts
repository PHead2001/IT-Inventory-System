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
  application_name: 'metadata-integration',
});
const actors: SupabaseClient[] = [];
const actorIds = new WeakMap<SupabaseClient, string>();
const uid = randomUUID;
async function actor(role: 'staff' | 'viewer', maintainer = false) {
  const email = `${uid()}@example.test`;
  const created = await admin.auth.admin.createUser({
    email,
    password: authFixture.password,
    email_confirm: true,
  });
  if (created.error) throw created.error;
  const id = created.data.user.id;
  await owner.query(
    'insert into public.app_members(user_id,display_name,role,active,can_manage_configuration) values($1,$2,$3,true,$4)',
    [id, 'Metadata integration', role, maintainer],
  );
  const client = createClient(api, process.env.LOCAL_ANON_KEY!, options);
  const signed = await client.auth.signInWithPassword({
    email,
    password: authFixture.password,
  });
  if (signed.error) throw signed.error;
  actors.push(client);
  actorIds.set(client, id);
  return { id, client };
}
async function currentBaseline(client: SupabaseClient, categoryId: string) {
  const { data, error } = await client.rpc(
    'metadata_form_get' as never,
    {
      p_category_id: categoryId,
    } as never,
  );
  assert.equal(error, null, error?.message);
  return data as {
    draft_id: string | null;
    draft_version: string | null;
    published_revision_id: string;
  };
}
async function rpc(
  client: SupabaseClient,
  operation: string,
  payload: Record<string, unknown>,
  requestId = uid(),
) {
  if (
    [
      'metadata_draft_save',
      'metadata_draft_discard',
      'metadata_publish',
    ].includes(operation)
  ) {
    const current = await currentBaseline(
      client,
      payload.category_id as string,
    );
    payload = {
      expected_actor_id: actorIds.get(client),
      expected_draft_id: current.draft_id,
      expected_published_revision_id: current.published_revision_id,
      ...payload,
    };
  }
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
  const { data, error } = await rpc(client, operation, payload, requestId);
  assert.equal(error, null, `${operation}: ${error?.code} ${error?.message}`);
  return data as Record<string, unknown>;
}
async function failure(
  client: SupabaseClient,
  operation: string,
  payload: Record<string, unknown>,
  code: string,
) {
  const { error } = await rpc(client, operation, payload);
  assert.equal(error?.code, code, `${operation}: ${error?.message}`);
}
async function category(client: SupabaseClient, suffix: string) {
  const result = await success(client, 'category_create', {
    code: 'META-' + uid().replaceAll('-', '').slice(0, 16).toUpperCase(),
    name: 'Metadata ' + suffix + ' ' + uid().slice(0, 8),
    sort_order: 500,
  });
  return result.category_id as string;
}
function form(categoryId: string) {
  const flag = uid();
  const note = uid();
  const choice = uid();
  const root = uid();
  const child = uid();
  const definition = {
    fields: [
      {
        id: flag,
        type: 'boolean',
        label: 'Inspected',
        help: 'Record both yes and no.',
        applies_to: ['quantity', 'asset'],
        required: true,
        rules: {},
        options: [],
      },
      {
        id: note,
        type: 'short_text',
        label: 'Notes',
        applies_to: ['quantity'],
        required: false,
        rules: { maxLength: 5 },
        options: [],
      },
      {
        id: choice,
        type: 'hierarchical_select',
        label: 'Location class',
        applies_to: ['quantity'],
        required: false,
        rules: {},
        options: [
          { id: root, label: 'Root', parent_id: null, active: true },
          { id: child, label: 'Child', parent_id: root, active: true },
        ],
      },
    ],
    layout: [
      {
        id: uid(),
        label: 'Details',
        controls: [
          { id: uid(), kind: 'builtin', builtin: 'name', width: 12 },
          { id: uid(), kind: 'builtin', builtin: 'category_id', width: 12 },
          { id: uid(), kind: 'field', field_id: flag, width: 'Auto' },
          { id: uid(), kind: 'field', field_id: note, width: 6 },
          { id: uid(), kind: 'field', field_id: choice, width: 6 },
        ],
      },
    ],
  };
  return { categoryId, definition, flag, note, choice, root, child };
}
async function save(
  client: SupabaseClient,
  categoryId: string,
  version: string,
  definition: unknown,
) {
  return success(client, 'metadata_draft_save', {
    category_id: categoryId,
    expected_draft_version: version,
    definition,
  });
}
async function review(client: SupabaseClient, categoryId: string) {
  const current = await currentBaseline(client, categoryId);
  const { data, error } = await client.rpc(
    'metadata_publish_review' as never,
    {
      p_payload: {
        category_id: categoryId,
        expected_actor_id: actorIds.get(client),
        expected_draft_id: current.draft_id,
        expected_draft_version: current.draft_version,
        expected_published_revision_id: current.published_revision_id,
      },
    } as never,
  );
  assert.equal(error, null, error?.message);
  return data as {
    token: string;
    draft_id: string;
    draft_version: string;
    published_revision_id: string;
    affected_quantity: string;
  };
}
async function publish(client: SupabaseClient, categoryId: string) {
  const impact = await review(client, categoryId);
  return success(client, 'metadata_publish', {
    category_id: categoryId,
    expected_draft_id: impact.draft_id,
    expected_draft_version: impact.draft_version,
    expected_published_revision_id: impact.published_revision_id,
    review_token: impact.token,
  });
}
async function observeCatalogWait(description: string) {
  for (let attempt = 0; attempt < 80; attempt++) {
    const locks = await owner.query(
      "select bool_or(granted) holder,bool_or(not granted) waiter from pg_locks where locktype='advisory' and classid=91081::oid and objid=5::oid",
    );
    if (locks.rows[0].holder === true && locks.rows[0].waiter === true) return;
    await delay(25);
  }
  assert.fail(
    `${description}: expected independent catalog lock holder and waiter`,
  );
}
async function observeRowWait(holderPid: number, description: string) {
  for (let attempt = 0; attempt < 80; attempt++) {
    const blocked = await owner.query(
      'select exists(select 1 from pg_stat_activity where pid<>$1 and $1=any(pg_blocking_pids(pid))) waiting',
      [holderPid],
    );
    if (blocked.rows[0].waiting === true) return;
    await delay(25);
  }
  assert.fail(`${description}: expected a real independent row-lock waiter`);
}

async function main() {
  await owner.connect();
  const maintainer = await actor('staff', true);
  const staff = await actor('staff');
  const viewer = await actor('viewer');
  const inactiveBatchReader = await actor('viewer');
  await owner.query(
    'update public.app_members set active=false where user_id=$1',
    [inactiveBatchReader.id],
  );
  const inactiveBatch = await inactiveBatchReader.client.rpc(
    'metadata_describe_batch' as never,
    { p_mode: 'search', p_keys: [] } as never,
  );
  assert.equal(inactiveBatch.error?.code, 'P1001');
  const anonymousBatch = await createClient(
    api,
    process.env.LOCAL_ANON_KEY!,
    options,
  ).rpc(
    'metadata_describe_batch' as never,
    {
      p_mode: 'search',
      p_keys: [],
    } as never,
  );
  assert.equal(anonymousBatch.error?.code, '42501');
  const categoryId = await category(maintainer.client, 'Source');
  const location = (
    await owner.query("select id from public.locations where code='ITC-D01'")
  ).rows[0].id as string;
  const baseline = await viewer.client.rpc(
    'metadata_form_get' as never,
    { p_category_id: categoryId } as never,
  );
  assert.equal(baseline.error, null);
  assert.ok(
    (baseline.data as { published_revision_id: string }).published_revision_id,
  );
  const firstDraftCategory = await category(
    maintainer.client,
    'First draft race',
  );
  const firstDraftBaseline = await currentBaseline(
    maintainer.client,
    firstDraftCategory,
  );
  const draftHolder = new Client({
    connectionString: db,
    application_name: 'metadata-first-draft-holder',
  });
  await draftHolder.connect();
  try {
    await draftHolder.query('begin');
    await draftHolder.query('set local role authenticated');
    await draftHolder.query("select set_config('request.jwt.claims',$1,true)", [
      JSON.stringify({ sub: maintainer.id, role: 'authenticated' }),
    ]);
    const holderPid = (await draftHolder.query('select pg_backend_pid() pid'))
      .rows[0].pid as number;
    const firstDraft = (
      await draftHolder.query(
        'select public.metadata_draft_save($1,$2::jsonb) result',
        [
          uid(),
          JSON.stringify({
            category_id: firstDraftCategory,
            expected_actor_id: maintainer.id,
            expected_draft_id: null,
            expected_draft_version: '0',
            expected_published_revision_id:
              firstDraftBaseline.published_revision_id,
            definition: { fields: [], layout: [] },
          }),
        ],
      )
    ).rows[0].result as { draft_id: string };
    const competingDraft = rpc(maintainer.client, 'metadata_draft_save', {
      category_id: firstDraftCategory,
      expected_draft_id: null,
      expected_draft_version: '0',
      expected_published_revision_id: firstDraftBaseline.published_revision_id,
      definition: { fields: [], layout: [] },
    });
    await observeRowWait(holderPid, 'two null-baseline first-draft saves');
    await draftHolder.query('commit');
    assert.equal((await competingDraft).error?.code, 'P1002');
    assert.equal(
      (
        await owner.query(
          "select id from public.category_form_revisions where category_id=$1 and status='draft'",
          [firstDraftCategory],
        )
      ).rows[0].id,
      firstDraft.draft_id,
    );
  } finally {
    await draftHolder.query('rollback').catch(() => undefined);
    await draftHolder.end();
  }
  await failure(
    staff.client,
    'metadata_draft_save',
    {
      category_id: categoryId,
      expected_draft_version: '0',
      definition: {},
    },
    'P1001',
  );
  assert.equal(
    (
      await viewer.client
        .from('category_form_revisions')
        .insert({ category_id: categoryId } as never)
    ).error?.code,
    '42501',
  );
  const directMetadataUpdate = await staff.client
    .from('metadata_fields')
    .update({ field_type: 'date' } as never)
    .eq('id', uid());
  assert.equal(
    directMetadataUpdate.error?.code,
    '42501',
    directMetadataUpdate.error?.message,
  );

  const originalPublished = (baseline.data as { published_revision_id: string })
    .published_revision_id;
  const abaRequest = uid();
  const abaDefinition = { fields: [], layout: [] };
  const draftX = await success(
    maintainer.client,
    'metadata_draft_save',
    {
      category_id: categoryId,
      expected_draft_id: null,
      expected_draft_version: '0',
      expected_published_revision_id: originalPublished,
      definition: abaDefinition,
    },
    abaRequest,
  );
  const xId = draftX.draft_id as string;
  await success(maintainer.client, 'metadata_draft_discard', {
    category_id: categoryId,
    expected_draft_id: xId,
    expected_draft_version: '1',
    expected_published_revision_id: originalPublished,
  });
  const draftY = await save(maintainer.client, categoryId, '0', abaDefinition);
  assert.notEqual(draftY.draft_id, xId);
  await failure(
    maintainer.client,
    'metadata_draft_save',
    {
      category_id: categoryId,
      expected_draft_id: xId,
      expected_draft_version: '1',
      expected_published_revision_id: originalPublished,
      definition: abaDefinition,
    },
    'P1002',
  );
  await failure(
    maintainer.client,
    'metadata_draft_discard',
    {
      category_id: categoryId,
      expected_draft_id: xId,
      expected_draft_version: '1',
      expected_published_revision_id: originalPublished,
    },
    'P1002',
  );
  const staleDraftReview = await maintainer.client.rpc(
    'metadata_publish_review' as never,
    {
      p_payload: {
        category_id: categoryId,
        expected_actor_id: maintainer.id,
        expected_draft_id: xId,
        expected_draft_version: '1',
        expected_published_revision_id: originalPublished,
      },
    } as never,
  );
  assert.equal(staleDraftReview.error?.code, 'P1002');
  await failure(
    maintainer.client,
    'metadata_publish',
    {
      category_id: categoryId,
      expected_draft_id: xId,
      expected_draft_version: '1',
      expected_published_revision_id: originalPublished,
      review_token: uid(),
    },
    'P1002',
  );
  const replayX = await success(
    maintainer.client,
    'metadata_draft_save',
    {
      category_id: categoryId,
      expected_draft_id: null,
      expected_draft_version: '0',
      expected_published_revision_id: originalPublished,
      definition: abaDefinition,
    },
    abaRequest,
  );
  assert.deepEqual(
    replayX,
    draftX,
    'authorized receipt replay precedes live draft check',
  );
  await failure(
    maintainer.client,
    'metadata_draft_save',
    {
      category_id: categoryId,
      expected_actor_id: staff.id,
      expected_draft_id: draftY.draft_id,
      expected_draft_version: '1',
      expected_published_revision_id: originalPublished,
      definition: abaDefinition,
    },
    'P1001',
  );
  const wrongActorReview = await maintainer.client.rpc(
    'metadata_publish_review' as never,
    {
      p_payload: {
        category_id: categoryId,
        expected_actor_id: staff.id,
        expected_draft_id: draftY.draft_id,
        expected_draft_version: '1',
        expected_published_revision_id: originalPublished,
      },
    } as never,
  );
  assert.equal(wrongActorReview.error?.code, 'P1001');
  await success(maintainer.client, 'metadata_draft_discard', {
    category_id: categoryId,
    expected_draft_id: draftY.draft_id,
    expected_draft_version: '1',
    expected_published_revision_id: originalPublished,
  });

  const malformed = await save(maintainer.client, categoryId, '0', {
    fields: [],
    layout: [],
  });
  assert.equal(malformed.version, '1');
  const invalidImpact = await review(maintainer.client, categoryId);
  await failure(
    maintainer.client,
    'metadata_publish',
    {
      category_id: categoryId,
      expected_draft_version: invalidImpact.draft_version,
      expected_published_revision_id: invalidImpact.published_revision_id,
      review_token: invalidImpact.token,
    },
    'P1021',
  );
  await success(maintainer.client, 'metadata_draft_discard', {
    category_id: categoryId,
    expected_draft_version: '1',
  });
  assert.equal(
    (
      await owner.query(
        "select count(*) from public.category_form_revisions where category_id=$1 and status='draft'",
        [categoryId],
      )
    ).rows[0].count,
    '0',
  );

  const firstField = (d: Record<string, unknown>) =>
    (d.fields as Record<string, unknown>[])[0];
  const controls = (d: Record<string, unknown>) =>
    (d.layout as Record<string, unknown>[])[0].controls as Record<
      string,
      unknown
    >[];
  const withLetter = (id: unknown) => 'a' + String(id).slice(1);
  const invalidCases: Array<
    [string, string, (d: Record<string, unknown>) => void]
  > = [
    [
      'unknown executable key',
      'P1021',
      (d) => {
        firstField(d).expression = 'true';
      },
    ],
    [
      'missing field key',
      'P1021',
      (d) => {
        delete firstField(d).required;
      },
    ],
    [
      'bad UUID',
      'P1021',
      (d) => {
        firstField(d).id = '-'.repeat(36);
      },
    ],
    [
      'uppercase field identity and matching control reference',
      'P1021',
      (d) => {
        const uppercase = withLetter(firstField(d).id).toUpperCase();
        firstField(d).id = uppercase;
        controls(d)[2].field_id = uppercase;
      },
    ],
    [
      'uppercase field control reference',
      'P1021',
      (d) => {
        const canonical = withLetter(firstField(d).id);
        firstField(d).id = canonical;
        controls(d)[2].field_id = canonical.toUpperCase();
      },
    ],
    [
      'uppercase option identity and parent reference',
      'P1021',
      (d) => {
        const hierarchy = (d.fields as Record<string, unknown>[])[2];
        const options = hierarchy.options as Record<string, unknown>[];
        options[0].id = withLetter(options[0].id).toUpperCase();
        options[1].parent_id = options[0].id;
      },
    ],
    [
      'uppercase option parent reference',
      'P1021',
      (d) => {
        const hierarchy = (d.fields as Record<string, unknown>[])[2];
        const options = hierarchy.options as Record<string, unknown>[];
        options[0].id = withLetter(options[0].id);
        options[1].parent_id = String(options[0].id).toUpperCase();
      },
    ],
    [
      'uppercase selection default',
      'P1021',
      (d) => {
        const hierarchy = (d.fields as Record<string, unknown>[])[2];
        const options = hierarchy.options as Record<string, unknown>[];
        options[0].id = withLetter(options[0].id);
        options[1].parent_id = options[0].id;
        hierarchy.default = String(options[0].id).toUpperCase();
      },
    ],
    [
      'uppercase section identity',
      'P1021',
      (d) => {
        (d.layout as Record<string, unknown>[])[0].id = withLetter(
          (d.layout as Record<string, unknown>[])[0].id,
        ).toUpperCase();
      },
    ],
    [
      'uppercase control identity',
      'P1021',
      (d) => {
        controls(d)[0].id = withLetter(controls(d)[0].id).toUpperCase();
      },
    ],
    [
      'builtin with null help',
      'P1021',
      (d) => {
        controls(d)[0].help = null;
      },
    ],
    [
      'builtin with invalid field reference',
      'P1021',
      (d) => {
        controls(d)[0].field_id = 'garbage';
      },
    ],
    [
      'field with extraneous builtin',
      'P1021',
      (d) => {
        controls(d)[2].builtin = 'name';
      },
    ],
    [
      'help with extraneous field',
      'P1021',
      (d) => {
        controls(d).push({
          id: uid(),
          kind: 'help',
          help: 'Instructions',
          field_id: firstField(d).id,
          width: 12,
        });
      },
    ],
    [
      'unknown rule',
      'P1021',
      (d) => {
        firstField(d).rules = { script: 'return true' };
      },
    ],
    [
      'numeric width string',
      'P1021',
      (d) => {
        controls(d)[0].width = '3';
      },
    ],
    [
      'duplicate builtin',
      'P1021',
      (d) => {
        controls(d).push({ ...controls(d)[0], id: uid() });
      },
    ],
    [
      'missing required name',
      'P1021',
      (d) => {
        controls(d).splice(0, 1);
      },
    ],
    [
      'invalid datetime default',
      'P1021',
      (d) => {
        firstField(d).type = 'datetime';
        firstField(d).default = '2026-99-99T00:00:00Z';
      },
    ],
    [
      'non-ISO currency',
      'P1021',
      (d) => {
        firstField(d).type = 'currency';
        firstField(d).rules = { currencyCode: 'ZZZ', precision: 2 };
      },
    ],
    [
      'option cycle',
      'P1022',
      (d) => {
        const hierarchy = (d.fields as Record<string, unknown>[])[2];
        const options = hierarchy.options as Record<string, unknown>[];
        options[0].parent_id = options[1].id;
      },
    ],
    [
      'option depth',
      'P1022',
      (d) => {
        const hierarchy = (d.fields as Record<string, unknown>[])[2];
        hierarchy.options = Array.from({ length: 65 }, (_, index) => ({
          id: uid(),
          label: `Tier ${index}`,
          active: true,
        })).map((option, index, options) => ({
          ...option,
          parent_id: index === 0 ? null : options[index - 1].id,
        }));
      },
    ],
    [
      'option resource limit',
      'P1022',
      (d) => {
        const hierarchy = (d.fields as Record<string, unknown>[])[2];
        hierarchy.options = Array.from({ length: 1001 }, (_, index) => ({
          id: uid(),
          label: `Choice ${index}`,
          active: true,
        }));
      },
    ],
    [
      'field resource limit',
      'P1022',
      (d) => {
        d.fields = Array.from({ length: 101 }, () => ({
          id: uid(),
          type: 'boolean',
          label: 'Flag',
          applies_to: ['quantity'],
          required: false,
          rules: {},
          options: [],
        }));
      },
    ],
  ];
  for (const [description, expectedCode, mutate] of invalidCases) {
    const document = structuredClone(
      form(categoryId).definition,
    ) as unknown as Record<string, unknown>;
    mutate(document);
    await save(maintainer.client, categoryId, '0', document);
    const impact = await review(maintainer.client, categoryId);
    await failure(
      maintainer.client,
      'metadata_publish',
      {
        category_id: categoryId,
        expected_draft_version: impact.draft_version,
        expected_published_revision_id: impact.published_revision_id,
        review_token: impact.token,
      },
      expectedCode,
    );
    await success(maintainer.client, 'metadata_draft_discard', {
      category_id: categoryId,
      expected_draft_version: '1',
    });
    assert.equal(
      (
        await owner.query(
          'select count(*) from public.metadata_fields where category_id=$1',
          [categoryId],
        )
      ).rows[0].count,
      '0',
      `invalid ${description} left no field identities`,
    );
  }

  const schema = form(categoryId);
  await save(maintainer.client, categoryId, '0', schema.definition);
  const published = await publish(maintainer.client, categoryId);
  const revision = published.published_revision_id as string;
  await failure(
    maintainer.client,
    'metadata_draft_save',
    {
      category_id: categoryId,
      expected_draft_id: null,
      expected_draft_version: '0',
      expected_published_revision_id: originalPublished,
      definition: schema.definition,
    },
    'P1002',
  );
  const afterPublicationDraft = await save(
    maintainer.client,
    categoryId,
    '0',
    schema.definition,
  );
  const oldPublicationReview = await maintainer.client.rpc(
    'metadata_publish_review' as never,
    {
      p_payload: {
        category_id: categoryId,
        expected_actor_id: maintainer.id,
        expected_draft_id: afterPublicationDraft.draft_id,
        expected_draft_version: '1',
        expected_published_revision_id: originalPublished,
      },
    } as never,
  );
  assert.equal(oldPublicationReview.error?.code, 'P1002');
  await failure(
    maintainer.client,
    'metadata_publish',
    {
      category_id: categoryId,
      expected_draft_id: afterPublicationDraft.draft_id,
      expected_draft_version: '1',
      expected_published_revision_id: originalPublished,
      review_token: uid(),
    },
    'P1002',
  );
  await success(maintainer.client, 'metadata_draft_discard', {
    category_id: categoryId,
    expected_draft_id: afterPublicationDraft.draft_id,
    expected_draft_version: '1',
    expected_published_revision_id: revision,
  });
  assert.equal(
    (
      await viewer.client.rpc(
        'metadata_form_get' as never,
        { p_category_id: categoryId } as never,
      )
    ).error,
    null,
  );
  await failure(
    staff.client,
    'quantity_create',
    {
      name: 'Legacy blocked',
      category_id: categoryId,
      initial_quantity: 0,
      initial_location_id: null,
    },
    'P1023',
  );
  const baseCreate = {
    name: 'Metadata integration item',
    category_id: categoryId,
    initial_quantity: 0,
    initial_location_id: null,
    expected_published_revision_id: revision,
  };
  await failure(
    staff.client,
    'quantity_create_v2',
    {
      ...baseCreate,
      custom_patch: { set: {}, unset: [] },
    },
    'P1023',
  );
  const created = await success(staff.client, 'quantity_create_v2', {
    ...baseCreate,
    custom_patch: {
      set: {
        [schema.flag]: false,
        [schema.note]: 'abc',
        [schema.choice]: schema.root,
      },
      unset: [],
    },
  });
  assert.equal(created.version, 1);
  const itemId = created.entity_id as string;
  const stored = (
    await owner.query(
      'select custom_values,needs_metadata from public.quantity_items where id=$1',
      [itemId],
    )
  ).rows[0];
  assert.equal(stored.custom_values[schema.flag].value, false);
  assert.equal(
    stored.custom_values[schema.flag].validated_revision_id,
    revision,
  );
  assert.equal(stored.needs_metadata, false);
  const sourceAsset = await success(staff.client, 'asset_create_v2', {
    name: 'Metadata serial',
    category_id: categoryId,
    location_id: location,
    expected_published_revision_id: revision,
    custom_patch: { set: { [schema.flag]: false }, unset: [] },
  });
  const assetId = sourceAsset.entity_id as string;
  const described = await viewer.client.rpc(
    'metadata_describe_values' as never,
    {
      p_values: stored.custom_values,
      p_current_category: categoryId,
    } as never,
  );
  assert.equal(described.error, null);
  assert.deepEqual(
    (described.data as Record<string, { option_paths: string[][] }>)[
      schema.choice
    ].option_paths,
    [['Root']],
  );
  const batchedSearch = await viewer.client.rpc(
    'metadata_describe_batch' as never,
    {
      p_mode: 'search',
      p_keys: [{ kind: 'quantity', id: itemId }],
    } as never,
  );
  assert.equal(batchedSearch.error, null, batchedSearch.error?.message);
  assert.match(
    (batchedSearch.data as Record<string, string>)[`quantity:${itemId}`],
    /Inspected: No.*Notes: abc|Notes: abc.*Inspected: No/,
  );
  const createdEventId = (
    await owner.query(
      "select id from public.quantity_events where item_id=$1 and kind='created'",
      [itemId],
    )
  ).rows[0].id as string;
  const historyProjection = await viewer.client.rpc('inventory_history', {
    p_type: 'quantity',
    p_entity_id: itemId,
    p_location_code: null,
    p_page: 1,
    p_page_size: 25,
  });
  assert.equal(historyProjection.error, null, historyProjection.error?.message);
  const createdProjection = (
    historyProjection.data as { rows: Array<Record<string, unknown>> }
  ).rows.find((row) => row.id === createdEventId)!;
  assert.equal(createdProjection.custom_present, true);
  assert.equal(createdProjection.custom_changed, true);
  assert.equal(
    Object.hasOwn(createdProjection.after_metadata as object, 'custom_values'),
    false,
  );
  const historyBefore = await viewer.client.rpc(
    'metadata_event_custom_page' as never,
    {
      p_kind: 'quantity',
      p_event_id: createdEventId,
      p_side: 'before',
    } as never,
  );
  assert.equal(historyBefore.error, null, historyBefore.error?.message);
  assert.equal((historyBefore.data as { present: boolean }).present, false);
  const historyAfter = await viewer.client.rpc(
    'metadata_event_custom_page' as never,
    {
      p_kind: 'quantity',
      p_event_id: createdEventId,
      p_side: 'after',
      p_field_id: schema.flag,
    } as never,
  );
  assert.equal(historyAfter.error, null, historyAfter.error?.message);
  assert.equal((historyAfter.data as { value: unknown }).value, false);
  const invalidHistoryPage = await viewer.client.rpc(
    'metadata_event_custom_page' as never,
    {
      p_kind: 'quantity',
      p_event_id: createdEventId,
      p_side: 'after',
      p_field_id: schema.flag,
      p_option_offset: 1,
    } as never,
  );
  assert.equal(invalidHistoryPage.error?.code, 'P1012');
  const inactiveHistoryPage = await inactiveBatchReader.client.rpc(
    'metadata_event_custom_page' as never,
    {
      p_kind: 'quantity',
      p_event_id: createdEventId,
      p_side: 'after',
    } as never,
  );
  assert.equal(inactiveHistoryPage.error?.code, 'P1001');
  const anonymousHistoryPage = await createClient(
    api,
    process.env.LOCAL_ANON_KEY!,
    options,
  ).rpc(
    'metadata_event_custom_page' as never,
    {
      p_kind: 'quantity',
      p_event_id: createdEventId,
      p_side: 'after',
    } as never,
  );
  assert.equal(anonymousHistoryPage.error?.code, '42501');
  const overCap = await viewer.client.rpc(
    'metadata_describe_batch' as never,
    {
      p_mode: 'search',
      p_keys: Array.from({ length: 26 }, () => ({
        kind: 'quantity',
        id: itemId,
      })),
    } as never,
  );
  assert.equal(overCap.error?.code, 'P1012');
  const rejectedHistoryBatch = await viewer.client.rpc(
    'metadata_describe_batch' as never,
    {
      p_mode: 'history',
      p_keys: [{ kind: 'quantity', id: createdEventId }],
    } as never,
  );
  assert.equal(rejectedHistoryBatch.error?.code, 'P1012');
  for (const keys of [
    [{ kind: 'quantity', id: itemId, custom_values: stored.custom_values }],
    [
      { kind: 'quantity', id: itemId },
      { kind: 'quantity', id: itemId },
    ],
    [{ kind: 'quantity', id: 'a'.repeat(4097) }],
  ]) {
    const invalid = await viewer.client.rpc(
      'metadata_describe_batch' as never,
      {
        p_mode: 'search',
        p_keys: keys,
      } as never,
    );
    assert.equal(invalid.error?.code, 'P1012');
  }
  await failure(
    staff.client,
    'quantity_update_v2',
    {
      item_id: itemId,
      expected_version: 1,
      name: 'Invalid',
      category_id: categoryId,
      expected_published_revision_id: revision,
      custom_patch: { set: { [schema.note]: 'too long' }, unset: [] },
    },
    'P1021',
  );

  const tighteningCases: {
    label: string;
    type: string;
    value?: unknown;
    initialRules?: Record<string, unknown>;
    nextRules?: Record<string, unknown>;
    nextRequired?: boolean;
    retire?: boolean;
    options?: { id: string; label: string; active: boolean }[];
  }[] = [
    { label: 'required missing', type: 'boolean', nextRequired: true },
    {
      label: 'short text maximum',
      type: 'short_text',
      value: 'abc',
      nextRules: { maxLength: 2 },
    },
    {
      label: 'long text minimum',
      type: 'long_text',
      value: 'a',
      nextRules: { minLength: 2 },
    },
    {
      label: 'integer minimum',
      type: 'integer',
      value: 0,
      nextRules: { min: 1 },
    },
    {
      label: 'decimal precision',
      type: 'decimal',
      value: '1.234',
      nextRules: { precision: 2 },
    },
    {
      label: 'date bound',
      type: 'date',
      value: '2026-01-01',
      nextRules: { min: '2026-02-01' },
    },
    {
      label: 'datetime bound',
      type: 'datetime',
      value: '2026-01-01T00:00:00Z',
      nextRules: { min: '2026-02-01T00:00:00Z' },
    },
    { label: 'URL required', type: 'url', nextRequired: true },
    {
      label: 'currency minimum',
      type: 'currency',
      value: { amount: '1.23', currency: 'USD' },
      initialRules: { currencyCode: 'USD', precision: 2 },
      nextRules: { currencyCode: 'USD', precision: 2, min: '2' },
    },
    {
      label: 'multi choice cardinality',
      type: 'multi_select',
      initialRules: { maxSelections: 2 },
      nextRules: { maxSelections: 1 },
      options: [
        { id: uid(), label: 'First', active: true },
        { id: uid(), label: 'Second', active: true },
      ],
    },
    {
      label: 'retired choice',
      type: 'single_select',
      retire: true,
      options: [{ id: uid(), label: 'Retired', active: true }],
    },
  ];
  for (const scenario of tighteningCases) {
    const scenarioCategory = await category(maintainer.client, scenario.label);
    const fieldId = uid();
    const value =
      scenario.type === 'multi_select'
        ? scenario.options!.map((option) => option.id)
        : scenario.type === 'single_select'
          ? scenario.options![0].id
          : scenario.value;
    const field = {
      id: fieldId,
      type: scenario.type,
      label: scenario.label,
      applies_to: ['quantity'],
      required: false,
      rules: scenario.initialRules ?? {},
      options: scenario.options ?? [],
    };
    const initialDefinition = {
      fields: [field],
      layout: [
        {
          id: uid(),
          label: 'Details',
          controls: [
            { id: uid(), kind: 'builtin', builtin: 'name', width: 12 },
            { id: uid(), kind: 'builtin', builtin: 'category_id', width: 12 },
            { id: uid(), kind: 'field', field_id: fieldId, width: 'Auto' },
          ],
        },
      ],
    };
    await save(maintainer.client, scenarioCategory, '0', initialDefinition);
    const initialRevision = (await publish(maintainer.client, scenarioCategory))
      .published_revision_id;
    const scenarioItem = await success(staff.client, 'quantity_create_v2', {
      name: `Tightening ${scenario.label}`,
      category_id: scenarioCategory,
      initial_quantity: 0,
      initial_location_id: null,
      expected_published_revision_id: initialRevision,
      custom_patch: {
        set: value === undefined ? {} : { [fieldId]: value },
        unset: [],
      },
    });
    if (scenario.label === 'short text maximum') {
      await owner.query(
        'update public.quantity_items set archived=true where id=$1',
        [scenarioItem.entity_id],
      );
    }
    const before = (
      await owner.query(
        'select version,updated_at,custom_values from public.quantity_items where id=$1',
        [scenarioItem.entity_id],
      )
    ).rows[0];
    const stricterDefinition = structuredClone(initialDefinition);
    stricterDefinition.fields[0].required = scenario.nextRequired ?? false;
    stricterDefinition.fields[0].rules =
      scenario.nextRules ?? scenario.initialRules ?? {};
    if (scenario.retire) stricterDefinition.fields[0].options[0].active = false;
    await save(maintainer.client, scenarioCategory, '0', stricterDefinition);
    await publish(maintainer.client, scenarioCategory);
    const after = (
      await owner.query(
        'select version,updated_at,custom_values,needs_metadata from public.quantity_items where id=$1',
        [scenarioItem.entity_id],
      )
    ).rows[0];
    assert.equal(after.needs_metadata, true, scenario.label);
    assert.equal(
      after.version,
      before.version,
      `${scenario.label}: no business version`,
    );
    assert.equal(
      after.updated_at.getTime(),
      before.updated_at.getTime(),
      `${scenario.label}: no business timestamp`,
    );
    assert.deepEqual(
      after.custom_values,
      before.custom_values,
      `${scenario.label}: no provenance rewrite`,
    );
    assert.equal(
      (
        await owner.query(
          'select count(*) from public.quantity_events where item_id=$1',
          [scenarioItem.entity_id],
        )
      ).rows[0].count,
      '1',
      `${scenario.label}: no fake inventory event`,
    );
  }
  const applicabilityCategory = await category(
    maintainer.client,
    'Applicability tightening',
  );
  const applicabilityField = uid();
  const applicabilityForm = {
    fields: [
      {
        id: applicabilityField,
        type: 'boolean',
        label: 'Required flag',
        applies_to: ['quantity'],
        required: true,
        rules: {},
        options: [],
      },
    ],
    layout: [
      {
        id: uid(),
        label: 'Details',
        controls: [
          { id: uid(), kind: 'builtin', builtin: 'name', width: 12 },
          { id: uid(), kind: 'builtin', builtin: 'category_id', width: 12 },
          { id: uid(), kind: 'field', field_id: applicabilityField, width: 6 },
        ],
      },
    ],
  };
  await save(maintainer.client, applicabilityCategory, '0', applicabilityForm);
  const applicabilityRevision = (
    await publish(maintainer.client, applicabilityCategory)
  ).published_revision_id;
  const applicabilityAsset = await success(staff.client, 'asset_create_v2', {
    name: 'Retired applicability asset',
    category_id: applicabilityCategory,
    location_id: location,
    expected_published_revision_id: applicabilityRevision,
    custom_patch: { set: {}, unset: [] },
  });
  await owner.query(
    "update public.serialized_assets set status='retired' where id=$1",
    [applicabilityAsset.entity_id],
  );
  const applicableToAssets = structuredClone(applicabilityForm);
  applicableToAssets.fields[0].applies_to = ['quantity', 'asset'];
  await save(maintainer.client, applicabilityCategory, '0', applicableToAssets);
  await publish(maintainer.client, applicabilityCategory);
  assert.equal(
    (
      await owner.query(
        'select needs_metadata from public.serialized_assets where id=$1',
        [applicabilityAsset.entity_id],
      )
    ).rows[0].needs_metadata,
    true,
    'retired asset reflects newly required applicable field immediately',
  );

  const stricter = structuredClone(schema.definition);
  const noteField = stricter.fields.find((field) => field.id === schema.note)!;
  noteField.rules = { maxLength: 2 };
  noteField.required = true;
  noteField.applies_to = ['quantity', 'asset'];
  await save(maintainer.client, categoryId, '0', stricter);
  const staleReview = await review(maintainer.client, categoryId);
  const same = await success(staff.client, 'quantity_update_v2', {
    item_id: itemId,
    expected_version: 1,
    name: 'Metadata integration item updated',
    category_id: categoryId,
    expected_published_revision_id: revision,
    custom_patch: { set: {}, unset: [] },
  });
  await failure(
    maintainer.client,
    'metadata_publish',
    {
      category_id: categoryId,
      expected_draft_version: staleReview.draft_version,
      expected_published_revision_id: staleReview.published_revision_id,
      review_token: staleReview.token,
    },
    'P1017',
  );
  const stricterPublished = await publish(maintainer.client, categoryId);
  const strictRevision = stricterPublished.published_revision_id as string;
  const afterPublication = (
    await owner.query(
      'select needs_metadata,version,custom_values,validated_form_revision_id from public.quantity_items where id=$1',
      [itemId],
    )
  ).rows[0];
  assert.equal(afterPublication.needs_metadata, true);
  assert.equal(afterPublication.version, same.version);
  assert.deepEqual(afterPublication.custom_values, stored.custom_values);
  assert.equal(afterPublication.validated_form_revision_id, revision);
  const assetAfterPublication = (
    await owner.query(
      'select needs_metadata,version,custom_values,validated_form_revision_id from public.serialized_assets where id=$1',
      [assetId],
    )
  ).rows[0];
  assert.equal(assetAfterPublication.needs_metadata, true);
  assert.equal(assetAfterPublication.version, sourceAsset.version);
  assert.equal(assetAfterPublication.validated_form_revision_id, revision);
  await failure(
    staff.client,
    'quantity_update_v2',
    {
      item_id: itemId,
      expected_version: same.version,
      name: 'Old schema',
      category_id: categoryId,
      expected_published_revision_id: revision,
      custom_patch: { set: {}, unset: [] },
    },
    'P1024',
  );
  const grandfather = await success(staff.client, 'quantity_update_v2', {
    item_id: itemId,
    expected_version: same.version,
    name: 'Grandfathered',
    category_id: categoryId,
    expected_published_revision_id: strictRevision,
    custom_patch: { set: { [schema.note]: 'abc' }, unset: [] },
  });
  assert.equal(grandfather.needs_metadata, true);
  const current = (
    await owner.query(
      'select custom_values,needs_metadata from public.quantity_items where id=$1',
      [itemId],
    )
  ).rows[0];
  assert.equal(
    current.custom_values[schema.note].validated_revision_id,
    revision,
    'resubmitting an identical old value keeps server provenance',
  );
  await failure(
    staff.client,
    'quantity_update_v2',
    {
      item_id: itemId,
      expected_version: grandfather.version,
      name: 'Invalid changed',
      category_id: categoryId,
      expected_published_revision_id: strictRevision,
      custom_patch: { set: { [schema.note]: 'abcd' }, unset: [] },
    },
    'P1021',
  );
  await failure(
    staff.client,
    'quantity_update_v2',
    {
      item_id: itemId,
      expected_version: grandfather.version,
      name: 'Required unset',
      category_id: categoryId,
      expected_published_revision_id: strictRevision,
      custom_patch: { set: {}, unset: [schema.note] },
    },
    'P1021',
  );

  const raceDraft = structuredClone(stricter);
  raceDraft.fields.find((field) => field.id === schema.note)!.label =
    'Updated notes';
  await save(maintainer.client, categoryId, '0', raceDraft);
  const independent = new Client({
    connectionString: db,
    application_name: 'metadata-catalog-race',
  });
  await independent.connect();
  try {
    await independent.query('begin');
    await independent.query('set local role authenticated');
    await independent.query("select set_config('request.jwt.claims',$1,true)", [
      JSON.stringify({ sub: staff.id, role: 'authenticated' }),
    ]);
    await independent.query('select public.quantity_update_v2($1,$2::jsonb)', [
      uid(),
      JSON.stringify({
        item_id: itemId,
        expected_version: grandfather.version,
        name: 'Race winner',
        category_id: categoryId,
        expected_published_revision_id: strictRevision,
        custom_patch: { set: {}, unset: [] },
      }),
    ]);
    const raceReview = await review(maintainer.client, categoryId);
    let settled = false;
    const competing = rpc(maintainer.client, 'metadata_publish', {
      category_id: categoryId,
      expected_draft_version: raceReview.draft_version,
      expected_published_revision_id: raceReview.published_revision_id,
      review_token: raceReview.token,
    }).then((value) => {
      settled = true;
      return value;
    });
    let sawBarrier = false;
    for (let attempt = 0; attempt < 40; attempt++) {
      const locks = await owner.query(
        "select bool_or(granted) holder,bool_or(not granted) waiter from pg_locks where locktype='advisory' and classid=91081::oid and objid=5::oid",
      );
      sawBarrier =
        locks.rows[0].holder === true && locks.rows[0].waiter === true;
      if (sawBarrier) break;
      await delay(25);
    }
    assert.equal(
      sawBarrier,
      true,
      'observed shared holder and exclusive waiter',
    );
    assert.equal(
      settled,
      false,
      'exclusive publication waits behind independent shared writer',
    );
    await independent.query('commit');
    assert.equal((await competing).error?.code, 'P1017');
  } finally {
    await independent.query('rollback').catch(() => undefined);
    await independent.end();
  }
  const createRaceReview = await review(maintainer.client, categoryId);
  const createRace = new Client({
    connectionString: db,
    application_name: 'metadata-create-race',
  });
  await createRace.connect();
  try {
    await createRace.query('begin');
    await createRace.query('set local role authenticated');
    await createRace.query("select set_config('request.jwt.claims',$1,true)", [
      JSON.stringify({ sub: staff.id, role: 'authenticated' }),
    ]);
    const created = (
      await createRace.query(
        'select public.quantity_create_v2($1,$2::jsonb) result',
        [
          uid(),
          JSON.stringify({
            name: 'Race-created metadata item',
            category_id: categoryId,
            initial_quantity: 0,
            initial_location_id: null,
            expected_published_revision_id: strictRevision,
            custom_patch: {
              set: { [schema.flag]: false, [schema.note]: 'ok' },
              unset: [],
            },
          }),
        ],
      )
    ).rows[0].result as { entity_id: string };
    const competingPublication = rpc(maintainer.client, 'metadata_publish', {
      category_id: categoryId,
      expected_draft_id: createRaceReview.draft_id,
      expected_draft_version: createRaceReview.draft_version,
      expected_published_revision_id: createRaceReview.published_revision_id,
      review_token: createRaceReview.token,
    });
    await observeCatalogWait('item creation before publication');
    await createRace.query('commit');
    assert.equal((await competingPublication).error?.code, 'P1017');
    assert.equal(
      (
        await owner.query(
          'select custom_values from public.quantity_items where id=$1',
          [created.entity_id],
        )
      ).rows[0].custom_values[schema.flag].value,
      false,
    );
  } finally {
    await createRace.query('rollback').catch(() => undefined);
    await createRace.end();
  }
  const stockRaceCategory = await category(
    maintainer.client,
    'Stock publish race',
  );
  const stockRaceForm = form(stockRaceCategory);
  await save(
    maintainer.client,
    stockRaceCategory,
    '0',
    stockRaceForm.definition,
  );
  const stockRaceRevision = (
    await publish(maintainer.client, stockRaceCategory)
  ).published_revision_id;
  const stockRaceItem = await success(staff.client, 'quantity_create_v2', {
    name: 'Stock publication barrier',
    category_id: stockRaceCategory,
    initial_quantity: 0,
    initial_location_id: null,
    expected_published_revision_id: stockRaceRevision,
    custom_patch: { set: { [stockRaceForm.flag]: false }, unset: [] },
  });
  const changedStockForm = structuredClone(stockRaceForm.definition);
  changedStockForm.fields[0].label = 'Changed by publication';
  await save(maintainer.client, stockRaceCategory, '0', changedStockForm);
  const stockReview = await review(maintainer.client, stockRaceCategory);
  const stockHolder = new Client({
    connectionString: db,
    application_name: 'metadata-stock-publication-holder',
  });
  await stockHolder.connect();
  try {
    await stockHolder.query('begin');
    await stockHolder.query('set local role authenticated');
    await stockHolder.query("select set_config('request.jwt.claims',$1,true)", [
      JSON.stringify({ sub: staff.id, role: 'authenticated' }),
    ]);
    const holderPid = (await stockHolder.query('select pg_backend_pid() pid'))
      .rows[0].pid as number;
    await stockHolder.query('select public.quantity_receive($1,$2::jsonb)', [
      uid(),
      JSON.stringify({
        item_id: stockRaceItem.entity_id,
        expected_version: stockRaceItem.version,
        location_id: location,
        quantity: 1,
        reason: 'Concurrent stock receipt',
      }),
    ]);
    const competingPublication = rpc(maintainer.client, 'metadata_publish', {
      category_id: stockRaceCategory,
      expected_draft_id: stockReview.draft_id,
      expected_draft_version: stockReview.draft_version,
      expected_published_revision_id: stockReview.published_revision_id,
      review_token: stockReview.token,
    });
    await observeRowWait(holderPid, 'stock mutation before publication');
    await stockHolder.query('commit');
    assert.equal((await competingPublication).error?.code, 'P1017');
    assert.equal(
      (
        await owner.query(
          'select published_form_revision_id from public.categories where id=$1',
          [stockRaceCategory],
        )
      ).rows[0].published_form_revision_id,
      stockRaceRevision,
    );
  } finally {
    await stockHolder.query('rollback').catch(() => undefined);
    await stockHolder.end();
  }
  const timeoutReview = await review(maintainer.client, stockRaceCategory);
  const timeoutHolder = new Client({
    connectionString: db,
    application_name: 'metadata-publication-timeout-holder',
  });
  await timeoutHolder.connect();
  try {
    await timeoutHolder.query('begin');
    const holderPid = (await timeoutHolder.query('select pg_backend_pid() pid'))
      .rows[0].pid as number;
    await timeoutHolder.query(
      'select id from public.quantity_items where id=$1 for update',
      [stockRaceItem.entity_id],
    );
    const timedOut = rpc(maintainer.client, 'metadata_publish', {
      category_id: stockRaceCategory,
      expected_draft_id: timeoutReview.draft_id,
      expected_draft_version: timeoutReview.draft_version,
      expected_published_revision_id: timeoutReview.published_revision_id,
      review_token: timeoutReview.token,
    });
    await observeRowWait(holderPid, 'publication row-lock timeout');
    assert.equal((await timedOut).error?.code, '55P03');
    const unchanged = (
      await owner.query(
        "select c.published_form_revision_id,(select count(*) from public.form_publication_events e where e.category_id=c.id) publication_count,(select count(*) from public.category_form_revisions r where r.category_id=c.id and r.status='draft') draft_count from public.categories c where c.id=$1",
        [stockRaceCategory],
      )
    ).rows[0];
    assert.equal(unchanged.published_form_revision_id, stockRaceRevision);
    assert.equal(unchanged.publication_count, '1');
    assert.equal(unchanged.draft_count, '1');
  } finally {
    await timeoutHolder.query('rollback').catch(() => undefined);
    await timeoutHolder.end();
  }
  const isolated = new Client({
    connectionString: db,
    application_name: 'metadata-isolation-rejection',
  });
  await isolated.connect();
  try {
    await isolated.query('begin isolation level repeatable read');
    await isolated.query('set local role authenticated');
    await isolated.query("select set_config('request.jwt.claims',$1,true)", [
      JSON.stringify({ sub: staff.id, role: 'authenticated' }),
    ]);
    await assert.rejects(
      isolated.query('select public.quantity_update_v2($1,$2::jsonb)', [
        uid(),
        JSON.stringify({
          item_id: itemId,
          expected_version: grandfather.version,
          name: 'Should not commit',
          category_id: categoryId,
          expected_published_revision_id: strictRevision,
          custom_patch: { set: {}, unset: [] },
        }),
      ]),
      { code: 'P1016' },
    );
  } finally {
    await isolated.query('rollback').catch(() => undefined);
    await isolated.end();
  }
  await success(maintainer.client, 'metadata_draft_discard', {
    category_id: categoryId,
    expected_draft_version: '1',
  });

  const snapshot = await viewer.client.rpc(
    'inventory_export_snapshot' as never,
    {
      p_query: 'Race winner',
      p_type: 'quantity',
      p_status: 'all',
      p_category_id: categoryId,
      p_location_code: null,
      p_low_stock: false,
      p_export_type: 'inventory',
      p_include_custom: true,
    } as never,
  );
  assert.equal(snapshot.error, null, snapshot.error?.message);
  const exported = snapshot.data as {
    total: string;
    rows: { custom_fields: Record<string, unknown> }[];
  };
  assert.equal(exported.total, '1');
  assert.ok(exported.rows[0].custom_fields[schema.note]);
  const currentForm = await viewer.client.rpc(
    'metadata_form_get' as never,
    { p_category_id: categoryId } as never,
  );
  assert.equal(
    (currentForm.data as { published_revision_id: string })
      .published_revision_id,
    strictRevision,
  );
  const replacement = await category(maintainer.client, 'Replacement');
  const replacementSchema = form(replacement);
  await save(maintainer.client, replacement, '0', replacementSchema.definition);
  const replacementRevision = (await publish(maintainer.client, replacement))
    .published_revision_id;
  const removalReview = await maintainer.client.rpc(
    'category_removal_review' as never,
    {
      p_category_id: categoryId,
      p_replacement_id: replacement,
    } as never,
  );
  assert.equal(removalReview.error, null, removalReview.error?.message);
  const removal = removalReview.data as {
    token: string;
    authored_revision_count: string;
    retained_value_count: string;
    quantity_needs_metadata_count: string;
    asset_needs_metadata_count: string;
    will_tombstone: boolean;
  };
  assert.equal(removal.authored_revision_count, '2');
  assert.equal(removal.retained_value_count, '3');
  assert.equal(removal.quantity_needs_metadata_count, '2');
  assert.equal(removal.asset_needs_metadata_count, '1');
  assert.equal(removal.will_tombstone, true);
  const removed = await success(maintainer.client, 'category_remove', {
    category_id: categoryId,
    replacement_id: replacement,
    review_token: removal.token,
  });
  assert.equal(removed.tombstoned, true);
  const reassigned = (
    await owner.query(
      'select category_id,custom_values,validated_form_revision_id,needs_metadata from public.quantity_items where id=$1',
      [itemId],
    )
  ).rows[0];
  assert.equal(reassigned.category_id, replacement);
  assert.equal(
    reassigned.custom_values[schema.note].validated_revision_id,
    revision,
  );
  assert.equal(reassigned.validated_form_revision_id, replacementRevision);
  assert.equal(reassigned.needs_metadata, true);
  assert.equal(
    (
      await owner.query(
        'select active,removed_at from public.categories where id=$1',
        [categoryId],
      )
    ).rows[0].active,
    false,
  );
  const reassignmentEvent = (
    await owner.query(
      "select before_metadata,after_metadata from public.quantity_events where item_id=$1 and reason like 'Category removed:%' order by created_at desc limit 1",
      [itemId],
    )
  ).rows[0];
  assert.equal(
    reassignmentEvent.before_metadata.custom_values[schema.note].value,
    'abc',
  );
  assert.equal(
    reassignmentEvent.after_metadata.form_revision_id,
    replacementRevision,
  );
  const reassignedAsset = (
    await owner.query(
      'select category_id,custom_values,validated_form_revision_id,needs_metadata from public.serialized_assets where id=$1',
      [assetId],
    )
  ).rows[0];
  assert.equal(reassignedAsset.category_id, replacement);
  assert.equal(reassignedAsset.custom_values[schema.flag].value, false);
  assert.equal(reassignedAsset.validated_form_revision_id, replacementRevision);
  assert.equal(reassignedAsset.needs_metadata, true);
  const assetReassignmentEvent = (
    await owner.query(
      "select from_location_id,to_location_id,before_metadata,after_metadata from public.asset_events where asset_id=$1 and reason like 'Category removed:%' order by created_at desc limit 1",
      [assetId],
    )
  ).rows[0];
  assert.equal(assetReassignmentEvent.from_location_id, null);
  assert.equal(assetReassignmentEvent.to_location_id, null);
  assert.equal(
    assetReassignmentEvent.before_metadata.custom_values[schema.flag].value,
    false,
  );

  const unused = await category(maintainer.client, 'Unused');
  const unusedReview = await maintainer.client.rpc(
    'category_removal_review' as never,
    {
      p_category_id: unused,
      p_replacement_id: null,
    } as never,
  );
  assert.equal(unusedReview.error, null);
  assert.equal(
    (unusedReview.data as { will_tombstone: boolean }).will_tombstone,
    false,
  );
  const unusedRemoved = await success(maintainer.client, 'category_remove', {
    category_id: unused,
    replacement_id: null,
    review_token: (unusedReview.data as { token: string }).token,
  });
  assert.equal(unusedRemoved.tombstoned, false);
  assert.equal(
    (
      await owner.query('select count(*) from public.categories where id=$1', [
        unused,
      ])
    ).rows[0].count,
    '0',
  );

  const typedCategory = await category(maintainer.client, 'All types');
  const ids = Object.fromEntries(
    [
      'short_text',
      'long_text',
      'integer',
      'decimal',
      'boolean',
      'date',
      'datetime',
      'url',
      'currency',
      'single_select',
      'multi_select',
      'hierarchical_select',
    ].map((type) => [type, uid()]),
  );
  const singleOption = uid();
  const multiOne = uid();
  const multiTwo = uid();
  const hierarchyRoot = uid();
  const hierarchyChild = uid();
  const typedFields = Object.entries(ids).map(([type, id]) => ({
    id,
    type,
    label: type,
    applies_to: ['quantity'],
    required: true,
    rules:
      type === 'short_text'
        ? { minLength: 0, maxLength: 10 }
        : type === 'decimal'
          ? { min: '-100', max: '100', precision: 4 }
          : type === 'currency'
            ? { currencyCode: 'USD', precision: 2, min: '0' }
            : type === 'multi_select'
              ? { maxSelections: 2 }
              : {},
    options:
      type === 'single_select'
        ? [{ id: singleOption, label: 'Single', active: true }]
        : type === 'multi_select'
          ? [
              { id: multiOne, label: 'First', active: true },
              { id: multiTwo, label: 'Second', active: true },
            ]
          : type === 'hierarchical_select'
            ? [
                { id: hierarchyRoot, label: 'Root', active: true },
                {
                  id: hierarchyChild,
                  label: 'Child',
                  parent_id: hierarchyRoot,
                  active: true,
                },
              ]
            : [],
  }));
  const typedDefinition = {
    fields: typedFields,
    layout: [
      {
        id: uid(),
        label: 'Every supported type',
        controls: [
          { id: uid(), kind: 'builtin', builtin: 'name', width: 12 },
          { id: uid(), kind: 'builtin', builtin: 'category_id', width: 12 },
          ...typedFields.map((field) => ({
            id: uid(),
            kind: 'field',
            field_id: field.id,
            width: 'Auto',
          })),
        ],
      },
    ],
  };
  await save(maintainer.client, typedCategory, '0', typedDefinition);
  const typedRevision = (await publish(maintainer.client, typedCategory))
    .published_revision_id;
  const typedValues = {
    [ids.short_text]: '',
    [ids.long_text]: 'é🙂',
    [ids.integer]: 0,
    [ids.decimal]: '12.3456',
    [ids.boolean]: false,
    [ids.date]: '2026-09-24',
    [ids.datetime]: '2026-09-24T12:30:00-05:00',
    [ids.url]: 'https://example.com?x=1#section',
    [ids.currency]: { amount: '0.00', currency: 'USD' },
    [ids.single_select]: singleOption,
    [ids.multi_select]: [multiOne, multiTwo],
    [ids.hierarchical_select]: hierarchyRoot,
  };
  const typedBase = {
    name: 'Typed values',
    category_id: typedCategory,
    initial_quantity: 0,
    initial_location_id: null,
    expected_published_revision_id: typedRevision,
  };
  const typedCreated = await success(staff.client, 'quantity_create_v2', {
    ...typedBase,
    custom_patch: { set: typedValues, unset: [] },
  });
  const typedStored = (
    await owner.query(
      'select custom_values from public.quantity_items where id=$1',
      [typedCreated.entity_id],
    )
  ).rows[0].custom_values;
  assert.equal(typedStored[ids.boolean].value, false);
  assert.equal(typedStored[ids.integer].value, 0);
  assert.equal(typedStored[ids.short_text].value, '');
  assert.equal(typedStored[ids.datetime].value, '2026-09-24T17:30:00.000000Z');
  await failure(
    staff.client,
    'quantity_create_v2',
    {
      ...typedBase,
      custom_patch: {
        set: { ...typedValues, [ids.integer]: 9007199254740992 },
        unset: [],
      },
    },
    'P1021',
  );
  await failure(
    staff.client,
    'quantity_create_v2',
    {
      ...typedBase,
      custom_patch: {
        set: { ...typedValues, [ids.url]: 'https://user:pass@example.com' },
        unset: [],
      },
    },
    'P1021',
  );
  await failure(
    staff.client,
    'quantity_create_v2',
    {
      ...typedBase,
      custom_patch: {
        set: { ...typedValues, [ids.multi_select]: [multiOne, multiOne] },
        unset: [],
      },
    },
    'P1021',
  );

  const migrationSource = await category(maintainer.client, 'Legacy source');
  const migrationTarget = await category(maintainer.client, 'Legacy target');
  const optionalField = uid();
  await save(maintainer.client, migrationSource, '0', {
    fields: [
      {
        id: optionalField,
        type: 'short_text',
        label: 'Prior label',
        applies_to: ['quantity'],
        required: false,
        rules: {},
        options: [],
      },
    ],
    layout: [
      {
        id: uid(),
        label: 'Details',
        controls: [
          { id: uid(), kind: 'builtin', builtin: 'name', width: 12 },
          { id: uid(), kind: 'builtin', builtin: 'category_id', width: 12 },
          { id: uid(), kind: 'field', field_id: optionalField, width: 6 },
        ],
      },
    ],
  });
  const migrationRevision = (await publish(maintainer.client, migrationSource))
    .published_revision_id;
  const targetForm = await viewer.client.rpc(
    'metadata_form_get' as never,
    { p_category_id: migrationTarget } as never,
  );
  assert.equal(targetForm.error, null);
  const targetRevision = (targetForm.data as { published_revision_id: string })
    .published_revision_id;
  const migrating = await success(staff.client, 'quantity_create_v2', {
    name: 'Legacy label item',
    category_id: migrationSource,
    initial_quantity: 0,
    initial_location_id: null,
    expected_published_revision_id: migrationRevision,
    custom_patch: { set: { [optionalField]: 'kept' }, unset: [] },
  });
  const migrationPayload = {
    item_id: migrating.entity_id,
    expected_version: migrating.version,
    name: 'Legacy label item',
    category_id: migrationTarget,
    expected_published_revision_id: targetRevision,
    custom_patch: { set: {}, unset: [] },
  };
  await failure(
    staff.client,
    'quantity_update',
    {
      item_id: migrating.entity_id,
      expected_version: migrating.version,
      name: 'Legacy label item',
      category_id: migrationTarget,
    },
    'P1023',
  );
  await failure(staff.client, 'quantity_update_v2', migrationPayload, 'P1026');
  await failure(
    staff.client,
    'quantity_update_v2',
    {
      ...migrationPayload,
      acknowledge_legacy_values: false,
    },
    'P1026',
  );
  const acknowledged = await success(staff.client, 'quantity_update_v2', {
    ...migrationPayload,
    acknowledge_legacy_values: true,
  });
  assert.equal(acknowledged.needs_metadata, false);
  const migratedRow = (
    await owner.query(
      'select custom_values,category_id from public.quantity_items where id=$1',
      [migrating.entity_id],
    )
  ).rows[0];
  assert.equal(migratedRow.category_id, migrationTarget);
  assert.equal(migratedRow.custom_values[optionalField].value, 'kept');
  assert.equal(
    migratedRow.custom_values[optionalField].validated_revision_id,
    migrationRevision,
  );
  const categoryMoveEvent = (
    await owner.query(
      "select id from public.quantity_events where item_id=$1 and after_metadata->>'category_id'=$2 and after_metadata->'custom_values' ? $3 order by created_at desc limit 1",
      [migrating.entity_id, migrationTarget, optionalField],
    )
  ).rows[0]?.id as string | undefined;
  assert.ok(categoryMoveEvent);
  const movedHistory = await viewer.client.rpc(
    'metadata_event_custom_page' as never,
    {
      p_kind: 'quantity',
      p_event_id: categoryMoveEvent,
      p_side: 'after',
      p_field_id: optionalField,
    } as never,
  );
  assert.equal(movedHistory.error, null, movedHistory.error?.message);
  assert.equal((movedHistory.data as { legacy: boolean }).legacy, true);
  assert.equal(
    (movedHistory.data as { event_category_id: string }).event_category_id,
    migrationTarget,
  );
  await owner.query(
    'update public.quantity_items set reorder_threshold=1 where id=$1',
    [migrating.entity_id],
  );
  for (const exportType of ['inventory', 'low_stock']) {
    const retainedExport = await viewer.client.rpc(
      'inventory_export_snapshot' as never,
      {
        p_query: 'Legacy label item',
        p_type: 'quantity',
        p_status: 'active',
        p_category_id: migrationTarget,
        p_location_code: null,
        p_low_stock: false,
        p_export_type: exportType,
        p_include_custom: true,
      } as never,
    );
    assert.equal(retainedExport.error, null, retainedExport.error?.message);
    const row = (
      retainedExport.data as {
        total: string;
        rows: {
          category_id: string;
          custom_fields: Record<
            string,
            {
              category_id: string;
              current_published_revision_id: string;
              validated_revision_id: string;
              legacy: boolean;
            }
          >;
        }[];
      }
    ).rows[0];
    assert.equal(row.category_id, migrationTarget);
    assert.equal(row.custom_fields[optionalField].category_id, migrationSource);
    assert.equal(
      row.custom_fields[optionalField].current_published_revision_id,
      migrationRevision,
    );
    assert.equal(
      row.custom_fields[optionalField].validated_revision_id,
      migrationRevision,
    );
    assert.equal(row.custom_fields[optionalField].legacy, true);
  }
  const removalSource = await category(
    maintainer.client,
    'Publish removal race',
  );
  const removalSchema = form(removalSource);
  await save(maintainer.client, removalSource, '0', removalSchema.definition);
  const removalRevision = (await publish(maintainer.client, removalSource))
    .published_revision_id;
  const removalItem = await success(staff.client, 'quantity_create_v2', {
    name: 'Publish removal race item',
    category_id: removalSource,
    initial_quantity: 0,
    initial_location_id: null,
    expected_published_revision_id: removalRevision,
    custom_patch: { set: { [removalSchema.flag]: false }, unset: [] },
  });
  const nextRemovalDefinition = structuredClone(removalSchema.definition);
  nextRemovalDefinition.fields[0].label = 'New inspected label';
  await save(maintainer.client, removalSource, '0', nextRemovalDefinition);
  const removalPublishReview = await review(maintainer.client, removalSource);
  const removalImpact = await maintainer.client.rpc('category_removal_review', {
    p_category_id: removalSource,
    p_replacement_id: migrationTarget,
  });
  assert.equal(removalImpact.error, null, removalImpact.error?.message);
  const removalToken = (removalImpact.data as { token: string }).token;
  const remover = new Client({
    connectionString: db,
    application_name: 'metadata-removal-race',
  });
  await remover.connect();
  try {
    await remover.query('begin');
    await remover.query('set local role authenticated');
    await remover.query("select set_config('request.jwt.claims',$1,true)", [
      JSON.stringify({ sub: maintainer.id, role: 'authenticated' }),
    ]);
    const removed = (
      await remover.query(
        'select public.category_remove($1,$2::jsonb) result',
        [
          uid(),
          JSON.stringify({
            category_id: removalSource,
            replacement_id: migrationTarget,
            review_token: removalToken,
          }),
        ],
      )
    ).rows[0].result as { tombstoned: boolean };
    assert.equal(removed.tombstoned, true);
    const competingPublish = rpc(maintainer.client, 'metadata_publish', {
      category_id: removalSource,
      expected_draft_id: removalPublishReview.draft_id,
      expected_draft_version: removalPublishReview.draft_version,
      expected_published_revision_id:
        removalPublishReview.published_revision_id,
      review_token: removalPublishReview.token,
    });
    await observeCatalogWait('category removal before publication');
    await remover.query('commit');
    assert.equal((await competingPublish).error?.code, 'P1011');
  } finally {
    await remover.query('rollback').catch(() => undefined);
    await remover.end();
  }
  const removalAfter = (
    await owner.query(
      'select category_id,custom_values from public.quantity_items where id=$1',
      [removalItem.entity_id],
    )
  ).rows[0];
  assert.equal(removalAfter.category_id, migrationTarget);
  assert.equal(removalAfter.custom_values[removalSchema.flag].value, false);
  assert.equal(
    removalAfter.custom_values[removalSchema.flag].validated_revision_id,
    removalRevision,
  );
  const removalEvent = (
    await owner.query(
      "select id from public.quantity_events where item_id=$1 and after_metadata->>'category_id'=$2 and after_metadata->'custom_values' ? $3 order by created_at desc limit 1",
      [removalItem.entity_id, migrationTarget, removalSchema.flag],
    )
  ).rows[0]?.id as string | undefined;
  assert.ok(removalEvent);
  const removedHistory = await viewer.client.rpc(
    'metadata_event_custom_page' as never,
    {
      p_kind: 'quantity',
      p_event_id: removalEvent,
      p_side: 'after',
      p_field_id: removalSchema.flag,
    } as never,
  );
  assert.equal(removedHistory.error, null, removedHistory.error?.message);
  assert.equal((removedHistory.data as { legacy: boolean }).legacy, true);
  assert.equal(
    (removedHistory.data as { event_category_id: string }).event_category_id,
    migrationTarget,
  );
  assert.equal(
    (
      await owner.query(
        'select published_form_revision_id from public.categories where id=$1',
        [removalSource],
      )
    ).rows[0].published_form_revision_id,
    removalRevision,
    'losing publication did not change the removed category form',
  );

  const publishFirstSource = await category(
    maintainer.client,
    'Removal stale race',
  );
  const publishFirstSchema = form(publishFirstSource);
  await save(
    maintainer.client,
    publishFirstSource,
    '0',
    publishFirstSchema.definition,
  );
  await publish(maintainer.client, publishFirstSource);
  const nextFirstDefinition = structuredClone(publishFirstSchema.definition);
  nextFirstDefinition.fields[0].label = 'Published first';
  await save(maintainer.client, publishFirstSource, '0', nextFirstDefinition);
  const publishFirstReview = await review(
    maintainer.client,
    publishFirstSource,
  );
  const staleRemovalImpact = await maintainer.client.rpc(
    'category_removal_review',
    {
      p_category_id: publishFirstSource,
      p_replacement_id: migrationTarget,
    },
  );
  assert.equal(
    staleRemovalImpact.error,
    null,
    staleRemovalImpact.error?.message,
  );
  const publisher = new Client({
    connectionString: db,
    application_name: 'metadata-publish-first-race',
  });
  await publisher.connect();
  try {
    await publisher.query('begin');
    await publisher.query('set local role authenticated');
    await publisher.query("select set_config('request.jwt.claims',$1,true)", [
      JSON.stringify({ sub: maintainer.id, role: 'authenticated' }),
    ]);
    const firstPublished = (
      await publisher.query(
        'select public.metadata_publish($1,$2::jsonb) result',
        [
          uid(),
          JSON.stringify({
            category_id: publishFirstSource,
            expected_actor_id: maintainer.id,
            expected_draft_id: publishFirstReview.draft_id,
            expected_draft_version: publishFirstReview.draft_version,
            expected_published_revision_id:
              publishFirstReview.published_revision_id,
            review_token: publishFirstReview.token,
          }),
        ],
      )
    ).rows[0].result as { published_revision_id: string };
    const competingRemoval = rpc(maintainer.client, 'category_remove', {
      category_id: publishFirstSource,
      replacement_id: migrationTarget,
      review_token: (staleRemovalImpact.data as { token: string }).token,
    });
    await observeCatalogWait('publication before category removal');
    await publisher.query('commit');
    assert.equal((await competingRemoval).error?.code, 'P1017');
    const finalCategory = (
      await owner.query(
        'select active,published_form_revision_id from public.categories where id=$1',
        [publishFirstSource],
      )
    ).rows[0];
    assert.equal(finalCategory.active, true);
    assert.equal(
      finalCategory.published_form_revision_id,
      firstPublished.published_revision_id,
    );
  } finally {
    await publisher.query('rollback').catch(() => undefined);
    await publisher.end();
  }
  const budgetCategory = await category(maintainer.client, 'Export bytes');
  const budgetFields = Array.from({ length: 27 }, (_, index) => ({
    id: uid(),
    type: 'long_text',
    label: `Large field ${index}`,
    applies_to: ['quantity'],
    required: false,
    rules: {},
    options: [],
  }));
  await save(maintainer.client, budgetCategory, '0', {
    fields: budgetFields,
    layout: [
      {
        id: uid(),
        label: 'Details',
        controls: [
          { id: uid(), kind: 'builtin', builtin: 'name', width: 12 },
          { id: uid(), kind: 'builtin', builtin: 'category_id', width: 12 },
          ...budgetFields.map((field) => ({
            id: uid(),
            kind: 'field',
            field_id: field.id,
            width: 6,
          })),
        ],
      },
    ],
  });
  const budgetRevision = (await publish(maintainer.client, budgetCategory))
    .published_revision_id;
  const largeValue = '😀"\\\n'.repeat(970);
  const nearLimit = Object.fromEntries(
    budgetFields.slice(0, 26).map((field) => [field.id, largeValue]),
  );
  const budgetItem = await success(staff.client, 'quantity_create_v2', {
    name: 'Budget export seed',
    category_id: budgetCategory,
    initial_quantity: 0,
    initial_location_id: null,
    expected_published_revision_id: budgetRevision,
    custom_patch: { set: nearLimit, unset: [] },
  });
  const budgetBytes = (
    await owner.query(
      'select octet_length(custom_values::text) bytes from public.quantity_items where id=$1',
      [budgetItem.entity_id],
    )
  ).rows[0].bytes as number;
  assert.ok(
    budgetBytes > 240000 && budgetBytes <= 262144,
    `stored ${budgetBytes} bytes`,
  );
  const budgetEventId = (
    await owner.query(
      "select id from public.quantity_events where item_id=$1 and kind='created'",
      [budgetItem.entity_id],
    )
  ).rows[0].id as string;
  const budgetHistory = await viewer.client.rpc('inventory_history', {
    p_type: 'quantity',
    p_entity_id: budgetItem.entity_id as string,
    p_location_code: null,
    p_page: 1,
    p_page_size: 25,
  });
  assert.equal(budgetHistory.error, null, budgetHistory.error?.message);
  const budgetProjected = (
    budgetHistory.data as {
      rows: Array<{ after_metadata: Record<string, unknown> }>;
    }
  ).rows[0];
  assert.equal(
    Object.hasOwn(budgetProjected.after_metadata, 'custom_values'),
    false,
  );
  assert.ok(
    Buffer.byteLength(JSON.stringify(budgetHistory.data), 'utf8') < 20_000,
  );
  const budgetFieldPage = await viewer.client.rpc(
    'metadata_event_custom_page' as never,
    {
      p_kind: 'quantity',
      p_event_id: budgetEventId,
      p_side: 'after',
      p_field_id: budgetFields[0].id,
    } as never,
  );
  assert.equal(budgetFieldPage.error, null, budgetFieldPage.error?.message);
  assert.equal((budgetFieldPage.data as { value: string }).value, largeValue);
  assert.ok(
    Buffer.byteLength(JSON.stringify(budgetFieldPage.data), 'utf8') <=
      2 * 1024 * 1024,
  );
  const pathCategory = await category(
    maintainer.client,
    'History option pages',
  );
  const pathField = uid();
  const hierarchyField = uid();
  const pathOptions = Array.from({ length: 20 }, (_, index) => ({
    id: uid(),
    label: `Choice ${index} 😀 " \\`,
    parent_id: null,
    active: true,
  }));
  const hierarchyOptions: {
    id: string;
    label: string;
    parent_id: string | null;
    active: boolean;
  }[] = [];
  for (let index = 0; index < 64; index++) {
    hierarchyOptions.push({
      id: uid(),
      label: `Choice ${index} ` + '😀"\\\n'.repeat(40),
      parent_id: index === 0 ? null : hierarchyOptions[index - 1].id,
      active: true,
    });
  }
  await save(maintainer.client, pathCategory, '0', {
    fields: [
      {
        id: pathField,
        type: 'multi_select',
        label: 'Paged choices',
        applies_to: ['quantity'],
        required: false,
        rules: { maxSelections: 20 },
        options: pathOptions,
      },
      {
        id: hierarchyField,
        type: 'hierarchical_select',
        label: 'Deep choice',
        applies_to: ['quantity'],
        required: false,
        rules: {},
        options: hierarchyOptions,
      },
    ],
    layout: [
      {
        id: uid(),
        label: 'Details',
        controls: [
          { id: uid(), kind: 'builtin', builtin: 'name', width: 12 },
          { id: uid(), kind: 'builtin', builtin: 'category_id', width: 12 },
          { id: uid(), kind: 'field', field_id: pathField, width: 12 },
          { id: uid(), kind: 'field', field_id: hierarchyField, width: 12 },
        ],
      },
    ],
  });
  const pathRevision = (await publish(maintainer.client, pathCategory))
    .published_revision_id;
  const pathItem = await success(staff.client, 'quantity_create_v2', {
    name: 'Paged history choices',
    category_id: pathCategory,
    expected_published_revision_id: pathRevision,
    custom_patch: {
      set: {
        [pathField]: pathOptions.map((option) => option.id),
        [hierarchyField]: hierarchyOptions.at(-1)!.id,
      },
      unset: [],
    },
  });
  const pathEvent = (
    await owner.query(
      "select id from public.quantity_events where item_id=$1 and kind='created'",
      [pathItem.entity_id],
    )
  ).rows[0].id as string;
  const pathFirst = await viewer.client.rpc(
    'metadata_event_custom_page' as never,
    {
      p_kind: 'quantity',
      p_event_id: pathEvent,
      p_side: 'after',
      p_field_id: pathField,
    } as never,
  );
  assert.equal(pathFirst.error, null, pathFirst.error?.message);
  assert.equal(
    (pathFirst.data as { option_paths: unknown[] }).option_paths.length,
    16,
  );
  assert.equal(
    (pathFirst.data as { next_option_offset: number }).next_option_offset,
    16,
  );
  assert.equal(
    (pathFirst.data as { option_paths: string[][] }).option_paths[0].length,
    1,
  );
  assert.ok(
    Buffer.byteLength(JSON.stringify(pathFirst.data), 'utf8') <=
      2 * 1024 * 1024,
  );
  const pathLast = await viewer.client.rpc(
    'metadata_event_custom_page' as never,
    {
      p_kind: 'quantity',
      p_event_id: pathEvent,
      p_side: 'after',
      p_field_id: pathField,
      p_option_offset: 16,
    } as never,
  );
  assert.equal(pathLast.error, null, pathLast.error?.message);
  assert.equal(
    (pathLast.data as { option_paths: unknown[] }).option_paths.length,
    4,
  );
  assert.equal(
    (pathLast.data as { next_option_offset: number | null }).next_option_offset,
    null,
  );
  const deepPath = await viewer.client.rpc(
    'metadata_event_custom_page' as never,
    {
      p_kind: 'quantity',
      p_event_id: pathEvent,
      p_side: 'after',
      p_field_id: hierarchyField,
    } as never,
  );
  assert.equal(deepPath.error, null, deepPath.error?.message);
  assert.equal(
    (deepPath.data as { option_paths: string[][] }).option_paths[0].length,
    64,
  );
  assert.ok(
    Buffer.byteLength(JSON.stringify(deepPath.data), 'utf8') <= 2 * 1024 * 1024,
  );
  await failure(
    staff.client,
    'quantity_update_v2',
    {
      item_id: budgetItem.entity_id,
      expected_version: budgetItem.version,
      name: 'Budget export seed',
      category_id: budgetCategory,
      expected_published_revision_id: budgetRevision,
      custom_patch: {
        set: { [budgetFields[26].id]: largeValue },
        unset: [],
      },
    },
    'P1022',
  );
  const budgetExportFilter = {
    p_query: 'Budget export',
    p_type: 'quantity',
    p_status: 'active',
    p_category_id: budgetCategory,
    p_location_code: null,
    p_low_stock: false,
    p_export_type: 'inventory',
  };
  const oneLarge = await viewer.client.rpc(
    'inventory_export_snapshot' as never,
    {
      ...budgetExportFilter,
      p_include_custom: true,
    } as never,
  );
  assert.equal(oneLarge.error, null, oneLarge.error?.message);
  assert.equal((oneLarge.data as { total: string }).total, '1');
  const compactSearch = await viewer.client.rpc(
    'metadata_describe_batch' as never,
    {
      p_mode: 'search',
      p_keys: [{ kind: 'quantity', id: budgetItem.entity_id }],
    } as never,
  );
  assert.equal(compactSearch.error, null, compactSearch.error?.message);
  const compactSummary = (compactSearch.data as Record<string, string>)[
    `quantity:${budgetItem.entity_id}`
  ];
  assert.ok(compactSummary.length < 1100);
  assert.match(
    compactSummary,
    /summary abbreviated; open record for full values/,
  );
  const copied = await owner.query(
    "insert into public.quantity_items(name,category_id,custom_values) select 'Budget export '||g.n,q.category_id,q.custom_values from public.quantity_items q cross join generate_series(1,8) g(n) where q.id=$1",
    [budgetItem.entity_id],
  );
  assert.equal(copied.rowCount, 8);
  const plainBudget = await viewer.client.rpc(
    'inventory_export_snapshot' as never,
    {
      ...budgetExportFilter,
      p_include_custom: false,
    } as never,
  );
  assert.equal(plainBudget.error, null, plainBudget.error?.message);
  assert.equal((plainBudget.data as { total: string }).total, '9');
  const tooLargeBudget = await viewer.client.rpc(
    'inventory_export_snapshot' as never,
    {
      ...budgetExportFilter,
      p_include_custom: true,
    } as never,
  );
  assert.equal(tooLargeBudget.error?.code, 'P1025');
  const sentinelCategory = await category(maintainer.client, 'Export sentinel');
  try {
    const insertedSentinels = await owner.query(
      "insert into public.quantity_items(name,category_id,reorder_threshold) select 'Sentinel export '||g.n,$1,1 from generate_series(1,10001) g(n)",
      [sentinelCategory],
    );
    assert.equal(insertedSentinels.rowCount, 10001);
    for (const exportType of ['inventory', 'low_stock']) {
      const overCap = await viewer.client.rpc(
        'inventory_export_snapshot' as never,
        {
          p_query: 'Sentinel export',
          p_type: 'quantity',
          p_status: 'active',
          p_category_id: sentinelCategory,
          p_location_code: null,
          p_low_stock: false,
          p_export_type: exportType,
          p_include_custom: false,
        } as never,
      );
      assert.equal(
        overCap.error?.code,
        'P1013',
        `${exportType} must stop at the 10001st key`,
      );
    }
    const inventoryPlan = (
      await owner.query(
        `explain (format json) with candidates as materialized (
        select x.kind,x.entity_id,x.location_id from public.inventory_search_rows x
        where x.category_id=$1 limit 10001
      ) select array_agg(kind),array_agg(entity_id),array_agg(location_id) from candidates`,
        [sentinelCategory],
      )
    ).rows[0]['QUERY PLAN'][0].Plan as {
      'Node Type': string;
      Plans: {
        'Node Type': string;
        'Subplan Name'?: string;
        Plans?: unknown[];
      }[];
    };
    assert.equal(inventoryPlan['Node Type'], 'Aggregate');
    assert.ok(
      inventoryPlan.Plans.some(
        (plan) =>
          plan['Node Type'] === 'Limit' &&
          plan['Subplan Name'] === 'CTE candidates',
      ),
      'inventory export identity-key cap appears before aggregation or hydration',
    );
    const lowStockPlan = (
      await owner.query(
        `explain (format json) with keys as materialized (
        select i.id from public.quantity_items i where exists (
          select 1 from public.inventory_search_rows x
          where x.kind='quantity' and x.entity_id=i.id and x.category_id=$1
            and x.status='active' and x.stock_state in ('needs_restocking','out_of_stock')
        ) limit 10001
      ) select array_agg(k.id) from keys k`,
        [sentinelCategory],
      )
    ).rows[0]['QUERY PLAN'][0].Plan as {
      'Node Type': string;
      Plans: {
        'Node Type': string;
        'Subplan Name'?: string;
        Plans?: unknown[];
      }[];
    };
    assert.equal(lowStockPlan['Node Type'], 'Aggregate');
    assert.ok(
      lowStockPlan.Plans.some(
        (plan) =>
          plan['Node Type'] === 'Limit' && plan['Subplan Name'] === 'CTE keys',
      ),
      'low-stock key cap appears before aggregation or hydration',
    );
  } finally {
    const removed = await owner.query(
      'delete from public.quantity_items where category_id=$1',
      [sentinelCategory],
    );
    assert.equal(
      removed.rowCount,
      10001,
      'export sentinel fixture must be removed',
    );
    const remaining = await owner.query(
      'select count(*)::int as total from public.quantity_items where category_id=$1',
      [sentinelCategory],
    );
    assert.equal(
      remaining.rows[0].total,
      0,
      'export sentinel cleanup is complete',
    );
  }
  const scaleCategory = await category(maintainer.client, 'Publication scale');
  const scaleRows = await owner.query(
    "insert into public.quantity_items(name,category_id) select 'Publication scale '||g.n,$1 from generate_series(1,500) g(n)",
    [scaleCategory],
  );
  assert.equal(scaleRows.rowCount, 500);
  const scaleForm = form(scaleCategory);
  await save(maintainer.client, scaleCategory, '0', scaleForm.definition);
  const scaleImpact = await review(maintainer.client, scaleCategory);
  assert.equal(scaleImpact.affected_quantity, '500');
  const scaleStarted = performance.now();
  await success(maintainer.client, 'metadata_publish', {
    category_id: scaleCategory,
    expected_draft_id: scaleImpact.draft_id,
    expected_draft_version: scaleImpact.draft_version,
    expected_published_revision_id: scaleImpact.published_revision_id,
    review_token: scaleImpact.token,
  });
  const scaleElapsedMs = performance.now() - scaleStarted;
  const scaleState = (
    await owner.query(
      'select count(*) filter(where needs_metadata) flagged,min(version) min_version,max(version) max_version from public.quantity_items where category_id=$1',
      [scaleCategory],
    )
  ).rows[0];
  assert.equal(scaleState.flagged, '500');
  assert.equal(scaleState.min_version, 1);
  assert.equal(scaleState.max_version, 1);
  assert.ok(
    scaleElapsedMs < 5000,
    `500-row publication elapsed ${scaleElapsedMs}ms`,
  );
  console.log(
    `500-row derived-flag publication: ${Math.round(scaleElapsedMs)}ms locally`,
  );
  // PostgREST must hoist the function setting before executing the statement.
  await owner.query(
    "create function public.metadata_timeout_probe() returns text language plpgsql volatile set search_path='' set statement_timeout='5s' as $$ begin perform pg_catalog.pg_sleep(6); return 'late'; end $$",
  );
  try {
    await owner.query(
      'revoke all on function public.metadata_timeout_probe() from public,anon,authenticated',
    );
    await owner.query(
      'grant execute on function public.metadata_timeout_probe() to authenticated',
    );
    await owner.query("notify pgrst, 'reload schema'");
    let probe: { error: { code?: string } | null } | null = null;
    let started = 0;
    for (let attempt = 0; attempt < 12; attempt++) {
      started = performance.now();
      probe = await maintainer.client.rpc('metadata_timeout_probe' as never);
      if (probe.error?.code !== 'PGRST202') break;
      await delay(250);
    }
    assert.equal(probe?.error?.code, '57014');
    const elapsed = performance.now() - started;
    assert.ok(
      elapsed >= 4500 && elapsed < 7500,
      `5s REST budget elapsed ${elapsed}ms`,
    );
  } finally {
    await owner.query('drop function public.metadata_timeout_probe()');
    await owner.query("notify pgrst, 'reload schema'");
  }
  const snapshotCategory = await category(
    maintainer.client,
    'Export snapshot race',
  );
  const snapshotItem = await success(staff.client, 'quantity_create_v2', {
    name: 'Snapshot race item old',
    category_id: snapshotCategory,
    initial_quantity: 0,
    initial_location_id: null,
    expected_published_revision_id: (
      await currentBaseline(staff.client, snapshotCategory)
    ).published_revision_id,
    custom_patch: { set: {}, unset: [] },
  });
  const oldCategoryName = (
    await owner.query('select name from public.categories where id=$1', [
      snapshotCategory,
    ])
  ).rows[0].name as string;
  const snapshotWriter = new Client({
    connectionString: db,
    application_name: 'metadata-export-writer',
  });
  const snapshotReader = new Client({
    connectionString: db,
    application_name: 'metadata-export-reader',
  });
  await snapshotWriter.connect();
  await snapshotReader.connect();
  const exportCall =
    "public.inventory_export_snapshot('Snapshot race item','quantity','active',$1,null,false,'inventory',true)";
  try {
    await snapshotWriter.query('begin');
    await snapshotWriter.query(
      'update public.categories set name=$1,version=version+1 where id=$2',
      [oldCategoryName + ' updated', snapshotCategory],
    );
    await snapshotWriter.query(
      'update public.quantity_items set name=$1,version=version+1 where id=$2',
      ['Snapshot race item new', snapshotItem.entity_id],
    );
    await snapshotReader.query('begin isolation level read committed');
    await snapshotReader.query('set local role authenticated');
    await snapshotReader.query(
      "select set_config('request.jwt.claims',$1,true)",
      [JSON.stringify({ sub: viewer.id, role: 'authenticated' })],
    );
    const readerPid = (
      await snapshotReader.query('select pg_backend_pid() pid')
    ).rows[0].pid as number;
    const pendingSnapshot = snapshotReader.query(
      `with first as materialized (select ${exportCall} doc),
       pause as materialized (select pg_sleep(1.2) from first),
       second as materialized (select ${exportCall} doc from pause)
       select first.doc before_doc,second.doc after_doc from first cross join second`,
      [snapshotCategory],
    );
    let observedPause = false;
    for (let attempt = 0; attempt < 60; attempt++) {
      const state = await owner.query(
        'select wait_event from pg_stat_activity where pid=$1',
        [readerPid],
      );
      observedPause = state.rows[0]?.wait_event === 'PgSleep';
      if (observedPause) break;
      await delay(25);
    }
    assert.equal(
      observedPause,
      true,
      'writer commits while both export reads share one statement',
    );
    await snapshotWriter.query('commit');
    const snapshots = (await pendingSnapshot).rows[0] as {
      before_doc: { rows: { name: string; category_name: string }[] };
      after_doc: { rows: { name: string; category_name: string }[] };
    };
    assert.deepEqual(snapshots.after_doc, snapshots.before_doc);
    assert.equal(snapshots.before_doc.rows[0].name, 'Snapshot race item old');
    assert.equal(snapshots.before_doc.rows[0].category_name, oldCategoryName);
    const nextStatement = (
      await snapshotReader.query(`select ${exportCall} doc`, [snapshotCategory])
    ).rows[0].doc as { rows: { name: string; category_name: string }[] };
    assert.equal(nextStatement.rows[0].name, 'Snapshot race item new');
    assert.equal(
      nextStatement.rows[0].category_name,
      oldCategoryName + ' updated',
    );
  } finally {
    await snapshotReader.query('rollback').catch(() => undefined);
    await snapshotWriter.query('rollback').catch(() => undefined);
    await snapshotReader.end();
    await snapshotWriter.end();
  }
  console.log(
    'Published metadata authorization, draft validation, value evolution, ABA baselines, item create/update and category removal/publication races, stable export snapshot, isolation, REST timeout and bounded export checks passed.',
  );
}
main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await Promise.allSettled(
      actors.map((client) => client.auth.signOut({ scope: 'local' })),
    );
    await owner.end();
  });
