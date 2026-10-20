import { custodyButtons } from './custody-controls';
import { randomUUID } from 'node:crypto';
import { expect, type Locator, type Page } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import fixture from '../fixtures/auth.json' with { type: 'json' };

export async function acceptanceLogin(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Email', { exact: true }).fill(fixture.emails.staff);
  await page.getByLabel('Password', { exact: true }).fill(fixture.password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page).toHaveURL(/\/inventory$/);
}
export async function acceptanceConfirm(form: Locator, action: string) {
  await form
    .getByRole('button', {
      name: custodyButtons(action)[0],
      exact: true,
    })
    .click();
  await expect(
    form.getByRole('region', { name: 'Review changes', exact: true }),
  ).toBeVisible();
  await form
    .getByRole('button', {
      name: custodyButtons(action)[1],
      exact: true,
    })
    .click();
  await expect(
    form
      .page()
      .getByRole('region', { name: 'Record tasks' })
      .getByRole('button', { name: 'Done', exact: true }),
  ).toBeVisible();
}
export async function acceptanceCommand(
  caller: SupabaseClient,
  operation: string,
  payload: Record<string, unknown>,
) {
  const result = await caller.rpc(operation, {
    p_request_id: randomUUID(),
    p_payload: payload,
  });
  expect(result.error, `${operation}: ${result.error?.message}`).toBeNull();
  return result.data as Record<string, string>;
}

