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
const owner = new Client({ connectionString: db, application_name: 'metadata-integration' });
const actors: SupabaseClient[] = [];
const uid = randomUUID;
async function actor(role: 'staff' | 'viewer', maintainer = false) {
  const email = `${uid()}@example.test`;
  const created = await admin.auth.admin.createUser({ email, password: authFixture.password, email_confirm: true });
  if (created.error) throw created.error;
  const id = created.data.user.id;
  await owner.query('insert into public.app_members(user_id,display_name,role,active,can_manage_configuration) values($1,$2,$3,true,$4)',
    [id, 'Metadata integration', role, maintainer]);
  const client = createClient(api, process.env.LOCAL_ANON_KEY!, options);
  const signed = await client.auth.signInWithPassword({ email, password: authFixture.password });
  if (signed.error) throw signed.error;
  actors.push(client);
  return { id, client };
}
async function rpc(client: SupabaseClient, operation: string, payload: Record<string, unknown>, requestId = uid()) {
  return client.rpc(operation as never, { p_request_id: requestId, p_payload: payload } as never);
}
async function success(client: SupabaseClient, operation: string, payload: Record<string, unknown>, requestId = uid()) {
  const { data, error } = await rpc(client, operation, payload, requestId);
  assert.equal(error, null, `${operation}: ${error?.code} ${error?.message}`);
  return data as Record<string, unknown>;
}
async function failure(client: SupabaseClient, operation: string, payload: Record<string, unknown>, code: string) {
  const { error } = await rpc(client, operation, payload);
  assert.equal(error?.code, code, `${operation}: ${error?.message}`);
}
async function category(client: SupabaseClient, suffix: string) {
  const result = await success(client, 'category_create', {
    code: 'META-' + uid().replaceAll('-', '').slice(0, 16).toUpperCase(),
    name: 'Metadata ' + suffix + ' ' + uid().slice(0, 8), sort_order: 500,
  });
  return result.category_id as string;
}
function form(categoryId: string) {
  const flag = uid(); const note = uid(); const choice = uid();
  const root = uid(); const child = uid();
  const definition = {
    fields: [
      { id: flag, type: 'boolean', label: 'Inspected', help: 'Record both yes and no.',
        applies_to: ['quantity', 'asset'], required: true, rules: {}, options: [] },
      { id: note, type: 'short_text', label: 'Notes', applies_to: ['quantity'],
        required: false, rules: { maxLength: 5 }, options: [] },
      { id: choice, type: 'hierarchical_select', label: 'Location class',
        applies_to: ['quantity'], required: false, rules: {},
        options: [
          { id: root, label: 'Root', parent_id: null, active: true },
          { id: child, label: 'Child', parent_id: root, active: true },
        ] },
    ],
    layout: [{ id: uid(), label: 'Details', controls: [
      { id: uid(), kind: 'builtin', builtin: 'name', width: 12 },
      { id: uid(), kind: 'builtin', builtin: 'category_id', width: 12 },
      { id: uid(), kind: 'field', field_id: flag, width: 'Auto' },
      { id: uid(), kind: 'field', field_id: note, width: 6 },
      { id: uid(), kind: 'field', field_id: choice, width: 6 },
    ] }],
  };
  return { categoryId, definition, flag, note, choice, root, child };
}
async function save(client: SupabaseClient, categoryId: string, version: string, definition: unknown) {
  return success(client, 'metadata_draft_save', {
    category_id: categoryId, expected_draft_version: version, definition,
  });
}
async function review(client: SupabaseClient, categoryId: string) {
  const { data, error } = await client.rpc('metadata_publish_review' as never, { p_category_id: categoryId } as never);
  assert.equal(error, null, error?.message);
  return data as { token: string; draft_version: string; published_revision_id: string; affected_quantity: string };
}
async function publish(client: SupabaseClient, categoryId: string) {
  const impact = await review(client, categoryId);
  return success(client, 'metadata_publish', {
    category_id: categoryId, expected_draft_version: impact.draft_version,
    expected_published_revision_id: impact.published_revision_id, review_token: impact.token,
  });
}

