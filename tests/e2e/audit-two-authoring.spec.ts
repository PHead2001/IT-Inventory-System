import { expect, test, type Locator, type Page } from '@playwright/test';
import type { MetadataDefinition } from '../../src/features/metadata/contracts';
import {
  auditCategory,
  auditLogin,
  auditReadback,
  auditSaveDesigner,
} from './audit-two-controls';
import { metadataReviewButton, metadataSaveButton } from './metadata-controls';
import { auditOpenMetadataTask } from './audit-two-controls';

async function addField(
  page: Page,
  designer: Locator,
  type: string,
  name: string,
) {
  await designer
    .getByRole('button', { name: 'Add field', exact: true })
    .click();
  const dialog = page.getByRole('dialog', { name: 'Add field', exact: true });
  await dialog.getByRole('button', { name: type, exact: true }).click();
  await dialog.getByLabel('Field name', { exact: true }).fill(name);
  await expect(
    dialog.getByText('Selected type: ' + type, { exact: true }),
  ).toBeVisible();
  return dialog;
}

async function finishField(dialog: Locator) {
  await dialog
    .getByRole('button', { name: 'Add to form', exact: true })
    .click();
  await expect(dialog).not.toBeVisible();
}

async function inspectField(designer: Locator, name: string) {
  await designer
    .getByTestId('designer-library')
    .getByRole('button')
    .filter({ hasText: name + ' ·' })
    .click();
  const inspector = designer.getByTestId('designer-inspector');
  const inspectorTab = designer.getByRole('button', {
    name: 'Inspector',
    exact: true,
  });
  if (await inspectorTab.isVisible()) await inspectorTab.click();
  await expect(inspector.getByLabel('Field name', { exact: true })).toHaveValue(
    name,
  );
  return inspector;
}

async function addOption(scope: Locator, label: string, parent?: string) {
  await scope
    .getByRole('button', {
      name: parent ? 'Add child option to ' + parent : 'Add option',
      exact: true,
    })
    .click();
  const input = scope.getByRole('textbox', {
    name: 'Option name: New option',
    exact: true,
  });
  await expect(input).toBeFocused();
  await input.fill(label);
}

async function pasteReview(scope: Locator, paths: string) {
  await scope
    .getByRole('button', { name: 'Paste option paths', exact: true })
    .click();
  const paste = scope.getByRole('region', {
    name: 'Paste option paths',
    exact: true,
  });
  await expect(paste.getByLabel('Option paths')).toBeFocused();
  await paste.getByLabel('Option paths').fill(paths);
  await paste
    .getByRole('button', { name: 'Review paths', exact: true })
    .click();
  return paste;
}

async function published(
  client: Awaited<ReturnType<typeof auditReadback>>,
  category: string,
) {
  const result = await client.rpc('metadata_form_get_v2', {
    p_category_id: category,
  });
  expect(result.error).toBeNull();
  return (
    result.data as unknown as { published_definition: MetadataDefinition }
  ).published_definition;
}

