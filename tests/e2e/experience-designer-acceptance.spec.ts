import { randomUUID } from 'node:crypto';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
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

async function openDesigner(page: Page, category: string) {
  await page.goto('/settings/forms');
  await page.getByRole('link', { name: category, exact: true }).click();
  const designer = page.getByRole('region', { name: 'Forms and fields' });
  await expect(
    designer.getByRole('button', { name: 'Save changes' }),
  ).toBeVisible();
  return designer;
}

async function createCategory(page: Page) {
  const name = `Acceptance ${randomUUID()}`;
  await page.goto('/settings/categories');
  await page.getByLabel('Display name').fill(name);
  await page.getByRole('button', { name: 'Add category' }).click();
  await expect(page.getByRole('status')).toContainText('Settings saved.');
  return name;
}

async function saveDesigner(designer: Locator) {
  await designer.getByRole('button', { name: 'Save changes' }).click();
  const impact = designer.getByRole('region', { name: 'Form save impact' });
  await expect(designer.getByRole('status')).toContainText(
    /Saved active form revision|Review the effect/,
  );
  if (await impact.isVisible())
    await impact
      .getByRole('button', { name: 'Confirm and save changes' })
      .click();
  await expect(designer.getByRole('status')).toContainText(
    'Saved active form revision',
  );
}

function fieldControl(designer: Locator, name: string) {
  return designer.locator(
    `[data-control-id]:has(button[aria-label="Drag ${name}"])`,
  );
}

async function openLayout(control: Locator) {
  await control.getByText('Layout options', { exact: true }).click();
}

async function chooseControlSection(control: Locator, name: string) {
  const section = control.getByLabel('Section');
  const option = section.locator('option').filter({ hasText: `${name} ·` });
  await expect(option).toHaveCount(1);
  const id = await option.getAttribute('value');
  expect(id).toBeTruthy();
  await section.selectOption(id!);
}

test('a serialized control excluded by its section can recover through a compatible destination', async ({
  page,
}) => {
  await signIn(page);
  const category = await createCategory(page);
  const designer = await openDesigner(page, category);
  // New categories inherit the canonical baseline's placed Serial Number.
  const control = fieldControl(designer, 'Serial Number');
  await control.hover();
  await expect(
    designer.getByRole('button', { name: 'Drag Serial Number' }),
  ).toBeVisible();
  await designer.getByRole('button', { name: 'Add section' }).click();
  const source = designer.locator('[data-section-id]').last();
  await source.getByLabel('Section heading').fill('Quantity only');
  await openLayout(control);
  await chooseControlSection(control, 'Quantity only');
  await source.getByText('Section options').click();
  await source.getByLabel('Applies to Quantity only').selectOption('quantity');
  await expect(control.getByTitle('Form types using this control')).toHaveText(
    'No form type',
  );
  await designer.getByRole('button', { name: 'Add section' }).click();
  const destination = designer.locator('[data-section-id]').last();
  await destination.getByLabel('Section heading').fill('Serialized recovery');
  await destination.getByText('Section options').click();
  await destination
    .getByLabel('Applies to Serialized recovery')
    .selectOption('asset');
  await openLayout(control);
  await chooseControlSection(control, 'Serialized recovery');
  await control.hover();
  await expect(
    destination.getByRole('button', { name: 'Drag Serial Number' }),
  ).toBeVisible();
  await expect(control.getByTitle('Form types using this control')).toHaveText(
    'Serialized',
  );
  await saveDesigner(designer);
  await openDesigner(page, category);
  const restored = fieldControl(designer, 'Serial Number');
  await expect(restored.getByTitle('Form types using this control')).toHaveText(
    'Serialized',
  );
});

