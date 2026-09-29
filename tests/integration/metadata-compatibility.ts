import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { Client } from 'pg';
import authFixture from '../fixtures/auth.json' with { type: 'json' };
import { formEnvelope as baselineEnvelope } from '../fixtures/metadata-baseline-contract';

const api = process.env.LOCAL_API_URL!;
const db = process.env.LOCAL_DB_URL!;
for (const [url, port] of [
  [api, 54321],
  [db, 54322],
] as const) {
  const parsed = new URL(url);
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname));
  assert.equal(Number(parsed.port), port);
}
const options = { auth: { persistSession: false, autoRefreshToken: false } };
const admin = createClient(api, process.env.LOCAL_SERVICE_ROLE_KEY!, options);
const owner = new Client({
  connectionString: db,
  application_name: 'metadata-legacy-compat',
});
const id = randomUUID;

async function actor(maintainer: boolean) {
  const email = `${id()}@example.test`;
  const created = await admin.auth.admin.createUser({
    email,
    password: authFixture.password,
    email_confirm: true,
  });
  assert.equal(created.error, null, created.error?.message);
  const userId = created.data.user!.id;
  await owner.query(
    'insert into public.app_members(user_id,display_name,role,active,can_manage_configuration) values($1,$2,$3,true,$4)',
    [
      userId,
      'Compatibility integration',
      maintainer ? 'staff' : 'viewer',
      maintainer,
    ],
  );
  const client = createClient(api, process.env.LOCAL_ANON_KEY!, options);
  const signed = await client.auth.signInWithPassword({
    email,
    password: authFixture.password,
  });
  assert.equal(signed.error, null, signed.error?.message);
  return { id: userId, client };
}

async function rpc(
  client: SupabaseClient,
  operation: string,
  payload: unknown,
  requestId = id(),
) {
  return client.rpc(
    operation as never,
    { p_request_id: requestId, p_payload: payload } as never,
  );
}
async function get(client: SupabaseClient, categoryId: string, version: 1 | 2) {
  return client.rpc(
    (version === 1 ? 'metadata_form_get' : 'metadata_form_get_v2') as never,
    { p_category_id: categoryId } as never,
  );
}
async function category(client: SupabaseClient, suffix: string) {
  const response = await rpc(client, 'category_create', {
    code: `COMP-${id().slice(0, 12).toUpperCase()}`,
    name: `Compatibility ${suffix}`,
    sort_order: 995,
  });
  assert.equal(response.error, null, response.error?.message);
  return (response.data as { category_id: string }).category_id;
}
type FormRead = {
  published_revision_id: string;
  published_definition: {
    fields: unknown[];
    layout: Array<{
      id: string;
      label: string;
      visible?: boolean;
      controls: Array<{
        id: string;
        kind: string;
        builtin?: string;
        width: number | string;
        applies_to?: string[];
      }>;
    }>;
  };
  draft_id: string | null;
  draft_version: string | null;
  draft_definition: unknown;
};
function draftPayload(
  actorId: string,
  categoryId: string,
  baseline: FormRead,
  definition: unknown,
  draftId = baseline.draft_id,
  version = baseline.draft_version ?? '0',
) {
  return {
    category_id: categoryId,
    expected_actor_id: actorId,
    expected_draft_id: draftId,
    expected_draft_version: version,
    expected_published_revision_id: baseline.published_revision_id,
    definition,
  };
}
function savePayload(
  actorId: string,
  categoryId: string,
  baseline: FormRead,
  definition: unknown,
) {
  return draftPayload(actorId, categoryId, baseline, definition);
}

