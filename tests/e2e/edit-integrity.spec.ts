import { expect, test } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import fixture from '../fixtures/auth.json' with { type: 'json' };
import { openRecordTask } from './record-task-controls';
import { chooseLocation } from './location-picker';

test('an unchanged individual asset offers Close, while a case-only tag edit creates one real version and event', async ({
  page,
}) => {
  const api = new URL(process.env.LOCAL_API_URL!);
  expect(['localhost', '127.0.0.1']).toContain(api.hostname);
  const client = createClient(
    api.href,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const suffix = crypto.randomUUID().slice(0, 8);
  let assetId: string | undefined;
  try {
    expect(
      (
        await client.auth.signInWithPassword({
          email: fixture.emails.staff,
          password: fixture.password,
        })
      ).error,
    ).toBeNull();
    const category = await client
      .from('categories')
      .select('id,published_form_revision_id')
      .eq('code', 'COMPUTERS')
      .single();
    const storage = await client
      .from('locations')
      .select('id')
      .eq('code', 'ITC-S1A')
      .single();
    expect(category.error).toBeNull();
    expect(storage.error).toBeNull();
    const created = await client.rpc('asset_create_v3', {
      p_request_id: crypto.randomUUID(),
      p_payload: {
        name: `No-op display asset ${suffix}`,
        category_id: category.data!.id,
        expected_published_revision_id:
          category.data!.published_form_revision_id,
        location_id: storage.data!.id,
        asset_tag: `00Ab-${suffix}`,
        custom_patch: {},
      },
    });
    expect(created.error).toBeNull();
    assetId = created.data.entity_id;
    await page.goto('/login');
    await page.getByLabel('Email', { exact: true }).fill(fixture.emails.staff);
    await page.getByLabel('Password', { exact: true }).fill(fixture.password);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(
      page.getByRole('heading', { name: 'Inventory', exact: true }),
    ).toBeVisible();
    await page.goto('/inventory/assets/' + assetId);
    const edit = await openRecordTask(page, 'Edit details');
    await expect(edit.getByText('Nothing to save.')).toBeVisible();
    await expect(
      edit.getByRole('button', { name: 'Confirm save' }),
    ).toHaveCount(0);
    const before = await client
      .from('serialized_assets')
      .select('asset_tag,version,updated_at')
      .eq('id', assetId!)
      .single();
    await edit.getByRole('button', { name: 'Close', exact: true }).click();
    expect(
      (
        await client
          .from('serialized_assets')
          .select('asset_tag,version,updated_at')
          .eq('id', assetId!)
          .single()
      ).data,
    ).toEqual(before.data);
    const correction = await openRecordTask(page, 'Edit details');
    await correction
      .getByLabel('Asset tag', { exact: true })
      .fill(`00aB-${suffix}`);
    await correction.getByRole('button', { name: 'Review details' }).click();
    await expect(
      correction.getByRole('region', { name: 'Metadata review' }),
    ).toContainText(`00Ab-${suffix}`);
    await correction.getByRole('button', { name: 'Confirm save' }).click();
    await expect(correction.getByText('Details saved.')).toBeVisible();
    const after = await client
      .from('serialized_assets')
      .select('asset_tag,version')
      .eq('id', assetId!)
      .single();
    expect(after.data).toEqual({ asset_tag: `00aB-${suffix}`, version: 2 });
    expect(
      (
        await client
          .from('asset_events')
          .select('id', { count: 'exact', head: true })
          .eq('asset_id', assetId!)
          .eq('kind', 'metadata_updated')
      ).count,
    ).toBe(1);
  } finally {
    if (assetId) {
      const current = await client
        .from('serialized_assets')
        .select('version')
        .eq('id', assetId)
        .single();
      expect(
        (
          await client.rpc('asset_retire', {
            p_request_id: crypto.randomUUID(),
            p_payload: {
              asset_id: assetId,
              expected_version: current.data!.version,
              reason: 'End browser regression fixture',
            },
          })
        ).error,
      ).toBeNull();
    }
    await client.auth.signOut();
  }
});

test('Return uses the current assignment origin beyond 25 transfers, and keeps manual/cleared destinations', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const api = new URL(process.env.LOCAL_API_URL!);
  expect(['localhost', '127.0.0.1']).toContain(api.hostname);
  const client = createClient(
    api.href,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const suffix = crypto.randomUUID().slice(0, 8).toUpperCase();
  async function change(operation: string, payload: Record<string, unknown>) {
    const response = await client.rpc(operation, {
      p_request_id: crypto.randomUUID(),
      p_payload: payload,
    });
    expect(response.error, operation).toBeNull();
    return response.data as { entity_id: string; version: string | number };
  }
  let assetId: string | undefined;
  let version = 1;
  let currentSite: string | undefined;
  try {
    expect(
      (
        await client.auth.signInWithPassword({
          email: fixture.emails.staff,
          password: fixture.password,
        })
      ).error,
    ).toBeNull();
    const category = await client
      .from('categories')
      .select('id,published_form_revision_id')
      .eq('active', true)
      .is('removed_at', null)
      .order('code')
      .limit(1)
      .single();
    const storage = await client
      .from('locations')
      .select('id,code')
      .in('code', ['ITC-S1A', 'ITC-S1B'])
      .order('code');
    expect(category.error).toBeNull();
    expect(storage.error).toBeNull();
    const first = storage.data!.find((row) => row.code === 'ITC-S1A')!;
    const second = storage.data!.find((row) => row.code === 'ITC-S1B')!;
    const sites = [];
    for (const n of [1, 2])
      sites.push(
        (
          await change('site_create', {
            code: `RETURN-${suffix}-${n}`,
            name: `Return origin ${suffix} ${n}`,
          })
        ).entity_id,
      );
    const asset = await change('asset_create_v3', {
      name: `Return beyond recent history ${suffix}`,
      category_id: category.data!.id,
      expected_published_revision_id: category.data!.published_form_revision_id,
      location_id: first.id,
      asset_tag: `Return-${suffix}`,
      custom_patch: {},
    });
    assetId = asset.entity_id;
    await change('asset_site_change', {
      action: 'assign',
      asset_id: assetId,
      expected_version: String(version++),
      source_location_id: first.id,
      destination_site_id: sites[0],
    });
    currentSite = sites[0];
    for (let i = 0; i < 30; i++) {
      const destination: string =
        currentSite === sites[0] ? sites[1] : sites[0];
      await change('asset_site_change', {
        action: 'transfer',
        asset_id: assetId,
        expected_version: String(version++),
        source_site_id: currentSite,
        destination_site_id: destination,
      });
      currentSite = destination;
    }
    await page.goto('/login');
    await page.getByLabel('Email', { exact: true }).fill(fixture.emails.staff);
    await page.getByLabel('Password', { exact: true }).fill(fixture.password);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(
      page.getByRole('heading', { name: 'Inventory', exact: true }),
    ).toBeVisible();
    await page.goto('/inventory/assets/' + assetId);
    const form = await openRecordTask(page, 'Return to storage');
    const picker = form.getByRole('combobox', {
      name: 'Return to storage',
      exact: true,
    });
    await expect(picker).toContainText('1A');
    await chooseLocation(form, 'Return to storage', 'ITC-S1B');
    // A separate metadata edit advances the record and causes the existing stale
    // form review flow; it must not reapply the original suggestion over our choice.
    await change('asset_update_v3', {
      asset_id: assetId,
      expected_version: version++,
      name: `Renamed Return ${suffix}`,
      category_id: category.data!.id,
      expected_published_revision_id: category.data!.published_form_revision_id,
      asset_tag: `Return-${suffix}`,
      custom_patch: {},
    });
    await form
      .getByRole('button', { name: 'Review return to storage' })
      .click();
    await form
      .getByRole('button', { name: 'Confirm return to storage' })
      .click();
    await expect(
      form.getByRole('button', { name: 'Review latest holdings' }),
    ).toBeVisible();
    await form.getByRole('button', { name: 'Review latest holdings' }).click();
    await expect(picker).toContainText('1B');
    await form.getByRole('button', { name: 'Clear destination' }).click();
    await expect(picker).toContainText('Select a location');
    // Start a new current episode from a different storage location.
    await change('asset_site_change', {
      action: 'return',
      asset_id: assetId,
      expected_version: String(version++),
      source_site_id: currentSite,
      destination_location_id: second.id,
    });
    await change('asset_site_change', {
      action: 'assign',
      asset_id: assetId,
      expected_version: String(version++),
      source_location_id: second.id,
      destination_site_id: currentSite,
    });
    await page.goto('/inventory/assets/' + assetId);
    const next = await openRecordTask(page, 'Return to storage');
    await expect(
      next.getByRole('combobox', { name: 'Return to storage', exact: true }),
    ).toContainText('1B');
  } finally {
    if (assetId && currentSite)
      await change('asset_site_change', {
        action: 'retire',
        asset_id: assetId,
        expected_version: String(version),
        source_site_id: currentSite,
        reason: 'End browser regression fixture',
      });
    await client.auth.signOut();
  }
});
