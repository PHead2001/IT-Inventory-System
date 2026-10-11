import { readFile } from 'node:fs/promises';
import { test, expect } from '@playwright/test';
import {
  acceptanceFixtures,
  acceptanceLogin,
} from './audit-three-acceptance-fixtures';
import { openRecordTask } from './record-task-controls';
import { chooseLocation } from './location-picker';

for (const width of [1280, 390])
  for (const reducedMotion of ['no-preference', 'reduce'] as const) {
    test(`P05 vocabulary, receipt support details and task headings at ${width} / ${reducedMotion}`, async ({
      page,
      context,
    }, testInfo) => {
      test.setTimeout(120_000);
      await page.setViewportSize({ width, height: 844 });
      await page.emulateMedia({ reducedMotion });
      await context.grantPermissions(['clipboard-read', 'clipboard-write']);
      const owned = await acceptanceFixtures();
      try {
        const name = `P05 vocabulary laptop ${owned.suffix}`;
        const id = await owned.asset(name, await owned.location('ITC-RED'));
        const site = await owned.site();
        await acceptanceLogin(page);
        await page.goto(`/scan?mode=assign&site=${site.id}`);
        await page
          .getByLabel('Scan, paste, or search inventory')
          .fill(`/inventory/assets/${id}`);
        await page
          .getByRole('form', { name: 'Inspect equipment' })
          .getByRole('button', { name: 'Inspect equipment', exact: true })
          .click();
        const inspection = page.getByRole('region', {
          name: 'Review assignment',
        });
        await expect(inspection).toContainText('Active');
        await expect(inspection).not.toContainText('Version');
        await page.screenshot({
          path: testInfo.outputPath('scan-inspection.png'),
          fullPage: true,
        });
        await page.goto('/labels');
        const labels = page.getByRole('form', { name: 'Search label records' });
        await labels.getByRole('textbox').fill(name);
        await labels
          .getByRole('button', { name: 'Search', exact: true })
          .click();
        const results = page.getByRole('region', {
          name: 'Search result records',
        });
        await expect(results).toContainText(name);
        await expect(results.locator('.experience-record-status')).toHaveText(
          'Active',
        );
        await page.screenshot({
          path: testInfo.outputPath('labels-status.png'),
          fullPage: true,
        });

        // Inspect does not mutate. Assignment is explicitly reviewed and confirmed on the record.
        await page.goto(`/inventory/assets/${id}`);
        const assign = await openRecordTask(page, 'Assign asset to a site');
        await assign.getByLabel('Destination site').selectOption(site.id);
        await assign
          .getByRole('button', { name: 'Review assignment', exact: true })
          .click();
        await assign
          .getByRole('button', { name: 'Assign to site', exact: true })
          .click();
        const receipt = page.getByRole('region', {
          name: 'Committed custody receipt',
        });
        await expect(
          receipt.getByRole('heading', {
            name: 'Assigned to site',
            exact: true,
          }),
        ).toBeVisible();
        await expect(receipt).not.toContainText(
          /Operation identity|reviewed for this operation/,
        );
        await expect(
          page.getByRole('button', { name: 'Issue another', exact: true }),
        ).toHaveCount(0);
        await receipt
          .getByRole('button', { name: 'Copy technical details' })
          .click();
        const copied = await page.evaluate(() =>
          navigator.clipboard.readText(),
        );
        expect(copied).toMatch(/Operation: [0-9a-f-]{36}/);
        expect(copied).toMatch(/Recorded instant: \d{4}-\d{2}-\d{2}T/);
        await expect(receipt).not.toContainText(
          /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/,
        );
        await page.screenshot({
          path: testInfo.outputPath('assignment-receipt.png'),
          fullPage: true,
        });
        await page.getByRole('button', { name: 'Done', exact: true }).click();
        const returned = await openRecordTask(page, 'Return to storage');
        await expect(
          page.getByRole('heading', { name: 'Return to storage', exact: true }),
        ).toHaveCount(1);
        const destination = returned.getByLabel('Storage location', {
          exact: true,
        });
        await expect(destination).toContainText('ITC-RED');
        await chooseLocation(returned, 'Storage location', 'ITC-BLACK');
        await expect(destination).toContainText('ITC-BLACK');
        await expect(destination).not.toContainText('ITC-RED');
        await expect(returned).not.toContainText('consumed quantity');
        await page.screenshot({
          path: testInfo.outputPath('return-task.png'),
          fullPage: true,
        });
        await page
          .getByRole('button', { name: 'Close task', exact: true })
          .click();
        await expect(
          page.getByRole('alertdialog', { name: 'Discard task draft?' }),
        ).toBeVisible();
        await page
          .getByRole('button', { name: 'Discard and close', exact: true })
          .click();
        await page.goto(`/inventory?q=${encodeURIComponent(name)}`);
        await page.getByText('Export CSV', { exact: true }).click();
        const downloadPending = page.waitForEvent('download');
        await page
          .getByRole('link', { name: 'Filtered inventory', exact: true })
          .click();
        const download = await downloadPending;
        const csv = await readFile((await download.path())!, 'utf8');
        expect(csv).toContain('"Type label","Status label","Custody label"');
        expect(csv).toContain('"Individual asset","Active","Assigned to site"');
        expect(csv).toContain('"active"');
        expect(csv).toContain('"site"');
        await page.goto(`/history?type=asset&entityId=${id}`);
        await expect(
          page.getByRole('heading', { name: 'Assigned to site', exact: true }),
        ).toBeVisible();
        const time = page
          .locator('details')
          .filter({ has: page.locator('time') })
          .first();
        await time.locator('summary').click();
        await expect(time).not.toContainText('Recorded instant:');
        await expect(
          time.getByRole('button', { name: 'Copy technical details' }),
        ).toBeVisible();
        await page.screenshot({
          path: testInfo.outputPath('history-readable-time.png'),
          fullPage: true,
        });
      } finally {
        await owned.cleanup();
      }
    });
  }