async function main() {
  await owner.connect();
  try {
    const maintainer = await actor(true);
    const viewer = await actor(false);
    const firstCategory = await category(maintainer.client, 'baseline');
    const oldRead = await get(maintainer.client, firstCategory, 1);
    assert.equal(oldRead.error, null, oldRead.error?.message);
    baselineEnvelope.parse(oldRead.data); // frozen schema from main 299aef4
    const original = oldRead.data as FormRead;
    const stored = await owner.query(
      'select draft_definition from public.category_form_revisions where id=$1',
      [original.published_revision_id],
    );
    assert.deepEqual(
      original.published_definition,
      stored.rows[0].draft_definition,
      'legacy GET returns original revision JSON without a lossy projection',
    );
    const effective = await get(maintainer.client, firstCategory, 2);
    assert.equal(effective.error, null, effective.error?.message);
    const next = effective.data as FormRead;
    const effectiveAgain = await get(maintainer.client, firstCategory, 2);
    assert.deepEqual(
      effectiveAgain.data,
      effective.data,
      'v2 overlay is deterministic and does not persist history',
    );
    assert.ok(
      next.published_definition.layout
        .flatMap((s) => s.controls)
        .some((c) => c.builtin === 'item_code'),
      'v2 supplies new item-code control',
    );
    assert.deepEqual(
      (
        await owner.query(
          'select draft_definition from public.category_form_revisions where id=$1',
          [original.published_revision_id],
        )
      ).rows[0].draft_definition,
      original.published_definition,
    );

    const unsupported = structuredClone(original.published_definition);
    unsupported.layout[0].visible = true;
    const deniedId = id();
    const denied = await rpc(
      maintainer.client,
      'metadata_draft_save',
      draftPayload(maintainer.id, firstCategory, original, unsupported),
      deniedId,
    );
    assert.equal(
      denied.error?.code,
      'P1030',
      'legacy fresh draft save rejects submitted v2 capabilities',
    );
    assert.equal(
      (
        await owner.query(
          'select count(*)::int n from private.mutation_requests where request_id=$1',
          [deniedId],
        )
      ).rows[0].n,
      0,
      'denial does not commit a null receipt',
    );
    assert.equal(
      (
        await owner.query(
          "select count(*)::int n from public.category_form_revisions where category_id=$1 and status='draft'",
          [firstCategory],
        )
      ).rows[0].n,
      0,
    );

    // An incompatible draft can pre-exist the migration. It stays recoverable
    // through v2, while the old editor cannot read, save or publish it.
    const incompatibleDraftId = id();
    await owner.query(
      "insert into public.category_form_revisions(id,category_id,status,revision_number,draft_version,draft_definition) values($1,$2,'draft',2,1,$3::jsonb)",
      [incompatibleDraftId, firstCategory, JSON.stringify(unsupported)],
    );
    assert.equal(
      (await get(maintainer.client, firstCategory, 1)).error?.code,
      'P1030',
    );
    assert.equal((await get(maintainer.client, firstCategory, 2)).error, null);
    const incompatiblePayload = draftPayload(
      maintainer.id,
      firstCategory,
      original,
      original.published_definition,
      incompatibleDraftId,
      '1',
    );
    assert.equal(
      (await rpc(maintainer.client, 'metadata_draft_save', incompatiblePayload))
        .error?.code,
      'P1030',
    );
    const review = await maintainer.client.rpc(
      'metadata_publish_review' as never,
      {
        p_payload: {
          category_id: firstCategory,
          expected_actor_id: maintainer.id,
          expected_draft_id: incompatibleDraftId,
          expected_draft_version: '1',
          expected_published_revision_id: original.published_revision_id,
        },
      } as never,
    );
    assert.equal(review.error, null, review.error?.message);
    const publishPayload = {
      category_id: firstCategory,
      expected_actor_id: maintainer.id,
      expected_draft_id: incompatibleDraftId,
      expected_draft_version: '1',
      expected_published_revision_id: original.published_revision_id,
      review_token: (review.data as { token: string }).token,
    };
    assert.equal(
      (await rpc(maintainer.client, 'metadata_publish', publishPayload)).error
        ?.code,
      'P1030',
    );
    assert.equal(
      (
        await owner.query(
          'select published_form_revision_id from public.categories where id=$1',
          [firstCategory],
        )
      ).rows[0].published_form_revision_id,
      original.published_revision_id,
    );
    const discard = await rpc(maintainer.client, 'metadata_draft_discard', {
      category_id: firstCategory,
      expected_actor_id: maintainer.id,
      expected_draft_id: incompatibleDraftId,
      expected_draft_version: '1',
      expected_published_revision_id: original.published_revision_id,
    });
    assert.equal(discard.error, null, discard.error?.message);
    assert.equal((await get(maintainer.client, firstCategory, 1)).error, null);

    // A new publication wins the catalog lock, then a pending old writer must
    // see the committed capability and leave no draft or receipt.
    const raceCategory = await category(maintainer.client, 'race');
    const raceOld = (await get(maintainer.client, raceCategory, 1))
      .data as FormRead;
    baselineEnvelope.parse(
      await get(maintainer.client, raceCategory, 1).then((r) => r.data),
    );
    const raceV2 = (await get(maintainer.client, raceCategory, 2))
      .data as FormRead;
    const newDefinition = structuredClone(raceV2.published_definition);
    newDefinition.layout[0].visible = true;
    const writer = new Client({
      connectionString: db,
      application_name: 'metadata-new-publish-race',
    });
    await writer.connect();
    try {
      await writer.query('begin');
      await writer.query('set local role authenticated');
      await writer.query("select set_config('request.jwt.claims',$1,true)", [
        JSON.stringify({ sub: maintainer.id, role: 'authenticated' }),
      ]);
      const committedNew = (
        await writer.query(
          'select public.metadata_form_save($1,$2::jsonb) result',
          [
            id(),
            JSON.stringify(
              savePayload(maintainer.id, raceCategory, raceV2, newDefinition),
            ),
          ],
        )
      ).rows[0].result as { status: string; published_revision_id: string };
      assert.equal(committedNew.status, 'saved');
      const oldRequestId = id();
      let settled = false;
      const oldPending = rpc(
        maintainer.client,
        'metadata_draft_save',
        draftPayload(
          maintainer.id,
          raceCategory,
          raceOld,
          raceOld.published_definition,
        ),
        oldRequestId,
      ).then((value) => {
        settled = true;
        return value;
      });
      await delay(150);
      assert.equal(settled, false, 'old writer waits for catalog publication');
      await writer.query('commit');
      assert.equal(
        (await oldPending).error?.code,
        'P1030',
        'old writer rejects newly committed incompatible publication',
      );
      assert.equal(
        (
          await owner.query(
            'select count(*)::int n from private.mutation_requests where request_id=$1',
            [oldRequestId],
          )
        ).rows[0].n,
        0,
      );
    } finally {
      await writer.query('rollback').catch(() => undefined);
      await writer.end();
    }
    assert.equal(
      (await get(maintainer.client, raceCategory, 1)).error?.code,
      'P1030',
    );
    assert.equal(
      (await get(viewer.client, raceCategory, 1)).error?.code,
      'P1030',
    );
    assert.equal((await get(maintainer.client, raceCategory, 2)).error, null);
    assert.equal(
      (
        await owner.query(
          "select count(*)::int n from public.category_form_revisions where category_id=$1 and status='draft'",
          [raceCategory],
        )
      ).rows[0].n,
      0,
    );

    // Historical successful receipts still replay after a new publication,
    // but the current membership check remains authoritative on every retry.
    const receiptCategory = await category(maintainer.client, 'receipts');
    const receiptOld = (await get(maintainer.client, receiptCategory, 1))
      .data as FormRead;
    const oldDraftId = id();
    const oldDraftPayload = draftPayload(
      maintainer.id,
      receiptCategory,
      receiptOld,
      receiptOld.published_definition,
    );
    const oldDraft = await rpc(
      maintainer.client,
      'metadata_draft_save',
      oldDraftPayload,
      oldDraftId,
    );
    assert.equal(oldDraft.error, null, oldDraft.error?.message);
    const oldDraftResult = oldDraft.data as {
      draft_id: string;
      version: string;
    };
    const oldReview = await maintainer.client.rpc(
      'metadata_publish_review' as never,
      {
        p_payload: {
          category_id: receiptCategory,
          expected_actor_id: maintainer.id,
          expected_draft_id: oldDraftResult.draft_id,
          expected_draft_version: oldDraftResult.version,
          expected_published_revision_id: receiptOld.published_revision_id,
        },
      } as never,
    );
    assert.equal(oldReview.error, null, oldReview.error?.message);
    const oldPublishId = id();
    const oldPublishPayload = {
      category_id: receiptCategory,
      expected_actor_id: maintainer.id,
      expected_draft_id: oldDraftResult.draft_id,
      expected_draft_version: oldDraftResult.version,
      expected_published_revision_id: receiptOld.published_revision_id,
      review_token: (oldReview.data as { token: string }).token,
    };
    const oldPublished = await rpc(
      maintainer.client,
      'metadata_publish',
      oldPublishPayload,
      oldPublishId,
    );
    assert.equal(oldPublished.error, null, oldPublished.error?.message);
    const receiptV2 = (await get(maintainer.client, receiptCategory, 2))
      .data as FormRead;
    const nextDefinition = structuredClone(receiptV2.published_definition);
    nextDefinition.layout[0].visible = true;
    const newer = await rpc(
      maintainer.client,
      'metadata_form_save',
      savePayload(maintainer.id, receiptCategory, receiptV2, nextDefinition),
    );
    assert.equal(newer.error, null, newer.error?.message);
    assert.equal((newer.data as { status: string }).status, 'saved');
    assert.equal(
      (await get(maintainer.client, receiptCategory, 1)).error?.code,
      'P1030',
    );
    assert.deepEqual(
      (
        await rpc(
          maintainer.client,
          'metadata_draft_save',
          oldDraftPayload,
          oldDraftId,
        )
      ).data,
      oldDraft.data,
      'authorized old draft receipt replays despite incompatible current form',
    );
    assert.deepEqual(
      (
        await rpc(
          maintainer.client,
          'metadata_publish',
          oldPublishPayload,
          oldPublishId,
        )
      ).data,
      oldPublished.data,
      'authorized old publication receipt replays before stale checks',
    );
    await owner.query(
      'update public.app_members set can_manage_configuration=false where user_id=$1',
      [maintainer.id],
    );
    assert.equal(
      (
        await rpc(
          maintainer.client,
          'metadata_draft_save',
          oldDraftPayload,
          oldDraftId,
        )
      ).error?.code,
      'P1001',
    );
    assert.equal(
      (
        await rpc(
          maintainer.client,
          'metadata_publish',
          oldPublishPayload,
          oldPublishId,
        )
      ).error?.code,
      'P1001',
    );
    console.log(
      'Frozen baseline GET, v2 overlays, legacy write guards, race, recovery and receipt compatibility passed.',
    );
  } finally {
    await owner.end();
  }
}

await main();
