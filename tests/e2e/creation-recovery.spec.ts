import { expect, test, type Page } from '@playwright/test';
import fixture from '../fixtures/auth.json' with { type: 'json' };
import { chooseLocation } from './location-picker';

test.use({ trace: 'on' });
async function login(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Email', { exact: true }).fill(fixture.emails.staff);
  await page.getByLabel('Password', { exact: true }).fill(fixture.password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Inventory', exact: true }),
  ).toBeVisible();
}
async function inventory(page: Page) {
  await page
    .getByRole('link', { name: 'Inventory', exact: true })
    .first()
    .click();
  await expect(
    page.getByRole('heading', { name: 'Inventory', exact: true }),
  ).toBeVisible();
}
test('creation recovery retains serialized input across Back/Forward, internal navigation and reload; saved draft stays terminal', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const warnings: string[] = [];
  page.on('dialog', async (dialog) => {
    warnings.push(dialog.type());
    await dialog.accept();
  });
  await login(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page
    .getByRole('link', { name: 'Create serialized asset', exact: true })
    .click();
  let form = page.getByRole('form', {
    name: 'Create asset inventory',
    exact: true,
  });
  await expect(form.getByLabel('Name', { exact: true })).toBeEnabled();
  await expect(page).toHaveURL(/draft=[0-9a-f-]{36}/);
  const draftURL = page.url();
  const suffix = crypto.randomUUID();
  const name = 'Checkpoint recovered asset ' + suffix,
    tag = 'REC-' + suffix,
    serial = 'SER-' + suffix;
  await form.getByLabel('Name', { exact: true }).fill(name);
  await form.getByLabel('Asset tag').fill(tag);
  await form.getByLabel('Serial number').fill(serial);
  await form.getByLabel('Manufacturer').fill('Fictional manufacturer');
  await form.getByLabel('Model').fill('Fictional model');
  await form.getByLabel('Description').fill('Raw recovery acceptance');
  const category = await form
    .getByLabel('Category', { exact: true })
    .inputValue();
  await chooseLocation(form, 'Current location', 'ITC-RED');
  await page.goBack();
  await expect(
    page.getByRole('heading', { name: 'Inventory', exact: true }),
  ).toBeVisible();
  await page.goForward();
  await expect(form.getByLabel('Name', { exact: true })).toHaveValue(name);
  await inventory(page);
  await page.goBack();
  await expect(form.getByLabel('Asset tag')).toHaveValue(tag);
  const warningsBefore = warnings.length;
  await page.reload();
  await expect(form.getByLabel('Name', { exact: true })).toHaveValue(name);
  await expect(form.getByLabel('Serial number')).toHaveValue(serial);
  await expect(form.getByLabel('Manufacturer')).toHaveValue(
    'Fictional manufacturer',
  );
  await expect(form.getByLabel('Model')).toHaveValue('Fictional model');
  await expect(form.getByLabel('Description')).toHaveValue(
    'Raw recovery acceptance',
  );
  await expect(form.getByLabel('Category', { exact: true })).toHaveValue(
    category,
  );
  await expect(
    form.getByLabel('Current location', { exact: true }),
  ).toContainText('ITC-RED');
  expect(warnings.slice(warningsBefore)).toContain('beforeunload');
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await form.getByRole('button', { name: 'Review metadata' }).click();
  await expect(
    form.getByRole('region', { name: 'Metadata review' }),
  ).toBeVisible();
  await form.getByRole('button', { name: 'Confirm save' }).click();
  await expect(page).toHaveURL(/\/inventory\/assets\/[0-9a-f-]+$/);
  const savedURL = page.url();
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
  await page.goto(draftURL);
  await expect(
    page.getByText('This creation draft was already saved.'),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Confirm save' })).toHaveCount(
    0,
  );
  const afterSaveWarnings = warnings.length;
  await page.reload();
  expect(warnings.length).toBe(afterSaveWarnings);
  await page.goto(savedURL);
  await page
    .locator('summary')
    .filter({ hasText: /^Retire asset$/ })
    .click();
  form = page.getByRole('form', { name: 'Retire asset', exact: true });
  await form
    .getByLabel('Reason (required)')
    .fill('Checkpoint local recovery acceptance cleanup');
  await form
    .getByRole('button', { name: 'Review retire asset', exact: true })
    .click();
  await form
    .getByRole('button', { name: 'Confirm retire asset', exact: true })
    .click();
  await expect(page.getByText(/Version 2$/)).toBeVisible();
});
test('quantity creation preserves stock input; explicit discard survives return and pristine forms do not warn', async ({
  page,
}) => {
  test.setTimeout(90_000);
  const warnings: string[] = [];
  page.on('dialog', async (dialog) => {
    warnings.push(dialog.type());
    await dialog.accept();
  });
  await login(page);
  await page
    .getByRole('link', { name: 'Create quantity inventory', exact: true })
    .click();
  const form = page.getByRole('form', {
    name: 'Create quantity inventory',
    exact: true,
  });
  await expect(form.getByLabel('Name', { exact: true })).toBeEnabled();
  await page.reload();
  expect(warnings).toEqual([]);
  const name = 'Checkpoint discarded quantity ' + crypto.randomUUID();
  await form.getByLabel('Name', { exact: true }).fill(name);
  await form.getByLabel('Item code (SKU)').fill('RECOVERY-SKU');
  await form.getByLabel('Initial quantity').fill('3');
  await chooseLocation(form, 'Initial location', 'ITC-RED');
  const draftURL = page.url();
  await inventory(page);
  await page.goBack();
  await expect(form.getByLabel('Name', { exact: true })).toHaveValue(name);
  await expect(form.getByLabel('Item code (SKU)')).toHaveValue('RECOVERY-SKU');
  await expect(form.getByLabel('Initial quantity')).toHaveValue('3');
  await expect(
    form.getByLabel('Initial location', { exact: true }),
  ).toContainText('ITC-RED');
  await form.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Keep editing' }),
  ).toBeFocused();
  await page.getByRole('button', { name: 'Keep editing' }).click();
  await expect(
    form.getByRole('button', { name: 'Cancel', exact: true }),
  ).toBeFocused();
  await form.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page
    .getByRole('button', { name: 'Discard changes', exact: true })
    .click();
  await expect(
    page.getByRole('heading', { name: 'Inventory', exact: true }),
  ).toBeVisible();
  await page.goBack();
  await expect(
    page.getByText('This creation draft was discarded.'),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByText('This creation draft was discarded.'),
  ).toBeVisible();
  await expect(
    page.getByRole('textbox', { name: 'Name', exact: true }),
  ).toHaveCount(0);
  expect(page.url()).toBe(draftURL);
});
test('unavailable creation storage explains internal-navigation limits, blocks dispatch and still warns before tab closure', async ({
  page,
}) => {
  test.setTimeout(90_000);
  await page.addInitScript(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key.startsWith('inventory-creation-v1:'))
        throw new DOMException('Fixture quota', 'QuotaExceededError');
      return original.call(this, key, value);
    };
  });
  await login(page);
  await page
    .getByRole('link', { name: 'Create serialized asset', exact: true })
    .click();
  const form = page.getByRole('form', {
    name: 'Create asset inventory',
    exact: true,
  });
  await form
    .getByLabel('Name', { exact: true })
    .fill('Checkpoint storage failure');
  await chooseLocation(form, 'Current location', 'ITC-RED');
  await form.getByRole('button', { name: 'Review metadata' }).click();
  await form.getByRole('button', { name: 'Confirm save' }).click();
  await expect(form.getByRole('alert')).toContainText(
    'browser and internal navigation may lose',
  );
  await expect(page).toHaveURL(/\/inventory\/assets\/new/);
  const closing = page.waitForEvent('dialog');
  void page.close({ runBeforeUnload: true });
  const warning = await closing;
  expect(warning.type()).toBe('beforeunload');
  await warning.accept();
});
