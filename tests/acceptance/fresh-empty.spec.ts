import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { expect, test, type Page } from '@playwright/test';
import fixture from '../fixtures/auth.json' with { type: 'json' };
import { chooseLocation } from '../e2e/location-picker';

async function login(page: Page, email: string) {
  await page.goto('/login');
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill(fixture.password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Inventory', exact: true }),
  ).toBeVisible();
}
async function operation(page: Page, name: string) {
  await page
    .locator('summary')
    .filter({ hasText: new RegExp('^' + name + '$') })
    .click();
  return page.getByRole('form', { name, exact: true });
}
async function archive(page: Page, detail: string) {
  await page.goto(detail);
  const form = await operation(
    page,
    'Archive quantity definition and clear stock',
  );
  await form
    .getByLabel('Reason (required)')
    .fill('Checkpoint 2 fictional acceptance cleanup');
  await form.getByRole('checkbox', { name: /I understand/ }).check();
  await form
    .getByRole('button', { name: 'Review archive and clear stock' })
    .click();
  await form
    .getByRole('button', { name: 'Confirm archive and clear stock' })
    .click();
  await expect(page.getByText(/Archived · Version/)).toBeVisible();
}
async function dashboard(page: Page, configured: number, alerts?: number) {
  await page.goto('/dashboard');
  const card = (label: string) =>
    page
      .locator('dl > div')
      .filter({ has: page.getByText(label, { exact: true }) })
      .locator('dd');
  await expect(card('Monitored active items')).toHaveText(String(configured));
  for (const label of ['Needs restocking', 'Out of stock (subset)'])
    await expect(card(label)).toHaveText(
      configured ? String(alerts) : 'Not configured',
    );
}
async function archiveSite(page: Page, code: string, name: string) {
  await page.goto('/settings/sites/' + code);
  const form = page.locator('form').filter({
    has: page.getByRole('heading', { name: 'Manage ' + name, exact: true }),
  });
  await form.getByRole('button', { name: 'Archive site', exact: true }).click();
  await form
    .getByLabel('Reason', { exact: true })
    .fill('Checkpoint 2 fictional closed property');
  await form
    .getByRole('button', { name: 'Confirm archive site', exact: true })
    .click();
  await expect(
    form.getByRole('status').filter({
      hasText: /^Site saved\. Code and history remain unchanged\.$/,
    }),
  ).toBeVisible();
}