test('nested paths are reviewed, cancelled, undone, published at six levels and retain saved identity through subtree moves and ancestor retirement', async ({
  page,
}, info) => {
  test.setTimeout(180_000);
  await auditLogin(page);
  const category = await auditCategory(page);
  const client = await auditReadback();
  const designer = page.getByRole('region', { name: 'Forms and fields' });
  await designer
    .getByRole('button', { name: 'Add section', exact: true })
    .click();
  await designer.getByLabel('Section heading').last().fill('Connections');
  const dialog = await addField(
    page,
    designer,
    'Nested dropdown',
    'Connection family',
  );
  await addOption(dialog, 'Existing root');
  await finishField(dialog);
  await auditSaveDesigner(designer);
  const originalField = (await published(client, category.id)).fields.find(
    (entry) => entry.label === 'Connection family',
  )!;
  const choices = await inspectField(designer, 'Connection family');
  const paths = [
    'USB > USB-C > USB 3 > Gen 2 > Gen 3 > Gen 4',
    'USB > USB-A',
    'USB > Shared',
    'Ethernet > Shared Ethernet',
    'Labels > A\\>B',
    'USB > USB-A',
  ].join('\n');
  let paste = await pasteReview(choices, paths);
  await expect(
    paste.getByRole('heading', { name: 'Skipped identical paths (1)' }),
  ).toBeVisible();
  await expect(
    paste.getByRole('heading', { name: 'Conflicts (0)' }),
  ).toBeVisible();
  await paste
    .getByRole('button', { name: 'Cancel paste', exact: true })
    .click();
  await expect(
    choices.getByRole('button', { name: 'Paste option paths', exact: true }),
  ).toBeFocused();
  await expect(
    choices.getByLabel('Option name: Gen 4', { exact: true }),
  ).toHaveCount(0);
  await expect(
    choices.getByLabel('Option name: Existing root', { exact: true }),
  ).toHaveValue('Existing root');
  paste = await pasteReview(choices, paths);
  await paste.getByRole('button', { name: 'Apply paths', exact: true }).click();
  await expect(
    choices.getByLabel('Option name: Gen 4', { exact: true }),
  ).toBeVisible();
  await expect(
    choices.getByLabel('Option name: A>B', { exact: true }),
  ).toBeVisible();
  await choices
    .getByRole('button', { name: 'Undo pasted paths', exact: true })
    .click();
  await expect(
    choices.getByLabel('Option name: Gen 4', { exact: true }),
  ).toHaveCount(0);
  await expect(
    choices.getByLabel('Option name: Existing root', { exact: true }),
  ).toHaveValue('Existing root');
  paste = await pasteReview(choices, paths);
  await paste.getByRole('button', { name: 'Apply paths', exact: true }).click();
  // U403 now requires fresh labels to be distinguishable across parents too.
  await choices
    .getByLabel('Option name: Shared Ethernet', { exact: true })
    .fill('Shared');
  await expect(
    choices.getByRole('alert').filter({ hasText: 'matches another choice' }),
  ).toHaveCount(2);
  await expect(
    designer.getByRole('button', { name: 'Save changes', exact: true }),
  ).toBeDisabled();
  await choices
    .getByLabel('Option name: Shared', { exact: true })
    .last()
    .fill('Shared Ethernet');
  await addOption(choices, ' shared ', 'USB');
  await expect(
    choices.getByRole('alert').filter({ hasText: 'matches another choice' }),
  ).toHaveCount(2);
  await expect(
    designer.getByRole('button', { name: 'Save changes', exact: true }),
  ).toBeDisabled();
  await choices
    .getByLabel('Option name:  shared ', { exact: true })
    .fill('Shared B');
  await auditSaveDesigner(designer);
  const before = await published(client, category.id);
  const field = before.fields.find(
    (field) => field.label === 'Connection family',
  )!;
  const choice = (label: string) =>
    field.options.find((option) => option.label === label)!;
  expect(field.id).toBe(originalField.id);
  expect(choice('Existing root').id).toBe(originalField.options[0].id);
  const deep = choice('Gen 4');
  let depth = 0,
    current = deep;
  while (current) {
    depth++;
    current = field.options.find((option) => option.id === current.parent_id)!;
  }
  expect(depth).toBe(6);
  expect(
    field.options.filter((option) => option.label === 'Shared'),
  ).toHaveLength(1);
  expect(choice('Shared Ethernet').parent_id).toBe(choice('Ethernet').id);
  const originalIds = field.options.map((option) => option.id).sort();

  await page.goto('/inventory/quantity/new');
  let form = page.getByRole('form', { name: 'Add quantity item' });
  await form
    .getByLabel('Name', { exact: true })
    .fill('Audit two deep answer ' + crypto.randomUUID());
  await form
    .getByLabel('Category', { exact: true })
    .selectOption({ label: category.name });
  const answer = form.getByRole('group', {
    name: 'Connection family',
    exact: true,
  });
  await answer.getByRole('button', { name: 'Gen 4', exact: true }).click();
  await answer
    .getByRole('button', { name: 'Clear answer', exact: true })
    .click();
  await expect(answer.getByLabel('Search options')).toBeFocused();
  await page.keyboard.type('Gen 4');
  await answer.getByRole('button', { name: /Gen 4$/ }).press('Enter');
  await metadataReviewButton(form).click();
  await metadataSaveButton(form).click();
  await expect(page).toHaveURL(/\/inventory\/quantity\/[0-9a-f-]+$/);
  const recordUrl = page.url(),
    id = new URL(recordUrl).pathname.split('/').at(-1)!;
  const saved = await client
    .from('quantity_items')
    .select('custom_values')
    .eq('id', id)
    .single();
  expect(saved.error).toBeNull();
  expect(saved.data!.custom_values[field.id].value).toBe(deep.id);
  const metadata = page.getByRole('region', {
    name: 'Custom metadata',
    exact: true,
  });
  await expect(metadata).toContainText(
    'USB / USB-C / USB 3 / Gen 2 / Gen 3 / Gen 4',
  );
  await info.attach('six-level-answer.png', {
    body: await metadata.screenshot(),
    contentType: 'image/png',
  });

  await page.goto(category.url);
  let inspector = await inspectField(designer, 'Connection family');
  await inspector
    .locator('summary')
    .filter({ hasText: 'Option tools for Gen 3' })
    .click();
  await inspector
    .getByRole('button', { name: 'Move to… Gen 3', exact: true })
    .click();
  await inspector
    .getByRole('group', { name: 'Move Gen 3', exact: true })
    .getByLabel('Move under')
    .selectOption({ label: 'Ethernet' });
  await expect(
    inspector.getByLabel('Option name: Gen 3', { exact: true }),
  ).toBeFocused();
  await auditSaveDesigner(designer);
  const moved = (await published(client, category.id)).fields.find(
    (entry) => entry.id === field.id,
  )!;
  expect(moved.options.map((option) => option.id).sort()).toEqual(originalIds);
  expect(
    moved.options.find((option) => option.id === choice('Gen 3').id)!.parent_id,
  ).toBe(choice('Ethernet').id);
  expect(moved.options.find((option) => option.id === deep.id)!.parent_id).toBe(
    choice('Gen 3').id,
  );
  inspector = await inspectField(designer, 'Connection family');
  await inspector
    .locator('summary')
    .filter({ hasText: 'Option tools for Ethernet' })
    .click();
  await inspector
    .getByRole('button', { name: 'Retire option Ethernet', exact: true })
    .click();
  await auditSaveDesigner(designer);
  await page.goto(recordUrl);
  await expect(metadata).toContainText(
    'USB / USB-C / USB 3 / Gen 2 / Gen 3 / Gen 4',
  );
  form = await auditOpenMetadataTask(page, 'Edit quantity metadata');
  const retainedAnswer = form.getByRole('group', {
    name: 'Connection family',
    exact: true,
  });
  await expect(retainedAnswer).toContainText(
    'Selected: Ethernet / Gen 3 / Gen 4',
  );
  await expect(
    retainedAnswer.getByRole('button', {
      name: 'Ethernet / Gen 3 / Gen 4',
      exact: true,
    }),
  ).toHaveAttribute('aria-pressed', 'true');
  await page.goto(category.url);
  inspector = await inspectField(designer, 'Connection family');
  await inspector
    .locator('summary')
    .filter({ hasText: 'Option tools for Ethernet' })
    .click();
  await inspector
    .getByRole('button', { name: 'Restore option Ethernet', exact: true })
    .click();
  await auditSaveDesigner(designer);
  const restored = (await published(client, category.id)).fields.find(
    (entry) => entry.id === field.id,
  )!;
  expect(restored.options.map((option) => option.id).sort()).toEqual(
    originalIds,
  );
  expect(
    restored.options.find((option) => option.id === choice('Ethernet').id)!
      .active,
  ).toBe(true);
  const retained = await client
    .from('quantity_items')
    .select('custom_values')
    .eq('id', id)
    .single();
  expect(retained.error).toBeNull();
  expect(retained.data!.custom_values).toEqual(saved.data!.custom_values);
  await client.auth.signOut({ scope: 'local' });
});