test('held section drag autoscrolls at the viewport edge', async ({ page }) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1440, height: 640 });
  await signIn(page);
  const designer = await openDesigner(page, 'Cables');
  const sections = designer.locator('[data-section-id]');
  const initialSections = await sections.count();
  for (let index = 0; index < 12; index++)
    await designer.getByRole('button', { name: 'Add section' }).click();
  await expect(sections).toHaveCount(initialSections + 12);
  await page.evaluate(() => window.scrollTo(0, 0));
  const handle = sections
    .first()
    .locator('button[aria-label^="Drag section "]');
  await handle.scrollIntoViewIfNeeded();
  const box = await handle.boundingBox();
  expect(box).toBeTruthy();
  const before = await page.evaluate(() => window.scrollY);
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await page.mouse.down();
  try {
    await page.mouse.move(box!.x + box!.width / 2, 630, { steps: 18 });
    await expect
      .poll(() => page.evaluate(() => window.scrollY), {
        timeout: 8_000,
      })
      .toBeGreaterThan(before + 40);
    await expect(handle).toHaveAttribute('aria-label', /Drag section/);
  } finally {
    await page.keyboard.press('Escape');
    await page.mouse.up();
  }
  await expect(sections).toHaveCount(initialSections + 12);
});

test('keyboard width editing retains focus and survives reload', async ({
  page,
}) => {
  await signIn(page);
  const category = await createCategory(page);
  let designer = await openDesigner(page, category);
  const control = fieldControl(designer, 'Name');
  await openLayout(control);
  const details = control.locator('details').first();
  await expect(details).toHaveAttribute('open', '');
  const summary = details.locator('summary');
  await summary.press('Enter');
  await expect(details).not.toHaveAttribute('open', '');
  await summary.press('Space');
  await expect(details).toHaveAttribute('open', '');
  const width = control.getByLabel('Width');
  const initial = await width.inputValue();
  await width.focus();
  await page.keyboard.press('End');
  await expect(width).toHaveValue('12');
  expect(await width.evaluate((node) => document.activeElement === node)).toBe(
    true,
  );
  await page.keyboard.press('Home');
  await page.keyboard.press('ArrowDown');
  await expect(width).not.toHaveValue(initial);
  expect(await width.evaluate((node) => document.activeElement === node)).toBe(
    true,
  );
  const chosen = await width.inputValue();
  await saveDesigner(designer);
  designer = await openDesigner(page, category);
  const reloaded = fieldControl(designer, 'Name');
  await openLayout(reloaded);
  await expect(reloaded.getByLabel('Width')).toHaveValue(chosen);
});

test('advanced JSON action stays clickable below sticky Save at a constrained viewport', async ({
  page,
}) => {
  await page.setViewportSize({ width: 720, height: 450 });
  await signIn(page);
  const designer = await openDesigner(page, 'Cables');
  await designer.getByText('Advanced JSON recovery', { exact: true }).click();
  await designer
    .getByRole('button', { name: 'Load current document JSON' })
    .click();
  await designer
    .getByRole('navigation', { name: 'Designer panels' })
    .getByRole('button', { name: 'Inspector' })
    .click();
  await expect(
    designer.getByRole('heading', { name: 'Inspector' }),
  ).toBeVisible();
  const apply = designer.getByRole('button', {
    name: 'Apply JSON to visual editor',
  });
  await expect(apply).toBeEnabled();
  await page.evaluate(() =>
    window.scrollTo(0, document.documentElement.scrollHeight),
  );
  const save = designer.getByRole('button', { name: 'Save changes' });
  await expect(save).toBeInViewport();
  expect(
    await apply.evaluate((button) => {
      const box = button.getBoundingClientRect();
      const hit = document.elementFromPoint(
        box.left + box.width / 2,
        box.top + box.height / 2,
      );
      return hit === button || button.contains(hit);
    }),
  ).toBe(true);
  await apply.click();
  await expect(designer.getByRole('status')).toContainText(
    'JSON applied to the local editor',
  );
});

