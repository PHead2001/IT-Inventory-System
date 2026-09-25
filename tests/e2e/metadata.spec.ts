import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import fixture from '../fixtures/auth.json' with { type: 'json' };

async function signIn(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Email', { exact: true }).fill(fixture.emails.staff);
  await page.getByLabel('Password', { exact: true }).fill(fixture.password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Inventory workspace' }),
  ).toBeVisible();
}

async function publishDefinition(
  client: SupabaseClient,
  actorId: string,
  categoryId: string,
  definition: unknown,
) {
  const current = await client.rpc(
    'metadata_form_get' as never,
    {
      p_category_id: categoryId,
    } as never,
  );
  expect(current.error).toBeNull();
  const baseline = current.data as {
    draft_id: string | null;
    draft_version: string | null;
    published_revision_id: string;
  };
  const draft = await client.rpc(
    'metadata_draft_save' as never,
    {
      p_request_id: randomUUID(),
      p_payload: {
        category_id: categoryId,
        expected_actor_id: actorId,
        expected_draft_id: baseline.draft_id,
        expected_draft_version: baseline.draft_version ?? '0',
        expected_published_revision_id: baseline.published_revision_id,
        definition,
      },
    } as never,
  );
  expect(draft.error).toBeNull();
  const saved = draft.data as { draft_id: string; version: string };
  const reviewed = await client.rpc(
    'metadata_publish_review' as never,
    {
      p_payload: {
        category_id: categoryId,
        expected_actor_id: actorId,
        expected_draft_id: saved.draft_id,
        expected_draft_version: saved.version,
        expected_published_revision_id: baseline.published_revision_id,
      },
    } as never,
  );
  expect(reviewed.error).toBeNull();
  const review = reviewed.data as { token: string };
  const published = await client.rpc(
    'metadata_publish' as never,
    {
      p_request_id: randomUUID(),
      p_payload: {
        category_id: categoryId,
        expected_actor_id: actorId,
        expected_draft_id: saved.draft_id,
        expected_draft_version: saved.version,
        expected_published_revision_id: baseline.published_revision_id,
        review_token: review.token,
      },
    } as never,
  );
  expect(published.error).toBeNull();
  return (published.data as { published_revision_id: string })
    .published_revision_id;
}

test('published custom field creates and edits with explicit schema-stale review', async ({
  page,
}) => {
  test.setTimeout(90_000);
  const client = createClient(
    process.env.LOCAL_API_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const signed = await client.auth.signInWithPassword({
    email: fixture.emails.staff,
    password: fixture.password,
  });
  expect(signed.error).toBeNull();
  const actorId = signed.data.user!.id;
  const suffix = randomUUID().slice(0, 12).toUpperCase();
  const categoryName = `Browser metadata ${suffix}`;
  const createdCategory = await client.rpc(
    'category_create' as never,
    {
      p_request_id: randomUUID(),
      p_payload: {
        code: `META-E2E-${suffix}`,
        name: categoryName,
        sort_order: 700,
      },
    } as never,
  );
  expect(createdCategory.error).toBeNull();
  const categoryId = (createdCategory.data as { category_id: string })
    .category_id;
  const fieldId = randomUUID();
  const definition = {
    fields: [
      {
        id: fieldId,
        type: 'short_text',
        label: 'Tracking note',
        applies_to: ['quantity'],
        required: true,
        rules: { maxLength: 10 },
        options: [],
      },
    ],
    layout: [
      {
        id: randomUUID(),
        label: 'Details',
        controls: [
          { id: randomUUID(), kind: 'builtin', builtin: 'name', width: 12 },
          {
            id: randomUUID(),
            kind: 'builtin',
            builtin: 'category_id',
            width: 12,
          },
          { id: randomUUID(), kind: 'field', field_id: fieldId, width: 6 },
        ],
      },
    ],
  };
  await publishDefinition(client, actorId, categoryId, definition);
  await signIn(page);
  await page.goto('/inventory/quantity/new');
  const createForm = page.getByRole('form', {
    name: 'Create quantity inventory',
  });
  await createForm
    .getByLabel('Name', { exact: true })
    .fill('Metadata ' + suffix);
  await createForm.getByLabel('Category').selectOption(categoryId);
  await createForm.getByLabel(/Tracking note/).fill('hello');
  await createForm.getByRole('button', { name: 'Review metadata' }).click();
  await expect(
    createForm.getByRole('region', { name: 'Metadata review' }),
  ).toContainText('Metadata ' + suffix);
  await createForm.getByRole('button', { name: 'Confirm save' }).click();
  await expect(page).toHaveURL(/\/inventory\/quantity\/[0-9a-f-]+$/);
  await expect(page.getByText('hello', { exact: true })).toBeVisible();
  const detailUrl = page.url();
  const itemId = detailUrl.split('/').at(-1)!;
  await page.goto('/history?entityId=' + itemId);
  await page
    .getByRole('link', {
      name: 'Custom metadata changed — inspect before and after',
    })
    .first()
    .click();
  await expect(page.getByText('Field absent in this snapshot.')).toBeVisible();
  await page.getByRole('link', { name: 'After event' }).click();
  await expect(
    page.getByRole('heading', { name: 'Tracking note' }),
  ).toBeVisible();
  await expect(page.locator('pre')).toContainText('hello');
  await page.goto(detailUrl);

  const editForm = page.getByRole('form', { name: 'Edit quantity metadata' });
  await editForm.getByLabel(/Tracking note/).fill('world');
  await editForm.getByRole('button', { name: 'Review metadata' }).click();
  await editForm.getByRole('button', { name: 'Confirm save' }).click();
  await expect(page.getByText(/Version 2$/)).toBeVisible();
  await expect(page.getByText('world', { exact: true })).toBeVisible();

  await expect(editForm.getByRole('alert')).toContainText(
    'This record changed from version 1 to 2',
  );
  await editForm
    .getByRole('button', { name: 'Use reviewed record version' })
    .click();
  await editForm.getByLabel(/Tracking note/).fill('five5');
  const stricter = structuredClone(definition);
  stricter.fields[0].rules.maxLength = 4;
  await publishDefinition(client, actorId, categoryId, stricter);
  await editForm.getByRole('button', { name: 'Review metadata' }).click();
  await editForm.getByRole('button', { name: 'Confirm save' }).click();
  await expect(editForm.getByRole('alert')).toContainText(
    'published form changed',
  );
  await expect(editForm.getByLabel(/Tracking note/)).toHaveValue('five5');
  await editForm
    .getByRole('button', { name: 'Use reviewed form revision' })
    .click();
  await expect(editForm.getByLabel(/Tracking note/)).toHaveValue('five5');
  await editForm.getByLabel(/Tracking note/).fill('okay');
  await editForm.getByRole('button', { name: 'Review metadata' }).click();
  await editForm.getByRole('button', { name: 'Confirm save' }).click();
  await expect(page.getByText(/Version 3$/)).toBeVisible();
  await expect(page.getByText('okay', { exact: true })).toBeVisible();
});