test('required-field and tightened-rule review uses names while Yes/No, clear focus, preview return and configured read sections preserve saved meanings', async ({
  page,
}, info) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1440, height: 960 });
  await auditLogin(page);
  const category = await auditCategory(page);
  const client = await auditReadback();
  const designer = page.getByRole('region', { name: 'Forms and fields' });
  await designer
    .getByRole('button', { name: 'Add section', exact: true })
    .click();
  await designer.getByLabel('Section heading').last().fill('Read first');
  let dialog = await addField(page, designer, 'Short text', 'Checked by');
  await dialog.getByText('Optional rules', { exact: true }).click();
  await dialog.getByLabel('Use maximum characters', { exact: true }).check();
  await dialog.getByLabel('Maximum characters', { exact: true }).fill('40');
  await finishField(dialog);
  dialog = await addField(page, designer, 'Checkbox', 'Ready to issue');
  await dialog
    .getByLabel('Answer presentation', { exact: true })
    .selectOption('yes_no');
  await finishField(dialog);
  await designer
    .getByRole('button', { name: 'Add section', exact: true })
    .click();
  await designer.getByLabel('Section heading').last().fill('Read second');
  dialog = await addField(page, designer, 'Whole number', 'Inspection count');
  await finishField(dialog);
  await auditSaveDesigner(designer);
  await page.goto('/inventory/quantity/new');
  let form = page.getByRole('form', { name: 'Add quantity item' });
  await form
    .getByLabel('Name', { exact: true })
    .fill('Audit two review ' + crypto.randomUUID());
  await form
    .getByLabel('Category', { exact: true })
    .selectOption({ label: category.name });
  await form.getByLabel('Checked by', { exact: true }).fill('Alex');
  await form
    .getByRole('group', { name: 'Ready to issue', exact: true })
    .getByRole('radio', { name: 'No', exact: true })
    .check();
  await form.getByLabel('Inspection count', { exact: true }).fill('0');
  await metadataReviewButton(form).click();
  await metadataSaveButton(form).click();
  await expect(page).toHaveURL(/\/inventory\/quantity\/[0-9a-f-]+$/);
  const recordUrl = page.url(),
    id = new URL(recordUrl).pathname.split('/').at(-1)!;
  const original = await published(client, category.id);
  const flagId = original.fields.find(
    (field) => field.label === 'Ready to issue',
  )!.id;

  await page.goto(category.url);
  let inspector = await inspectField(designer, 'Checked by');
  await inspector.getByText('Optional rules', { exact: true }).click();
  await inspector.getByLabel('Maximum characters', { exact: true }).fill('10');
  dialog = await addField(page, designer, 'Short text', 'Required approval');
  await dialog.getByLabel('Required', { exact: true }).check();
  await finishField(dialog);
  await designer
    .getByRole('button', { name: 'Save changes', exact: true })
    .click();
  const impact = designer.getByRole('region', {
    name: 'Form save impact',
    exact: true,
  });
  await expect(impact).toBeVisible();
  await expect(impact).toContainText(
    '1 quantity records and 0 individual assets',
  );
  await expect(impact).toContainText(
    'Add required field “Required approval”: absent → required',
  );
  await expect(impact).toContainText(
    'Change rules for “Checked by”: Maximum characters: 40 → 10',
  );
  await expect(impact).not.toContainText('rules_tightened');
  await info.attach('human-publication-review.png', {
    body: await impact.screenshot(),
    contentType: 'image/png',
  });
  await impact
    .getByRole('button', { name: 'Confirm and save changes', exact: true })
    .click();
  await expect(
    designer
      .getByRole('status')
      .filter({ hasText: 'Saved active form revision' }),
  ).toBeVisible();

  inspector = await inspectField(designer, 'Ready to issue');
  const fieldName = inspector.getByLabel('Field name', { exact: true });
  await fieldName.focus();
  await designer
    .getByRole('button', { name: 'Preview form', exact: true })
    .click();
  await expect(
    designer.getByRole('form', {
      name: 'Preview quantity metadata',
      exact: true,
    }),
  ).toBeVisible();
  await designer
    .getByRole('button', { name: 'Back to editing', exact: true })
    .click();
  await expect(fieldName).toBeFocused();
  await expect(fieldName).toHaveValue('Ready to issue');

  await page.goto(recordUrl);
  const metadata = page.getByRole('region', {
    name: 'Custom metadata',
    exact: true,
  });
  const first = metadata.getByRole('region', {
    name: 'Read first',
    exact: true,
  });
  const second = metadata.getByRole('region', {
    name: 'Read second',
    exact: true,
  });
  await expect(first.locator('dt')).toHaveText([
    'Checked byLegacy value',
    'Ready to issueLegacy value',
  ]);
  await expect(second.locator('dt')).toHaveText([
    'Inspection countLegacy value',
  ]);
  await expect(first.getByText('Legacy value', { exact: true })).toHaveCount(2);
  await expect(first).toContainText('No');
  await expect(second).toContainText('0');
  form = await auditOpenMetadataTask(page, 'Edit quantity metadata');
  const boolean = form.getByRole('group', {
    name: 'Ready to issue',
    exact: true,
  });
  await boolean.getByRole('radio', { name: 'Yes', exact: true }).check();
  const booleanWrapper = boolean.locator('xpath=..');
  await booleanWrapper
    .getByRole('button', { name: 'Clear answer', exact: true })
    .click();
  await expect(
    boolean.getByRole('radio', { name: 'Yes', exact: true }),
  ).toBeFocused();
  await expect(
    boolean.getByRole('radio', { name: 'Yes', exact: true }),
  ).not.toBeChecked();
  await expect(
    boolean.getByRole('radio', { name: 'No', exact: true }),
  ).not.toBeChecked();
  await page.keyboard.press('Space');
  await expect(
    boolean.getByRole('radio', { name: 'Yes', exact: true }),
  ).toBeChecked();
  await form
    .getByLabel('Required approval (required)', { exact: true })
    .fill('Approved');
  await metadataReviewButton(form).click();
  const changes = form.getByRole('region', {
    name: 'Changed details',
    exact: true,
  });
  const changedFlag = changes.locator('dl > div').filter({
    has: page.locator('dt').filter({ hasText: /^Ready to issue$/ }),
  });
  await expect(changedFlag).toContainText('No');
  await expect(changedFlag).toContainText('Yes');
  await expect(changes).not.toContainText('Inspection count');
  await expect(changes).not.toContainText('Checked by');
  await metadataSaveButton(form).click();
  await expect(
    form.getByRole('status').filter({ hasText: /^Details saved\.$/ }),
  ).toBeVisible();
  await form.getByRole('button', { name: 'Done', exact: true }).click();
  await page.reload();
  await expect(first).toContainText('Yes');
  await expect(second).toContainText('0');
  const saved = await client
    .from('quantity_items')
    .select('custom_values')
    .eq('id', id)
    .single();
  expect(saved.error).toBeNull();
  expect(saved.data!.custom_values[flagId].value).toBe(true);
  await client.auth.signOut({ scope: 'local' });
});

