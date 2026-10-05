import { expect, test } from '@playwright/test';
import fixture from '../fixtures/auth.json' with { type: 'json' };
declare global {
  interface Window {
    __cameraRequests: number;
  }
}

test('click before partial prefetch completes gives immediate feedback and completes navigation', async ({
  page,
}) => {
  await page.goto('/login');
  await page.getByLabel('Email', { exact: true }).fill(fixture.emails.staff);
  await page.getByLabel('Password', { exact: true }).fill(fixture.password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Inventory', exact: true }),
  ).toBeVisible();
  let release!: () => void;
  const gate = new Promise<void>((done) => {
    release = done;
  });
  let started!: () => void;
  const requested = new Promise<void>((done) => {
    started = done;
  });
  await page.route(
    (url) => url.pathname === '/sites' && url.searchParams.has('_rsc'),
    async (route) => {
      started();
      await gate;
      await route.continue();
    },
  );
  try {
    const link = page
      .getByRole('navigation', { name: 'Main navigation' })
      .getByRole('link', { name: 'Properties & sites', exact: true });
    await link.hover();
    await requested;
    await link.click();
    await expect(
      page
        .locator('[data-navigation-pending="true"], [data-route-loading]')
        .first(),
    ).toBeVisible();
    expect(new URL(page.url()).pathname).toBe('/inventory');
    release();
    await expect(
      page.getByRole('heading', { name: 'Properties & sites', exact: true }),
    ).toBeVisible();
    await expect(link).toHaveAttribute('aria-current', 'page');
    await expect(page.locator('[data-navigation-pending="true"]')).toHaveCount(
      0,
    );
  } finally {
    release();
  }
});

test('sidebar intent prefetch keeps scanner and printing work dormant', async ({
  page,
}) => {
  await page.addInitScript(() => {
    window.__cameraRequests = 0;
    navigator.mediaDevices.getUserMedia = async () => {
      window.__cameraRequests++;
      throw new Error('Camera should require an explicit action');
    };
  });
  await page.goto('/login');
  await page.getByLabel('Email', { exact: true }).fill(fixture.emails.staff);
  await page.getByLabel('Password', { exact: true }).fill(fixture.password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Inventory', exact: true }),
  ).toBeVisible();
  const nav = page.getByRole('navigation', { name: 'Main navigation' });
  await nav.getByRole('link', { name: 'Scan', exact: true }).focus();
  await nav.getByRole('link', { name: 'Labels', exact: true }).focus();
  await nav.getByRole('link', { name: 'Labels', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Print labels', exact: true }),
  ).toBeVisible();
  await expect(page.locator('.label-card')).toHaveCount(0);
  expect(await page.evaluate(() => window.__cameraRequests)).toBe(0);
});
