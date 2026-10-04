import { openRecordTask } from './record-task-controls';
import { metadataReviewButton, metadataSaveButton } from './metadata-controls';
import { randomUUID } from 'node:crypto';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import fixture from '../fixtures/auth.json' with { type: 'json' };
import { chooseLocation } from './location-picker';

async function signIn(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Email', { exact: true }).fill(fixture.emails.staff);
  await page.getByLabel('Password', { exact: true }).fill(fixture.password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Inventory', exact: true }),
  ).toBeVisible();
}

async function reviewMetadata(form: Locator) {
  await metadataReviewButton(form).click();
  await expect(
    form.getByRole('region', { name: 'Metadata review' }),
  ).toBeVisible();
  await metadataSaveButton(form).click();
  if ((await form.getAttribute('aria-label')) === 'Edit quantity metadata') {
    await expect(
      form.getByRole('status').filter({ hasText: /^Metadata saved\.$/ }),
    ).toBeVisible();
    await expect(metadataReviewButton(form)).toBeEnabled();
    await expect(
      form.getByRole('button', { name: 'Retry saved record refresh' }),
    ).toHaveCount(0);
  }
}

async function reviewStock(form: Locator, action: string) {
  await form
    .getByRole('button', { name: `Review ${action.toLowerCase()}` })
    .click();
  await expect(
    form.getByRole('region', { name: 'Review changes' }),
  ).toBeVisible();
  await form
    .getByRole('button', { name: `Confirm ${action.toLowerCase()}` })
    .click();
}

async function openEditForm(page: Page) {
  return openRecordTask(page, 'Edit quantity metadata');
}

async function readyQuantityLabel(page: Page, id: string, name: string) {
  await page.goto(`/labels?quantity=${id}`);
  await expect(
    page.getByRole('status').filter({
      hasText: 'Print preview refreshed from current inventory',
    }),
  ).toBeVisible();
  const card = page.locator('.label-card').filter({ hasText: name });
  await expect(card).toHaveCount(1);
  await expect(card).toHaveAttribute('data-code-ready', 'true');
  return card;
}

async function expectStock(
  page: Page,
  available: number,
  assigned: number,
  balances: Record<string, number>,
) {
  const stock = page.locator('section').filter({
    has: page.getByRole('heading', {
      name: `Current stock — ${available} available in storage`,
    }),
  });
  await expect(stock).toContainText(`${assigned} assigned to sites`);
  for (const [code, units] of Object.entries(balances)) {
    const row = stock.locator('li').filter({
      has: page.getByRole('link', { name: new RegExp(code) }),
    });
    if (units > 0) await expect(row).toContainText(`${units} units`);
    else await expect(row).toHaveCount(0);
  }
}

