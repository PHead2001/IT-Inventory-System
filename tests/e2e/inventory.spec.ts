import { expect, test, type Page, type Locator } from '@playwright/test';
import fixture from '../fixtures/auth.json' with { type: 'json' };
import { chooseLocation } from './location-picker';

async function login(page: Page, role: 'staff' | 'viewer' = 'staff') {
  await page.goto('/login');
  await page.getByLabel('Email', { exact: true }).fill(fixture.emails[role]);
  await page.getByLabel('Password', { exact: true }).fill(fixture.password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Inventory workspace' }),
  ).toBeVisible();
}
async function choose(form: Locator, label: string, code: string) {
  await chooseLocation(form, label, code);
}
async function openForm(page: Page, name: string) {
  await page
    .locator('summary')
    .filter({ hasText: new RegExp('^' + name + '$') })
    .click();
  return page.getByRole('form', { name, exact: true });
}
async function confirm(form: Locator, name: string) {
  await form
    .getByRole('button', { name: 'Review ' + name.toLowerCase(), exact: true })
    .click();
  await expect(
    form.getByRole('region', { name: 'Review changes' }),
  ).toBeVisible();
  await form
    .getByRole('button', { name: 'Confirm ' + name.toLowerCase(), exact: true })
    .click();
}
async function version(page: Page, value: number) {
  await expect(
    page.getByText(new RegExp('Version ' + value + '$')),
  ).toBeVisible();
}
async function createQuantity(page: Page, name: string, count = 0) {
  await page.goto('/inventory/quantity/new');
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  const form = page.getByRole('form', {
    name: 'Create quantity inventory',
    exact: true,
  });
  await form.getByLabel('Name', { exact: true }).fill(name);
  if (count) {
    await form.getByLabel('Initial quantity').fill(String(count));
    await choose(form, 'Initial location', 'ITC-S1A');
  }
  await confirm(form, 'Create quantity inventory');
  await expect(page).toHaveURL(/\/inventory\/quantity\/[0-9a-f-]+$/);
  await version(page, 1);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
}
test('quantity core persists multi-location receives, partial and all transfers, counts, metadata and lifecycle', async ({
  page,
}) => {
  test.setTimeout(90_000);
  await login(page);
  await page.setViewportSize({ width: 390, height: 844 });
  const name = 'Browser cables ' + crypto.randomUUID();
  await createQuantity(page, name, 10);
  const url = page.url();
  let form = await openForm(page, 'Receive stock');
  await choose(form, 'Receive at', 'ITC-S1B');
  await form.getByLabel('Quantity to receive').fill('5');
  await form.getByLabel('Reason (required)').fill('New stock delivery');
  await confirm(form, 'Receive stock');
  await version(page, 2);
  await page.reload();
  await expect(
    page.getByRole('heading', { name: 'Current stock — 15 units total' }),
  ).toBeVisible();
  form = await openForm(page, 'Move stock');
  await choose(form, 'Source location', 'ITC-S1A');
  await choose(form, 'Destination location', 'ITC-S1B');
  await form.getByLabel('Quantity to move').fill('3');
  await confirm(form, 'Move stock');
  await version(page, 3);
  await page.reload();
  form = await openForm(page, 'Move stock');
  await choose(form, 'Source location', 'ITC-S1A');
  await choose(form, 'Destination location', 'ITC-S1C');
  await form.getByLabel('Move All from this source location').check();
  await confirm(form, 'Move stock');
  await version(page, 4);
  await page.reload();
  const stock = page.locator('section').filter({
    has: page.getByRole('heading', {
      name: 'Current stock — 15 units total',
    }),
  });
  await expect(stock.getByText('8 units', { exact: true })).toBeVisible();
  await expect(stock.getByText('7 units', { exact: true })).toBeVisible();
  await expect(stock.getByRole('link', { name: /ITC-S1A/ })).toHaveCount(0);
  form = await openForm(page, 'Correct physical count');
  await choose(form, 'Counted location', 'ITC-S1B');
  await form.getByLabel('Observed physical count').fill('6');
  await form.getByLabel('Reason (required)').fill('Verified physical count');
  await confirm(form, 'Correct physical count');
  await version(page, 5);
  form = await openForm(page, 'Edit quantity metadata');
  await form.getByLabel('Name', { exact: true }).fill(name + ' updated');
  await confirm(form, 'Edit quantity metadata');
  await version(page, 6);
  await page.goto('/inventory?q=' + encodeURIComponent(name));
  await expect(
    page.getByRole('link', { name: name + ' updated', exact: true }),
  ).toHaveCount(2);
  const filter = page.getByRole('form', { name: 'Search inventory' });
  const unfilteredUrl = page.url();
  await chooseLocation(filter, 'Location', 'ITC-L');
  expect(page.url()).toBe(unfilteredUrl);
  await filter.getByRole('button', { name: 'Search', exact: true }).click();
  await expect(page).toHaveURL(/location=ITC-L/);
  await expect(
    page.getByRole('link', { name: name + ' updated', exact: true }),
  ).toHaveCount(2);
  await chooseLocation(filter, 'Location', 'ITC-S1C');
  await filter.getByRole('button', { name: 'Search', exact: true }).click();
  await expect(page).toHaveURL(/location=ITC-S1C/);
  await expect(
    page.getByRole('link', { name: name + ' updated', exact: true }),
  ).toHaveCount(1);
  await page
    .getByRole('link', { name: /IT Closet.*ITC-S1C/ })
    .first()
    .click();
  await expect(
    page.getByRole('heading', { name: '1C', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('link', { name: name + ' updated', exact: true }),
  ).toBeVisible();
  await page.goto(url);
  for (const [index, code] of ['ITC-S1B', 'ITC-S1C'].entries()) {
    form = await openForm(page, 'Correct physical count');
    await choose(form, 'Counted location', code);
    await form.getByLabel('Observed physical count').fill('0');
    await form
      .getByLabel('Reason (required)')
      .fill('Stock consumed and counted');
    await confirm(form, 'Correct physical count');
    await version(page, 7 + index);
    await page.reload();
  }
  form = await openForm(page, 'Archive quantity definition');
  await form
    .getByLabel('Reason (required)')
    .fill('Definition no longer needed');
  await confirm(form, 'Archive quantity definition');
  await version(page, 9);
  await expect(page.getByText(/Quantity inventory · Archived/)).toBeVisible();
  form = await openForm(page, 'Restore quantity definition');
  await form.getByLabel('Reason (required)').fill('Needed again');
  await confirm(form, 'Restore quantity definition');
  await version(page, 10);
  await page.reload();
  await expect(
    page.getByRole('heading', { name: 'Current stock — 0 units total' }),
  ).toBeVisible();
  await page.getByRole('link', { name: 'View all item history' }).click();
  await expect(
    page.getByRole('heading', { name: 'Stock received', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Physically moved', exact: true }),
  ).toHaveCount(2);
  await expect(
    page.getByRole('heading', {
      name: 'Physical count corrected',
      exact: true,
    }),
  ).toHaveCount(3);
  await expect(
    page.getByRole('heading', { name: 'Definition archived', exact: true }),
  ).toBeVisible();
  const historyFilter = page.getByRole('form', { name: 'Filter history' });
  await chooseLocation(historyFilter, 'Location', 'ITC-L');
  await historyFilter
    .getByRole('button', { name: 'Filter history', exact: true })
    .click();
  await expect(page).toHaveURL(/location=ITC-L/);
  await expect(
    page.getByRole('heading', { name: 'Physically moved', exact: true }),
  ).toHaveCount(2);
  await chooseLocation(historyFilter, 'Location', 'ITC-S1C');
  await historyFilter
    .getByRole('button', { name: 'Filter history', exact: true })
    .click();
  await expect(page).toHaveURL(/location=ITC-S1C/);
  await expect(
    page.getByRole('heading', { name: 'Physically moved', exact: true }),
  ).toHaveCount(1);
});
test('serialized core allows duplicate serials and persists distinct moves, corrections and retirement', async ({
  page,
}) => {
  test.setTimeout(90_000);
  await login(page);
  const suffix = crypto.randomUUID(),
    name = 'Browser switch ' + suffix,
    serial = '001-' + suffix;
  async function create(name: string, tag: string) {
    await page.goto('/inventory/assets/new');
    const form = page.getByRole('form', {
      name: 'Create serialized asset',
      exact: true,
    });
    await form.getByLabel('Name', { exact: true }).fill(name);
    await form.getByLabel('Asset tag').fill(tag);
    await form.getByLabel('Serial number').fill(serial);
    await choose(form, 'Destination location', 'ITC-RACK');
    return form;
  }
  let form = await create(name, 'A-' + suffix);
  await confirm(form, 'Create serialized asset');
  await expect(page).toHaveURL(/\/inventory\/assets\/[0-9a-f-]+$/);
  const first = page.url();
  form = await create(name + ' duplicate', 'B-' + suffix);
  await form
    .getByRole('button', { name: 'Review create serialized asset' })
    .click();
  await expect(form.getByRole('status')).toContainText(name);
  await form
    .getByRole('button', { name: 'Confirm create serialized asset' })
    .click();
  await expect(page).toHaveURL(/\/inventory\/assets\/[0-9a-f-]+$/);
  await expect(
    page.getByRole('heading', { name: 'Duplicate serial warning' }),
  ).toBeVisible();
  await page.goto(first);
  form = await openForm(page, 'Move asset');
  await choose(form, 'Destination location', 'ITC-D01');
  await confirm(form, 'Move asset');
  await version(page, 2);
  form = await openForm(page, 'Correct recorded location');
  await choose(form, 'Destination location', 'ITC-D02');
  await form.getByLabel('Reason (required)').fill('Found in adjacent drawer');
  await confirm(form, 'Correct recorded location');
  await version(page, 3);
  form = await openForm(page, 'Edit asset metadata');
  await form.getByLabel('Model').fill('Managed switch');
  await confirm(form, 'Edit asset metadata');
  await version(page, 4);
  form = await openForm(page, 'Retire asset');
  await form.getByLabel('Reason (required)').fill('Removed from service');
  await confirm(form, 'Retire asset');
  await version(page, 5);
  await page.reload();
  await expect(
    page.getByRole('heading', { name: 'Last known location' }),
  ).toBeVisible();
  await expect(
    page.locator('summary').filter({ hasText: /^Move asset$/ }),
  ).toHaveCount(0);
  form = await openForm(page, 'Restore asset');
  await choose(form, 'Confirmed current location', 'ITC-RACK');
  await form
    .getByLabel('Reason (required)')
    .fill('Tested and returned to service');
  await confirm(form, 'Restore asset');
  await version(page, 6);
  await page.reload();
  await expect(
    page.getByRole('heading', { name: 'Current location' }),
  ).toBeVisible();
  await expect(
    page
      .locator('section')
      .filter({
        has: page.getByRole('heading', { name: 'Asset details', exact: true }),
      })
      .getByText(/Managed switch/),
  ).toBeVisible();
  await page.getByRole('link', { name: 'View all asset history' }).click();
  await expect(
    page.getByRole('heading', { name: 'Physically moved', exact: true }),
  ).toHaveCount(1);
  await expect(
    page.getByRole('heading', {
      name: 'Recorded location corrected',
      exact: true,
    }),
  ).toHaveCount(1);
  await expect(
    page.getByText('Reason: Found in adjacent drawer'),
  ).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Asset retired', exact: true }),
  ).toBeVisible();
});
test('stale two-page edits require explicit re-review and viewers retain read-only access', async ({
  page,
  context,
}) => {
  test.setTimeout(90_000);
  await login(page);
  const name = 'Browser concurrency ' + crypto.randomUUID();
  await createQuantity(page, name);
  const detailUrl = page.url();
  const firstForm = await openForm(page, 'Edit quantity metadata');
  await firstForm.getByLabel('Name', { exact: true }).fill(name + ' my edit');
  const other = await context.newPage();
  await other.goto(detailUrl);
  const otherForm = await openForm(other, 'Edit quantity metadata');
  await otherForm
    .getByLabel('Name', { exact: true })
    .fill(name + ' concurrent');
  await confirm(otherForm, 'Edit quantity metadata');
  await version(other, 2);
  await other.close();
  await confirm(firstForm, 'Edit quantity metadata');
  await expect(firstForm.getByRole('alert')).toContainText('changed');
  await expect(firstForm.getByLabel('Name', { exact: true })).toHaveValue(
    name + ' my edit',
  );
  await firstForm
    .getByRole('button', { name: 'Refresh latest record' })
    .click();
  await version(page, 2);
  await expect(
    firstForm.getByRole('button', { name: 'Review edit quantity metadata' }),
  ).toBeEnabled();
  await firstForm
    .getByRole('button', { name: 'Review edit quantity metadata' })
    .click();
  await expect(
    firstForm.getByRole('region', { name: 'Review changes' }),
  ).toContainText(name + ' concurrent → ' + name + ' my edit');
  await firstForm
    .getByRole('button', { name: 'Confirm edit quantity metadata' })
    .click();
  await version(page, 3);
  await page.getByRole('button', { name: 'Sign out' }).click();
  await login(page, 'viewer');
  await page.goto(detailUrl);
  await expect(
    page.getByRole('heading', { name: name + ' my edit', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText('Manage quantity inventory', { exact: true }),
  ).toHaveCount(0);
  await page.getByRole('link', { name: 'View all item history' }).click();
  await expect(
    page.getByRole('heading', { name: 'Metadata edited', exact: true }),
  ).toHaveCount(2);
  await page.goto('/inventory/quantity/new');
  await expect(page.getByText(/Read-only access/)).toBeVisible();
  await expect(
    page.getByRole('form', { name: 'Create quantity inventory' }),
  ).toHaveCount(0);
});
