import { expect, test, type Page } from '@playwright/test';
import {
  auditCategory,
  auditCreateRecord,
  auditLogin,
  auditOpenMetadataTask,
} from './audit-two-controls';
import { metadataReviewButton, metadataSaveButton } from './metadata-controls';
import { openRecordTask } from './record-task-controls';
import { chooseLocation } from './location-picker';
import fixture from '../fixtures/auth.json' with { type: 'json' };

test('explicit completed task reentry starts fresh, while an unconfirmed move retains its exact retry', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await auditLogin(page);
  const category = await auditCategory(page);
  const record = await auditCreateRecord(
    page,
    'quantity',
    category.name,
    'Record workflow ' + crypto.randomUUID(),
  );
  let form = await openRecordTask(page, 'Receive stock');
  await chooseLocation(form, 'Receive at', 'ITC-RED');
  await form.getByLabel('Quantity to receive').fill('6');
  await form.getByLabel('Reason').fill('Disposable workflow stock');
  await form.getByRole('button', { name: 'Review receive stock' }).click();
  await form.getByRole('button', { name: 'Confirm receive stock' }).click();
  await expect(form.getByRole('status')).toContainText('Saved successfully.');
  const tasks = page.getByRole('region', { name: 'Record tasks' });
  await tasks
    .getByRole('button', { name: 'Receive stock', exact: true })
    .click();
  await expect(form.getByLabel('Quantity to receive')).toHaveValue('1');
  await expect(form.getByLabel('Reason')).toHaveValue('');
  form = await openRecordTask(page, 'Move stock');
  await chooseLocation(form, 'Destination location', 'ITC-BLACK');
  await form.getByLabel('Quantity to move').fill('2');
  await form.getByRole('button', { name: 'Review move stock' }).click();
  await form.getByRole('button', { name: 'Confirm move stock' }).click();
  await expect(form.getByRole('status')).toContainText(
    'This item: move completed.',
  );
  await tasks.getByRole('button', { name: 'Move stock', exact: true }).click();
  await expect(form.getByLabel('Quantity to move')).toHaveValue('');
  const previous = form
    .locator('details')
    .filter({ has: page.locator('summary').filter({ hasText: /^Last move/ }) })
    .first();
  await expect(previous).not.toHaveAttribute('open');
  await previous.locator('summary').first().click();
  await expect(previous).toContainText('Moved 2 units');
  await expect(previous.locator('time').first()).toHaveAttribute(
    'datetime',
    /.+/,
  );
  await chooseLocation(form, 'Destination location', 'ITC-BLACK');
  await form.getByLabel('Quantity to move').fill('1');
  await form.getByRole('button', { name: 'Review move stock' }).click();
  const commands: string[] = [];
  const pattern = '**/inventory/quantity/' + record.id + '**';
  await page.route(pattern, async (route) => {
    const request = route.request();
    const body = request.postData();
    if (request.method() !== 'POST' || !body?.includes('quantity_move'))
      return route.continue();
    commands.push(body);
    if (commands.length > 1) return route.continue();
    const response = await route.fetch();
    expect(response.ok()).toBe(true);
    await route.abort('failed');
  });
  await form.getByRole('button', { name: 'Confirm move stock' }).click();
  await expect(
    form.getByRole('button', { name: 'Retry this move safely' }),
  ).toBeVisible();
  await expect(
    tasks.getByRole('button', { name: 'Move stock', exact: true }),
  ).toBeDisabled();
  await expect(
    tasks.getByRole('button', { name: 'Receive stock', exact: true }),
  ).toBeDisabled();
  await expect(
    tasks.getByRole('button', { name: 'Close task', exact: true }),
  ).toBeDisabled();
  await form.getByRole('button', { name: 'Retry this move safely' }).click();
  await expect(form.getByRole('status')).toContainText('move completed.');
  expect(commands).toHaveLength(2);
  expect(commands[1]).toBe(commands[0]);
  await page.unroute(pattern);
});