test('nonempty section removal moves or unplaces a populated custom field, and hide/restore keeps its value', async ({
  page,
}) => {
  test.setTimeout(180_000);
  const fieldName = 'Lineage code';
  const value = `Connector ${randomUUID()}`;
  await signIn(page);
  const category = await createCategory(page);
  let designer = await openDesigner(page, category);
  await designer.getByLabel('New field type').selectOption('short_text');
  await designer.getByRole('button', { name: 'Add field' }).click();
  await designer.getByLabel('Label', { exact: true }).fill(fieldName);
  const initialSectionCount = await designer
    .locator('[data-section-id]')
    .count();
  await designer.getByRole('button', { name: 'Add section' }).click();
  await designer.getByLabel('Section heading').last().fill('Retirable fields');
  let control = fieldControl(designer, fieldName);
  await openLayout(control);
  await chooseControlSection(control, 'Retirable fields');
  await saveDesigner(designer);

  await page.goto('/inventory/quantity/new');
  const create = page.getByRole('form', { name: 'Create quantity inventory' });
  await create.getByLabel('Category').selectOption({ label: category });
  await create
    .getByLabel('Name', { exact: true })
    .fill(`Acceptance item ${category}`);
  await create.getByLabel(fieldName).fill(value);
  await create.getByRole('button', { name: 'Review metadata' }).click();
  await create.getByRole('button', { name: 'Confirm save' }).click();
  await expect(page).toHaveURL(/\/inventory\/quantity\/[0-9a-f-]+$/);
  const itemId = page.url().split('/').at(-1)!;

  const api = new URL(process.env.LOCAL_API_URL!);
  expect(['localhost', '127.0.0.1']).toContain(api.hostname);
  expect(api.port).toBe('54321');
  const local = createClient(api.href, process.env.LOCAL_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const categoryRow = await local
    .from('categories')
    .select('id,published_form_revision_id')
    .eq('name', category)
    .single();
  expect(categoryRow.error).toBeNull();
  const fieldRow = await local
    .from('form_revision_fields')
    .select('field_id')
    .eq('revision_id', categoryRow.data!.published_form_revision_id!)
    .eq('label', fieldName)
    .single();
  expect(fieldRow.error).toBeNull();
  const fieldId = fieldRow.data!.field_id;
  const item = async () => {
    const result = await local
      .from('quantity_items')
      .select('custom_values,validated_form_revision_id,version')
      .eq('id', itemId)
      .single();
    expect(result.error).toBeNull();
    return result.data!;
  };
  const original = await item();
  expect((original.custom_values as Record<string, unknown>)[fieldId]).toEqual({
    value,
    validated_revision_id: original.validated_form_revision_id,
  });
  const persistedField = async () => {
    const categoryResult = await local
      .from('categories')
      .select('published_form_revision_id')
      .eq('id', categoryRow.data!.id)
      .single();
    expect(categoryResult.error).toBeNull();
    const result = await local
      .from('form_revision_fields')
      .select('field_id')
      .eq('revision_id', categoryResult.data!.published_form_revision_id!)
      .eq('field_id', fieldId)
      .single();
    expect(result.error).toBeNull();
  };
  const retainedValue = async () => {
    const current = await item();
    expect(current.custom_values).toEqual(original.custom_values);
    expect(current.validated_form_revision_id).toBe(
      original.validated_form_revision_id,
    );
    expect(current.version).toBe(original.version);
    await persistedField();
  };

  designer = await openDesigner(page, category);
  let section = designer.locator('[data-section-id]').last();
  await fieldControl(designer, fieldName).click();
  await expect(
    section.getByRole('button', { name: `Drag ${fieldName}` }),
  ).toBeVisible();
  await section.getByText('Section options').click();
  await section.getByRole('button', { name: 'Remove section' }).click();
  let removal = designer.getByRole('dialog', {
    name: 'Remove Retirable fields?',
  });
  await removal.getByRole('button', { name: 'Remove section' }).click();
  await expect(designer.locator('[data-section-id]')).toHaveCount(
    initialSectionCount,
  );
  await expect(
    designer
      .locator('[data-section-id]')
      .first()
      .locator(`[data-control-id]:has(button[aria-label="Drag ${fieldName}"])`),
  ).toHaveCount(1);
  await saveDesigner(designer);
  await retainedValue();

  designer = await openDesigner(page, category);
  control = fieldControl(designer, fieldName);
  await openLayout(control);
  await control.getByRole('checkbox', { name: 'Show control' }).uncheck();
  await saveDesigner(designer);
  await retainedValue();
  await page.goto(`/inventory/quantity/${itemId}`);
  const edit = page.getByRole('form', { name: 'Edit quantity metadata' });
  if (!(await edit.isVisible()))
    await page
      .locator('summary')
      .filter({ hasText: 'Edit quantity metadata' })
      .click();
  await expect(edit.getByLabel(fieldName)).toHaveCount(0);

  designer = await openDesigner(page, category);
  await designer.getByText(/Hidden & unplaced/).click();
  await designer.getByRole('button', { name: `Restore ${fieldName}` }).click();
  await saveDesigner(designer);
  await retainedValue();
  await page.goto(`/inventory/quantity/${itemId}`);
  const restoredEdit = page.getByRole('form', {
    name: 'Edit quantity metadata',
  });
  if (!(await restoredEdit.isVisible()))
    await page
      .locator('summary')
      .filter({ hasText: 'Edit quantity metadata' })
      .click();
  await expect(restoredEdit.getByLabel(fieldName)).toHaveValue(value);

  designer = await openDesigner(page, category);
  await designer.getByRole('button', { name: 'Add section' }).click();
  await designer
    .getByLabel('Section heading')
    .last()
    .fill('Temporary placement');
  control = fieldControl(designer, fieldName);
  await openLayout(control);
  await chooseControlSection(control, 'Temporary placement');
  section = designer.locator('[data-section-id]').last();
  await fieldControl(designer, fieldName).click();
  await expect(
    section.getByRole('button', { name: `Drag ${fieldName}` }),
  ).toBeVisible();
  await section.getByText('Section options').click();
  await section.getByRole('button', { name: 'Remove section' }).click();
  removal = designer.getByRole('dialog', {
    name: 'Remove Temporary placement?',
  });
  await removal.getByLabel('Destination').selectOption('');
  await removal.getByRole('button', { name: 'Remove section' }).click();
  await expect(designer.locator('[data-section-id]')).toHaveCount(
    initialSectionCount,
  );
  await expect(fieldControl(designer, fieldName)).toHaveCount(0);
  await expect(
    designer.getByRole('button', { name: /Lineage code.*Unplaced/ }),
  ).toBeVisible();
  await saveDesigner(designer);
  await retainedValue();

  designer = await openDesigner(page, category);
  const library = designer.getByTestId('designer-library');
  await library.getByText(/Hidden & unplaced/).click();
  await expect(
    library.getByRole('heading', {
      name: /Unplaced fields and standard controls \([1-9]/,
    }),
  ).toBeVisible();
  await library.getByRole('button', { name: `Place ${fieldName}` }).click();
  await expect(fieldControl(designer, fieldName)).toHaveCount(1);
  await saveDesigner(designer);
  await retainedValue();
  designer = await openDesigner(page, category);
  await expect(fieldControl(designer, fieldName)).toHaveCount(1);
  await page.goto(`/inventory/quantity/${itemId}`);
  const placedEdit = page.getByRole('form', { name: 'Edit quantity metadata' });
  if (!(await placedEdit.isVisible()))
    await page
      .locator('summary')
      .filter({ hasText: 'Edit quantity metadata' })
      .click();
  await expect(placedEdit.getByLabel(fieldName)).toHaveValue(value);
});

test('hidden sections and preview exclusions remain distinct through save and reload', async ({
  page,
}) => {
  await signIn(page);
  const category = await createCategory(page);
  let designer = await openDesigner(page, category);
  await designer.getByLabel('New field type').selectOption('short_text');
  await designer.getByRole('button', { name: 'Add field' }).click();
  await designer.getByLabel('Label', { exact: true }).fill('Quantity note');
  await designer.getByRole('button', { name: 'Add section' }).click();
  const section = designer.locator('[data-section-id]').last();
  await section.getByLabel('Section heading').fill('Quantity details');
  const control = fieldControl(designer, 'Quantity note');
  await openLayout(control);
  await control.getByLabel('Applies to Quantity note').selectOption('quantity');
  await chooseControlSection(control, 'Quantity details');
  await section.getByText('Section options').click();
  await section
    .getByLabel('Applies to Quantity details')
    .selectOption('quantity');
  await designer
    .getByText(/Live preview · open quantity or asset form/)
    .click();
  await designer.getByRole('button', { name: 'Asset', exact: true }).click();
  const library = designer.getByTestId('designer-library');
  await library.getByText(/Hidden & unplaced/).click();
  await expect(
    library.getByRole('heading', {
      name: /Excluded from Serialized preview \([1-9]/,
    }),
  ).toBeVisible();
  await expect(
    library.getByText(/Quantity note in Quantity details/),
  ).toBeVisible();
  await expect(library.getByText('Hidden sections (0)')).toBeVisible();
  await section.getByRole('checkbox', { name: 'Show section' }).uncheck();
  await expect(library.getByText('Hidden sections (1)')).toBeVisible();
  await expect(library.getByText('Hidden controls (0)')).toBeVisible();
  await expect(
    library.getByText(/Quantity note in Quantity details/),
  ).toHaveCount(0);
  await saveDesigner(designer);

  designer = await openDesigner(page, category);
  const reloadedLibrary = designer.getByTestId('designer-library');
  await reloadedLibrary.getByText(/Hidden & unplaced/).click();
  await expect(reloadedLibrary.getByText('Hidden sections (1)')).toBeVisible();
  await reloadedLibrary
    .getByRole('button', { name: 'Restore section Quantity details' })
    .click();
  await expect(reloadedLibrary.getByText('Hidden sections (0)')).toBeVisible();
  await saveDesigner(designer);
  designer = await openDesigner(page, category);
  await designer
    .locator('[data-section-id]')
    .last()
    .getByText('Section options')
    .click();
  await expect(
    designer.locator('[data-section-id]').last().getByRole('checkbox', {
      name: 'Show section',
    }),
  ).toBeChecked();
});

test('duplicate section names use distinct UUID destinations and removal can be undone', async ({
  page,
}) => {
  await signIn(page);
  const category = await createCategory(page);
  const designer = await openDesigner(page, category);
  const initialSectionCount = await designer
    .locator('[data-section-id]')
    .count();
  await designer.getByRole('button', { name: 'Add section' }).click();
  await designer.getByRole('button', { name: 'Add section' }).click();
  const sections = designer.locator('[data-section-id]');
  const first = sections.nth(initialSectionCount);
  const second = sections.nth(initialSectionCount + 1);
  await first.getByLabel('Section heading').fill('Duplicate details');
  await second.getByLabel('Section heading').fill('Duplicate details');
  const firstId = await first.getAttribute('data-section-id');
  const secondId = await second.getAttribute('data-section-id');
  expect(firstId).toBeTruthy();
  expect(secondId).toBeTruthy();
  expect(firstId).not.toBe(secondId);
  await first.getByText('Section options').click();
  await first.getByRole('button', { name: 'Remove section' }).click();
  let dialog = designer.getByRole('dialog', {
    name: 'Remove Duplicate details?',
  });
  await expect(
    dialog.getByRole('option', {
      name: `Duplicate details · ${secondId!.slice(-8)}`,
    }),
  ).toHaveAttribute('value', secondId!);
  await dialog.getByLabel('Destination').selectOption(secondId!);
  await expect(dialog.getByLabel('Destination')).toHaveValue(secondId!);
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(sections).toHaveCount(initialSectionCount + 2);
  await first.getByRole('button', { name: 'Remove section' }).click();
  dialog = designer.getByRole('dialog', { name: 'Remove Duplicate details?' });
  await dialog.getByLabel('Destination').selectOption(secondId!);
  await dialog.getByRole('button', { name: 'Remove section' }).click();
  await expect(sections).toHaveCount(initialSectionCount + 1);
  await designer.getByRole('button', { name: 'Undo edit' }).click();
  await expect(sections).toHaveCount(initialSectionCount + 2);
  await expect(first).toHaveAttribute('data-section-id', firstId!);
  await expect(second).toHaveAttribute('data-section-id', secondId!);
});
