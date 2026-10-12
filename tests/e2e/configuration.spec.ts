import { metadataReviewButton, metadataSaveButton } from './metadata-controls';
import { expect, test, type Page } from '@playwright/test';
import { withOwnedLabelDefaults } from './label-defaults-fixture';
import fixture from '../fixtures/auth.json' with { type: 'json' };

async function signIn(page: Page, role: 'staff' | 'viewer') {
  await page.goto('/login');
  await page.getByLabel('Email', { exact: true }).fill(fixture.emails[role]);
  await page.getByLabel('Password', { exact: true }).fill(fixture.password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Inventory', exact: true }),
  ).toBeVisible();
}
async function noHorizontalOverflow(page: Page) {
  const layout = await page.evaluate(() => ({
    viewport: window.innerWidth,
    scrollWidth: document.documentElement.scrollWidth,
    offenders: [...document.querySelectorAll('body *')]
      .filter(
        (element) =>
          element.getBoundingClientRect().right > window.innerWidth + 1,
      )
      .slice(0, 8)
      .map((element) => ({
        tag: element.tagName,
        className: element.className,
        right: Math.round(element.getBoundingClientRect().right),
      })),
  }));
  expect(layout.scrollWidth, JSON.stringify(layout)).toBeLessThanOrEqual(
    layout.viewport,
  );
}

test('phone Settings reviews referenced removal and shares label defaults with new jobs', async ({
  page,
}) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 390, height: 844 });
  const unique = Date.now().toString();
  const firstName = 'Settings ' + unique;
  const renamed = 'Renamed ' + firstName;
  const code = 'SETTINGS-' + unique;
  await withOwnedLabelDefaults(page, async (defaults) => {
    await signIn(page, 'staff');
    await page.goto('/settings/categories');
    await expect(
      page.getByRole('heading', { name: 'Categories', level: 1 }),
    ).toBeVisible();
    await expect(
      page.getByRole('heading', { name: 'Categories', exact: true }),
    ).toHaveCount(1);
    await noHorizontalOverflow(page);
    await page.getByLabel('Display name').fill(firstName);
    await expect(page.getByLabel('Permanent code')).toHaveValue(code);
    await page.getByRole('button', { name: 'Add category' }).click();
    const category = page.locator('li').filter({ hasText: code });
    await expect(category).toContainText(firstName);
    await expect(
      category.getByRole('link', {
        name: 'Edit form for ' + firstName,
        exact: true,
      }),
    ).toHaveAttribute('href', /\/settings\/forms\/[0-9a-f-]+$/);
    await expect(
      category.getByRole('button', {
        name: 'Remove ' + firstName,
        exact: true,
      }),
    ).toBeVisible();
    await category
      .getByRole('button', { name: 'Rename ' + firstName, exact: true })
      .click();
    await category.getByLabel('New category name').fill(renamed);
    await category.getByRole('button', { name: 'Save name' }).click();
    await expect(category).toContainText(renamed);
    await expect(
      category.getByRole('link', {
        name: 'Edit form for ' + renamed,
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      category.getByRole('button', { name: 'Remove ' + renamed, exact: true }),
    ).toBeVisible();
    await page.goto('/inventory/quantity/new');
    const form = page.getByRole('form', { name: 'Add quantity item' });
    await form
      .getByLabel('Name', { exact: true })
      .fill('Settings referenced ' + unique);
    await form.getByLabel('Category').selectOption({ label: renamed });
    await metadataReviewButton(form).click();
    await expect(
      form.getByRole('region', { name: 'Metadata review' }),
    ).toBeVisible();
    await metadataSaveButton(form).click();
    await expect(page).toHaveURL(/\/inventory\/quantity\/[0-9a-f-]+$/);
    await page.goto('/settings/categories');
    const current = page.locator('li').filter({ hasText: code });
    await current.getByRole('button', { name: 'Remove ' + renamed }).click();
    await current
      .getByLabel('Replacement category')
      .selectOption({ label: 'Cables' });
    await current.getByRole('button', { name: 'Review impact' }).click();
    await expect(
      current.getByRole('region', { name: 'Removal impact review' }),
    ).toContainText('1 current quantity items');
    await noHorizontalOverflow(page);
    await current.getByRole('button', { name: /^Remove category / }).click();
    await expect(current).toContainText('Removed');
    await page.goto('/settings/labels');
    await expect(
      page.getByRole('heading', {
        name: 'Labels & printing defaults',
        level: 1,
      }),
    ).toBeVisible();
    await page
      .getByRole('combobox', { name: 'Label size' })
      .selectOption('70x35');
    await page.getByRole('combobox', { name: 'Paper size' }).selectOption('A4');
    await page
      .getByRole('combobox', { name: 'Barcode type' })
      .selectOption('code128');
    const savedMessage = defaults.reviewSave({
      size: '70x35',
      page: 'A4',
      format: 'code128',
      // Selecting a standard size/paper explicitly clears custom geometry.
      layout: null,
    });
    await page.getByRole('button', { name: 'Save shared defaults' }).click();
    await expect(page.getByRole('status')).toContainText(savedMessage);
    await defaults.confirmSaved();
    await page.goto('/labels');
    await expect(
      page.getByRole('combobox', { name: 'Label size' }),
    ).toHaveValue('70x35');
    await expect(
      page.getByRole('combobox', { name: 'Paper size' }),
    ).toHaveValue('A4');
    await expect(
      page.getByRole('combobox', { name: 'Barcode type' }),
    ).toHaveValue('code128');
    await noHorizontalOverflow(page);
    await page.getByRole('button', { name: 'Sign out' }).click();
    await expect(page).toHaveURL(/\/login(?:\?|$)/);
    await expect(page.getByLabel('Email', { exact: true })).toBeVisible();
    await signIn(page, 'viewer');
    await page.goto('/settings/categories');
    await expect(page.getByText(renamed)).toBeVisible();
    await expect(page.getByRole('note')).toContainText(
      'Settings are read-only for your account',
    );
    await expect(
      page.getByRole('button', { name: 'Add category' }),
    ).toHaveCount(0);
    await page.goto('/settings/labels');
    await expect(
      page.getByRole('button', { name: 'Save shared defaults' }),
    ).toHaveCount(0);
    await noHorizontalOverflow(page);
  });
});