for (const kind of ['quantity', 'asset'] as const) {
  test(
    kind +
      ' long record name preserves three-line mobile header, reachable Tasks and keyboard full-name disclosure',
    async ({ page }) => {
      test.setTimeout(120_000);
      await page.setViewportSize({ width: 375, height: 812 });
      await auditLogin(page);
      const category = await auditCategory(page);
      const name =
        'Cat6 Ethernet patch cable, snagless RJ45 connectors, blue jacket, certified network installation, office replacement stock, extra flexible shielded copper ' +
        crypto.randomUUID().slice(0, 16);
      const identifier =
        `TEST-PR52-${kind === 'asset' ? 'ASSET' : 'SKU'}-` +
        crypto.randomUUID().slice(0, 8);
      await auditCreateRecord(page, kind, category.name, name, identifier);
      await expect(page).toHaveTitle(name + ' · IT Inventory');
      await page.evaluate(async () => {
        await document.fonts.ready;
        window.scrollTo(0, 0);
      });
      const heading = page.getByRole('heading', { name, exact: true });
      const header = page
        .getByRole('main')
        .locator('section')
        .filter({ has: heading });
      await expect(header).toHaveCount(1);
      const facts = header.locator('dl');
      await expect(facts.getByText(identifier, { exact: true })).toBeVisible();
      if (kind === 'asset') {
        await expect(
          facts.getByRole('link', {
            name: 'IT Closet / Red Container (ITC-RED)',
            exact: true,
          }),
        ).toBeVisible();
        await expect(
          facts.getByRole('link', {
            name: 'Show ITC-RED in room',
            exact: true,
          }),
        ).toBeVisible();
      }
      const collapsed = await heading.evaluate((element) => ({
        height: element.getBoundingClientRect().height,
        line: Number.parseFloat(getComputedStyle(element).lineHeight),
      }));
      expect(collapsed.height).toBeLessThanOrEqual(collapsed.line * 3 + 1);
      const tasks = page.getByRole('heading', { name: 'Tasks', exact: true });
      const expectTasksWithinFirstScreen = async () => {
        await page.evaluate(async () => {
          await document.fonts.ready;
          window.scrollTo(0, 0);
        });
        await expect
          .poll(() =>
            tasks.evaluate(
              (element) =>
                element.getBoundingClientRect().bottom + window.scrollY,
            ),
          )
          .toBeLessThanOrEqual(812);
      };
      await expectTasksWithinFirstScreen();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      ).toBe(true);
      await expect(
        page.getByRole('region', { name: 'Record tasks' }),
      ).toContainText('This item');
      const toggle = page.getByRole('button', { name: 'Show full name' });
      await toggle.focus();
      await page.keyboard.press('Enter');
      await expect(
        page.getByRole('button', { name: 'Show less' }),
      ).toBeFocused();
      expect((await heading.boundingBox())!.height).toBeGreaterThan(
        collapsed.height,
      );
      await page.keyboard.press('Space');
      await expect(
        page.getByRole('button', { name: 'Show full name' }),
      ).toBeFocused();
      await expect(heading).toHaveText(name);
      if (kind === 'asset') {
        const retirement = await openRecordTask(page, 'Retire asset');
        await retirement
          .getByLabel('Reason (required)', { exact: true })
          .fill('Owned long-header retired-state regression');
        await retirement
          .getByRole('button', { name: 'Review retire asset', exact: true })
          .click();
        await retirement
          .getByRole('button', { name: 'Confirm retire asset', exact: true })
          .click();
        await expect(retirement.getByRole('status')).toContainText(
          'Saved successfully.',
        );
        await page.reload();
        await expect(
          facts.getByText('Last recorded custody', { exact: true }),
        ).toBeVisible();
        await expectTasksWithinFirstScreen();
        await expect(
          facts.getByText(identifier, { exact: true }),
        ).toBeVisible();
      }
      await page.setViewportSize({ width: 1280, height: 900 });
      await page.evaluate(() => document.fonts.ready);
      await expect
        .poll(async () => {
          const over = await heading.evaluate(
            (element) =>
              element.scrollHeight > element.clientHeight + 1 ||
              element.scrollWidth > element.clientWidth + 1,
          );
          return (
            (await page
              .getByRole('button', { name: 'Show full name' })
              .count()) === Number(over)
          );
        })
        .toBe(true);
      await page.setViewportSize({ width: 375, height: 812 });
      const form = await auditOpenMetadataTask(page, `Edit ${kind} metadata`);
      await form.getByLabel('Name', { exact: true }).fill('Switch');
      await metadataReviewButton(form).click();
      await metadataSaveButton(form).click();
      await expect(
        page.getByRole('heading', { name: 'Switch', exact: true }),
      ).toBeVisible();
      await expect(
        page.getByRole('button', { name: 'Show full name' }),
      ).toHaveCount(0);
      await expect(page).toHaveTitle('Switch · IT Inventory');
    },
  );
}

async function signInAs(page: Page, role: 'viewer' | 'inactive') {
  await page.goto('/login');
  await page.getByLabel('Email', { exact: true }).fill(fixture.emails[role]);
  await page.getByLabel('Password', { exact: true }).fill(fixture.password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page).toHaveURL(
    role === 'inactive' ? /\/access-denied/ : /\/inventory/,
  );
}

