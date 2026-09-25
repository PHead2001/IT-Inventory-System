import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { Client } from 'pg';
import fixture from '../fixtures/auth.json' with { type: 'json' };

function local(value: string | undefined, port: number) {
  assert.ok(value, 'local Supabase is required');
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
  application_name: 'custody-read-contract',
});
const uid = () => randomUUID();
const prefix = 'Custody read ' + uid().slice(0, 8);

async function member(
  role: 'staff' | 'viewer' | 'nonmember',
  maintainer = false,
) {
  const email = `${role}-${uid()}@example.test`;
  const created = await admin.auth.admin.createUser({
    email,
    password: fixture.password,
    email_confirm: true,
  });
  assert.equal(created.error, null);
  const actor = created.data.user!.id;
  if (role !== 'nonmember')
    await owner.query(
      'insert into public.app_members(user_id,display_name,role,active,can_manage_configuration) values($1,$2,$3,true,$4)',
      [actor, `${prefix} ${role}`, role, maintainer],
    );
  const client = createClient(api, process.env.LOCAL_ANON_KEY!, options);
  const signed = await client.auth.signInWithPassword({
    email,
    password: fixture.password,
  });
  assert.equal(signed.error, null);
  return { actor, client };
}
async function rpc(
  client: SupabaseClient,
  name: string,
  args: Record<string, unknown> = {},
) {
  const result = await client.rpc(name as never, args as never);
  assert.equal(
    result.error,
    null,
    `${name}: ${result.error?.code} ${result.error?.message}`,
  );
  return result.data as Record<string, unknown>;
}
async function change(
  client: SupabaseClient,
  name: string,
  payload: Record<string, unknown>,
) {
  return rpc(client, name, { p_request_id: uid(), p_payload: payload });
}
async function main() {
  await owner.connect();
  const staff = await member('staff', true);
  const viewer = await member('viewer');
  const outsider = await member('nonmember');
  const selected = await owner.query(`select
    (select id from public.locations where code='ITO-GENERAL') office,
    (select id from public.locations where code='ITC-S1A') closet`);
  const { office, closet } = selected.rows[0];
  const site = await change(staff.client, 'site_create', {
    code: 'READ-' + uid().slice(0, 12).toUpperCase(),
    name: prefix + ' property',
  });
  const otherSite = await change(staff.client, 'site_create', {
    code: 'READ-' + uid().slice(0, 12).toUpperCase(),
    name: prefix + ' second property',
  });
  const category = await change(staff.client, 'category_create', {
    code: 'READ-' + uid().slice(0, 12).toUpperCase(),
    name: prefix + ' category',
    sort_order: 900,
  });
  const categoryId = category.category_id as string;
  const baseline = await rpc(staff.client, 'metadata_form_get', {
    p_category_id: categoryId,
  });
  const fieldId = uid();
  const definition = {
    fields: [
      {
        id: fieldId,
        type: 'short_text',
        label: 'Custody note',
        applies_to: ['quantity'],
        required: false,
        rules: { maxLength: 80 },
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
          { id: uid(), kind: 'field', field_id: fieldId, width: 6 },
        ],
      },
    ],
  };
  const draft = await change(staff.client, 'metadata_draft_save', {
    category_id: categoryId,
    expected_actor_id: staff.actor,
    expected_draft_id: baseline.draft_id,
    expected_draft_version: baseline.draft_version ?? '0',
    expected_published_revision_id: baseline.published_revision_id,
    definition,
  });
  const review = await rpc(staff.client, 'metadata_publish_review', {
    p_payload: {
      category_id: categoryId,
      expected_actor_id: staff.actor,
      expected_draft_id: draft.draft_id,
      expected_draft_version: draft.version,
      expected_published_revision_id: baseline.published_revision_id,
    },
  });
  const published = await change(staff.client, 'metadata_publish', {
    category_id: categoryId,
    expected_actor_id: staff.actor,
    expected_draft_id: draft.draft_id,
    expected_draft_version: draft.version,
    expected_published_revision_id: baseline.published_revision_id,
    review_token: review.token,
  });
  const item = await change(staff.client, 'quantity_create_v2', {
    name: prefix + ' cables',
    category_id: categoryId,
    reorder_threshold: 7,
    initial_location_id: office,
    initial_quantity: 10,
    expected_published_revision_id: published.published_revision_id,
    custom_patch: { set: { [fieldId]: 'traceable site custody' }, unset: [] },
  });
  const itemId = item.entity_id as string;
  const first = await change(staff.client, 'quantity_site_change', {
    action: 'issue',
    item_id: itemId,
    expected_version: '1',
    source_location_id: office,
    destination_site_id: site.entity_id,
    quantity: 3,
  });
  const second = await change(staff.client, 'quantity_site_change', {
    action: 'return',
    item_id: itemId,
    expected_version: first.version,
    source_site_id: site.entity_id,
    destination_location_id: closet,
    quantity: 1,
  });
  const third = await change(staff.client, 'quantity_site_change', {
    action: 'transfer',
    item_id: itemId,
    expected_version: second.version,
    source_site_id: site.entity_id,
    destination_site_id: otherSite.entity_id,
    quantity: 1,
  });
  assert.equal(third.version, '4');
  const totals = await viewer.client
    .from('inventory_quantity_totals')
    .select(
      'available_quantity,assigned_quantity,recorded_quantity,stock_state',
    )
    .eq('item_id', itemId)
    .single();
  assert.equal(totals.error, null);
  assert.deepEqual(totals.data, {
    available_quantity: '8',
    assigned_quantity: '2',
    recorded_quantity: '10',
    stock_state: 'in_stock',
  });
  const direct = await owner.query(
    'select custom_values from public.quantity_items where id=$1',
    [itemId],
  );
  assert.equal(
    direct.rows[0].custom_values[fieldId].validated_revision_id,
    published.published_revision_id,
  );

  const search = (await rpc(viewer.client, 'inventory_search_v3', {
    p_query: prefix + ' cables',
    p_type: 'quantity',
    p_status: 'active',
    p_page_size: 25,
  })) as { rows: Record<string, unknown>[]; total: number };
  assert.equal(
    search.total,
    4,
    'two storage locations and two site holdings each have a distinct row',
  );
  assert.deepEqual(
    new Set(search.rows.map((row) => row.custody_kind)),
    new Set(['storage', 'site']),
  );
  assert.ok(
    search.rows.every(
      (row) =>
        row.available_quantity === '8' &&
        row.assigned_quantity === '2' &&
        row.recorded_quantity === '10' &&
        row.recorded_total === 8,
    ),
  );
  assert.deepEqual(
    search.rows
      .filter((row) => row.site_id)
      .map((row) => row.quantity)
      .sort(),
    [1, 1],
  );
  const siteSearch = (await rpc(viewer.client, 'inventory_search_v3', {
    p_query: prefix + ' cables',
    p_type: 'quantity',
    p_status: 'active',
    p_site_id: site.entity_id,
    p_low_stock: true,
  })) as { rows: Record<string, unknown>[]; total: number };
  assert.equal(
    siteSearch.total,
    0,
    '8 available storage units remain above threshold 7',
  );
  const siteOnly = (await rpc(viewer.client, 'inventory_search_v3', {
    p_query: prefix + ' cables',
    p_site_id: site.entity_id,
  })) as { rows: Record<string, unknown>[]; total: number };
  assert.equal(siteOnly.total, 1);
  assert.equal(siteOnly.rows[0].quantity, 1);
  const locationOnly = (await rpc(viewer.client, 'inventory_search_v3', {
    p_query: prefix + ' cables',
    p_location_code: 'ITO',
  })) as { rows: Record<string, unknown>[]; total: number };
  assert.equal(locationOnly.total, 1);
  assert.equal(locationOnly.rows[0].quantity, 7);

  const snapshot = (await rpc(viewer.client, 'inventory_export_snapshot_v3', {
    p_query: prefix + ' cables',
    p_type: 'quantity',
    p_status: 'active',
    p_category_id: null,
    p_location_code: null,
    p_site_id: null,
    p_low_stock: false,
    p_export_type: 'inventory',
    p_include_custom: true,
  })) as { rows: Record<string, unknown>[]; total: string };
  assert.equal(snapshot.total, '4');
  assert.equal(
    new Set(
      snapshot.rows.map((row) => [row.location_id, row.site_id].join(':')),
    ).size,
    4,
    'export joins each physical and site holding only once',
  );
  assert.ok(
    snapshot.rows.every((row) => !Object.hasOwn(row, 'recorded_total')),
    'ordinary inventory export retains the historical absence of recorded_total',
  );
  assert.deepEqual(
    snapshot.rows
      .filter((row) => row.recorded_quantity !== null)
      .map((row) => [
        row.available_quantity,
        row.assigned_quantity,
        row.recorded_quantity,
      ]),
    [['8', '2', '10']],
    'named definition totals appear once across four holdings',
  );
  assert.ok(
    snapshot.rows
      .filter((row) => row.recorded_quantity === null)
      .every(
        (row) =>
          row.available_quantity === null && row.assigned_quantity === null,
      ),
    'later holding rows do not repeat aggregate stock totals',
  );
  assert.ok(
    snapshot.rows.every((row) => {
      const custom = row.custom_fields as Record<
        string,
        Record<string, unknown>
      >;
      return (
        custom[fieldId]?.value === 'traceable site custody' &&
        custom[fieldId]?.validated_revision_id ===
          published.published_revision_id
      );
    }),
    'custom-field export retains field UUID and validated revision on every holding row',
  );
  const selectedSiteExport = (await rpc(
    viewer.client,
    'inventory_export_snapshot_v3',
    {
      p_query: prefix + ' cables',
      p_type: 'quantity',
      p_status: 'active',
      p_category_id: null,
      p_location_code: null,
      p_site_id: site.entity_id,
      p_low_stock: false,
      p_export_type: 'inventory',
      p_include_custom: false,
    },
  )) as { rows: Record<string, unknown>[]; total: string };
  assert.equal(selectedSiteExport.total, '1');
  assert.deepEqual(
    [
      selectedSiteExport.rows[0].available_quantity,
      selectedSiteExport.rows[0].assigned_quantity,
      selectedSiteExport.rows[0].recorded_quantity,
    ],
    ['8', '2', '10'],
    'site filter includes item-wide totals once for its selected definition',
  );
  const lowStock = (await rpc(viewer.client, 'low_stock_dashboard', {
    p_page: 1,
    p_page_size: 100,
  })) as { rows: { entity_id: string }[] };
  assert.ok(!lowStock.rows.some((row) => row.entity_id === itemId));

  const held = await viewer.client
    .from('site_current_holdings')
    .select('*')
    .eq('site_id', site.entity_id);
  assert.equal(held.error, null);
  assert.equal(held.data?.length, 1);
  const groups = (await rpc(viewer.client, 'site_holding_groups', {
    p_site_id: site.entity_id,
  })) as {
    rows: { quantity_units: string; serialized_devices: string | null }[];
  };
  assert.equal(groups.rows[0].quantity_units, '1');
  assert.equal(groups.rows[0].serialized_devices, null);

  const corrected = await change(staff.client, 'quantity_site_change', {
    action: 'issue',
    item_id: itemId,
    expected_version: third.version,
    source_location_id: office,
    destination_site_id: site.entity_id,
    quantity: 1,
  });
  const boundary = await viewer.client
    .from('inventory_quantity_totals')
    .select(
      'available_quantity,assigned_quantity,recorded_quantity,stock_state',
    )
    .eq('item_id', itemId)
    .single();
  assert.equal(boundary.error, null);
  assert.deepEqual(boundary.data, {
    available_quantity: '7',
    assigned_quantity: '3',
    recorded_quantity: '10',
    stock_state: 'needs_restocking',
  });
  const dashboard = (await rpc(viewer.client, 'low_stock_dashboard', {
    p_page: 1,
    p_page_size: 100,
  })) as {
    rows: {
      entity_id: string;
      recorded_total: number;
      available_quantity: string;
      assigned_quantity: string;
      recorded_quantity: string;
      stock_state: string;
    }[];
  };
  assert.equal(
    dashboard.rows.filter((row) => row.entity_id === itemId).length,
    1,
  );
  const dashboardItem = dashboard.rows.find((row) => row.entity_id === itemId);
  assert.ok(dashboardItem);
  assert.deepEqual(
    {
      recorded_total: dashboardItem.recorded_total,
      available_quantity: dashboardItem.available_quantity,
      assigned_quantity: dashboardItem.assigned_quantity,
      recorded_quantity: dashboardItem.recorded_quantity,
      stock_state: dashboardItem.stock_state,
    },
    {
      recorded_total: 7,
      available_quantity: '7',
      assigned_quantity: '3',
      recorded_quantity: '10',
      stock_state: 'needs_restocking',
    },
    'one dashboard RPC response contains internally coherent stock state and custody totals',
  );
  const filtered = (await rpc(viewer.client, 'inventory_search_v3', {
    p_query: prefix + ' cables',
    p_site_id: site.entity_id,
    p_low_stock: true,
  })) as { rows: Record<string, unknown>[]; total: number };
  assert.equal(filtered.total, 1);
  assert.equal(filtered.rows[0].available_quantity, '7');
  const lowExport = (await rpc(viewer.client, 'inventory_export_snapshot_v3', {
    p_query: prefix + ' cables',
    p_type: 'quantity',
    p_status: 'active',
    p_category_id: null,
    p_location_code: null,
    p_site_id: site.entity_id,
    p_low_stock: true,
    p_export_type: 'low_stock',
    p_include_custom: true,
  })) as { rows: Record<string, unknown>[]; total: string };
  assert.equal(
    lowExport.total,
    '1',
    'low-stock export emits a definition once despite multiple holdings',
  );
  assert.equal(lowExport.rows[0].recorded_total, '10');
  assert.equal(lowExport.rows[0].available_quantity, '7');
  assert.equal(lowExport.rows[0].assigned_quantity, '3');
  assert.match(String(lowExport.rows[0].holding_context), /ITO-GENERAL/);
  assert.match(String(lowExport.rows[0].holding_context), /Site/);
  assert.equal(
    (lowExport.rows[0].custom_fields as Record<string, { value: unknown }>)[
      fieldId
    ].value,
    'traceable site custody',
  );

  const opening = await change(staff.client, 'quantity_site_change', {
    action: 'opening',
    item_id: itemId,
    expected_version: corrected.version,
    destination_site_id: otherSite.entity_id,
    quantity: 1,
  });
  const afterOpening = await viewer.client
    .from('inventory_quantity_totals')
    .select('available_quantity,assigned_quantity,recorded_quantity')
    .eq('item_id', itemId)
    .single();
  assert.equal(afterOpening.error, null);
  assert.deepEqual(afterOpening.data, {
    available_quantity: '7',
    assigned_quantity: '4',
    recorded_quantity: '11',
  });
  const asset = await change(staff.client, 'asset_create_v2', {
    name: prefix + ' laptop',
    category_id: categoryId,
    location_id: office,
    asset_tag: 'READ-' + uid().slice(0, 12).toUpperCase(),
    expected_published_revision_id: published.published_revision_id,
    custom_patch: { set: {}, unset: [] },
  });
  const assignedOnce = await change(staff.client, 'asset_site_change', {
    action: 'assign',
    asset_id: asset.entity_id,
    expected_version: '1',
    source_location_id: office,
    destination_site_id: otherSite.entity_id,
  });
  const returnedAsset = await change(staff.client, 'asset_site_change', {
    action: 'return',
    asset_id: asset.entity_id,
    expected_version: assignedOnce.version,
    source_site_id: otherSite.entity_id,
    destination_location_id: office,
  });
  const assignedTwice = await change(staff.client, 'asset_site_change', {
    action: 'assign',
    asset_id: asset.entity_id,
    expected_version: returnedAsset.version,
    source_location_id: office,
    destination_site_id: otherSite.entity_id,
  });
  const assetSearch = (await rpc(viewer.client, 'inventory_search_v3', {
    p_query: prefix + ' laptop',
    p_site_id: otherSite.entity_id,
  })) as { rows: Record<string, unknown>[]; total: number };
  assert.equal(
    assetSearch.total,
    1,
    'one serialized record has one current site custody',
  );
  assert.equal(assetSearch.rows[0].entity_id, asset.entity_id);
  assert.equal(assetSearch.rows[0].location_id, null);
  assert.equal(assetSearch.rows[0].custody_kind, 'site');
  const assetLabelSearch = (await rpc(viewer.client, 'inventory_label_search', {
    p_query: prefix + ' laptop',
    p_type: 'asset',
    p_status: 'active',
  })) as {
    rows: { entity_id: string; holding_context: string }[];
    total: number;
  };
  assert.equal(assetLabelSearch.total, 1);
  assert.equal(assetLabelSearch.rows[0].entity_id, asset.entity_id);
  assert.ok(
    assetLabelSearch.rows[0].holding_context.includes(
      prefix + ' second property',
    ),
  );
  const currentAssetLabel = (await rpc(
    viewer.client,
    'inventory_label_resolve',
    {
      p_selection: [{ kind: 'asset', key: asset.entity_id }],
    },
  )) as unknown as { key: string; context: string; state: string }[];
  assert.equal(currentAssetLabel.length, 1);
  assert.equal(currentAssetLabel[0].key, asset.entity_id);
  assert.match(currentAssetLabel[0].context, /site/i);
  const activity = (await rpc(viewer.client, 'site_activity_summary', {
    p_site_id: otherSite.entity_id,
  })) as {
    current_quantity_units: string;
    current_serialized_assets: string;
    quantity: {
      gross_issued_units: string;
      opening_units: string;
      transfer_in_units: string;
    };
    serialized: {
      gross_storage_issue_events: string;
      unique_issued_assets: string;
    };
  };
  assert.equal(activity.current_quantity_units, '2');
  assert.equal(activity.current_serialized_assets, '1');
  assert.equal(activity.quantity.opening_units, '1');
  assert.equal(activity.quantity.transfer_in_units, '1');
  assert.equal(activity.quantity.gross_issued_units, '0');
  assert.equal(activity.serialized.gross_storage_issue_events, '2');
  assert.equal(activity.serialized.unique_issued_assets, '1');
  const historical = (await rpc(viewer.client, 'site_activity_summary', {
    p_site_id: otherSite.entity_id,
    p_from: '2000-01-01T00:00:00Z',
    p_until: '2000-01-02T00:00:00Z',
  })) as {
    current_quantity_units: string;
    quantity: { opening_units: string };
  };
  assert.equal(
    historical.current_quantity_units,
    '2',
    'date filters affect events, not current holdings',
  );
  assert.equal(historical.quantity.opening_units, '0');
  const retiredAsset = await change(staff.client, 'asset_site_change', {
    action: 'retire',
    asset_id: asset.entity_id,
    expected_version: assignedTwice.version,
    source_site_id: otherSite.entity_id,
    reason: 'Fictional end-of-life evidence',
  });
  assert.equal(retiredAsset.changed, true);
  const retiredLabel = (await rpc(viewer.client, 'inventory_label_resolve', {
    p_selection: [{ kind: 'asset', key: asset.entity_id }],
  })) as unknown as { key: string; state: string }[];
  assert.equal(
    retiredLabel.length,
    1,
    'retired unlocated asset remains printable by immutable UUID',
  );
  assert.equal(retiredLabel[0].key, asset.entity_id);
  assert.equal(retiredLabel[0].state, 'retired');

  const retiredStorageAsset = await change(staff.client, 'asset_create_v2', {
    name: prefix + ' retired storage laptop',
    category_id: categoryId,
    location_id: office,
    expected_published_revision_id: published.published_revision_id,
    custom_patch: { set: {}, unset: [] },
  });
  await change(staff.client, 'asset_retire', {
    asset_id: retiredStorageAsset.entity_id,
    expected_version: 1,
    reason: 'Fictional retired storage context',
  });
  const retiredStorageLabel = (await rpc(
    viewer.client,
    'inventory_label_resolve',
    {
      p_selection: [{ kind: 'asset', key: retiredStorageAsset.entity_id }],
    },
  )) as unknown as { context: string; state: string }[];
  assert.equal(retiredStorageLabel[0].state, 'retired');
  assert.match(retiredStorageLabel[0].context, /Last recorded storage:/);
  assert.match(retiredStorageLabel[0].context, /General Storage \/ Unsorted/);

  const empty = await change(staff.client, 'quantity_create_v2', {
    name: prefix + ' unlocated empty definition',
    category_id: categoryId,
    initial_location_id: null,
    initial_quantity: 0,
    expected_published_revision_id: published.published_revision_id,
    custom_patch: { set: {}, unset: [] },
  });
  const emptySearch = (await rpc(viewer.client, 'inventory_search_v3', {
    p_query: prefix + ' unlocated empty definition',
    p_type: 'quantity',
  })) as { rows: Record<string, unknown>[]; total: number };
  assert.equal(
    emptySearch.total,
    1,
    'zero-stock definition has one browse row',
  );
  assert.equal(emptySearch.rows[0].entity_id, empty.entity_id);
  assert.equal(emptySearch.rows[0].custody_kind, 'unlocated');
  assert.equal(emptySearch.rows[0].available_quantity, '0');
  assert.equal(emptySearch.rows[0].assigned_quantity, '0');
  assert.equal(emptySearch.rows[0].recorded_quantity, '0');
  const emptyExport = (await rpc(
    viewer.client,
    'inventory_export_snapshot_v3',
    {
      p_query: prefix + ' unlocated empty definition',
      p_type: 'quantity',
      p_status: 'active',
      p_category_id: null,
      p_location_code: null,
      p_site_id: null,
      p_low_stock: false,
      p_export_type: 'inventory',
      p_include_custom: true,
    },
  )) as { rows: Record<string, unknown>[]; total: string };
  assert.equal(emptyExport.total, '1');
  assert.equal(emptyExport.rows[0].entity_id, empty.entity_id);

  const openedDefinition = await change(staff.client, 'quantity_site_open', {
    name: prefix + ' recorded at site',
    description: null,
    category_id: categoryId,
    manufacturer: null,
    model: null,
    reorder_threshold: null,
    site_id: otherSite.entity_id,
    quantity: 2,
    expected_published_revision_id: published.published_revision_id,
    custom_patch: { set: {}, unset: [] },
    reason: null,
    reference: null,
  });
  assert.equal(openedDefinition.version, '1');
  const openedTotals = await viewer.client
    .from('inventory_quantity_totals')
    .select('available_quantity,assigned_quantity,recorded_quantity')
    .eq('item_id', openedDefinition.entity_id)
    .single();
  assert.equal(openedTotals.error, null);
  assert.deepEqual(openedTotals.data, {
    available_quantity: '0',
    assigned_quantity: '2',
    recorded_quantity: '2',
  });
  const siteOnlyLabel = (await rpc(viewer.client, 'inventory_label_resolve', {
    p_selection: [{ kind: 'quantity', key: openedDefinition.entity_id }],
  })) as unknown as { key: string; context: string }[];
  assert.equal(siteOnlyLabel.length, 1);
  assert.equal(siteOnlyLabel[0].key, openedDefinition.entity_id);
  assert.match(siteOnlyLabel[0].context, /site/i);
  let holdingVersion = '1';
  for (let index = 0; index < 4; index++) {
    const extraSite = await change(staff.client, 'site_create', {
      code: `A-READ-${index}-${uid().slice(0, 8).toUpperCase()}`,
      name:
        index === 0
          ? 'Long fictional property ' + 'x'.repeat(175)
          : `${prefix} extra property ${index}`,
    });
    const added = await change(staff.client, 'quantity_site_change', {
      action: 'opening',
      item_id: openedDefinition.entity_id,
      expected_version: holdingVersion,
      destination_site_id: extraSite.entity_id,
      quantity: 1,
    });
    holdingVersion = added.version as string;
  }
  const manyHoldingsLabel = (await rpc(
    viewer.client,
    'inventory_label_resolve',
    {
      p_selection: [{ kind: 'quantity', key: openedDefinition.entity_id }],
    },
  )) as unknown as { key: string; context: string }[];
  assert.equal(manyHoldingsLabel.length, 1);
  assert.match(manyHoldingsLabel[0].context, /\+ 2 more; see item details/);
  assert.match(manyHoldingsLabel[0].context, /Long fictional property/);
  assert.match(manyHoldingsLabel[0].context, /…/);
  assert.ok(
    !manyHoldingsLabel[0].context.includes('extra property 3'),
    'only three deterministic paths are expanded',
  );
  const manyHoldingsSearch = (await rpc(
    viewer.client,
    'inventory_label_search',
    {
      p_query: prefix + ' recorded at site',
      p_type: 'quantity',
    },
  )) as { rows: { entity_id: string; holding_context: string }[] };
  assert.equal(
    manyHoldingsSearch.rows[0].entity_id,
    openedDefinition.entity_id,
  );
  assert.match(
    manyHoldingsSearch.rows[0].holding_context,
    /\+ 2 more; see item details/,
  );
  const openedAsset = await change(staff.client, 'asset_site_open', {
    name: prefix + ' recorded serialized equipment',
    description: null,
    category_id: categoryId,
    manufacturer: null,
    model: null,
    asset_tag: null,
    serial_number: null,
    site_id: otherSite.entity_id,
    expected_published_revision_id: published.published_revision_id,
    custom_patch: { set: {}, unset: [] },
    reason: null,
    reference: null,
  });
  assert.equal(openedAsset.version, '1');
  const openingAssetRow = await viewer.client
    .from('serialized_assets')
    .select('location_id,site_id,status')
    .eq('id', openedAsset.entity_id)
    .single();
  assert.equal(openingAssetRow.error, null);
  assert.deepEqual(openingAssetRow.data, {
    location_id: null,
    site_id: otherSite.entity_id,
    status: 'active',
  });

  const denied = await outsider.client.rpc('inventory_search_v3', {
    p_query: prefix,
  });
  assert.ok(
    denied.error || (denied.data as { rows: unknown[] }).rows.length === 0,
    'nonmember cannot inspect private holdings',
  );
  await owner.query(
    'update public.app_members set active=false where user_id in ($1,$2)',
    [staff.actor, viewer.actor],
  );
  const revoked = await viewer.client.rpc('inventory_search_v3', {
    p_query: prefix,
  });
  assert.ok(
    revoked.error || (revoked.data as { rows: unknown[] }).rows.length === 0,
    'deactivated member cannot read current holdings',
  );
  await Promise.all([
    staff.client.auth.signOut({ scope: 'local' }),
    viewer.client.auth.signOut({ scope: 'local' }),
    outsider.client.auth.signOut({ scope: 'local' }),
  ]);
  console.log(
    'Custody shared reads, filters, low-stock threshold, snapshots, metadata provenance and site metrics passed.',
  );
  void opening;
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await owner.end();
  });