test('quantity label identity survives receipt, move, issue and return while print diagnostics stay off the sheet', async ({
  page,
}) => {
  test.setTimeout(150_000);
  await signIn(page);
  const suffix = randomUUID().slice(0, 8);
  const name = `Permanent adapters ${suffix}`;
  const siteCode = `E2E-LABEL-${suffix.toUpperCase()}`;
  await page.goto('/settings/sites');
  const site = page.locator('form').filter({
    has: page.getByRole('heading', { name: 'Add property/site' }),
  });
  await site.getByLabel('Name', { exact: true }).fill(`Label site ${suffix}`);
  await site.getByLabel('Permanent code', { exact: true }).fill(siteCode);
  await site.getByRole('button', { name: 'Save site' }).click();
  await expect(site.getByRole('status')).toContainText('Site saved');

  await page.goto('/inventory/quantity/new');
  const create = page.getByRole('form', { name: 'Add quantity item' });
  await create.getByLabel('Name', { exact: true }).fill(name);
  await create.getByLabel('Initial quantity').fill('10');
  await chooseLocation(create, 'Initial location', 'ITC-S1A');
  await reviewMetadata(create);
  await expect(page).toHaveURL(/\/inventory\/quantity\/[0-9a-f-]+$/);
  const id = page.url().split('/').at(-1)!;
  const detail = `/inventory/quantity/${id}`;
  await expectStock(page, 10, 0, { 'ITC-S1A': 10 });
  let card = await readyQuantityLabel(page, id, name);
  const permanentText = await card.innerText();
  const permanentQr = await card
    .getByRole('img', { name: /QR code for/ })
    .getAttribute('src');
  expect(permanentText).toContain(name);
  expect(permanentText).not.toMatch(
    /Holdings|available|assigned|\b10 units\b/i,
  );
  expect(permanentQr).toMatch(/^data:image\/png;base64,/);

  const unchanged = async () => {
    card = await readyQuantityLabel(page, id, name);
    expect(await card.innerText()).toBe(permanentText);
    await expect(
      card.getByRole('img', { name: /QR code for/ }),
    ).toHaveAttribute('src', permanentQr!);
  };

  await page.goto(detail);
  const receive = await openRecordTask(page, 'Receive stock');
  await openRecordTask(page, 'Receive stock');
  await chooseLocation(receive, 'Receive at', 'ITC-S1B');
  await receive.getByLabel('Quantity to receive').fill('5');
  await receive.getByLabel('Reason (required)').fill('Label stability receipt');
  await reviewStock(receive, 'Receive stock');
  await expectStock(page, 15, 0, { 'ITC-S1A': 10, 'ITC-S1B': 5 });
  await unchanged();

  await page.goto(detail);
  const move = await openRecordTask(page, 'Move stock');
  await openRecordTask(page, 'Move stock');
  await chooseLocation(move, 'Source location', 'ITC-S1A');
  await chooseLocation(move, 'Destination location', 'ITC-S1C');
  await move.getByLabel('Quantity to move').fill('2');
  await reviewStock(move, 'Move stock');
  await expectStock(page, 15, 0, {
    'ITC-S1A': 8,
    'ITC-S1B': 5,
    'ITC-S1C': 2,
  });
  await unchanged();

  await page.goto(detail);
  const issue = page.locator('form').filter({
    has: page.getByRole('heading', {
      name: 'Issue stock to a site',
      exact: true,
    }),
  });
  await chooseLocation(issue, 'Storage source', 'ITC-S1B');
  await issue
    .getByLabel('Destination site')
    .selectOption({ label: `Label site ${suffix} (${siteCode})` });
  await issue.getByLabel('Units').fill('3');
  await issue.getByRole('button', { name: 'Issue stock to a site' }).click();
  await expect(issue.getByRole('status')).toContainText('Custody saved');
  await expectStock(page, 12, 3, {
    'ITC-S1A': 8,
    'ITC-S1B': 2,
    'ITC-S1C': 2,
  });
  await unchanged();

  await page.goto(detail);
  const returned = page.locator('form').filter({
    has: page.getByRole('heading', { name: 'Return to storage', exact: true }),
  });
  await returned
    .getByLabel('Source site')
    .selectOption({ label: `Label site ${suffix} (${siteCode})` });
  await chooseLocation(returned, 'Return to storage', 'ITC-S1B');
  await returned.getByLabel('Units').fill('1');
  await returned.getByRole('button', { name: 'Return to storage' }).click();
  await expect(returned.getByRole('status')).toContainText('Custody saved');
  await expectStock(page, 13, 2, {
    'ITC-S1A': 8,
    'ITC-S1B': 3,
    'ITC-S1C': 2,
  });
  await unchanged();

  await page.getByRole('combobox', { name: 'Code' }).selectOption('code128');
  await expect(card).toHaveAttribute('data-code-fallback', 'true');
  const fallbackMessage = page.getByText(
    /queued record\(s\) will use stable QR links/i,
  );
  await expect(fallbackMessage).toBeVisible();
  await expect(card.getByText('Preview label')).toBeVisible();
  await page.evaluate(() => {
    window.print = () => {
      window.dispatchEvent(new Event('beforeprint'));
      document.body.dataset.verifiedPrint =
        document
          .querySelector('.label-print-root')
          ?.getAttribute('data-print-authorized') ?? 'missing';
    };
  });
  await expect(
    page.getByRole('button', { name: /Print selected labels/ }),
  ).toBeDisabled();
  await expect(
    page.getByRole('button', { name: 'Acknowledge QR fallback' }),
  ).toBeVisible();
  await expect(page.locator('body')).not.toHaveAttribute(
    'data-verified-print',
    'true',
  );
  await page.getByRole('button', { name: 'Acknowledge QR fallback' }).click();
  await page.getByRole('button', { name: /Print selected labels/ }).click();
  await expect(page.locator('body')).toHaveAttribute(
    'data-verified-print',
    'true',
  );
  await expect(page.locator('.label-print-root')).not.toHaveAttribute(
    'data-print-authorized',
  );
  // The real print action granted and revoked authorization above. Mirror the
  // verified sheet only to inspect its CSS print projection after that action.
  await page
    .locator('.label-print-root')
    .evaluate((node) => node.setAttribute('data-print-authorized', 'true'));
  await page.emulateMedia({ media: 'print' });
  try {
    await expect(card.getByText('Preview label')).toBeVisible();
    await expect(fallbackMessage).toBeHidden();
  } finally {
    await page.emulateMedia({ media: 'screen' });
    await page
      .locator('.label-print-root')
      .evaluate((node) => node.removeAttribute('data-print-authorized'));
    await expect(page.locator('.label-print-root')).not.toHaveAttribute(
      'data-print-authorized',
    );
  }
});

