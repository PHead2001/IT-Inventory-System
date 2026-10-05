import { openRecordTask } from './record-task-controls';
import { metadataReviewButton, metadataSaveButton } from './metadata-controls';
import { randomUUID } from 'node:crypto';
import { expect, test, type Page, type Locator } from '@playwright/test';
import fixture from '../fixtures/auth.json' with { type: 'json' };
import { chooseLocation } from './location-picker';

async function login(page: Page, role: 'staff' | 'viewer' = 'staff') {
  await page.goto('/login');
  await page.getByLabel('Email', { exact: true }).fill(fixture.emails[role]);
  await page.getByLabel('Password', { exact: true }).fill(fixture.password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Inventory', exact: true }),
  ).toBeVisible();
}
async function openOperation(page: Page, name: string) {
  return openRecordTask(page, name);
}
async function archive(page: Page, detail: string) {
  await page.goto(detail);
  const form = await openOperation(
    page,
    'Archive quantity definition and clear stock',
  );
  await form
    .getByLabel('Reason (required)')
    .fill('Checkpoint 2 fictional fixture cleanup');
  await form.getByRole('checkbox', { name: /I understand/ }).check();
  await form
    .getByRole('button', { name: 'Review archive and clear stock' })
    .click();
  await form
    .getByRole('button', { name: 'Confirm archive and clear stock' })
    .click();
  await expect(page.getByText(/Archived · Version/)).toBeVisible();
}
async function associatedError(input: Locator) {
  await expect(input).toBeFocused();
  await expect(input).toHaveAttribute('aria-invalid', 'true');
  await expect(input).toHaveAttribute('aria-describedby', /.+/);
  await expect(input).toHaveAccessibleDescription(/Enter|Choose|Answer/);
}
async function noOverflow(page: Page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
}

test('category Rename preserves keyboard focus through invalid, Cancel, Escape and successful rerender', async ({
  page,
}, testInfo) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1180, height: 757 });
  await login(page);
  await page.goto('/settings/categories');
  const name = 'Accessibility category ' + randomUUID();
  const renamed = 'Renamed ' + name;
  await page.getByLabel('Display name').fill(name);
  const code = await page
    .getByLabel('Permanent code', { exact: true })
    .inputValue();
  const row = page.locator('li').filter({ hasText: code });
  try {
    await page
      .getByRole('button', { name: 'Add category', exact: true })
      .click();
    await expect(row).toContainText(name);
    const trigger = row.getByRole('button', {
      name: 'Rename ' + name,
      exact: true,
    });
    await trigger.focus();
    await page.keyboard.press('Enter');
    const input = row.getByLabel('New category name', { exact: true });
    await expect(input).toBeFocused();
    await expect(input).toHaveValue(name);
    await input.fill('');
    await page.keyboard.press('Enter');
    await associatedError(input);
    await page.screenshot({
      path: testInfo.outputPath('rename-invalid-desktop.png'),
      fullPage: true,
    });
    await row.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(trigger).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(input).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(input).toHaveCount(0);
    await expect(trigger).toBeFocused();
    await page.keyboard.press('Enter');
    await input.fill(renamed);
    await row.getByRole('button', { name: 'Save name', exact: true }).click();
    await expect(
      row.getByRole('button', { name: 'Rename ' + renamed, exact: true }),
    ).toBeFocused();
    await expect(input).toHaveCount(0);
    await page.screenshot({
      path: testInfo.outputPath('rename-return-focus.png'),
      fullPage: true,
    });
    await noOverflow(page);
  } finally {
    await page.goto('/settings/categories');
    if (await row.count()) {
      await row.getByRole('button', { name: /^Remove /, exact: true }).click();
      await row
        .getByRole('button', { name: 'Review impact', exact: true })
        .click();
      await row
        .getByRole('button', { name: 'Confirm removal', exact: true })
        .click();
      await expect(row).toHaveCount(0);
    }
  }
});

