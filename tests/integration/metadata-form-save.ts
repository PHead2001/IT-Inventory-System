import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { createClient } from '@supabase/supabase-js';
import { Client } from 'pg';
import authFixture from '../fixtures/auth.json' with { type: 'json' };

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
  application_name: 'metadata-form-save',
});
const uuid = randomUUID;

async function actor(maintainer: boolean) {
  const email = `${uuid()}@example.test`;
  const created = await admin.auth.admin.createUser({
    email,
    password: authFixture.password,
    email_confirm: true,
  });
  assert.equal(created.error, null);
  const id = created.data.user!.id;
  await owner.query(
    'insert into public.app_members(user_id,display_name,role,active,can_manage_configuration) values($1,$2,$3,true,$4)',
    [id, 'Form save integration', maintainer ? 'staff' : 'viewer', maintainer],
  );
  const client = createClient(api, process.env.LOCAL_ANON_KEY!, options);
  const signed = await client.auth.signInWithPassword({
    email,
    password: authFixture.password,
  });
  assert.equal(signed.error, null);
  return { id, client };
}

async function main() {
  await owner.connect();
  try {
    const maintainer = await actor(true);
    const viewer = await actor(false);
    const created = await maintainer.client.rpc(
      'category_create' as never,
      {
        p_request_id: uuid(),
        p_payload: {
          code: `FORM-${uuid().slice(0, 12).toUpperCase()}`,
          name: 'Save integration',
          sort_order: 990,
        },
      } as never,
    );
    assert.equal(created.error, null, created.error?.message);
    const categoryId = (created.data as { category_id: string }).category_id;
    // Emulate a previously published definition that predates protection.
    // The effective read must repair it without altering immutable history.
    const seeded = await owner.query(
      'select r.draft_definition from public.categories c join public.category_form_revisions r on r.id=c.published_form_revision_id where c.id=$1',
      [categoryId],
    );
    const legacyDefinition = seeded.rows[0].draft_definition as {
      layout: Array<{ controls: Array<{ builtin?: string }> }>;
    };
    legacyDefinition.layout[0].controls =
      legacyDefinition.layout[0].controls.filter(
        (control) => control.builtin !== 'asset_tag',
      );
    const legacyId = uuid();
    await owner.query(
      "insert into public.category_form_revisions(id,category_id,status,revision_number,draft_definition,published_at) values($1,$2,'published',2,$3::jsonb,now())",
      [legacyId, categoryId, JSON.stringify(legacyDefinition)],
    );
    await owner.query(
      'update public.categories set published_form_revision_id=$1 where id=$2',
      [legacyId, categoryId],
    );
    const get = async () => {
      const response = await maintainer.client.rpc(
        'metadata_form_get_v2' as never,
        { p_category_id: categoryId } as never,
      );
      assert.equal(response.error, null, response.error?.message);
      return response.data as {
        published_revision_id: string;
        published_definition: {
          fields: Array<Record<string, unknown>>;
          layout: Array<{
            id: string;
            label: string;
            visible?: boolean;
            applies_to?: string[];
            controls: Array<Record<string, unknown>>;
          }>;
        };
        draft_id: string | null;
        draft_version: string | null;
      };
    };
    const baseline = await get();
    assert.equal(baseline.draft_id, null);
    assert.equal(
      baseline.published_definition.layout.at(-1)?.label,
      'Identification',
    );
    const tagged = baseline.published_definition.layout
      .flatMap((section) => section.controls)
      .filter((control) => control.builtin === 'asset_tag');
    assert.equal(
      tagged.length,
      1,
      'legacy publication gains one deterministic virtual asset tag',
    );
    const original = await owner.query(
      'select draft_definition from public.category_form_revisions where id=$1',
      [baseline.published_revision_id],
    );
    assert.equal(
      JSON.stringify(original.rows[0].draft_definition).includes(
        'Identification',
      ),
      false,
      'legacy revision JSON stays immutable',
    );

    const request = (definition: unknown, reviewToken?: string) => ({
      category_id: categoryId,
      expected_actor_id: maintainer.id,
      expected_published_revision_id: baseline.published_revision_id,
      expected_draft_id: null,
      expected_draft_version: '0',
      definition,
      ...(reviewToken ? { review_token: reviewToken } : {}),
    });
    const save = async (payload: unknown, requestId = uuid()) =>
      maintainer.client.rpc(
        'metadata_form_save' as never,
        { p_request_id: requestId, p_payload: payload } as never,
      );

    const item = await maintainer.client.rpc(
      'quantity_create_v2' as never,
      {
        p_request_id: uuid(),
        p_payload: {
          name: 'Form save item',
          category_id: categoryId,
          initial_quantity: 0,
          initial_location_id: null,
          expected_published_revision_id: baseline.published_revision_id,
          custom_patch: { set: {}, unset: [] },
        },
      } as never,
    );
    assert.equal(item.error, null, item.error?.message);
    const itemId = (item.data as { entity_id: string }).entity_id;
    const location = (
      await owner.query("select id from public.locations where code='ITC-D01'")
    ).rows[0].id as string;
    const asset = await maintainer.client.rpc(
      'asset_create_v2' as never,
      {
        p_request_id: uuid(),
        p_payload: {
          name: 'Form save asset',
          category_id: categoryId,
          location_id: location,
          expected_published_revision_id: baseline.published_revision_id,
          custom_patch: { set: {}, unset: [] },
        },
      } as never,
    );
    assert.equal(asset.error, null, asset.error?.message);

    const invalid = structuredClone(baseline.published_definition);
    const virtual = invalid.layout.at(-1)!.controls[0];
    virtual.visible = false;
    const invalidId = uuid();
    const denied = await save(request(invalid), invalidId);
    assert.equal(
      denied.error?.code,
      'P1021',
      'protected control cannot be hidden',
    );
    assert.equal(
      (
        await owner.query(
          'select count(*)::int n from private.mutation_requests where actor_id=$1 and request_id=$2',
          [maintainer.id, invalidId],
        )
      ).rows[0].n,
      0,
      'failed save leaves no null receipt',
    );

    const proposed = structuredClone(baseline.published_definition);
    const fieldId = uuid();
    const optionId = uuid();
    proposed.fields.push({
      id: fieldId,
      type: 'single_select',
      label: 'Approval note',
      applies_to: ['quantity'],
      required: true,
      rules: {},
      options: [{ id: optionId, label: 'Ready', active: true }],
    });
    proposed.layout[0].controls.push({
      id: uuid(),
      kind: 'field',
      field_id: fieldId,
      width: 12,
    });
    const hiddenAncestor = structuredClone(proposed);
    const requiredControl = hiddenAncestor.layout[0].controls.pop()!;
    hiddenAncestor.layout.push({
      id: uuid(),
      label: 'Hidden required',
      visible: false,
      controls: [requiredControl],
    });
    assert.equal(
      (await save(request(hiddenAncestor))).error?.code,
      'P1021',
      'required field cannot lose its reachable section',
    );
    const wrongKindAncestor = structuredClone(hiddenAncestor);
    wrongKindAncestor.layout.at(-1)!.visible = true;
    wrongKindAncestor.layout.at(-1)!.applies_to = ['asset'];
    assert.equal(
      (await save(request(wrongKindAncestor))).error?.code,
      'P1021',
      'required quantity field cannot exist only in an asset section',
    );
    const initialId = uuid();
    const first = await save(request(proposed), initialId);
    assert.equal(first.error, null, first.error?.message);
    let review = first.data as {
      status: string;
      token: string;
      expires_at: string;
      changed: boolean;
      reasons: Array<{ kind: string; id: string }>;
      newly_needs_quantity: string;
      affected_quantity: string;
      expected_draft_version: string;
    };
    assert.equal(review.status, 'confirmation_required');
    assert.equal(review.changed, false);
    assert.equal(review.expected_draft_version, '0');
    assert.equal(review.affected_quantity, '1');
    assert.equal(
      (first.data as { affected_assets: string }).affected_assets,
      '0',
      'quantity-only consequence excludes asset records',
    );
    assert.equal(review.newly_needs_quantity, '1');
    assert.ok(
      review.reasons.some(
        (reason) =>
          reason.kind === 'required_tightened' && reason.id === fieldId,
      ),
    );
    const replay = await save(request(proposed), initialId);
    assert.deepEqual(
      replay.data,
      first.data,
      'completed review receipt replays exact token',
    );
    const staged = await owner.query(
      'select count(*)::int n from public.metadata_fields where id=$1',
      [fieldId],
    );
    assert.equal(
      staged.rows[0].n,
      0,
      'review-only compilation left no canonical identity',
    );
    const stagedOption = await owner.query(
      'select count(*)::int n from public.metadata_options where id=$1',
      [optionId],
    );
    assert.equal(
      stagedOption.rows[0].n,
      0,
      'review-only compilation left no canonical option identity',
    );
    assert.equal(
      (await get()).published_revision_id,
      baseline.published_revision_id,
    );
    await owner.query(
      "update private.form_save_reviews set expires_at=clock_timestamp()-interval '1 second' where token=$1",
      [review.token],
    );
    assert.deepEqual(
      (await save(request(proposed), initialId)).data,
      first.data,
      'expired first review still replays its original receipt',
    );
    const expiredId = uuid();
    assert.equal(
      (await save(request(proposed, review.token), expiredId)).error?.code,
      'P1017',
    );
    assert.equal(
      (
        await owner.query(
          'select count(*)::int n from private.mutation_requests where request_id=$1',
          [expiredId],
        )
      ).rows[0].n,
      0,
      'failed confirmation leaves no receipt',
    );
    const refreshed = await save(request(proposed));
    assert.equal(refreshed.error, null, refreshed.error?.message);
    review = refreshed.data as typeof review;
    assert.notEqual(
      review.token,
      first.data && (first.data as { token: string }).token,
    );
    const edited = structuredClone(proposed);
    edited.fields[0].label = 'Edited proposal';
    assert.equal(
      (await save(request(edited, review.token))).error?.code,
      'P1017',
    );

    const confirmedId = uuid();
    const confirmed = await save(request(proposed, review.token), confirmedId);
    assert.equal(confirmed.error, null, confirmed.error?.message);
    const published = confirmed.data as {
      status: string;
      published_revision_id: string;
      version: string;
    };
    assert.equal(published.status, 'saved');
    assert.equal(published.version, '3');
    assert.notEqual(
      published.published_revision_id,
      baseline.published_revision_id,
    );
    const projected = (
      await owner.query(
        'select version,needs_metadata,custom_values from public.quantity_items where id=$1',
        [itemId],
      )
    ).rows[0];
    assert.equal(
      projected.version,
      1,
      'publication does not advance item version',
    );
    assert.equal(
      projected.needs_metadata,
      true,
      'new required field updates derived flag',
    );
    assert.deepEqual(
      projected.custom_values,
      {},
      'publication preserves values',
    );
    assert.deepEqual(
      (await save(request(proposed, review.token), confirmedId)).data,
      confirmed.data,
      'success replay precedes obsolete baseline and token checks',
    );
    assert.equal(
      (await save(request(proposed, review.token))).error?.code,
      'P1002',
      'new request cannot rebase stale review',
    );
    const viewerAttempt = await viewer.client.rpc(
      'metadata_form_save' as never,
      {
        p_request_id: uuid(),
        p_payload: { ...request(proposed), expected_actor_id: viewer.id },
      } as never,
    );
    assert.equal(viewerAttempt.error?.code, 'P1001');
    const event = await owner.query(
      'select count(*)::int n from public.form_publication_events where revision_id=$1',
      [published.published_revision_id],
    );
    assert.equal(event.rows[0].n, 1);

    const current = await get();
    const relabeled = structuredClone(current.published_definition);
    relabeled.layout[0].label = 'Inventory details';
    const ordinaryPayload = {
      ...request(relabeled),
      expected_published_revision_id: current.published_revision_id,
    };
    const ordinary = await save(ordinaryPayload);
    assert.equal(ordinary.error, null, ordinary.error?.message);
    assert.equal(
      (ordinary.data as { status: string }).status,
      'saved',
      'layout and label only edit publishes in one request',
    );

    const moveBaseline = await get();
    const manufacturer =
      moveBaseline.published_definition.layout[0].controls.find(
        (control) => control.builtin === 'manufacturer',
      )!;
    const moveTo = (kinds?: string[]) => {
      const definition = structuredClone(moveBaseline.published_definition);
      definition.layout[0].controls = definition.layout[0].controls.filter(
        (control) => control.id !== manufacturer.id,
      );
      definition.layout.push({
        id: uuid(),
        label: 'Moved details',
        ...(kinds ? { applies_to: kinds } : {}),
        controls: [manufacturer],
      });
      return definition;
    };
    const narrowerMove = await save({
      ...request(moveTo(['asset'])),
      expected_published_revision_id: moveBaseline.published_revision_id,
    });
    assert.equal(narrowerMove.error, null, narrowerMove.error?.message);
    assert.equal(
      (narrowerMove.data as { status: string }).status,
      'confirmation_required',
      'stable control moved to asset-only new section requires review',
    );
    assert.ok(
      (narrowerMove.data as { reasons: Array<{ id: string }> }).reasons.some(
        (reason) => reason.id === manufacturer.id,
      ),
    );
    assert.equal(
      (narrowerMove.data as { affected_quantity: string }).affected_quantity,
      '1',
    );
    assert.equal(
      (narrowerMove.data as { affected_assets: string }).affected_assets,
      '0',
    );
    assert.equal(
      (await get()).published_revision_id,
      moveBaseline.published_revision_id,
    );
    const permuted = structuredClone(moveBaseline.published_definition);
    const oldManufacturer = permuted.layout[0].controls.find(
      (control) => control.id === manufacturer.id,
    )!;
    const oldDescription = permuted.layout[0].controls.find(
      (control) => control.builtin === 'description',
    )!;
    oldManufacturer.builtin = 'description';
    oldDescription.builtin = 'manufacturer';
    permuted.layout[0].controls = permuted.layout[0].controls.filter(
      (control) => control.id !== oldDescription.id,
    );
    permuted.layout.push({
      id: uuid(),
      label: 'Permuted move',
      applies_to: ['asset'],
      controls: [oldDescription],
    });
    const permutationReview = await save({
      ...request(permuted),
      expected_published_revision_id: moveBaseline.published_revision_id,
    });
    assert.equal(
      permutationReview.error,
      null,
      permutationReview.error?.message,
    );
    assert.equal(
      (permutationReview.data as { status: string }).status,
      'confirmation_required',
      'control ID rebinding cannot mask a narrowed builtin',
    );
    assert.ok(
      (
        permutationReview.data as { reasons: Array<{ id: string }> }
      ).reasons.some((reason) => reason.id === manufacturer.id),
    );
    const equalMove = await save({
      ...request(moveTo()),
      expected_published_revision_id: moveBaseline.published_revision_id,
    });
    assert.equal(equalMove.error, null, equalMove.error?.message);
    assert.equal(
      (equalMove.data as { status: string }).status,
      'saved',
      'cross-section move preserving effective kinds saves directly',
    );

    const latest = await get();
    const assetOnly = structuredClone(latest.published_definition);
    const assetFieldId = uuid();
    assetOnly.fields.push({
      id: assetFieldId,
      type: 'boolean',
      label: 'Asset acceptance',
      applies_to: ['asset'],
      required: true,
      rules: {},
      options: [],
    });
    assetOnly.layout[0].controls.push({
      id: uuid(),
      kind: 'field',
      field_id: assetFieldId,
      width: 6,
    });
    const assetReview = await save({
      ...request(assetOnly),
      expected_published_revision_id: latest.published_revision_id,
    });
    assert.equal(assetReview.error, null, assetReview.error?.message);
    assert.equal(
      (assetReview.data as { status: string }).status,
      'confirmation_required',
    );
    assert.equal(
      (assetReview.data as { affected_quantity: string }).affected_quantity,
      '0',
    );
    assert.equal(
      (assetReview.data as { affected_assets: string }).affected_assets,
      '1',
    );
    assert.equal(
      (assetReview.data as { newly_needs_assets: string }).newly_needs_assets,
      '1',
    );
    assert.equal(
      (assetReview.data as { newly_needs_quantity: string })
        .newly_needs_quantity,
      '0',
    );

    const withAssetSection = structuredClone(latest.published_definition);
    const assetSectionId = uuid();
    const serialControl = withAssetSection.layout[0].controls.find(
      (control) => control.builtin === 'serial_number',
    )!;
    withAssetSection.layout[0].controls =
      withAssetSection.layout[0].controls.filter(
        (control) => control.builtin !== 'serial_number',
      );
    withAssetSection.layout.push({
      id: assetSectionId,
      label: 'Asset extras',
      controls: [serialControl],
    });
    const addedSection = await save({
      ...request(withAssetSection),
      expected_published_revision_id: latest.published_revision_id,
    });
    assert.equal(addedSection.error, null, addedSection.error?.message);
    assert.equal((addedSection.data as { status: string }).status, 'saved');
    const sectionBaseline = await get();
    const removingAssetSection = structuredClone(
      sectionBaseline.published_definition,
    );
    removingAssetSection.layout = removingAssetSection.layout.filter(
      (section) => section.id !== assetSectionId,
    );
    const sectionReview = await save({
      ...request(removingAssetSection),
      expected_published_revision_id: sectionBaseline.published_revision_id,
    });
    assert.equal(sectionReview.error, null, sectionReview.error?.message);
    assert.equal(
      (sectionReview.data as { status: string }).status,
      'confirmation_required',
    );
    assert.equal(
      (sectionReview.data as { affected_quantity: string }).affected_quantity,
      '0',
      'asset-only removed section excludes quantity records',
    );
    assert.equal(
      (sectionReview.data as { affected_assets: string }).affected_assets,
      '1',
    );

    const retiring = structuredClone(sectionBaseline.published_definition);
    retiring.fields = retiring.fields.filter((field) => field.id !== fieldId);
    retiring.layout[0].controls = retiring.layout[0].controls.filter(
      (control) => control.field_id !== fieldId,
    );
    const retirementPayload = {
      ...request(retiring),
      expected_published_revision_id: sectionBaseline.published_revision_id,
    };
    const retirement = await save(retirementPayload);
    assert.equal(retirement.error, null, retirement.error?.message);
    const retirementToken = (retirement.data as { token: string }).token;
    const revised = await maintainer.client.rpc(
      'quantity_update_v2' as never,
      {
        p_request_id: uuid(),
        p_payload: {
          item_id: itemId,
          expected_version: 1,
          name: 'Form save item updated',
          category_id: categoryId,
          expected_published_revision_id: sectionBaseline.published_revision_id,
          custom_patch: { set: { [fieldId]: optionId }, unset: [] },
        },
      } as never,
    );
    assert.equal(revised.error, null, revised.error?.message);
    assert.equal(
      (await save({ ...retirementPayload, review_token: retirementToken }))
        .error?.code,
      'P1017',
      'inventory version change invalidates reviewed impact',
    );

    // An uncommitted competing draft is serialized by the catalog lock. Once
    // committed, the exact absent-draft baseline must fail rather than adopt it.
    const race = await actor(true);
    const raceCategory = await race.client.rpc(
      'category_create' as never,
      {
        p_request_id: uuid(),
        p_payload: {
          code: `RACE-${uuid().slice(0, 12).toUpperCase()}`,
          name: 'Save race',
          sort_order: 991,
        },
      } as never,
    );
    assert.equal(raceCategory.error, null);
    const raceId = (raceCategory.data as { category_id: string }).category_id;
    // The competing writer is an old client, so its submitted definition must
    // come from the raw legacy read rather than the v2 effective overlay.
    const raceGet = await race.client.rpc(
      'metadata_form_get' as never,
      { p_category_id: raceId } as never,
    );
    assert.equal(raceGet.error, null);
    const raceBase = raceGet.data as {
      published_revision_id: string;
      published_definition: unknown;
    };
    const competitor = new Client({
      connectionString: db,
      application_name: 'form-save-draft-race',
    });
    await competitor.connect();
    try {
      await competitor.query('begin');
      await competitor.query('set local role authenticated');
      await competitor.query(
        "select set_config('request.jwt.claims',$1,true)",
        [JSON.stringify({ sub: race.id, role: 'authenticated' })],
      );
      await competitor.query(
        'select public.metadata_draft_save($1,$2::jsonb)',
        [
          uuid(),
          JSON.stringify({
            category_id: raceId,
            expected_actor_id: race.id,
            expected_draft_id: null,
            expected_draft_version: '0',
            expected_published_revision_id: raceBase.published_revision_id,
            definition: raceBase.published_definition,
          }),
        ],
      );
      let settled = false;
      const competingSave = race.client
        .rpc(
          'metadata_form_save' as never,
          {
            p_request_id: uuid(),
            p_payload: {
              category_id: raceId,
              expected_actor_id: race.id,
              expected_published_revision_id: raceBase.published_revision_id,
              expected_draft_id: null,
              expected_draft_version: '0',
              definition: raceBase.published_definition,
            },
          } as never,
        )
        .then((value) => {
          settled = true;
          return value;
        });
      await delay(150);
      assert.equal(settled, false, 'save waits for competing catalog writer');
      await competitor.query('commit');
      const stale = await competingSave;
      assert.equal(
        stale.error?.code,
        'P1002',
        'absent draft is an exact baseline',
      );
    } finally {
      await competitor.query('rollback').catch(() => undefined);
      await competitor.end();
    }
    const draftBaselineResponse = await race.client.rpc(
      'metadata_form_get_v2' as never,
      { p_category_id: raceId } as never,
    );
    assert.equal(draftBaselineResponse.error, null);
    const draftBaseline = draftBaselineResponse.data as {
      draft_id: string;
      draft_version: string;
    };
    assert.ok(draftBaseline.draft_id);
    const discarded = await race.client.rpc(
      'metadata_draft_discard' as never,
      {
        p_request_id: uuid(),
        p_payload: {
          category_id: raceId,
          expected_actor_id: race.id,
          expected_draft_id: draftBaseline.draft_id,
          expected_draft_version: draftBaseline.draft_version,
          expected_published_revision_id: raceBase.published_revision_id,
        },
      } as never,
    );
    assert.equal(discarded.error, null, discarded.error?.message);
    const replacement = await race.client.rpc(
      'metadata_draft_save' as never,
      {
        p_request_id: uuid(),
        p_payload: {
          category_id: raceId,
          expected_actor_id: race.id,
          expected_draft_id: null,
          expected_draft_version: '0',
          expected_published_revision_id: raceBase.published_revision_id,
          definition: raceBase.published_definition,
        },
      } as never,
    );
    assert.equal(replacement.error, null, replacement.error?.message);
    const newDraft = replacement.data as { draft_id: string; version: string };
    assert.notEqual(newDraft.draft_id, draftBaseline.draft_id);
    assert.equal(newDraft.version, draftBaseline.draft_version);
    const oldDraftSave = await race.client.rpc(
      'metadata_form_save' as never,
      {
        p_request_id: uuid(),
        p_payload: {
          category_id: raceId,
          expected_actor_id: race.id,
          expected_published_revision_id: raceBase.published_revision_id,
          expected_draft_id: draftBaseline.draft_id,
          expected_draft_version: draftBaseline.draft_version,
          definition: raceBase.published_definition,
        },
      } as never,
    );
    assert.equal(
      oldDraftSave.error?.code,
      'P1002',
      'present draft UUID must reject replacement even at same version',
    );

    const legacyCategory = await maintainer.client.rpc(
      'category_create' as never,
      {
        p_request_id: uuid(),
        p_payload: {
          code: `OLD-${uuid().slice(0, 12).toUpperCase()}`,
          name: 'Legacy publish guard',
          sort_order: 992,
        },
      } as never,
    );
    assert.equal(legacyCategory.error, null, legacyCategory.error?.message);
    const legacyCategoryId = (legacyCategory.data as { category_id: string })
      .category_id;
    const legacyCurrent = await maintainer.client.rpc(
      'metadata_form_get' as never,
      { p_category_id: legacyCategoryId } as never,
    );
    assert.equal(legacyCurrent.error, null);
    const legacyForm = legacyCurrent.data as {
      published_revision_id: string;
      published_definition: {
        layout: Array<{ controls: Array<{ builtin?: string }> }>;
      };
    };
    const unprotected = structuredClone(legacyForm.published_definition);
    for (const section of unprotected.layout) {
      section.controls = section.controls.filter(
        (control) => control.builtin !== 'asset_tag',
      );
    }
    const legacyDraft = await maintainer.client.rpc(
      'metadata_draft_save' as never,
      {
        p_request_id: uuid(),
        p_payload: {
          category_id: legacyCategoryId,
          expected_actor_id: maintainer.id,
          expected_draft_id: null,
          expected_draft_version: '0',
          expected_published_revision_id: legacyForm.published_revision_id,
          definition: unprotected,
        },
      } as never,
    );
    assert.equal(legacyDraft.error, null, legacyDraft.error?.message);
    const draftResult = legacyDraft.data as {
      draft_id: string;
      version: string;
    };
    const legacyReview = await maintainer.client.rpc(
      'metadata_publish_review' as never,
      {
        p_payload: {
          category_id: legacyCategoryId,
          expected_actor_id: maintainer.id,
          expected_draft_id: draftResult.draft_id,
          expected_draft_version: draftResult.version,
          expected_published_revision_id: legacyForm.published_revision_id,
        },
      } as never,
    );
    assert.equal(legacyReview.error, null, legacyReview.error?.message);
    const legacyPublish = await maintainer.client.rpc(
      'metadata_publish' as never,
      {
        p_request_id: uuid(),
        p_payload: {
          category_id: legacyCategoryId,
          expected_actor_id: maintainer.id,
          expected_draft_id: draftResult.draft_id,
          expected_draft_version: draftResult.version,
          expected_published_revision_id: legacyForm.published_revision_id,
          review_token: (legacyReview.data as { token: string }).token,
        },
      } as never,
    );
    assert.equal(
      legacyPublish.error?.code,
      'P1021',
      'legacy publication RPC uses the strengthened protected compiler',
    );

    await owner.query(
      'update public.app_members set can_manage_configuration=false where user_id=$1',
      [maintainer.id],
    );
    assert.equal(
      (await save(request(proposed, review.token), confirmedId)).error?.code,
      'P1001',
      'revoked maintainer cannot replay a completed publication receipt',
    );
    console.log(
      'Atomic form save, cross-section consequences, staged rollback, protected legacy publish, receipts, actor and draft races passed.',
    );
  } finally {
    await owner.end();
  }
}

await main();
