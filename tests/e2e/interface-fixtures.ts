import { randomUUID } from 'node:crypto';
import { expect, test as base, type Page } from '@playwright/test';
import fixture from '../fixtures/auth.json' with { type: 'json' };
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { cleanupInterfaceFixture } from '../helpers/interface-fixture-cleanup';

async function command(
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
export const interfaceTest = base.extend<{
  interfaceRecord: {
    id: string;
    categoryId: string;
    name: string;
    itemCode: string;
  };
}>({
  interfaceRecord: async ({ baseURL }, provideRecord) => {
    expect(['localhost', '127.0.0.1']).toContain(new URL(baseURL!).hostname);
    const api = new URL(process.env.LOCAL_API_URL!);
    expect(['localhost', '127.0.0.1']).toContain(api.hostname);
    expect(api.port).toBe('54321');
    const caller = createClient(
      api.href,
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
    const signedIn = await caller.auth.signInWithPassword({
      email: fixture.emails.staff,
      password: fixture.password,
    });
    expect(signedIn.error).toBeNull();
    let categoryId: string | undefined, itemId: string | undefined;
    try {
      const suffix = randomUUID();
      const category = await command(caller, 'category_create', {
        code: 'A3-UI-' + suffix.replaceAll('-', '').slice(0, 16).toUpperCase(),
        name: 'Interface fixture ' + suffix,
        sort_order: 900,
      });
      categoryId = category.category_id;
      const form = await caller
        .from('categories')
        .select('published_form_revision_id')
        .eq('id', categoryId)
        .single();
      expect(form.error).toBeNull();
      const name = 'Interface quantity ' + suffix;
      const itemCode = 'A3-UI-' + suffix.replaceAll('-', '').toUpperCase();
      const item = await command(caller, 'quantity_create_v2', {
        name,
        item_code: itemCode,
        category_id: categoryId,
        initial_quantity: 0,
        expected_published_revision_id: form.data!.published_form_revision_id,
        custom_patch: { set: {}, unset: [] },
      });
      itemId = item.entity_id;
      await provideRecord({ id: itemId, categoryId, name, itemCode });
    } finally {
      await cleanupInterfaceFixture({
        record: async () => {
          if (itemId) {
            const current = await caller
              .from('quantity_items')
              .select('version,archived')
              .eq('id', itemId)
              .single();
            expect(current.error).toBeNull();
            if (!current.data!.archived)
              await command(caller, 'quantity_archive_and_clear', {
                item_id: itemId,
                expected_version: current.data!.version,
                confirm_clear_stock: true,
                reason: 'Owned Audit three interface fixture cleanup',
              });
          }
        },
        category: async () => {
          if (categoryId) {
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
            await command(caller, 'category_remove', {
              category_id: categoryId,
              replacement_id: replacement.data!.id,
              review_token: (review.data as { token: string }).token,
            });
          }
        },
        signOut: async () => {
          const result = await caller.auth.signOut({ scope: 'local' });
          expect(result.error).toBeNull();
        },
      });
    }
  },
});

export async function interfaceLogin(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Email', { exact: true }).fill(fixture.emails.staff);
  await page.getByLabel('Password', { exact: true }).fill(fixture.password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Inventory', exact: true }),
  ).toBeVisible();
}
