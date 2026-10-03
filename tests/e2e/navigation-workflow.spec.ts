import { expect, test, type Page } from '@playwright/test';
import fixture from '../fixtures/auth.json' with { type: 'json' };

async function signIn(page: Page, role: 'staff' | 'viewer' = 'staff') {
  await page.goto('/login');
  await expect(
    page.getByRole('button', { name: 'Reduce motion locally' }),
  ).toHaveCount(0);
  await page.getByLabel('Email', { exact: true }).fill(fixture.emails[role]);
  await page.getByLabel('Password', { exact: true }).fill(fixture.password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Inventory', exact: true }),
  ).toBeVisible();
}

test('category routes, pending field recovery and native modal focus remain consistent through Back/Forward', async ({
  page,
}, testInfo) => {
  test.setTimeout(120_000);
  await signIn(page);
  const names = [
    `Navigation A ${crypto.randomUUID()}`,
    `Navigation B ${crypto.randomUUID()}`,
  ];
  for (const name of names) {
    await page.goto('/settings/categories');
    await page.getByLabel('Display name').fill(name);
    await page.getByRole('button', { name: 'Add category' }).click();
    await expect(page.getByRole('status')).toContainText('Settings saved.');
  }
  await page.goto('/settings/forms');
  await page.getByRole('link', { name: names[0], exact: true }).click();
  const routeA = page.url();
  const designer = page.getByRole('region', { name: 'Forms and fields' });
  const selector = designer.getByLabel('Category', { exact: true });
  await expect(
    selector.locator('option').filter({ hasText: names[1] }),
  ).toHaveCount(1);
  await selector.selectOption({ label: names[1] });
  await expect(
    page.getByRole('heading', { name: `${names[1]} form`, exact: true }),
  ).toBeVisible();
  const routeB = page.url();
  expect(routeB).not.toBe(routeA);
  await selector.selectOption({ label: names[0] });
  await expect(page).toHaveURL(routeA);
  await expect(
    page.getByRole('heading', { name: `${names[0]} form`, exact: true }),
  ).toBeVisible();

  await designer
    .getByRole('button', { name: 'Add field', exact: true })
    .click();
  const modal = page.getByRole('dialog', { name: 'Add field', exact: true });
  await modal.getByRole('button', { name: 'Date & time', exact: true }).click();
  await modal
    .getByLabel('Field name', { exact: true })
    .fill('Pending appointment');
  const basics = modal.getByRole('region', { name: 'Basics', exact: true });
  await basics.getByLabel('Display timezone').selectOption('America/Chicago');
  await basics.getByLabel('Date', { exact: true }).fill('2026-03-08');
  await basics.getByLabel('Time', { exact: true }).fill('02:30:00');
  await expect(
    basics.getByText(/does not exist in this timezone/),
  ).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(routeB);
  await expect(page.getByRole('button', { name: 'Recover edits' })).toHaveCount(
    0,
  );
  await page.goForward();
  await expect(page).toHaveURL(routeA);
  await page.getByRole('button', { name: 'Recover edits' }).click();
  await expect(modal.getByLabel('Field name', { exact: true })).toHaveValue(
    'Pending appointment',
  );
  await expect(basics.getByLabel('Display timezone')).toHaveValue(
    'America/Chicago',
  );
  await expect(basics.getByLabel('Date', { exact: true })).toHaveValue(
    '2026-03-08',
  );
  await expect(basics.getByLabel('Time', { exact: true })).toHaveValue(
    '02:30:00',
  );
  await page.keyboard.press('Escape');
  await expect(modal).not.toBeVisible();
  await expect(
    designer.getByRole('button', { name: 'Add field', exact: true }),
  ).toBeFocused();

  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 390, height: 480 },
    { width: 1440, height: 330 },
  ]) {
    await page.setViewportSize(viewport);
    const canvas = designer.getByRole('button', {
      name: 'Canvas',
      exact: true,
    });
    if (await canvas.isVisible()) await canvas.click();
    const trigger = designer.getByRole('button', {
      name: 'Add field to Details',
      exact: true,
    });
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await trigger.scrollIntoViewIfNeeded();
    await expect
      .poll(() => page.evaluate(() => window.scrollY))
      .toBeGreaterThan(0);
    await page.evaluate(() =>
      document
        .querySelector('.experience-page-arrival')
        ?.animate(
          [{ transform: 'translateY(12px)' }, { transform: 'translateY(0)' }],
          { duration: 10000 },
        ),
    );
    await trigger.click();
    const box = await modal.boundingBox();
    expect(box).toBeTruthy();
    expect(Math.abs(box!.x + box!.width / 2 - viewport.width / 2)).toBeLessThan(
      2,
    );
    expect(box!.y).toBeGreaterThanOrEqual(15);
    expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height - 15);
    expect(
      Math.abs(box!.y + box!.height / 2 - viewport.height / 2),
    ).toBeLessThan(2);
    await expect(
      modal.getByRole('button', { name: 'Add to form' }),
    ).toBeInViewport();
    await expect(
      modal.getByRole('button', { name: 'Cancel', exact: true }),
    ).toBeInViewport();
    await modal.getByRole('button', { name: 'Add to form' }).focus();
    await page.keyboard.press('Tab');
    await expect(
      modal.getByRole('button', { name: 'Cancel', exact: true }),
    ).toBeFocused();
    await page.screenshot({
      path: testInfo.outputPath(
        `add-field-${viewport.width}-${viewport.height}.png`,
      ),
    });
    await page.keyboard.press('Escape');
    await expect(trigger).toBeFocused();
    await page.evaluate(() =>
      document
        .querySelector('.experience-page-arrival')
        ?.getAnimations()
        .forEach((animation) => animation.cancel()),
    );
  }
});

test('viewer controls personal motion in Settings and retains it across routes with OS precedence', async ({
  page,
}) => {
  await signIn(page, 'viewer');
  await page.goto('/settings');
  const preference = page.getByRole('region', {
    name: 'Appearance & preferences',
  });
  await preference
    .getByRole('button', { name: 'Reduce motion locally' })
    .focus();
  await page.keyboard.press('Enter');
  await expect(
    preference.getByRole('button', { name: 'Use system motion setting' }),
  ).toHaveText(/Reduced locally/);
  await page
    .getByRole('navigation', { name: 'Main navigation' })
    .getByRole('link', { name: 'Inventory' })
    .click();
  await expect(page.locator('html')).toHaveAttribute('data-motion', 'reduced');
  await expect(
    page.getByRole('button', { name: 'Use system motion setting' }),
  ).toHaveCount(0);
  await page.goto('/settings');
  await preference
    .getByRole('button', { name: 'Use system motion setting' })
    .click();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(
    preference.getByRole('button', { name: 'Reduce motion locally' }),
  ).toHaveText(/Reduced by system/);
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-motion', 'reduced');
});
