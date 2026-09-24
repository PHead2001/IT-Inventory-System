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

async function main() {
  await owner.connect();
  const maintainer = await actor('staff', true);
  const staff = await actor('staff');
  const viewer = await actor('viewer');
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

  const stricter = structuredClone(schema.definition);
  const noteField = stricter.fields.find((field) => field.id === schema.note)!;
  noteField.rules = { maxLength: 2 };
  noteField.required = true;
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
    const raceDraft = structuredClone(stricter);
    raceDraft.fields.find((field) => field.id === schema.note)!.label =
      'Updated notes';
    await save(maintainer.client, categoryId, '0', raceDraft);
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
  const sourceAsset = await success(staff.client, 'asset_create_v2', {
    name: 'Metadata serial',
    category_id: categoryId,
    location_id: location,
    expected_published_revision_id: strictRevision,
    custom_patch: { set: { [schema.flag]: false }, unset: [] },
  });
  const assetId = sourceAsset.entity_id as string;
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
  assert.equal(removal.retained_value_count, '2');
  assert.equal(removal.quantity_needs_metadata_count, '1');
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
  console.log(
    'Published metadata authorization, draft validation, value evolution, stale revisions, observed lock race, isolation, REST timeout and bounded export checks passed.',
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