async function main() {
  await owner.connect();
  const maintainer = await actor('staff', true);
  const staff = await actor('staff');
  const viewer = await actor('viewer');
  const categoryId = await category(maintainer.client, 'Source');
  const location = (await owner.query("select id from public.locations where code='ITC-D01'")).rows[0].id as string;
  const baseline = await viewer.client.rpc('metadata_form_get' as never, { p_category_id: categoryId } as never);
  assert.equal(baseline.error, null);
  assert.ok((baseline.data as { published_revision_id: string }).published_revision_id);
  await failure(staff.client, 'metadata_draft_save', {
    category_id: categoryId, expected_draft_version: '0', definition: {},
  }, 'P1001');
  assert.equal((await viewer.client.from('category_form_revisions').insert({ category_id: categoryId } as never)).error?.code, '42501');
  assert.equal((await staff.client.from('metadata_fields').update({ field_type: 'date' } as never)).error?.code, '42501');

  const malformed = await save(maintainer.client, categoryId, '0', { fields: [], layout: [] });
  assert.equal(malformed.version, '1');
  const invalidImpact = await review(maintainer.client, categoryId);
  await failure(maintainer.client, 'metadata_publish', {
    category_id: categoryId, expected_draft_version: invalidImpact.draft_version,
    expected_published_revision_id: invalidImpact.published_revision_id,
    review_token: invalidImpact.token,
  }, 'P1021');
  await success(maintainer.client, 'metadata_draft_discard', {
    category_id: categoryId, expected_draft_version: '1',
  });
  assert.equal((await owner.query("select count(*) from public.category_form_revisions where category_id=$1 and status='draft'", [categoryId])).rows[0].count, '0');

  const schema = form(categoryId);
  await save(maintainer.client, categoryId, '0', schema.definition);
  const published = await publish(maintainer.client, categoryId);
  const revision = published.published_revision_id as string;
  assert.equal((await viewer.client.rpc('metadata_form_get' as never, { p_category_id: categoryId } as never)).error, null);
  await failure(staff.client, 'quantity_create', { name: 'Legacy blocked', category_id: categoryId,
    initial_quantity: 0, initial_location_id: null }, 'P1023');
  const baseCreate = { name: 'Metadata integration item', category_id: categoryId,
    initial_quantity: 0, initial_location_id: null, expected_published_revision_id: revision };
  await failure(staff.client, 'quantity_create_v2', {
    ...baseCreate, custom_patch: { set: {}, unset: [] },
  }, 'P1023');
  const created = await success(staff.client, 'quantity_create_v2', {
    ...baseCreate, custom_patch: { set: {
      [schema.flag]: false, [schema.note]: 'abc', [schema.choice]: schema.root,
    }, unset: [] },
  });
  assert.equal(created.version, 1);
  const itemId = created.entity_id as string;
  const stored = (await owner.query('select custom_values,needs_metadata from public.quantity_items where id=$1', [itemId])).rows[0];
  assert.equal(stored.custom_values[schema.flag].value, false);
  assert.equal(stored.custom_values[schema.flag].validated_revision_id, revision);
  assert.equal(stored.needs_metadata, false);
  const described = await viewer.client.rpc('metadata_describe_values' as never, {
    p_values: stored.custom_values, p_current_category: categoryId,
  } as never);
  assert.equal(described.error, null);
  assert.deepEqual((described.data as Record<string, { option_paths: string[][] }>)[schema.choice].option_paths,
    [['Root']]);
  await failure(staff.client, 'quantity_update_v2', {
    item_id: itemId, expected_version: 1, name: 'Invalid', category_id: categoryId,
    expected_published_revision_id: revision, custom_patch: { set: { [schema.note]: 'too long' }, unset: [] },
  }, 'P1021');

  const stricter = structuredClone(schema.definition);
  const noteField = stricter.fields.find((field) => field.id === schema.note)!;
  noteField.rules = { maxLength: 2 };
  noteField.required = true;
  await save(maintainer.client, categoryId, '0', stricter);
  const staleReview = await review(maintainer.client, categoryId);
  const same = await success(staff.client, 'quantity_update_v2', {
    item_id: itemId, expected_version: 1, name: 'Metadata integration item updated', category_id: categoryId,
    expected_published_revision_id: revision, custom_patch: { set: {}, unset: [] },
  });
  await failure(maintainer.client, 'metadata_publish', {
    category_id: categoryId, expected_draft_version: staleReview.draft_version,
    expected_published_revision_id: staleReview.published_revision_id, review_token: staleReview.token,
  }, 'P1017');
  const stricterPublished = await publish(maintainer.client, categoryId);
  const strictRevision = stricterPublished.published_revision_id as string;
  await failure(staff.client, 'quantity_update_v2', {
    item_id: itemId, expected_version: same.version, name: 'Old schema', category_id: categoryId,
    expected_published_revision_id: revision, custom_patch: { set: {}, unset: [] },
  }, 'P1024');
  const grandfather = await success(staff.client, 'quantity_update_v2', {
    item_id: itemId, expected_version: same.version, name: 'Grandfathered', category_id: categoryId,
    expected_published_revision_id: strictRevision,
    custom_patch: { set: { [schema.note]: 'abc' }, unset: [] },
  });
  assert.equal(grandfather.needs_metadata, true);
  const current = (await owner.query('select custom_values,needs_metadata from public.quantity_items where id=$1', [itemId])).rows[0];
  assert.equal(current.custom_values[schema.note].validated_revision_id, revision,
    'resubmitting an identical old value keeps server provenance');
  await failure(staff.client, 'quantity_update_v2', {
    item_id: itemId, expected_version: grandfather.version, name: 'Invalid changed', category_id: categoryId,
    expected_published_revision_id: strictRevision,
    custom_patch: { set: { [schema.note]: 'abcd' }, unset: [] },
  }, 'P1021');
  await failure(staff.client, 'quantity_update_v2', {
    item_id: itemId, expected_version: grandfather.version, name: 'Required unset', category_id: categoryId,
    expected_published_revision_id: strictRevision,
    custom_patch: { set: {}, unset: [schema.note] },
  }, 'P1021');

  const independent = new Client({ connectionString: db, application_name: 'metadata-catalog-race' });
  await independent.connect();
  try {
    await independent.query('begin');
    await independent.query('set local role authenticated');
    await independent.query("select set_config('request.jwt.claims',$1,true)",
      [JSON.stringify({ sub: staff.id, role: 'authenticated' })]);
    await independent.query('select public.quantity_update_v2($1,$2::jsonb)', [uid(), JSON.stringify({
      item_id: itemId, expected_version: grandfather.version, name: 'Race winner', category_id: categoryId,
      expected_published_revision_id: strictRevision, custom_patch: { set: {}, unset: [] },
    })]);
    const raceDraft = structuredClone(stricter);
    (raceDraft.fields.find((field) => field.id === schema.note)!).label = 'Updated notes';
    await save(maintainer.client, categoryId, '0', raceDraft);
    const raceReview = await review(maintainer.client, categoryId);
    let settled = false;
    const competing = rpc(maintainer.client, 'metadata_publish', {
      category_id: categoryId, expected_draft_version: raceReview.draft_version,
      expected_published_revision_id: raceReview.published_revision_id, review_token: raceReview.token,
    }).then((value) => { settled = true; return value; });
    await delay(100);
    assert.equal(settled, false, 'exclusive publication waits behind independent shared writer');
    await independent.query('commit');
    assert.equal((await competing).error?.code, 'P1017');
  } finally {
    await independent.query('rollback').catch(() => undefined);
    await independent.end();
  }

  const snapshot = await viewer.client.rpc('inventory_export_snapshot' as never, {
    p_query: 'Race winner', p_type: 'quantity', p_status: 'all',
    p_category_id: categoryId, p_location_code: null, p_low_stock: false,
    p_export_type: 'inventory', p_include_custom: true,
  } as never);
  assert.equal(snapshot.error, null, snapshot.error?.message);
  const exported = snapshot.data as { total: string; rows: { custom_fields: Record<string, unknown> }[] };
  assert.equal(exported.total, '1');
  assert.ok(exported.rows[0].custom_fields[schema.note]);
  const currentForm = await viewer.client.rpc('metadata_form_get' as never, { p_category_id: categoryId } as never);
  assert.equal((currentForm.data as { published_revision_id: string }).published_revision_id, strictRevision);
  console.log('Published metadata authorization, draft validation, value evolution, stale revisions, race and bounded export checks passed.');
}
main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(async () => {
  await Promise.allSettled(actors.map((client) => client.auth.signOut({ scope: 'local' })));
  await owner.end();
});