test('flat choice authoring rejects Unicode/case/space siblings and restores a renamed retired choice without replacing identities', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await auditLogin(page);
  const category = await auditCategory(page);
  const client = await auditReadback();
  const designer = page.getByRole('region', { name: 'Forms and fields' });
  for (const type of ['Dropdown', 'Multiple choice']) {
    const dialog = await addField(page, designer, type, type + ' accents');
    await addOption(dialog, 'Café');
    await addOption(dialog, ' CAFE\u0301 ');
    await expect(
      dialog.getByRole('alert').filter({ hasText: 'matches a sibling' }),
    ).toHaveCount(2);
    await dialog
      .getByRole('button', { name: 'Add to form', exact: true })
      .click();
    await expect(dialog).toBeVisible();
    await expect(
      designer.getByRole('button', {
        name: 'Drag ' + type + ' accents',
        exact: true,
      }),
    ).toHaveCount(0);
    await expect(
      dialog.getByRole('alert').filter({ hasText: 'matches a sibling' }),
    ).toHaveCount(2);
    const duplicate = dialog
      .getByRole('textbox', { name: 'Option name:  CAFE\u0301 ', exact: true })
      .locator('xpath=ancestor::li[1]');
    await duplicate.locator('summary').click();
    await duplicate.getByRole('button', { name: /Retire option/ }).click();
    await expect(
      dialog.getByRole('alert').filter({ hasText: 'matches a sibling' }),
    ).toHaveCount(0);
    await finishField(dialog);
  }
  await auditSaveDesigner(designer);
  const baseline = await published(client, category.id);
  for (const type of ['Dropdown', 'Multiple choice']) {
    const inspector = await inspectField(designer, type + ' accents');
    const duplicate = inspector
      .getByRole('textbox', { name: 'Option name:  CAFE\u0301 ', exact: true })
      .locator('xpath=ancestor::li[1]');
    await duplicate.locator('summary').click();
    await duplicate.getByRole('button', { name: /Restore option/ }).click();
    await expect(inspector.getByRole('status')).toContainText(
      'an active sibling has the same name',
    );
    await expect(duplicate).toContainText('Retired');
    await duplicate.getByRole('textbox').fill('Café alternate');
    const renamed = inspector
      .getByRole('textbox', {
        name: 'Option name: Café alternate',
        exact: true,
      })
      .locator('xpath=ancestor::li[1]');
    await renamed.getByRole('button', { name: /Restore option/ }).click();
    await expect(
      renamed.getByRole('button', { name: /Retire option/ }),
    ).toBeVisible();
  }
  await auditSaveDesigner(designer);
  await page.reload();
  const restored = await published(client, category.id);
  for (const oldField of baseline.fields) {
    const field = restored.fields.find((entry) => entry.id === oldField.id)!;
    expect(field.options.map((option) => option.id)).toEqual(
      oldField.options.map((option) => option.id),
    );
    expect(field.options.map((option) => option.label)).toEqual([
      'Café',
      'Café alternate',
    ]);
    expect(field.options.every((option) => option.active)).toBe(true);
  }
  await client.auth.signOut({ scope: 'local' });
});
