import { expect, test, type Page } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import fixture from '../fixtures/auth.json' with { type: 'json' };

async function signIn(page: Page, role: 'staff' | 'viewer') {
  await page.goto('/login');
  await page.getByLabel('Email', { exact: true }).fill(fixture.emails[role]);
  await page.getByLabel('Password', { exact: true }).fill(fixture.password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Inventory workspace' }),
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
  const admin = createClient(
    process.env.LOCAL_API_URL!,
    process.env.LOCAL_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );
  await signIn(page, 'staff');
  try {
    await page.goto('/settings');
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
    await noHorizontalOverflow(page);
    await page.getByLabel('Display name').fill(firstName);
    await expect(page.getByLabel('Permanent code')).toHaveValue(code);
    await page.getByRole('button', { name: 'Add category' }).click();
    const category = page.locator('li').filter({ hasText: code });
    await expect(category).toContainText(firstName);
    await category.getByRole('button', { name: 'Rename' }).click();
    await category.getByLabel('New category name').fill(renamed);
    await category.getByRole('button', { name: 'Save name' }).click();
    await expect(category).toContainText(renamed);
    await page.goto('/inventory/quantity/new');
    const form = page.getByRole('form', { name: 'Create quantity inventory' });
    await form
      .getByLabel('Name', { exact: true })
      .fill('Settings referenced ' + unique);
    await form.getByLabel('Category').selectOption({ label: renamed });
    await form
      .getByRole('button', { name: 'Review create quantity inventory' })
      .click();
    await form
      .getByRole('button', { name: 'Confirm create quantity inventory' })
      .click();
    await expect(page).toHaveURL(/\/inventory\/quantity\/[0-9a-f-]+$/);
    await page.goto('/settings');
    const current = page.locator('li').filter({ hasText: code });
    await current.getByRole('button', { name: 'Remove' }).click();
    await current
      .getByLabel('Replacement category')
      .selectOption({ label: 'Cables' });
    await current.getByRole('button', { name: 'Review impact' }).click();
    await expect(
      current.getByRole('region', { name: 'Removal impact review' }),
    ).toContainText('1 current quantity definitions');
    await noHorizontalOverflow(page);
    await current.getByRole('button', { name: 'Confirm removal' }).click();
    await expect(current).toContainText('Removed');
    await page.getByRole('combobox', { name: 'Size' }).selectOption('70x35');
    await page.getByRole('combobox', { name: 'Page' }).selectOption('A4');
    await page
      .getByRole('combobox', { name: 'Format' })
      .selectOption('code128');
    await page.getByRole('button', { name: 'Save shared defaults' }).click();
    await expect(page.getByRole('status')).toContainText('Settings saved.');
    await page.goto('/labels');
    await expect(
      page.getByRole('combobox', { name: 'Label size' }),
    ).toHaveValue('70x35');
    await expect(page.getByRole('combobox', { name: 'Page' })).toHaveValue(
      'A4',
    );
    await expect(page.getByRole('combobox', { name: 'Code' })).toHaveValue(
      'code128',
    );
    await noHorizontalOverflow(page);
    await page.getByRole('button', { name: 'Sign out' }).click();
    await signIn(page, 'viewer');
    await page.goto('/settings');
    await expect(page.getByText(renamed)).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Add category' }),
    ).toHaveCount(0);
    await expect(
      page.getByRole('button', { name: 'Save shared defaults' }),
    ).toHaveCount(0);
    await noHorizontalOverflow(page);
  } finally {
    const { error } = await admin
      .from('label_defaults')
      .update({ size: '90x50', page: 'letter', format: 'qr' })
      .eq('singleton', true);
    expect(error).toBeNull();
  }
});
