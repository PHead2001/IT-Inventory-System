import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import {
  acceptanceCommand,
  acceptanceFixtures,
  acceptanceLogin,
} from './audit-three-acceptance-fixtures';

test('grouped complete holdings, picking view, saved settings, Back and full-scope CSV at phone width', async ({
  page,
}) => {
  const owned = await acceptanceFixtures();
  const prefix = `Grouped ${owned.suffix}`;
  try {
    const a = await owned.location('ITC-S1A');
    const b = await owned.location('ITC-S1B');
    const first = await owned.quantity(`${prefix} 01`, a, 10);
    await acceptanceCommand(owned.caller, 'quantity_receive', {
      item_id: first,
      expected_version: 1,
      location_id: b,
      quantity: 25,
      reason: 'Second owned grouping holding',
    });
    for (let n = 2; n <= 26; n++)
      await owned.quantity(`${prefix} ${String(n).padStart(2, '0')}`, null, 0);
    await page.setViewportSize({ width: 390, height: 850 });
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await acceptanceLogin(page);
    await page.goto(`/inventory?q=${encodeURIComponent(prefix)}&view=items`);
    await expect(
      page.locator('[data-count-final]').filter({ hasText: /^26 items$/ }),
    ).toBeVisible();
    await expect(
      page.getByRole('link', { name: `${prefix} 01`, exact: true }),
    ).toHaveCount(1);
    await expect(
      page
        .getByText('Within these filters:')
        .first()
        .locator('..')
        .locator('[data-count-final]')
        .first(),
    ).toHaveText('35');
    await page
      .getByRole('combobox', { name: 'Inventory density' })
      .selectOption('compact');
    await expect(page).toHaveURL(/density=compact/);
    await expect(page.locator('html')).toHaveAttribute('data-motion', 'full');
    const disclosure = page.getByText(
      'Storage and sites within these filters (2)',
      { exact: true },
    );
    await disclosure.click();
    await expect(disclosure).toHaveAttribute('aria-expanded', 'true');
    const firstRow = disclosure.locator('xpath=ancestor::li[1]');
    await expect(
      firstRow.getByRole('link', { name: /Show in room/ }),
    ).toHaveCount(2);
    const holding = firstRow.getByRole('link', { name: /\(ITC-S1B\)$/ });
    // The stale height write occurs when the 250 ms spring deadline cancels
    // the animation. Check layout after the following paint frames.
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          window.setTimeout(() => {
            requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
          }, 250),
        ),
    );
    await holding.scrollIntoViewIfNeeded();
    const geometry = await holding.evaluate((link) => {
      const ownRow = link.closest('details')?.closest('li');
      const nextRow = ownRow?.nextElementSibling;
      if (!ownRow || !nextRow)
        throw new Error('Missing adjacent inventory rows');
      const rect = link.getBoundingClientRect();
      return {
        linkBottom: rect.bottom,
        ownRowBottom: ownRow.getBoundingClientRect().bottom,
        nextRowTop: nextRow.getBoundingClientRect().top,
        receivesPointer: link.contains(
          document.elementFromPoint(
            rect.x + rect.width / 2,
            rect.y + rect.height / 2,
          ),
        ),
      };
    });
    expect(geometry.linkBottom).toBeLessThanOrEqual(geometry.ownRowBottom + 1);
    expect(geometry.linkBottom).toBeLessThanOrEqual(geometry.nextRowTop + 1);
    expect(geometry.receivesPointer).toBe(true);
    await holding.click({ trial: true });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await page
      .getByRole('textbox', { name: 'View name' })
      .fill('Owned grouped picking');
    await page.getByRole('button', { name: 'Save view', exact: true }).click();
    await page
      .getByRole('combobox', { name: 'Inventory view' })
      .selectOption('holdings');
    await expect(
      page
        .locator('[data-count-final]')
        .filter({ hasText: /^27 holding rows$/ }),
    ).toBeVisible();
    await expect(
      page.getByRole('link', { name: `${prefix} 01`, exact: true }),
    ).toHaveCount(2);
    await page.goBack();
    await expect(
      page.getByRole('combobox', { name: 'Inventory view' }),
    ).toHaveValue('items');
    await page.getByText('Export CSV', { exact: true }).click();
    const downloadEvent = page.waitForEvent('download');
    await page
      .getByRole('link', { name: 'Matching holdings rows', exact: true })
      .click();
    const download = await downloadEvent;
    const contents = await readFile((await download.path())!, 'utf8');
    expect(contents).toContain('Quantity at Location');
    expect(
      contents.split('\r\n').filter((line) => line.includes(prefix)),
    ).toHaveLength(27);
    await page.getByRole('link', { name: 'Next', exact: true }).click();
    await expect(
      page.getByRole('link', { name: `${prefix} 26`, exact: true }),
    ).toBeVisible();
    await page.getByRole('link', { name: `${prefix} 26`, exact: true }).click();
    await page
      .getByRole('link', { name: 'Back to results', exact: true })
      .click();
    await expect(page).toHaveURL(/page=2/);
    await expect(
      page.getByRole('combobox', { name: 'Inventory density' }),
    ).toHaveValue('compact');
    await expect(page).toHaveURL(/view=items/);
    await page
      .getByRole('combobox', { name: 'Saved inventory view' })
      .selectOption({ label: 'Owned grouped picking' });
    await expect(page).not.toHaveURL(/page=2/);
    await page.reload();
    await expect(
      page.getByRole('combobox', { name: 'Inventory density' }),
    ).toHaveValue('compact');
    await page.goto(
      '/locations/ITC-S1A?' +
        new URLSearchParams({ q: prefix, view: 'items', density: 'compact' }),
    );
    for (const mode of ['items', 'holdings']) {
      await page
        .getByRole('combobox', { name: 'Inventory view' })
        .selectOption(mode);
      // Repeated App Back returns to an already-used fragment. Native history
      // cannot supply this return's reveal on the application's behalf.
      for (let attempt = 0; attempt < 2; attempt++) {
        await page
          .getByRole('link', { name: `${prefix} 01`, exact: true })
          .click();
        await page
          .getByRole('link', { name: 'Back to results', exact: true })
          .click();
        await expect(page).toHaveURL(/\/locations\/ITC-S1A\?/);
        await expect(page).toHaveURL(new RegExp('view=' + mode));
        await expect(page).toHaveURL(/#inventory-row-1$/);
        await expect(
          page.getByRole('link', { name: `${prefix} 01`, exact: true }),
        ).toBeInViewport();
      }
    }

    const directoryQuery = new URLSearchParams({
      q: 'ITC-S1A',
      selected: 'ITC-S1A',
      level: 'ITC-S1',
      expanded: 'ITC-S1',
    });
    const directoryPath = '/locations?' + directoryQuery;
    const directoryReturn = directoryPath + '#location-row-mobile-level-' + a;
    await page.goto(directoryPath);
    const browser = page.getByRole('navigation', {
      name: 'Location browser',
      exact: true,
    });
    await browser
      .getByRole('link', {
        name: 'View IT Closet / Left Storage / Shelf 1 / 1A location details',
        exact: true,
      })
      .click();
    const allLocations = page.getByRole('link', {
      name: 'All locations',
      exact: true,
    });
    await expect(allLocations).toHaveAttribute('href', directoryReturn);

    await page
      .getByRole('combobox', { name: 'Saved inventory view' })
      .selectOption({ label: 'Owned grouped picking' });
    await expect(page).toHaveURL(
      (url) =>
        url.pathname === '/locations/ITC-S1A' &&
        url.searchParams.get('q') === prefix &&
        url.searchParams.get('view') === 'items' &&
        url.searchParams.get('returnTo') === directoryReturn,
    );
    await page
      .getByRole('combobox', { name: 'Inventory view' })
      .selectOption('holdings');
    await expect(page).toHaveURL(
      (url) =>
        url.pathname === '/locations/ITC-S1A' &&
        url.searchParams.get('view') === 'holdings' &&
        url.searchParams.get('returnTo') === directoryReturn,
    );
    await allLocations.click();
    await expect(page).toHaveURL(new URL(directoryReturn, page.url()).href);
    await expect(
      browser.getByRole('searchbox', { name: 'Browse locations', exact: true }),
    ).toHaveValue('ITC-S1A');
    await expect(
      browser.getByRole('button', {
        name: 'IT Closet / Left Storage / Shelf 1 / 1A ITC-S1A',
        exact: true,
      }),
    ).toHaveAttribute('aria-current', 'location');
  } finally {
    await owned.cleanup();
  }
});
