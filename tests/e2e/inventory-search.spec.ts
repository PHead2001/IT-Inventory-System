import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { countFeedback } from './count-feedback-support';
import fixture from '../fixtures/auth.json' with { type: 'json' };
import {
  discoveryFixture,
  holdFirstSearch,
  appliedSearch,
  exportScope,
  csvRows,
  runDiscoveryCleanup,
} from './inventory-discovery-fixtures';

// This read/search fixture uses the current category schema. Keep it exclusive
// while other feature specs may publish required fields on shared categories.
async function signIn(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Email', { exact: true }).fill(fixture.emails.staff);
  await page.getByLabel('Password', { exact: true }).fill(fixture.password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page).toHaveURL(/\/inventory$/);
}

// Fake-timer SearchForm coverage retains elapsed debounce/composition exclusions.
// Browser readiness uses applied URL, rows, filters and idle status.
test('live inventory typing keeps applied rows, chips and CSV coherent through delay, composition, history and competing navigation', async ({
  page,
}, info) => {
  test.setTimeout(180_000);
  page.setDefaultTimeout(15_000);
  page.setDefaultNavigationTimeout(20_000);
  const setup = await discoveryFixture();
  const alpha = setup.prefix + ' Alpha';
  const beta = setup.prefix + ' Beta';
  let dispose = async () => {};
  let primaryFailure: { cause: unknown } | undefined;
  try {
    await signIn(page);
    await page.goto('/inventory?q=' + encodeURIComponent(setup.prefix));
    await appliedSearch(page, setup.prefix, 26);
    const fixtureRows = page.getByRole('link', {
      name: new RegExp('^' + setup.prefix + ' (Alpha|Beta) \\d{2}$'),
    });
    await expect(fixtureRows).toHaveCount(25);
    const form = page.getByRole('form', {
      name: 'Search inventory',
      exact: true,
    });
    const input = form.getByRole('textbox', {
      name: 'Search inventory',
      exact: true,
    });
    const delayed = await holdFirstSearch(page, alpha);
    dispose = delayed.dispose;
    await input.fill(alpha);
    await expect
      .poll(() => delayed.isHeld() && delayed.requests.includes(alpha))
      .toBe(true);
    await expect(input).toHaveValue(alpha);
    await expect(countFeedback(page, '26 items')).toBeVisible();
    await expect(
      page.getByRole('navigation', { name: 'Active inventory filters' }),
    ).toContainText(`Search: ${setup.prefix}`);
    await expect(
      page.getByText(
        'Updating results. Displayed rows, active filters and CSV still use the previous applied search.',
        { exact: true },
      ),
    ).toBeVisible();
    await exportScope(page, setup.prefix);
    // A is in flight; rapid B/A edits must survive that earlier response.
    await input.fill(beta);
    await input.fill(alpha);
    await test.step('Release the held Alpha search', delayed.release, {
      timeout: 15_000,
    });
    await appliedSearch(page, alpha, 24);
    await expect(fixtureRows).toHaveCount(24);
    for (const name of await fixtureRows.allTextContents())
      expect(name).toContain(alpha);
    expect(delayed.requests).not.toContain(beta);

    await input.dispatchEvent('compositionstart');
    await input.fill(beta);
    expect(delayed.requests).not.toContain(beta);
    await expect(input).toHaveValue(beta);
    await expect(countFeedback(page, '24 items')).toBeVisible();
    await exportScope(page, alpha);
    await input.dispatchEvent('compositionend');
    await appliedSearch(page, beta, 2);
    await expect(fixtureRows).toHaveCount(2);
    for (const name of await fixtureRows.allTextContents())
      expect(name).toContain(beta);

    // Explicit Search creates history entries; live typing itself uses replace.
    await input.fill(setup.prefix);
    await form.getByRole('button', { name: 'Search', exact: true }).click();
    await appliedSearch(page, setup.prefix, 26);
    await input.fill(alpha);
    await form.getByRole('button', { name: 'Search', exact: true }).click();
    await appliedSearch(page, alpha, 24);
    await page.goBack();
    await appliedSearch(page, setup.prefix, 26);
    await page.goForward();
    await appliedSearch(page, alpha, 24);

    await form
      .getByLabel('Tracking type', { exact: true })
      .selectOption('quantity');
    await expect(page).toHaveURL(
      (url) => url.searchParams.get('type') === 'quantity',
    );
    const chipCancelled = setup.prefix + ' chip-cancelled';
    await input.fill(chipCancelled);
    await page
      .getByRole('link', {
        name: 'Remove Type: Quantity items filter',
        exact: true,
      })
      .click();
    await appliedSearch(page, alpha, 24);
    await expect(page).toHaveURL((url) => !url.searchParams.has('type'));
    expect(delayed.requests).not.toContain(chipCancelled);

    await input.fill(setup.prefix);
    await form.getByRole('button', { name: 'Search', exact: true }).click();
    await appliedSearch(page, setup.prefix, 26);
    const pageCancelled = setup.prefix + ' page-cancelled';
    await input.fill(pageCancelled);
    await page
      .getByRole('navigation', { name: 'Pagination' })
      .getByRole('link', { name: 'Next', exact: true })
      .click();
    await expect(page).toHaveURL((url) => url.searchParams.get('page') === '2');
    await appliedSearch(page, setup.prefix, 26);
    await expect(page.getByText('Page 2 of 2', { exact: true })).toBeVisible();
    expect(delayed.requests).not.toContain(pageCancelled);

    const absent = setup.prefix + ' absent';
    await input.fill(absent);
    await form.getByRole('button', { name: 'Search', exact: true }).click();
    await expect(
      page.getByText('No inventory matches these filters.', { exact: true }),
    ).toBeVisible();
    const clearCancelled = setup.prefix + ' clear-cancelled';
    await input.fill(clearCancelled);
    await page
      .getByRole('link', { name: 'Clear inventory filters', exact: true })
      .click();
    await expect(page).toHaveURL((url) => !url.searchParams.has('q'));
    await expect(input).toHaveValue('');
    await expect(
      page.getByText('Results and CSV use the applied search.', {
        exact: true,
      }),
    ).toBeVisible();
    expect(delayed.requests).not.toContain(clearCancelled);

    // An unavailable page reconciles to real rows without broadening CSV scope.
    await page.goto(
      '/inventory?q=' + encodeURIComponent(setup.prefix) + '&page=99',
    );
    await appliedSearch(page, setup.prefix, 26);
    await expect(page).toHaveURL((url) => url.searchParams.get('page') === '2');
    await expect(
      page.getByText(
        'The previous results page is no longer available. Showing the nearest available page with your filters retained.',
        { exact: true },
      ),
    ).toBeVisible();
    await expect(
      page.getByRole('link', {
        name: new RegExp('^' + setup.prefix + ' (Alpha|Beta) \\d{2}$'),
      }),
    ).toHaveCount(1);
    const exported = await exportScope(page, setup.prefix);
    expect(
      new URL(
        (await exported.getAttribute('href'))!,
        page.url(),
      ).searchParams.has('page'),
    ).toBe(false);
    const path = info.outputPath('applied-discovery.csv');
    await test.step(
      'Download the applied holdings CSV',
      async () => {
        const [download] = await Promise.all([
          page.waitForEvent('download', { timeout: 20_000 }),
          exported.click(),
        ]);
        await download.saveAs(path);
      },
      { timeout: 30_000 },
    );
    const [headers, ...rows] = csvRows(await readFile(path, 'utf8'));
    expect(rows).toHaveLength(26);
    const names = rows.map((row) => row[headers.indexOf('Name')]);
    expect(names.sort()).toEqual([...setup.names].sort());
    await info.attach('applied-discovery.csv', {
      path,
      contentType: 'text/csv',
    });
  } catch (cause) {
    primaryFailure = { cause };
    throw cause;
  } finally {
    await runDiscoveryCleanup(
      [
        {
          name: 'Release the search route',
          run: () =>
            test.step('Release the search route', dispose, { timeout: 15_000 }),
        },
        { name: 'Archive owned discovery data', run: setup.cleanup },
      ],
      primaryFailure,
    );
  }
});