test('fresh first-use, site availability and configured stock states stay truthful for each role', async ({
  page,
  browser,
}, testInfo) => {
  test.setTimeout(180_000);
  const api = new URL(process.env.LOCAL_API_URL!);
  expect(['localhost', '127.0.0.1']).toContain(api.hostname);
  expect(api.port).toBe('54321');
  const options = { auth: { persistSession: false, autoRefreshToken: false } };
  const reader = createClient(
    api.href,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    options,
  );
  expect(
    (
      await reader.auth.signInWithPassword({
        email: fixture.emails.staff,
        password: fixture.password,
      })
    ).error,
  ).toBeNull();
  for (const table of ['quantity_items', 'serialized_assets', 'sites']) {
    const result = await reader
      .from(table)
      .select('id', { count: 'exact', head: true });
    expect(result.error, table + ' precondition read failed').toBeNull();
    expect(
      result.count,
      table +
        ' must be empty after the canonical reset; run this suite before other fixtures',
    ).toBe(0);
  }
  const admin = createClient(
    api.href,
    process.env.LOCAL_SERVICE_ROLE_KEY!,
    options,
  );
  const ordinaryEmail = 'checkpoint2-staff-' + randomUUID() + '@example.test';
  let ordinaryId: string | undefined;
  let detail: string | undefined;
  let archived = false;
  const siteCode = 'CK2-' + randomUUID().slice(0, 8).toUpperCase();
  const siteName = 'Checkpoint 2 fictional site ' + siteCode;
  let siteCreated = false;
  let siteArchived = false;
  const viewerContext = await browser.newContext();
  const ordinaryContext = await browser.newContext();
  try {
    const created = await admin.auth.admin.createUser({
      email: ordinaryEmail,
      password: fixture.password,
      email_confirm: true,
    });
    expect(created.error).toBeNull();
    ordinaryId = created.data.user!.id;
    expect(
      (
        await admin.from('app_members').insert({
          user_id: ordinaryId,
          display_name: 'Checkpoint 2 ordinary staff',
          role: 'staff',
          active: true,
          can_manage_configuration: false,
        })
      ).error,
    ).toBeNull();
    await login(page, fixture.emails.staff);
    await expect(
      page.getByText('No inventory has been recorded yet.', { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole('link', {
        name: 'Add the first quantity item',
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      page.getByRole('navigation', { name: 'Pagination' }),
    ).toHaveCount(0);
    await page.screenshot({
      path: testInfo.outputPath('first-use-staff.png'),
      fullPage: true,
    });
    const viewer = await viewerContext.newPage();
    await login(viewer, fixture.emails.viewer);
    await expect(
      viewer.getByText('Ask an IT staff member to add the first record.', {
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      viewer.getByRole('link', {
        name: 'Add the first quantity item',
        exact: true,
      }),
    ).toHaveCount(0);
    await page.goto('/locations/ITC-RED');
    await expect(
      page.getByText('No active inventory here.', { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText('0 matching rows', { exact: true }),
    ).toBeVisible();
    await dashboard(page, 0);
    await expect(
      page.getByText(
        '0 monitored active quantity items. Stock monitoring needs a reorder threshold.',
        { exact: false },
      ),
    ).toBeVisible();
    await page.screenshot({
      path: testInfo.outputPath('monitoring-not-configured.png'),
      fullPage: true,
    });

    await page.goto('/inventory/quantity/new');
    let form = page.getByRole('form', {
      name: 'Create quantity inventory',
      exact: true,
    });
    const name = 'Checkpoint 2 fresh quantity ' + randomUUID();
    await form.getByLabel('Name', { exact: true }).fill(name);
    await form.getByLabel('Initial quantity').fill('2');
    await chooseLocation(form, 'Initial location', 'ITC-RED');
    await form.getByRole('button', { name: 'Review metadata' }).click();
    await form.getByRole('button', { name: 'Confirm save' }).click();
    await expect(page).toHaveURL(/\/inventory\/quantity\/[0-9a-f-]+$/);
    detail = page.url();
    const issue = page.getByRole('form', {
      name: 'Issue stock to a site',
      exact: true,
    });
    await expect(
      issue.getByText(
        'No sites are configured. This operation needs a destination site.',
      ),
    ).toBeVisible();
    await expect(
      issue.getByRole('button', { name: 'Issue stock to a site', exact: true }),
    ).toBeDisabled();
    await expect(
      issue.getByRole('link', { name: 'Open site settings' }),
    ).toHaveAttribute('href', '/settings/sites');
    const opening = page.getByRole('form', {
      name: 'Record existing site holding',
      exact: true,
    });
    await expect(
      opening.getByRole('button', {
        name: 'Record existing site holding',
        exact: true,
      }),
    ).toBeDisabled();
    await expect(
      opening.getByText(
        'No sites are configured. This operation needs a destination site.',
      ),
    ).toBeVisible();
    const ordinary = await ordinaryContext.newPage();
    await login(ordinary, ordinaryEmail);
    await ordinary.goto(detail);
    const ordinaryIssue = ordinary.getByRole('form', {
      name: 'Issue stock to a site',
      exact: true,
    });
    await expect(
      ordinaryIssue.getByText(/Ask a configuration maintainer/),
    ).toBeVisible();
    await expect(
      ordinaryIssue.getByRole('link', { name: 'Open site settings' }),
    ).toHaveCount(0);
    await expect(
      ordinaryIssue.getByRole('button', {
        name: 'Issue stock to a site',
        exact: true,
      }),
    ).toBeDisabled();
    await viewer.goto(detail);
    await expect(
      viewer.getByRole('form', { name: 'Issue stock to a site', exact: true }),
    ).toHaveCount(0);
    await expect(
      viewer.getByRole('form', { name: 'Edit quantity metadata', exact: true }),
    ).toHaveCount(0);
    await page.screenshot({
      path: testInfo.outputPath('no-site-maintainer.png'),
      fullPage: true,
    });
    await ordinary.screenshot({
      path: testInfo.outputPath('no-site-ordinary-staff.png'),
      fullPage: true,
    });
    await dashboard(page, 0);

    await page.goto('/settings/sites');
    const siteForm = page.locator('form').filter({
      has: page.getByRole('heading', {
        name: 'Add property / site',
        exact: true,
      }),
    });
    await siteForm.getByLabel('Name', { exact: true }).fill(siteName);
    await siteForm.getByLabel('Permanent code', { exact: true }).fill(siteCode);
    await siteForm
      .getByRole('button', { name: 'Save site', exact: true })
      .click();
    await expect(
      siteForm.getByRole('status').filter({
        hasText: /^Site saved\. Code and history remain unchanged\.$/,
      }),
    ).toBeVisible();
    siteCreated = true;
    await page.goto('/sites/' + siteCode);
    await page
      .getByRole('link', {
        name: 'Record existing quantity holding',
        exact: true,
      })
      .click();
    const siteOpening = page.getByRole('form', {
      name: 'Record opening quantity at site',
      exact: true,
    });
    await siteOpening
      .getByRole('button', { name: 'Review metadata', exact: true })
      .click();
    await expect(siteOpening.getByLabel('Name', { exact: true })).toBeFocused();
    await expect(
      siteOpening.getByLabel('Name', { exact: true }),
    ).toHaveAttribute('aria-invalid', 'true');
    await expect(
      siteOpening.getByLabel('Name', { exact: true }),
    ).toHaveAccessibleDescription(/Enter/);
    await siteOpening
      .getByLabel('Name', { exact: true })
      .fill('Unsubmitted fictional opening');
    await siteOpening.getByLabel('Units already at this site').fill('0');
    await siteOpening
      .getByRole('button', { name: 'Review metadata', exact: true })
      .click();
    await expect(
      siteOpening.getByLabel('Units already at this site'),
    ).toBeFocused();
    await expect(
      siteOpening.getByLabel('Units already at this site'),
    ).toHaveAccessibleDescription('Enter at least 1.');
    await expect(
      siteOpening.getByRole('region', { name: 'Metadata review' }),
    ).toHaveCount(0);
    await page.screenshot({
      path: testInfo.outputPath('opening-site-validation.png'),
      fullPage: true,
    });
    await siteOpening
      .getByRole('button', { name: 'Cancel', exact: true })
      .click();
    await page
      .getByRole('button', { name: 'Discard changes', exact: true })
      .click();
    await archiveSite(page, siteCode, siteName);
    siteArchived = true;
    await page.goto(detail);
    await expect(
      issue.getByText('No active sites are available for this operation.', {
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      issue.getByRole('button', { name: 'Issue stock to a site', exact: true }),
    ).toBeDisabled();
    await page.screenshot({
      path: testInfo.outputPath('only-inactive-site.png'),
      fullPage: true,
    });

    async function threshold(value: number) {
      await page.goto(detail!);
      const edit = await operation(page, 'Edit quantity metadata');
      await edit.getByLabel('Reorder threshold (optional)').fill(String(value));
      await edit.getByRole('button', { name: 'Review metadata' }).click();
      await edit.getByRole('button', { name: 'Confirm save' }).click();
      await expect(
        edit.getByRole('status').filter({ hasText: /^Metadata saved\.$/ }),
      ).toBeVisible();
    }
    await threshold(1);
    await dashboard(page, 1, 0);
    await expect(
      page.getByText('1 monitored active quantity item.', { exact: false }),
    ).toBeVisible();
    await page.screenshot({
      path: testInfo.outputPath('monitoring-one-healthy.png'),
      fullPage: true,
    });
    await threshold(0);
    await page.goto(detail);
    form = await operation(page, 'Correct physical count');
    await chooseLocation(form, 'Counted location', 'ITC-RED');
    await form.getByLabel('Observed physical count').fill('0');
    await form
      .getByLabel('Reason (required)')
      .fill('Fictional zero stock acceptance');
    await form
      .getByRole('button', {
        name: 'Review correct physical count',
        exact: true,
      })
      .click();
    await form
      .getByRole('button', {
        name: 'Confirm correct physical count',
        exact: true,
      })
      .click();
    await expect(
      form.getByRole('status').filter({ hasText: /^Saved successfully\.$/ }),
    ).toBeVisible();
    await dashboard(page, 1, 1);
    await expect(page.getByRole('link', { name, exact: true })).toBeVisible();
    await page.screenshot({
      path: testInfo.outputPath('monitoring-zero-threshold-zero-stock.png'),
      fullPage: true,
    });
    await archive(page, detail);
    archived = true;
    await dashboard(page, 0);
    await page.goto('/inventory');
    await expect(
      page.getByText('No active inventory. Historical records are available.', {
        exact: true,
      }),
    ).toBeVisible();
    await page
      .getByRole('link', { name: 'Include all statuses', exact: true })
      .click();
    await expect(page.getByRole('link', { name, exact: true })).toBeVisible();
    await page.screenshot({
      path: testInfo.outputPath('historical-inventory-preserved.png'),
      fullPage: true,
    });
  } finally {
    try {
      if (detail && !archived) await archive(page, detail);
    } finally {
      if (siteCreated && !siteArchived)
        await archiveSite(page, siteCode, siteName);
      if (ordinaryId)
        expect(
          (
            await admin
              .from('app_members')
              .update({ active: false })
              .eq('user_id', ordinaryId)
          ).error,
        ).toBeNull();
      await ordinaryContext.close();
      await viewerContext.close();
      await reader.auth.signOut({ scope: 'local' });
    }
  }
});