async function openDesigner(page: Page, category: string) {
  await page.goto('/settings/forms');
  await page.getByRole('link', { name: category, exact: true }).click();
  return page.getByRole('region', { name: 'Forms and fields' });
}

async function saveDesigner(designer: Locator) {
  await designer.getByRole('button', { name: 'Save changes' }).click();
  const impact = designer.getByRole('region', { name: 'Form save impact' });
  await expect(
    designer
      .getByRole('status')
      .filter({ hasText: /Saved active form revision|Review the effect/ }),
  ).toContainText(/Saved active form revision|Review the effect/);
  if (await impact.isVisible())
    await impact
      .getByRole('button', { name: 'Confirm and save changes' })
      .click();
  await expect(
    designer
      .getByRole('status')
      .filter({ hasText: 'Saved active form revision' }),
  ).toContainText('Saved active form revision');
}

function fieldControl(designer: Locator, name: string) {
  return designer.locator(
    `[data-control-id]:has(button[aria-label="Drag ${name}"])`,
  );
}

test('designer hide and restore retain false, zero and empty values while an unset value stays absent', async ({
  page,
}) => {
  test.setTimeout(180_000);
  await signIn(page);
  const category = `Value retention ${randomUUID()}`;
  await page.goto('/settings/categories');
  await page.getByLabel('Display name').fill(category);
  await page.getByRole('button', { name: 'Add category' }).click();
  await expect(page.getByRole('status')).toContainText('Settings saved.');
  let designer = await openDesigner(page, category);
  const fields = [
    { type: 'boolean', name: 'False flag' },
    { type: 'integer', name: 'Zero count' },
    { type: 'short_text', name: 'Empty note' },
    { type: 'short_text', name: 'Cleared note' },
  ] as const;
  for (const field of fields) {
    await designer
      .getByRole('button', { name: 'Add field', exact: true })
      .click();
    const addition = designer.getByRole('dialog', { name: 'Add field' });
    await addition
      .getByRole('button', {
        name:
          field.type === 'boolean'
            ? /Checkbox/
            : field.type === 'integer'
              ? /Whole number/
              : /Short text/,
      })
      .click();
    await addition.getByLabel('Field name').fill(field.name);
    await addition.getByRole('button', { name: 'Add to form' }).click();
  }
  await saveDesigner(designer);

  await page.goto('/inventory/quantity/new');
  const create = page.getByRole('form', { name: 'Add quantity item' });
  await create.getByLabel('Category').selectOption({ label: category });
  await create
    .getByLabel('Name', { exact: true })
    .fill(`Value item ${category}`);
  await create.getByLabel('False flag').check();
  await create.getByLabel('False flag').uncheck();
  await create.getByLabel('Zero count').fill('0');
  await create.getByLabel('Empty note').fill('temporary');
  await create.getByLabel('Empty note').fill('');
  await create.getByLabel('Cleared note').fill('remove me');
  await reviewMetadata(create);
  await expect(page).toHaveURL(/\/inventory\/quantity\/[0-9a-f-]+$/);
  const id = page.url().split('/').at(-1)!;
  const detail = `/inventory/quantity/${id}`;

  const edit = await openEditForm(page);
  // Edit lives on the detail route: discarding must reset the mounted editor.
  await edit.getByLabel('Name', { exact: true }).fill('Discarded item name');
  await edit.getByLabel('Cleared note').fill('Discarded custom note');
  await edit.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page
    .getByRole('dialog', { name: 'Discard changes?' })
    .getByRole('button', { name: 'Discard changes', exact: true })
    .click();
  await expect(edit).toBeHidden();
  await expect(page).toHaveURL(new RegExp(`${detail}$`));
  await expect(
    page.getByRole('button', { name: 'Edit details', exact: true }),
  ).toBeFocused();
  await openEditForm(page);
  await expect(edit.getByLabel('Name', { exact: true })).toHaveValue(
    `Value item ${category}`,
  );
  await expect(edit.getByLabel('Cleared note')).toHaveValue('remove me');
  await expect(edit.getByLabel('False flag')).not.toBeChecked();
  await expect(edit.getByLabel('Zero count')).toHaveValue('0');
  await expect(edit.getByLabel('Empty note')).toHaveValue('');
  await edit
    .locator('div')
    .filter({ has: page.getByLabel('Cleared note') })
    .filter({ has: page.getByRole('button', { name: 'Clear answer' }) })
    .last()
    .getByRole('button', { name: 'Clear answer' })
    .click();
  await reviewMetadata(edit);

  const api = new URL(process.env.LOCAL_API_URL!);
  expect(['localhost', '127.0.0.1']).toContain(api.hostname);
  expect(api.port).toBe('54321');
  const local = createClient(api.href, process.env.LOCAL_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const categoryRow = await local
    .from('categories')
    .select('published_form_revision_id')
    .eq('name', category)
    .single();
  expect(categoryRow.error).toBeNull();
  const fieldRows = await local
    .from('form_revision_fields')
    .select('field_id,label')
    .eq('revision_id', categoryRow.data!.published_form_revision_id!)
    .in(
      'label',
      fields.map((field) => field.name),
    );
  expect(fieldRows.error).toBeNull();
  expect(fieldRows.data).toHaveLength(fields.length);
  const ids = Object.fromEntries(
    fieldRows.data!.map((row) => [row.label, row.field_id]),
  );
  const readValues = async () => {
    const result = await local
      .from('quantity_items')
      .select('custom_values')
      .eq('id', id)
      .single();
    expect(result.error).toBeNull();
    return result.data!.custom_values as Record<string, { value: unknown }>;
  };
  const original = await readValues();
  expect(original[ids['False flag']].value).toBe(false);
  expect(original[ids['Zero count']].value).toBe(0);
  expect(original[ids['Empty note']].value).toBe('');
  expect(original).not.toHaveProperty(ids['Cleared note']);

  designer = await openDesigner(page, category);
  for (const field of fields) {
    const control = fieldControl(designer, field.name);
    await control.click();
    await designer
      .getByTestId('designer-inspector')
      .getByRole('button', { name: 'Hide from form' })
      .click();
  }
  await saveDesigner(designer);
  expect(await readValues()).toEqual(original);
  await page.goto(detail);
  const hiddenEdit = await openEditForm(page);
  for (const field of fields)
    await expect(hiddenEdit.getByLabel(field.name)).toHaveCount(0);

  designer = await openDesigner(page, category);
  await designer
    .locator('summary')
    .filter({ hasText: /Hidden fields/ })
    .click();
  for (const field of fields)
    await designer.getByRole('button', { name: `Show ${field.name}` }).click();
  await saveDesigner(designer);
  expect(await readValues()).toEqual(original);
  await page.goto(detail);
  const restored = await openEditForm(page);
  await expect(restored.getByLabel('False flag')).not.toBeChecked();
  await expect(restored.getByLabel('False flag')).toHaveAttribute(
    'aria-checked',
    'false',
  );
  await expect(restored.getByLabel('Zero count')).toHaveValue('0');
  await expect(restored.getByLabel('Empty note')).toHaveValue('');
  await expect(restored.getByLabel('Cleared note')).toHaveValue('');
  expect(await readValues()).toEqual(original);
});
