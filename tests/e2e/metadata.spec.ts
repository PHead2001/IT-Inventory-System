import { chooseLocation } from './location-picker';
import { acceptanceFixtures } from './audit-three-acceptance-fixtures';
import { expectRecordVersion, openRecordTask } from './record-task-controls';
import { metadataReviewButton, metadataSaveButton } from './metadata-controls';
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
    page.getByRole('heading', { name: 'Inventory', exact: true }),
  ).toBeVisible();
}

async function finishMetadata(page: Page) {
  const form = page.getByRole('form', {
    name: 'Edit quantity metadata',
    exact: true,
  });
  await expect(form.getByRole('status')).toHaveText('Details saved.');
  await form.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(
    page
      .getByRole('region', { name: 'Record tasks' })
      .getByRole('button', { name: 'Edit details', exact: true }),
  ).toBeFocused();
}

async function expectStableMetadataDone(page: Page) {
  const form = page.getByRole('form', {
    name: 'Edit quantity metadata',
    exact: true,
  });
  const saved = form.getByRole('status');
  await expect(saved).toHaveText('Details saved.');
  const done = form.getByRole('button', { name: 'Done', exact: true });
  await expect(done).toBeEnabled();
  await page.mouse.move(0, 0);
  await done.scrollIntoViewIfNeeded();
  const neutral = await done.boundingBox();
  expect(neutral).not.toBeNull();
  await page.mouse.move(
    neutral!.x + neutral!.width / 2,
    neutral!.y + neutral!.height - 0.02,
  );
  const samples = await done.evaluate(async (element) => {
    const frames = [];
    for (let frame = 0; frame < 20; frame++) {
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => resolve()),
      );
      const rect = element.getBoundingClientRect();
      frames.push({
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
        hovered: element.matches(':hover'),
      });
    }
    return frames;
  });
  for (const frame of samples) {
    expect(frame.hovered).toBe(true);
    for (const key of ['x', 'y', 'width', 'height'] as const)
      expect(Math.abs(frame[key] - neutral![key])).toBeLessThan(0.001);
  }
  await expect(saved).toHaveText('Details saved.');
}