test('creation and receive keep associated errors, entered values and correction usable at narrow width', async ({
  page,
}, testInfo) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await login(page);
  await page.goto('/inventory/quantity/new');
  let form = page.getByRole('form', {
    name: 'Add quantity item',
    exact: true,
  });
  const name = 'Accessibility quantity ' + randomUUID();
  await expect(form.getByLabel('Name', { exact: true })).toBeEnabled();
  await expect(form.getByText(/Fields marked/)).toBeVisible();
  await metadataReviewButton(form).click();
  await associatedError(form.getByLabel('Name', { exact: true }));
  await expect(
    form.getByRole('region', { name: 'Metadata review' }),
  ).toHaveCount(0);
  await form.getByLabel('Name', { exact: true }).fill(name);
  await form.getByLabel('Initial quantity').fill('1');
  await metadataReviewButton(form).click();
  await associatedError(form.getByLabel('Initial location', { exact: true }));
  await expect(form.getByLabel('Name', { exact: true })).toHaveValue(name);
  await page.screenshot({
    path: testInfo.outputPath('conditional-location-invalid-phone.png'),
    fullPage: true,
  });
  await chooseLocation(form, 'Initial location', 'ITC-RED');
  await metadataReviewButton(form).click();
  await metadataSaveButton(form).click();
  await expect(page).toHaveURL(/\/inventory\/quantity\/[0-9a-f-]+$/);
  const detail = page.url();
  try {
    form = await openOperation(page, 'Receive stock');
    await chooseLocation(form, 'Receive at', 'ITC-RED');
    await form.getByLabel('Reason (required)').fill('Fictional delivery');
    await form.getByLabel('Quantity to receive').fill('0');
    await form
      .getByRole('button', { name: 'Review receive stock', exact: true })
      .click();
    await associatedError(form.getByLabel('Quantity to receive'));
    await expect(form.getByLabel('Reason (required)')).toHaveValue(
      'Fictional delivery',
    );
    await expect(
      form.getByRole('region', { name: 'Review changes' }),
    ).toHaveCount(0);
    await page.screenshot({
      path: testInfo.outputPath('receive-invalid-phone.png'),
      fullPage: true,
    });
    await noOverflow(page);
    await form.getByLabel('Quantity to receive').fill('2');
    await form
      .getByRole('button', { name: 'Review receive stock', exact: true })
      .click();
    await expect(
      form.getByRole('region', { name: 'Review changes' }),
    ).toBeVisible();
    await form
      .getByRole('button', { name: 'Confirm receive stock', exact: true })
      .click();
    await expect(
      form.getByRole('status').filter({ hasText: /^Saved successfully\.$/ }),
    ).toBeVisible();
    await page.goto(detail);
    form = await openOperation(page, 'Move stock');
    await chooseLocation(form, 'Source location', 'ITC-RED');
    await chooseLocation(form, 'Destination location', 'ITC-BLACK');
    await form.getByLabel('Quantity to move').fill('4');
    await form
      .getByRole('button', { name: 'Review move stock', exact: true })
      .click();
    await associatedError(form.getByLabel('Quantity to move'));
    await expect(
      form.getByRole('region', { name: 'Review changes' }),
    ).toHaveCount(0);
    await expect(form.getByLabel('Quantity to move')).toHaveValue('4');
    await page.screenshot({
      path: testInfo.outputPath('move-overdraw-associated-error-phone.png'),
      fullPage: true,
    });
    await page.goto('/settings/sites');
    const siteForm = page.locator('form').filter({
      has: page.getByRole('heading', { name: 'Add property/site' }),
    });
    await siteForm
      .getByRole('button', { name: 'Save site', exact: true })
      .click();
    await associatedError(siteForm.getByLabel('Name', { exact: true }));
    await expect(
      siteForm.getByLabel('Notes', { exact: true }),
    ).not.toHaveAttribute('required', '');
    await noOverflow(page);
    await page.setViewportSize({ width: 1180, height: 757 });
    await page.evaluate(() => {
      document.body.style.zoom = '2';
    });
    await siteForm.getByLabel('Name', { exact: true }).scrollIntoViewIfNeeded();
    await page.screenshot({
      path: testInfo.outputPath('site-validation-css-zoom-200.png'),
      fullPage: true,
    });
    await noOverflow(page);
    await page.evaluate(() => {
      document.body.style.zoom = '';
    });
  } finally {
    await archive(page, detail);
  }
});

test('serialized creation leaves asset tag optional and retains invalid values through Cancel', async ({
  page,
}, testInfo) => {
  await login(page);
  await page.goto('/inventory/assets/new');
  const form = page.getByRole('form', {
    name: 'Add individual asset',
    exact: true,
  });
  await expect(form.getByLabel('Name', { exact: true })).toBeEnabled();
  await metadataReviewButton(form).click();
  await associatedError(form.getByLabel('Name', { exact: true }));
  await expect(form.getByLabel('Asset tag')).not.toHaveAttribute(
    'required',
    '',
  );
  await form.getByLabel('Manufacturer').fill('Fictional retained manufacturer');
  await form.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.getByRole('button', { name: 'Keep editing', exact: true }).click();
  await expect(form.getByLabel('Manufacturer')).toHaveValue(
    'Fictional retained manufacturer',
  );
  await expect(
    form.getByRole('region', { name: 'Metadata review' }),
  ).toHaveCount(0);
  await page.screenshot({
    path: testInfo.outputPath('asset-invalid-cancel.png'),
    fullPage: true,
  });
  await form.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page
    .getByRole('button', { name: 'Discard changes', exact: true })
    .click();
  await expect(page).toHaveURL(/\/inventory$/);
});
