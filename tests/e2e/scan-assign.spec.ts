import { expectScopedInteractiveTransitions } from './interactive-style-contract';
import { randomUUID } from 'node:crypto';
import { test, expect, type Page } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { Client } from 'pg';
import { PNG } from 'pngjs';
import { NotFoundException } from '@zxing/library';
import fixture from '../fixtures/auth.json' with { type: 'json' };
import { chooseLocation } from './location-picker';
import { metadataReviewButton, metadataSaveButton } from './metadata-controls';
import { decodeInventoryFrame } from '../../src/features/scan/decode-frame';

async function signIn(page: Page, role: 'staff' | 'viewer' = 'staff') {
  await page.goto('/login');
  await page.getByLabel('Email', { exact: true }).fill(fixture.emails[role]);
  await page.getByLabel('Password', { exact: true }).fill(fixture.password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Inventory', exact: true }),
  ).toBeVisible();
}
async function staffClient() {
  const url = process.env.LOCAL_API_URL!;
  expect(['localhost', '127.0.0.1', '[::1]']).toContain(new URL(url).hostname);
  const client = createClient(
    url,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const signed = await client.auth.signInWithPassword({
    email: fixture.emails.staff,
    password: fixture.password,
  });
  expect(signed.error).toBeNull();
  return client;
}
async function generatedLabel(
  page: Page,
  kind: 'quantity' | 'asset',
  id: string,
  name: string,
) {
  await page.goto(`/labels?${kind}=${id}`);
  await expect(
    page
      .getByRole('status')
      .filter({ hasText: 'Print preview refreshed from current inventory' }),
  ).toBeVisible();
  const card = page
    .locator('.label-card[data-code-ready="true"]')
    .filter({ hasText: name });
  await expect(card).toHaveCount(1);
  const source = await card
    .getByRole('img', { name: /QR code for/ })
    .getAttribute('src');
  expect(source).toMatch(/^data:image\/png;base64,/);
  const image = PNG.sync.read(Buffer.from(source!.split(',')[1], 'base64'));
  const canvas = {
    width: image.width,
    height: image.height,
    getContext: () => ({
      getImageData: () => ({
        data: new Uint8ClampedArray(image.data),
        width: image.width,
        height: image.height,
      }),
    }),
  } as unknown as HTMLCanvasElement;
  // Exercise the production fallback on the normal UI-generated label pixels.
  return decodeInventoryFrame(canvas, () => {
    throw new NotFoundException();
  }).getText();
}

/** Seed only owned legacy holdings on the disposable loopback database.
 * Inactive balances can predate current destination guards; application writes
 * still go through the existing caller-authorized custody action below. */
async function seedInactiveScanSource(itemId: string, suffix: string) {
  const target = new URL(process.env.LOCAL_DB_URL!);
  expect(['localhost', '127.0.0.1', '[::1]']).toContain(target.hostname);
  expect(target.port).toBe('54322');
  expect(target.pathname).toBe('/postgres');
  const parentId = randomUUID(),
    sourceId = randomUUID();
  const sourceCode = `SCAN-OLD-${suffix}`;
  const db = new Client({
    connectionString: target.href,
    application_name: 'scan-owned-legacy-source-fixture',
  });
  await db.connect();
  try {
    await db.query('begin');
    await db.query(
      `insert into public.locations(id,code,name,kind,active,can_hold_inventory)
      values($1,$2,$3,'room',false,false)`,
      [parentId, `${sourceCode}-ROOM`, `Legacy scan room ${suffix}`],
    );
    await db.query(
      `insert into public.locations(id,code,name,parent_id,kind,active,can_hold_inventory)
      values($1,$2,$3,$4,'container',false,true)`,
      [sourceId, sourceCode, `Legacy scan bin ${suffix}`, parentId],
    );
    await db.query(
      `insert into public.stock_balances(item_id,location_id,quantity) values($1,$2,2)`,
      [itemId, sourceId],
    );
    await db.query('commit');
    return { id: sourceId, code: sourceCode };
  } catch (error) {
    await db.query('rollback');
    throw error;
  } finally {
    await db.end();
  }
}

test('generated labels inspect and explicitly assign a repeat quantity and an asset in one site batch', async ({
  page,
}) => {
  test.setTimeout(150_000);
  await signIn(page);
  const suffix = randomUUID().slice(0, 10).toUpperCase();
  const siteName = `Scan assignment ${suffix}`;
  const siteCode = `ASSIGN-${suffix}`;
  await page.goto('/settings/sites');
  const siteForm = page.locator('form').filter({
    has: page.getByRole('heading', {
      name: 'Add property/site',
      exact: true,
    }),
  });
  await siteForm.getByLabel('Name', { exact: true }).fill(siteName);
  await siteForm.getByLabel('Permanent code', { exact: true }).fill(siteCode);
  await siteForm.getByRole('button', { name: 'Save site' }).click();
  await expect(
    page.getByRole('region', { name: 'Site creation complete' }),
  ).toContainText(siteName);

  await page.goto('/inventory/quantity/new');
  const quantityForm = page.getByRole('form', { name: 'Add quantity item' });
  const quantityName = `Scan cables ${suffix}`;
  await quantityForm.getByLabel('Name', { exact: true }).fill(quantityName);
  await quantityForm.getByLabel('Initial quantity').fill('2');
  await chooseLocation(quantityForm, 'Initial location', 'ITC-RED');
  await metadataReviewButton(quantityForm).click();
  await metadataSaveButton(quantityForm).click();
  await expect(page).toHaveURL(/\/inventory\/quantity\/[0-9a-f-]+$/);
  const quantityId = page.url().split('/').at(-1)!;
  const quantityLabel = await generatedLabel(
    page,
    'quantity',
    quantityId,
    quantityName,
  );

  await page.goto('/inventory/assets/new');
  const assetForm = page.getByRole('form', { name: 'Add individual asset' });
  const assetName = `Scan asset ${suffix}`;
  await assetForm.getByLabel('Name', { exact: true }).fill(assetName);
  await chooseLocation(assetForm, 'Current location', 'ITC-RED');
  await metadataReviewButton(assetForm).click();
  await metadataSaveButton(assetForm).click();
  await expect(page).toHaveURL(/\/inventory\/assets\/[0-9a-f-]+$/);
  const assetId = page.url().split('/').at(-1)!;
  const assetLabel = await generatedLabel(page, 'asset', assetId, assetName);

  const client = await staffClient();
  try {
    const inactiveSource = await seedInactiveScanSource(quantityId, suffix);
    const site = await client
      .from('sites')
      .select('id')
      .eq('code', siteCode)
      .single();
    expect(site.error).toBeNull();
    const eventCount = async () => {
      const events = await client
        .from('assignment_events')
        .select('id', { count: 'exact', head: true })
        .eq('to_site_id', site.data!.id);
      expect(events.error).toBeNull();
      return events.count;
    };
    await page.goto('/sites/' + siteCode);
    await page
      .getByRole('link', { name: 'Issue existing stock', exact: true })
      .click();
    await expect(page).toHaveURL(
      new RegExp(`/scan\\?mode=assign&site=${site.data!.id}$`),
    );
    await expect(
      page.getByLabel('Destination site', { exact: true }),
    ).toHaveValue(site.data!.id);
    const ticket = `TICKET-${suffix}`;
    await page
      .getByLabel('Ticket number reference (optional)', { exact: true })
      .fill(ticket);
    await chooseLocation(
      page.locator('body'),
      'Preferred storage source (optional)',
      inactiveSource.code,
    );
    const input = page.getByLabel('Scan, paste, or search inventory', {
      exact: true,
    });
    const review = page.getByRole('region', { name: 'Review assignment' });
    await input.fill(`  ${quantityLabel}\r\n`);
    await input.press('Enter');
    await expect(review).toContainText(quantityName);
    await expectScopedInteractiveTransitions(page);
    await expect(review.getByLabel('Units to assign')).toHaveValue('1');
    await expect(review.getByLabel('Storage source')).toHaveValue(
      inactiveSource.id,
    );
    await expect(review.getByLabel('Storage source')).toContainText(
      'inactive source',
    );
    expect(await eventCount()).toBe(0);
    await review.getByRole('link', { name: 'Open inventory record' }).click();
    await expect(page).toHaveURL(
      new RegExp(`/inventory/quantity/${quantityId}$`),
    );
    await page.goBack();
    await expect(
      page.getByLabel('Ticket number reference (optional)'),
    ).toHaveValue(ticket);
    await expect(page.getByLabel('Destination site')).toHaveValue(
      site.data!.id,
    );
    await expect(
      page.getByLabel('Preferred storage source (optional)'),
    ).toContainText(inactiveSource.code);
    await expect(
      page.getByText(
        'Availability refreshed. Review the source and units before confirming.',
      ),
    ).toBeVisible();
    expect(await eventCount()).toBe(0);
    await page
      .getByRole('button', { name: 'Confirm assign', exact: true })
      .click();
    const receipt = page.getByRole('region', {
      name: 'Latest assignment receipt',
    });
    await expect(receipt).toContainText(quantityName);
    await expectScopedInteractiveTransitions(page);
    await expect(receipt).toContainText(ticket);
    await expect(input).toBeEnabled();
    await expect(input).toHaveValue('');
    await expect(
      page.getByLabel('Ticket number reference (optional)', { exact: true }),
    ).toHaveValue(ticket);
    expect(await eventCount()).toBe(1);
    await page.reload();
    await expect(receipt).toContainText(quantityName);
    await expect(
      page.getByRole('region', { name: 'Batch checklist' }),
    ).toContainText('1 quantity assignment (1 unit) confirmed');
    expect(await eventCount()).toBe(1);

    // The same identifier is a new, explicit keyboard-scanner intent, then a new confirmation.
    await input.fill(quantityLabel);
    await input.press('Enter');
    await expect(review).toContainText('1 available');
    await page
      .getByRole('button', { name: 'Confirm assign', exact: true })
      .click();
    await expect(
      receipt.getByText(/remaining after this operation/).locator('..'),
    ).toContainText('0 units');
    await expect(
      receipt
        .getByText(siteName + ' · balance after this operation')
        .locator('..'),
    ).toContainText('2 units');
    await expect(input).toBeEnabled();
    expect(await eventCount()).toBe(2);
    const remaining = await client
      .from('stock_balances')
      .select('quantity')
      .eq('item_id', quantityId)
      .eq('location_id', inactiveSource.id)
      .single();
    expect(remaining.error).toBeNull();
    expect(remaining.data!.quantity).toBe(0);
    const issued = await client
      .from('assignment_events')
      .select('from_location_id,quantity')
      .eq('item_id', quantityId)
      .eq('from_location_id', inactiveSource.id);
    expect(issued.error).toBeNull();
    expect(issued.data).toHaveLength(2);
    expect(issued.data!.every((line) => line.quantity === 1)).toBe(true);

    await input.fill(assetLabel);
    await input.press('Enter');
    await expect(review).toContainText(assetName);
    expect(await eventCount()).toBe(2);
    await page
      .getByRole('button', { name: 'Confirm assign', exact: true })
      .click();
    await expect(receipt).toContainText(assetName);
    await expect(input).toBeEnabled();
    expect(await eventCount()).toBe(3);

    await input.fill(assetLabel);
    await input.press('Enter');
    await expect(review).toContainText('already assigned');
    await expect(
      page.getByRole('button', { name: 'Confirm assign', exact: true }),
    ).toBeDisabled();
    expect(await eventCount()).toBe(3);

    await page
      .getByRole('button', { name: 'Finish batch', exact: true })
      .click();
    const summary = page.getByRole('region', { name: 'Batch summary' });
    await expect(summary).toContainText(
      '1 asset assignment · 2 quantity assignments (2 units) confirmed',
    );
    await expect(
      summary.getByRole('link', { name: /View committed history/ }),
    ).toHaveCount(3);
    expect(await eventCount()).toBe(3);
    await page.reload();
    await expect(summary).toBeVisible();
    await page.getByRole('button', { name: 'End batch', exact: true }).click();
    await expect(page.getByLabel('Destination site')).toHaveValue('');
    await expect(
      page.getByLabel('Ticket number reference (optional)'),
    ).toHaveValue('');
    expect(await eventCount()).toBe(3);
    await page.goto('/scan');
    await page
      .getByLabel('Paste a label URL, barcode text, or exact identifier')
      .fill(quantityLabel);
    await page.getByRole('button', { name: 'Open', exact: true }).click();
    await expect(page).toHaveURL(
      new RegExp(`/inventory/quantity/${quantityId}$`),
    );
    expect(await eventCount()).toBe(3);
  } finally {
    await client.auth.signOut();
  }
});

for (const role of ['viewer', 'inactive', 'nonmember'] as const) {
  test(`${role} cannot invoke the existing assignment RPC directly`, async () => {
    const url = process.env.LOCAL_API_URL!;
    expect(['localhost', '127.0.0.1', '[::1]']).toContain(
      new URL(url).hostname,
    );
    const client = createClient(
      url,
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
    const signed = await client.auth.signInWithPassword({
      email: fixture.emails[role],
      password: fixture.password,
    });
    expect(signed.error).toBeNull();
    try {
      const result = await client.rpc('quantity_site_change', {
        p_request_id: randomUUID(),
        p_payload: {
          action: 'issue',
          item_id: randomUUID(),
          expected_version: '1',
          source_location_id: randomUUID(),
          destination_site_id: randomUUID(),
          quantity: 1,
          reference: null,
          reason: null,
        },
      });
      expect(result.error?.code).toBe('P1001');
      expect(result.data).toBeNull();
    } finally {
      await client.auth.signOut();
    }
  });
}

test('viewer assignment entry has no writable batch controls', async ({
  page,
}) => {
  await signIn(page, 'viewer');
  await page.goto('/scan?mode=assign');
  await expect(
    page.getByText(/Assignment requires an active staff account/),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Confirm assign', exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByLabel('Destination site', { exact: true }),
  ).toHaveCount(0);
});

test('real scan batch cancels late reads, refreshes stale stock, reconciles lost responses/storage cleanup and clears on logout from another route', async ({
  page,
  context,
}) => {
  test.setTimeout(180_000);
  await signIn(page);
  const suffix = randomUUID().slice(0, 8).toUpperCase();
  await page.goto('/settings/sites');
  const siteForm = page.locator('form').filter({
    has: page.getByRole('heading', {
      name: 'Add property/site',
      exact: true,
    }),
  });
  await siteForm
    .getByLabel('Name', { exact: true })
    .fill(`Resilient scan ${suffix}`);
  await siteForm
    .getByLabel('Permanent code', { exact: true })
    .fill(`RES-${suffix}`);
  await siteForm.getByRole('button', { name: 'Save site' }).click();
  await expect(
    page.getByRole('region', { name: 'Site creation complete' }),
  ).toBeVisible();
  await page.goto('/inventory/quantity/new');
  const form = page.getByRole('form', { name: 'Add quantity item' });
  await form
    .getByLabel('Name', { exact: true })
    .fill(`Resilient adapters ${suffix}`);
  await form.getByLabel('Initial quantity').fill('5');
  await chooseLocation(form, 'Initial location', 'ITC-RED');
  await metadataReviewButton(form).click();
  await metadataSaveButton(form).click();
  await expect(page).toHaveURL(/\/inventory\/quantity\/[0-9a-f-]+$/);
  const path = new URL(page.url()).pathname;
  const client = await staffClient();
  const site = await client
    .from('sites')
    .select('id')
    .eq('code', `RES-${suffix}`)
    .single();
  expect(site.error).toBeNull();
  const siteId = site.data!.id;
  const count = async () => {
    const result = await client
      .from('assignment_events')
      .select('id', { count: 'exact', head: true })
      .eq('to_site_id', siteId);
    expect(result.error).toBeNull();
    return result.count;
  };
  const inspect = async (target: Page) => {
    const input = target.getByLabel('Scan, paste, or search inventory');
    await input.fill(path);
    await input.press('Enter');
    await expect(
      target.getByRole('region', { name: 'Review assignment' }),
    ).toBeVisible();
  };
  try {
    await page.goto(`/scan?mode=assign&site=${siteId}`);
    await page
      .getByLabel('Ticket number reference (optional)')
      .fill(`PRIVATE-${suffix}`);
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let signalIntercepted!: () => void;
    const intercepted = new Promise<void>((resolve) => {
      signalIntercepted = resolve;
    });
    let delayed = false;
    await page.route('**/scan?mode=assign*', async (route) => {
      if (
        !delayed &&
        route.request().method() === 'POST' &&
        route.request().headers()['next-action']
      ) {
        delayed = true;
        signalIntercepted();
        await held;
      }
      await route.continue();
    });
    await page.getByLabel('Scan, paste, or search inventory').fill(path);
    await page.getByLabel('Scan, paste, or search inventory').press('Enter');
    await intercepted; // Prove the real read is held before cancelling it.
    await expect(
      page.getByText('Inspecting equipment…', { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole('form', { name: 'Inspect equipment' }),
    ).toHaveAttribute('aria-busy', 'true');
    await expect(
      page.getByRole('button', { name: 'Cancel inspection' }),
    ).toBeFocused();
    await page.getByRole('button', { name: 'Cancel inspection' }).click();
    await expect(
      page.getByLabel('Scan, paste, or search inventory'),
    ).toBeFocused();
    release();
    // Drain the resumed handler before removal: default unroute can mark the
    // still-running route handled before its continuation completes.
    await page.unrouteAll({ behavior: 'wait' });
    await expect(
      page.getByRole('region', { name: 'Review assignment' }),
    ).toHaveCount(0);
    expect(await count()).toBe(0);
    await inspect(page);
    // Restore a persisted pending review on a phone. Unlike the late-result
    // cancellation above, this read completes between a real press and release.
    const originalViewport = page.viewportSize();
    await page.setViewportSize({ width: 375, height: 812 });
    let releaseRestore!: () => void;
    const heldRestore = new Promise<void>((resolve) => {
      releaseRestore = resolve;
    });
    let signalRestore!: () => void;
    const restoreIntercepted = new Promise<void>((resolve) => {
      signalRestore = resolve;
    });
    let restoreDelayed = false;
    await page.route('**/scan?mode=assign*', async (route) => {
      if (
        !restoreDelayed &&
        route.request().method() === 'POST' &&
        route.request().headers()['next-action']
      ) {
        restoreDelayed = true;
        signalRestore();
        await heldRestore;
      }
      await route.continue();
    });
    try {
      await page.reload();
      await restoreIntercepted;
      const inspection = page.getByRole('form', { name: 'Inspect equipment' });
      const cancel = inspection.getByRole('button', {
        name: /^(Cancel inspection|Skip inspection \/ review)$/,
      });
      await expect(inspection).toHaveAttribute('aria-busy', 'true');
      await expect(cancel).toHaveText('Cancel inspection');
      await expect(cancel).toBeFocused();
      await cancel.scrollIntoViewIfNeeded();
      await page.evaluate(() => document.fonts.ready);
      const before = await cancel.boundingBox();
      expect(before).toBeTruthy();
      const point = {
        x: before!.x + before!.width / 2,
        y: before!.y + before!.height / 2,
      };
      const scrollBefore = await page.evaluate(() => window.scrollY);
      await page.mouse.move(point.x, point.y);
      await page.mouse.down();
      await expect(cancel).toBeFocused();
      const restoredResponse = page.waitForResponse(
        (response) =>
          response.url().includes('/scan?mode=assign') &&
          response.request().method() === 'POST' &&
          !!response.request().headers()['next-action'],
      );
      releaseRestore();
      expect(await (await restoredResponse).finished()).toBeNull();
      await expect(inspection).toHaveAttribute('aria-busy', 'false');
      await expect(
        page.getByText(
          'Availability refreshed. Review the source and units before confirming.',
          { exact: true },
        ),
      ).toBeVisible();
      await expect(cancel).toHaveText('Skip inspection / review');
      // These checks happen with the mouse still held. Review focus must not
      // scroll the pressed target away and divert the browser's eventual click.
      await expect(cancel).toBeFocused();
      expect(await page.evaluate(() => window.scrollY)).toBe(scrollBefore);
      const after = await cancel.boundingBox();
      expect(after).toMatchObject({
        x: before!.x,
        y: before!.y,
        height: before!.height,
      });
      expect(
        await cancel.evaluate(
          (element, point) =>
            document.elementFromPoint(point.x, point.y)?.closest('button') ===
            element,
          point,
        ),
      ).toBe(true);
      expect(await count()).toBe(0);
      await page.mouse.up();
      await expect(
        page.getByLabel('Scan, paste, or search inventory'),
      ).toBeFocused();
      await expect(
        page.getByRole('region', { name: 'Review assignment' }),
      ).toHaveCount(0);
      await expect(
        page.getByRole('region', { name: 'Batch checklist' }),
      ).toContainText('0 pending');
      await expect(
        page.getByRole('region', { name: 'Batch checklist' }),
      ).toContainText('Skipped before confirmation.');
      expect(await count()).toBe(0);
    } finally {
      releaseRestore();
      await page.mouse.up();
      await page.unrouteAll({ behavior: 'wait' });
      if (originalViewport) await page.setViewportSize(originalViewport);
    }
    await inspect(page);
    const other = await context.newPage();
    await other.goto(`/scan?mode=assign&site=${siteId}`);
    await expect(
      other.getByLabel('Ticket number reference (optional)'),
    ).toHaveValue('');
    await inspect(other);
    await other
      .getByRole('button', { name: 'Confirm assign', exact: true })
      .click();
    await expect(
      other.getByRole('region', { name: 'Latest assignment receipt' }),
    ).toBeVisible();
    await other.close();
    expect(await count()).toBe(1);
    await page
      .getByRole('button', { name: 'Confirm assign', exact: true })
      .click();
    await expect(
      page.getByRole('button', { name: 'Inspect current state' }),
    ).toBeVisible();
    await expect(
      page.getByRole('region', { name: 'Batch checklist' }),
    ).toContainText('Failed');
    expect(await count()).toBe(1);
    await page.getByRole('button', { name: 'Inspect current state' }).click();
    await expect(
      page.getByRole('region', { name: 'Review assignment' }),
    ).toContainText('4 available');
    await page.evaluate(() => {
      const original = Storage.prototype.setItem;
      (
        window as Window & { restoreAssignmentStorage?: () => void }
      ).restoreAssignmentStorage = () => {
        Storage.prototype.setItem = original;
      };
      Storage.prototype.setItem = function (key, value) {
        if (key.startsWith('inventory-assign-v1:'))
          throw new DOMException('quota', 'QuotaExceededError');
        original.call(this, key, value);
      };
    });
    await page
      .getByRole('button', { name: 'Confirm assign', exact: true })
      .click();
    await expect(page.getByText(/Nothing was submitted\./)).toBeVisible();
    expect(await count()).toBe(1);
    await page.evaluate(() =>
      (
        window as Window & { restoreAssignmentStorage?: () => void }
      ).restoreAssignmentStorage?.(),
    );
    let lost = false;
    await page.route('**/scan?mode=assign*', async (route) => {
      if (
        !lost &&
        route.request().method() === 'POST' &&
        route.request().postData()?.includes('quantity_site_change')
      ) {
        lost = true;
        await route.fetch(); // Execute the real server action, lose only its response.
        await route.abort('failed');
      } else await route.continue();
    });
    await page
      .getByRole('button', { name: 'Confirm assign', exact: true })
      .click();
    await expect(
      page.getByRole('button', { name: 'Retry same assignment' }),
    ).toBeVisible();
    expect(await count()).toBe(2);
    await expect(
      page.getByRole('button', { name: 'Finish batch' }),
    ).toBeDisabled();
    await page.unroute('**/scan?mode=assign*');
    await page.reload();
    await page.getByRole('button', { name: 'Retry same assignment' }).click();
    await expect(
      page.getByRole('region', { name: 'Latest assignment receipt' }),
    ).toBeVisible();
    expect(await count()).toBe(2);
    await expect(
      page
        .getByRole('region', { name: 'Batch checklist' })
        .getByRole('link', { name: /View committed history/ }),
    ).toHaveCount(1);
    await inspect(page);
    await page.evaluate(() => {
      const original = Storage.prototype.removeItem;
      Storage.prototype.removeItem = function (key) {
        if (key.startsWith('inventory-assign-v1:'))
          throw new Error('cleanup unavailable');
        original.call(this, key);
      };
    });
    await page
      .getByRole('button', { name: 'Confirm assign', exact: true })
      .click();
    await expect(
      page.getByText(
        /Assignment confirmed\. Reload to finish updating this batch/,
      ),
    ).toBeVisible();
    expect(await count()).toBe(3);
    await page.reload(); // Clear-only reconciliation must not issue a new mutation.
    await expect(
      page.getByLabel('Scan, paste, or search inventory'),
    ).toBeEnabled();
    expect(await count()).toBe(3);
    await page.goto('/inventory');
    await page.getByRole('button', { name: 'Sign out', exact: true }).click();
    await expect(page).toHaveURL(/\/login$/);
    expect(
      await page.evaluate(() =>
        Object.keys(sessionStorage).filter(
          (key) =>
            key.startsWith('inventory-assign-batch-v1:') ||
            key.startsWith('inventory-assign-v1:'),
        ),
      ),
    ).toEqual([]);
    await signIn(page);
    await page.goto('/scan?mode=assign');
    await expect(page.getByLabel('Destination site')).toHaveValue('');
    await expect(
      page.getByLabel('Ticket number reference (optional)'),
    ).toHaveValue('');
    expect(await count()).toBe(3);
  } finally {
    await client.auth.signOut();
  }
});