/** Disposable loopback-only records; no seeded names, IDs, hierarchy or forms change. */
export async function acceptanceFixtures() {
  const api = new URL(process.env.LOCAL_API_URL!);
  expect(['localhost', '127.0.0.1']).toContain(api.hostname);
  expect(api.port).toBe('54321');
  expect(['localhost', '127.0.0.1']).toContain(
    new URL(process.env.APP_ORIGIN!).hostname,
  );
  const caller = createClient(
    api.href,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  // Trusted fixture-only client, used solely for owned location setup/retention.
  const admin = createClient(api.href, process.env.LOCAL_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const suffix = randomUUID().replaceAll('-', '').slice(0, 12).toUpperCase();
  const categoryCode = `A3-AC-${suffix}`;
  let categoryId = '',
    revisionId = '';
  let categoryCreateAttempted = false;
  const siteCodes = new Set<string>();
  const assets = new Set<string>(),
    quantities = new Set<string>(),
    sites = new Set<string>(),
    locations = new Set<string>();
  async function location(code: string) {
    const row = await caller
      .from('locations')
      .select('id')
      .eq('code', code)
      .single();
    expect(row.error).toBeNull();
    return row.data!.id as string;
  }
  async function asset(name: string, locationId: string) {
    const row = await acceptanceCommand(caller, 'asset_create_v3', {
      name,
      category_id: categoryId,
      location_id: locationId,
      asset_tag: `00aZ-${randomUUID()}`,
      expected_published_revision_id: revisionId,
      custom_patch: { set: {}, unset: [] },
    });
    assets.add(row.entity_id);
    return row.entity_id;
  }
  async function quantity(
    name: string,
    locationId: string | null,
    count: number,
  ) {
    const row = await acceptanceCommand(caller, 'quantity_create_v2', {
      name,
      category_id: categoryId,
      initial_location_id: locationId,
      initial_quantity: count,
      expected_published_revision_id: revisionId,
      custom_patch: { set: {}, unset: [] },
    });
    quantities.add(row.entity_id);
    return row.entity_id;
  }
  async function site() {
    const code = `A3-AC-SITE-${suffix}`;
    siteCodes.add(code);
    await acceptanceCommand(caller, 'site_create', {
      code,
      name: `Acceptance site ${suffix}`,
      notes: null,
    });
    const row = await caller
      .from('sites')
      .select('id')
      .eq('code', code)
      .single();
    expect(row.error).toBeNull();
    sites.add(row.data!.id);
    return { id: row.data!.id as string, code };
  }
  async function ownedLocation(
    name: string,
    parentCode = 'ITO',
    kind: 'storage_area' | 'storage_group' = 'storage_area',
  ) {
    const code = `A3-AC-LOC-${suffix}-${locations.size}`;
    const id = randomUUID();
    locations.add(id);
    const row = await admin
      .from('locations')
      .insert({
        id,
        code,
        name,
        parent_id: await location(parentCode),
        kind,
        can_hold_inventory: kind !== 'storage_group',
      })
      .select('id,code,name')
      .single();
    expect(row.error).toBeNull();
    locations.add(row.data!.id);
    return row.data!;
  }
  function legacyVersion(value: unknown): number {
    expect(typeof value).toBe('number');
    expect(Number.isSafeInteger(value)).toBe(true);
    return value as number;
  }
  async function cleanup() {
    const failures: unknown[] = [];
    const attempt = async (work: () => Promise<void>) => {
      try {
        await work();
      } catch (error) {
        failures.push(error);
      }
    };
    try {
      // A create can commit before the response/revision read fails. Its unique
      // code remains ours even when setup never returned a fixture handle.
      if (!categoryId && categoryCreateAttempted)
        await attempt(async () => {
          const row = await caller
            .from('categories')
            .select('id')
            .eq('code', categoryCode)
            .maybeSingle();
          expect(row.error).toBeNull();
          categoryId = row.data?.id ?? '';
        });
      await attempt(async () => {
        if (!siteCodes.size) return;
        const rows = await caller
          .from('sites')
          .select('id')
          .in('code', [...siteCodes]);
        expect(rows.error).toBeNull();
        for (const row of rows.data!) sites.add(row.id);
      });
      // Also retain unexpected successful UI creations in this owned category.
      // A failed assertion must not leave active records behind.
      await attempt(async () => {
        if (!categoryId) return;
        const rows = await caller
          .from('serialized_assets')
          .select('id')
          .eq('category_id', categoryId);
        expect(rows.error).toBeNull();
        for (const row of rows.data!) assets.add(row.id);
      });
      await attempt(async () => {
        if (!categoryId) return;
        const rows = await caller
          .from('quantity_items')
          .select('id')
          .eq('category_id', categoryId);
        expect(rows.error).toBeNull();
        for (const row of rows.data!) quantities.add(row.id);
      });
      for (const id of assets)
        await attempt(async () => {
          const row = await caller
            .from('serialized_assets')
            .select('status,version,site_id')
            .eq('id', id)
            .single();
          expect(row.error).toBeNull();
          if (row.data!.status !== 'retired')
            await acceptanceCommand(
              caller,
              row.data!.site_id ? 'asset_site_change' : 'asset_retire',
              {
                asset_id: id,
                expected_version: row.data!.site_id
                  ? String(row.data!.version)
                  : legacyVersion(row.data!.version),
                reason: 'Owned Audit3 acceptance fixture cleanup',
                ...(row.data!.site_id
                  ? { action: 'retire', source_site_id: row.data!.site_id }
                  : {}),
              },
            );
        });
      for (const id of quantities)
        await attempt(async () => {
          const row = await caller
            .from('quantity_items')
            .select('archived,version')
            .eq('id', id)
            .single();
          expect(row.error).toBeNull();
          if (!row.data!.archived)
            await acceptanceCommand(caller, 'quantity_archive_and_clear', {
              item_id: id,
              expected_version: legacyVersion(row.data!.version),
              confirm_clear_stock: true,
              reason: 'Owned Audit3 acceptance fixture cleanup',
            });
        });
      for (const id of sites)
        await attempt(async () => {
          const row = await caller
            .from('sites')
            .select('version,active')
            .eq('id', id)
            .single();
          expect(row.error).toBeNull();
          if (row.data!.active)
            await acceptanceCommand(caller, 'site_set_active', {
              site_id: id,
              expected_version: String(row.data!.version),
              active: false,
              reason: 'Owned Audit3 acceptance fixture cleanup',
            });
        });
      // Codes/history are permanent; retain only these empty owned nodes inactive.
      await attempt(async () => {
        if (locations.size) {
          const result = await admin
            .from('locations')
            .update({ active: false, can_hold_inventory: false })
            .in('id', [...locations]);
          expect(result.error).toBeNull();
        }
      });
      await attempt(async () => {
        if (!categoryId) return;
        const replacement = await caller
          .from('categories')
          .select('id')
          .eq('code', 'CABLES')
          .eq('active', true)
          .single();
        expect(replacement.error).toBeNull();
        const review = await caller.rpc('category_removal_review', {
          p_category_id: categoryId,
          p_replacement_id: replacement.data!.id,
        });
        expect(review.error).toBeNull();
        await acceptanceCommand(caller, 'category_remove', {
          category_id: categoryId,
          replacement_id: replacement.data!.id,
          review_token: (review.data as { token: string }).token,
        });
      });
    } finally {
      await attempt(async () => {
        const signedOut = await caller.auth.signOut({ scope: 'local' });
        expect(signedOut.error).toBeNull();
      });
    }
    if (failures.length)
      throw new AggregateError(
        failures,
        'Owned Audit3 acceptance fixture cleanup failed',
      );
  }
  try {
    const signed = await caller.auth.signInWithPassword({
      email: fixture.emails.staff,
      password: fixture.password,
    });
    expect(signed.error).toBeNull();
    categoryCreateAttempted = true;
    const category = await acceptanceCommand(caller, 'category_create', {
      code: categoryCode,
      name: `Acceptance ${suffix}`,
      sort_order: 950,
    });
    categoryId = category.category_id;
    const published = await caller
      .from('categories')
      .select('published_form_revision_id')
      .eq('id', categoryId)
      .single();
    expect(published.error).toBeNull();
    revisionId = published.data!.published_form_revision_id;
    return {
      caller,
      admin,
      actorId: signed.data.user!.id,
      suffix,
      categoryId,
      revisionId,
      assets,
      quantities,
      locations,
      location,
      asset,
      quantity,
      site,
      ownedLocation,
      cleanup,
    };
  } catch (setupError) {
    try {
      await cleanup();
    } catch (cleanupError) {
      throw new AggregateError(
        [setupError, cleanupError],
        'Audit3 acceptance setup and cleanup failed',
      );
    }
    throw setupError;
  }
}
