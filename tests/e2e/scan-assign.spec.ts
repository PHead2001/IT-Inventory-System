import { expectScopedInteractiveTransitions } from './interactive-style-contract';
import { randomUUID } from 'node:crypto';
import { test, expect, type Page } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
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
    const input = page.getByLabel('Scan, paste, or search inventory', {
      exact: true,
    });
    const review = page.getByRole('region', { name: 'Review assignment' });
    await input.fill(`  ${quantityLabel}\r\n`);
    await input.press('Enter');
    await expect(review).toContainText(quantityName);
    await expectScopedInteractiveTransitions(page);
    await expect(review.getByLabel('Units to assign')).toHaveValue('1');
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