async function publishDefinition(
  client: SupabaseClient,
  actorId: string,
  categoryId: string,
  definition: unknown,
) {
  const current = await client.rpc(
    'metadata_form_get_v2' as never,
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
  const payload = {
    category_id: categoryId,
    expected_actor_id: actorId,
    expected_draft_id: baseline.draft_id,
    expected_draft_version: baseline.draft_version ?? '0',
    expected_published_revision_id: baseline.published_revision_id,
    definition,
  };
  const first = await client.rpc(
    'metadata_form_save' as never,
    {
      p_request_id: randomUUID(),
      p_payload: payload,
    } as never,
  );
  expect(first.error).toBeNull();
  const firstResult = first.data as { status: string; token?: string };
  const published =
    firstResult.status === 'confirmation_required'
      ? await client.rpc(
          'metadata_form_save' as never,
          {
            p_request_id: randomUUID(),
            p_payload: { ...payload, review_token: firstResult.token },
          } as never,
        )
      : first;
  expect(published.error).toBeNull();
  expect((published.data as { status: string }).status).toBe('saved');
  return (published.data as { published_revision_id: string })
    .published_revision_id;
}

test('published custom fields preserve independent concurrent edits, refresh own saves and require targeted schema review', async ({
  page,
  context,
}) => {
  test.setTimeout(120_000);
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
          {
            id: randomUUID(),
            kind: 'builtin',
            builtin: 'asset_tag',
            width: 6,
            applies_to: ['asset'],
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
    name: 'Add quantity item',
  });
  await createForm
    .getByLabel('Name', { exact: true })
    .fill('Metadata ' + suffix);
  await createForm.getByLabel('Category').selectOption(categoryId);
  await createForm.getByLabel(/Tracking note/).fill('hello');
  await metadataReviewButton(createForm).click();
  await expect(
    createForm.getByRole('region', { name: 'Metadata review' }),
  ).toContainText('Metadata ' + suffix);
  await metadataSaveButton(createForm).click();
  await expect(page).toHaveURL(/\/inventory\/quantity\/[0-9a-f-]+$/);
  await expect(page.getByText('hello', { exact: true })).toBeVisible();
  const detailUrl = page.url();
  const itemId = detailUrl.split('/').at(-1)!;
  await page.goto('/history?entityId=' + itemId);
  await page.getByText('View event details', { exact: true }).first().click();
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
  await page.getByText('Technical recorded value', { exact: true }).click();
  await expect(page.locator('pre')).toBeVisible();
  await expect(page.locator('pre')).toContainText('hello');
  await page.goto(detailUrl);

  await openRecordTask(page, 'Edit quantity metadata');
  const editForm = await openRecordTask(page, 'Edit quantity metadata');
  await editForm.getByLabel(/Tracking note/).fill('world');
  await metadataReviewButton(editForm).click();
  await metadataSaveButton(editForm).click();
  await expectRecordVersion(page, 2);
  await expectStableMetadataDone(page);
  await expectRecordVersion(page, 2);
  await finishMetadata(page);
  await expect(
    page.getByRole('region', { name: 'Record tasks' }).getByRole('button', {
      name: 'Edit details',
      exact: true,
    }),
  ).toBeFocused();
  await openRecordTask(page, 'Edit quantity metadata');
  await expect(page.getByText('world', { exact: true })).toBeVisible();

  await expect(editForm.getByLabel(/Tracking note/)).toHaveValue('world');
  await expect(metadataReviewButton(editForm)).toBeEnabled();
  await expect(editForm.getByText(/changed from version/)).toHaveCount(0);
  await expect(
    editForm.getByRole('button', { name: /Use reviewed .* version/ }),
  ).toHaveCount(0);
  // These pages begin with the same baseline but edit independent fields. The
  // stale complete custom envelope must not overwrite the other page's answer.
  const other = await context.newPage();
  try {
    await other.goto(detailUrl);
    await openRecordTask(other, 'Edit quantity metadata');
    const otherEdit = await openRecordTask(other, 'Edit quantity metadata');
    await editForm
      .getByLabel('Name', { exact: true })
      .fill('Independent ' + suffix);
    await otherEdit.getByLabel(/Tracking note/).fill('newer');
    await metadataReviewButton(otherEdit).click();
    await metadataSaveButton(otherEdit).click();
    await expectRecordVersion(other, 3);
    await metadataReviewButton(editForm).click();
    await metadataSaveButton(editForm).click();
    await expectRecordVersion(page, 4);
    await finishMetadata(page);
    await openRecordTask(page, 'Edit quantity metadata');
    await expect(editForm.getByLabel(/Tracking note/)).toHaveValue('newer');
    await expect(editForm.getByLabel('Name', { exact: true })).toHaveValue(
      'Independent ' + suffix,
    );
    await expect(
      editForm.getByRole('button', { name: /Keep latest|Use my .* edit/ }),
    ).toHaveCount(0);
    await other.reload();
    await openRecordTask(other, 'Edit quantity metadata');
    const converged = 'Converged ' + suffix;
    await editForm.getByLabel('Name', { exact: true }).fill(converged);
    await otherEdit.getByLabel('Name', { exact: true }).fill(converged);
    await metadataReviewButton(otherEdit).click();
    await metadataSaveButton(otherEdit).click();
    await expectRecordVersion(other, 5);
    await metadataReviewButton(editForm).click();
    await metadataSaveButton(editForm).click();
    await expectRecordVersion(page, 6);
    await finishMetadata(page);
    await openRecordTask(page, 'Edit quantity metadata');
    await expect(editForm.getByLabel('Name', { exact: true })).toHaveValue(
      converged,
    );
    await expect(editForm.getByLabel(/Tracking note/)).toHaveValue('newer');
    await expect(
      editForm.getByRole('button', { name: /Keep latest|Use my .* edit/ }),
    ).toHaveCount(0);
  } finally {
    await other.close();
  }
  await editForm.getByLabel(/Tracking note/).fill('five5');
  const stricter = structuredClone(definition);
  stricter.fields[0].rules.maxLength = 4;
  await publishDefinition(client, actorId, categoryId, stricter);
  await metadataReviewButton(editForm).click();
  await metadataSaveButton(editForm).click();
  await expect(
    editForm
      .getByRole('alert')
      .filter({ hasText: 'The category form changed' }),
  ).toContainText('validation rules changed');
  await expect(editForm.getByLabel(/Tracking note/)).toHaveValue('five5');
  await editForm.getByRole('button', { name: 'Review updated fields' }).click();
  await expect(editForm.getByLabel(/Tracking note/)).toHaveValue('five5');
  await editForm.getByLabel(/Tracking note/).fill('okay');
  await metadataReviewButton(editForm).click();
  await metadataSaveButton(editForm).click();
  await expectRecordVersion(page, 7);
  await finishMetadata(page);
  await openRecordTask(page, 'Edit quantity metadata');
  await expect(page.getByText('okay', { exact: true })).toBeVisible();
  // A successful category change establishes its own complete baseline too.
  await editForm.getByLabel('Category').selectOption({ label: 'Cables' });
  await metadataReviewButton(editForm).click();
  await editForm
    .getByRole('checkbox', { name: /existing custom values.*legacy values/ })
    .check();
  await metadataSaveButton(editForm).click();
  await expectRecordVersion(page, 8);
  await finishMetadata(page);
  await openRecordTask(page, 'Edit quantity metadata');
  await expect(metadataReviewButton(editForm)).toBeEnabled();
  await editForm
    .getByLabel('Name', { exact: true })
    .fill('After category ' + suffix);
  await metadataReviewButton(editForm).click();
  await metadataSaveButton(editForm).click();
  await expectRecordVersion(page, 9);
  await page.reload();
  await expect(
    page.getByRole('heading', {
      name: 'After category ' + suffix,
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.getByText('okay', { exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'View all item history' }).click();
  await expect(
    page.getByRole('heading', { name: 'Details updated', exact: true }),
  ).toHaveCount(8);
});

test('creation clears every linked required-field error during correction and both search surfaces retain bounded readable UUID-looking answers', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const owned = await acceptanceFixtures();
  // The bounded projection orders field IDs, so make the first three explicit.
  const previewIds = Array.from({ length: 4 }, () => randomUUID()).sort();
  const fields = [
    {
      id: previewIds[0],
      type: 'short_text',
      label: 'Owner reference',
      required: true,
    },
    {
      id: previewIds[1],
      type: 'integer',
      label: 'Device count',
      required: true,
    },
    { id: previewIds[3], type: 'date', label: 'Needed by', required: true },
    {
      id: previewIds[2],
      type: 'long_text',
      label: 'Long note',
      required: false,
    },
  ];
  const uuidLookingAnswer = '123e4567-e89b-42d3-a456-426614174000';
  const longAnswer = 'Bounded note ' + 'x'.repeat(300);
  const boundedAnswer = longAnswer.slice(0, 256) + '…';
  const name = `Readable answers ${owned.suffix}`;
  try {
    await publishDefinition(owned.caller, owned.actorId, owned.categoryId, {
      fields: fields.map((field) => ({
        ...field,
        applies_to: ['quantity'],
        rules: {},
        options: [],
      })),
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
            {
              id: randomUUID(),
              kind: 'builtin',
              builtin: 'asset_tag',
              width: 12,
              applies_to: ['asset'],
            },
            ...fields.map((field) => ({
              id: randomUUID(),
              kind: 'field',
              field_id: field.id,
              width: 12,
            })),
          ],
        },
      ],
    });
    await signIn(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/inventory/quantity/new');
    const form = page.getByRole('form', {
      name: 'Add quantity item',
      exact: true,
    });
    await form
      .getByLabel('Category', { exact: true })
      .selectOption(owned.categoryId);
    await form.getByLabel('Initial quantity', { exact: true }).fill('1');
    await metadataReviewButton(form).click();
    const summary = form.getByRole('alert');
    for (const label of [
      'Name',
      'Owner reference',
      'Device count',
      'Needed by',
      'Initial location',
    ])
      await expect(
        summary.getByRole('link', { name: label, exact: true }),
      ).toBeVisible();
    for (const [label, value] of [
      ['Name', name],
      ['Owner reference', uuidLookingAnswer],
      ['Device count', '7'],
      ['Needed by', '2026-10-08'],
    ]) {
      await summary.getByRole('link', { name: label, exact: true }).click();
      const field = form.getByLabel(
        label === 'Name' ? label : label + ' (required)',
        { exact: true },
      );
      await expect(field).toBeFocused();
      await field.fill(value);
      await expect(
        summary.getByRole('link', { name: label, exact: true }),
      ).toHaveCount(0);
    }
    await summary
      .getByRole('link', { name: 'Initial location', exact: true })
      .click();
    await chooseLocation(form, 'Initial location', 'ITC-RED');
    // No second Review click is needed to clear the old error summary.
    await expect(summary).toHaveCount(0);
    await expect(
      form.getByRole('region', { name: 'Metadata review', exact: true }),
    ).toHaveCount(0);
    await form.getByLabel('Long note', { exact: true }).fill(longAnswer);
    await metadataReviewButton(form).click();
    await metadataSaveButton(form).click();
    await expect(page).toHaveURL(/\/inventory\/quantity\/[0-9a-f-]+$/);
    const id = new URL(page.url()).pathname.split('/').at(-1)!;
    owned.quantities.add(id);
    await page.goto('/inventory?q=' + encodeURIComponent(name));
    const row = page
      .getByRole('listitem')
      .filter({ has: page.getByRole('link', { name, exact: true }) });
    await expect(row).toContainText('Owner reference: ' + uuidLookingAnswer);
    await expect(row).toContainText('Device count: 7');
    await expect(row).toContainText('Long note: ' + boundedAnswer);
    await expect(
      row.getByRole('link', { name: 'View all details', exact: true }),
    ).toBeVisible();
    await expect(row).not.toContainText(longAnswer);
    await expect(row).not.toContainText('Needed by:');
    for (const field of fields) await expect(row).not.toContainText(field.id);
    await page.goto('/labels');
    const search = page.getByRole('form', {
      name: 'Search label records',
      exact: true,
    });
    await search.getByRole('textbox').fill(name);
    await search.getByRole('button', { name: 'Search', exact: true }).click();
    const labels = page.getByRole('region', {
      name: 'Search result records',
      exact: true,
    });
    // Scope to the existing resultMain container through its real record link.
    const result = labels
      .getByRole('link', { name, exact: true })
      .locator('..');
    // User-facing label results must carry the same bounded human answers.
    await expect(result).toHaveCount(1);
    await expect(result).toContainText('Owner reference: ' + uuidLookingAnswer);
    await expect(result).toContainText('Device count: 7');
    await expect(result).toContainText('Long note: ' + boundedAnswer);
    await expect(
      result.getByRole('link', { name: 'View all details', exact: true }),
    ).toBeVisible();
    await expect(result).not.toContainText(longAnswer);
    await expect(result).not.toContainText('Needed by:');
    for (const field of fields)
      await expect(result).not.toContainText(field.id);
  } finally {
    await owned.cleanup();
  }
});