test('record and form titles name only their authorized readable record, including complete streamed anonymous responses', async ({
  page,
  browser,
}) => {
  test.setTimeout(180_000);
  await auditLogin(page);
  const category = await auditCategory(page);
  const quantityName = 'Private title quantity ' + crypto.randomUUID();
  const assetName = 'Private title asset ' + crypto.randomUUID();
  const quantity = await auditCreateRecord(
    page,
    'quantity',
    category.name,
    quantityName,
  );
  const asset = await auditCreateRecord(
    page,
    'asset',
    category.name,
    assetName,
  );
  const siteName = 'Private title site ' + crypto.randomUUID();
  const code = 'A4-TITLE-' + crypto.randomUUID().slice(0, 8).toUpperCase();
  await page.goto('/settings/sites');
  const siteForm = page.locator('form').filter({
    has: page.getByRole('heading', {
      name: 'Add property/site',
      exact: true,
    }),
  });
  await siteForm.getByLabel('Name', { exact: true }).fill(siteName);
  await siteForm.getByLabel('Permanent code', { exact: true }).fill(code);
  await siteForm
    .getByRole('button', { name: 'Save site', exact: true })
    .click();
  await expect(
    page.getByRole('region', { name: 'Site creation complete' }),
  ).toBeVisible();
  const routes = [
    { url: asset.url, title: assetName + ' · IT Inventory' },
    { url: quantity.url, title: quantityName + ' · IT Inventory' },
    {
      url: '/locations/ITC-RED',
      title: 'Red Container · Locations · IT Inventory',
    },
    { url: '/sites/' + code, title: siteName + ' · Sites · IT Inventory' },
    {
      url: category.url,
      title: category.name + ' form · Settings · IT Inventory',
    },
    {
      url: '/settings/locations/ITC-RED',
      title: 'Red Container · Location settings · IT Inventory',
    },
    {
      url: '/settings/sites/' + code,
      title: siteName + ' · Site settings · IT Inventory',
    },
    {
      url: '/sites/' + code + '/open/quantity',
      title: 'Record existing quantity item at ' + siteName + ' · IT Inventory',
    },
  ];
  for (const route of routes) {
    await page.goto(route.url);
    await expect(page).toHaveTitle(route.title);
  }
  const viewerContext = await browser.newContext();
  const viewer = await viewerContext.newPage();
  await signInAs(viewer, 'viewer');
  for (const route of routes.slice(0, -1)) {
    await viewer.goto(route.url);
    await expect(viewer).toHaveTitle(route.title);
  }
  await viewer.goto(routes.at(-1)!.url);
  await expect(viewer).toHaveTitle('Record existing equipment · IT Inventory');
  await expect(
    viewer.getByText('Read-only access.', { exact: false }),
  ).toBeVisible();
  await viewerContext.close();
  const privateNames = [
    assetName,
    quantityName,
    siteName,
    category.name,
    'Red Container',
  ];
  for (const role of ['anonymous', 'inactive'] as const) {
    const deniedContext = await browser.newContext();
    const deniedPage = await deniedContext.newPage();
    if (role === 'inactive') await signInAs(deniedPage, 'inactive');
    for (const route of routes) {
      // Chrome permits streamed metadata; Googlebot forces blocking metadata.
      // Read the entire response, including body metadata and hydration scripts.
      for (const userAgent of ['Mozilla/5.0 Chrome/145.0.0.0', 'Googlebot']) {
        const response = await deniedContext.request.get(route.url, {
          headers: { 'user-agent': userAgent },
          maxRedirects: 0,
        });
        const body = await response.text();
        for (const name of privateNames) expect(body).not.toContain(name);
        const destination = role === 'inactive' ? '/access-denied' : '/login';
        expect([200, 307, 308]).toContain(response.status());
        expect(response.headers().location ?? body).toContain(destination);
      }
      await deniedPage.goto(route.url);
      await expect(deniedPage).toHaveURL(
        role === 'inactive' ? /\/access-denied/ : /\/login/,
      );
      for (const name of privateNames)
        expect(await deniedPage.content()).not.toContain(name);
    }
    await deniedContext.close();
  }
});

test('ordinary Inventory and Add quantity metadata restore after protected privacy verification', async ({
  page,
}) => {
  await auditLogin(page);
  await expect(page).toHaveTitle('Inventory · IT Inventory');
  await page.goto('/inventory/quantity/new');
  const form = page.getByRole('form', {
    name: 'Add quantity item',
    exact: true,
  });
  await expect(form).toBeVisible();
  await expect(page).toHaveTitle('Add quantity item · IT Inventory');
  await form
    .getByLabel('Name', { exact: true })
    .fill('Unsaved ordinary title draft');
  await expect(page).toHaveTitle('Add quantity item · IT Inventory');
});
