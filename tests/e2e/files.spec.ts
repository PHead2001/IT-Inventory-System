import { expect, test, type Page, type Locator } from '@playwright/test';
import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { PNG } from 'pngjs';
import { PDFDocument } from 'pdf-lib';
import { createClient } from '@supabase/supabase-js';
import { Client } from 'pg';
import fixture from '../fixtures/auth.json' with { type: 'json' };
import { chooseLocation } from './location-picker';

async function login(page: Page, role: 'staff' | 'viewer') {
  await page.goto('/login');
  await page.getByLabel('Email', { exact: true }).fill(fixture.emails[role]);
  await page.getByLabel('Password', { exact: true }).fill(fixture.password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Inventory workspace' }),
  ).toBeVisible();
}
async function confirm(form: Locator) {
  await form.getByRole('button', { name: 'Review metadata' }).click();
  await expect(
    form.getByRole('region', { name: 'Metadata review' }),
  ).toBeVisible();
  await form.getByRole('button', { name: 'Confirm save' }).click();
}
function custodyForm(page: Page, title: string) {
  return page
    .locator('form')
    .filter({ has: page.getByRole('heading', { name: title, exact: true }) });
}
async function submitCustody(form: Locator, title: string) {
  await form.getByRole('button', { name: title, exact: true }).click();
  await expect(form.getByRole('status')).toContainText('Custody saved');
}
function png(color: number) {
  const image = new PNG({ width: 4, height: 4 });
  for (let i = 0; i < image.data.length; i += 4) {
    image.data[i] = color;
    image.data[i + 1] = 60;
    image.data[i + 2] = 120;
    image.data[i + 3] = 255;
  }
  return PNG.sync.write(image);
}
const sha256 = (bytes: Uint8Array) =>
  createHash('sha256').update(bytes).digest('hex');

test('quantity recognition photo uploads, previews for viewers, replaces and removes without stock changes', async ({
  page,
  browser,
}, testInfo) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page, 'staff');
  await page.goto('/inventory/quantity/new');
  const form = page.getByRole('form', { name: 'Create quantity inventory' });
  const quantityName = 'Photo browser ' + crypto.randomUUID();
  await form.getByLabel('Name', { exact: true }).fill(quantityName);
  await confirm(form);
  await expect(page).toHaveURL(/\/inventory\/quantity\/[0-9a-f-]+$/);
  const detailUrl = page.url();
  const files = page.getByRole('region', { name: 'Inventory files' });
  const cards = files.locator('ul').first();
  await files.getByLabel('Add recognition photo').setInputFiles({
    name: 'first.png',
    mimeType: 'image/png',
    buffer: png(210),
  });
  const firstValidation = page.waitForResponse(
    (response) => response.url().includes('/api/inventory-files/validate'),
    { timeout: 20_000 },
  );
  await files.getByRole('button', { name: 'Upload and review' }).click();
  const firstResult = await firstValidation;
  expect(firstResult.ok(), JSON.stringify(await firstResult.json())).toBe(true);
  await expect(
    cards.getByRole('listitem').getByText('first.png', { exact: true }),
  ).toBeVisible();
  await expect(cards.getByRole('listitem').getByText(/^ready/)).toBeVisible();
  await expect(
    files.getByRole('button', { name: 'Preview first.png' }).locator('img'),
  ).toBeVisible();
  await testInfo.attach('ready-quantity-photo-mobile', {
    body: await page.screenshot({ fullPage: true }),
    contentType: 'image/png',
  });
  await page.goto('/inventory?q=' + encodeURIComponent(quantityName));
  const listRow = page
    .locator('li')
    .filter({
      has: page.getByRole('link', { name: quantityName, exact: true }),
    })
    .first();
  await listRow.scrollIntoViewIfNeeded();
  await expect(listRow.locator('img[alt="first.png"]')).toBeVisible();
  await page.goto(detailUrl);
  await files.getByRole('button', { name: 'View photo' }).click();
  await expect(
    page.getByRole('dialog', { name: 'first.png' }).locator('img'),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Close photo' }).click();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);

  const viewerContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
  });
  try {
    const viewer = await viewerContext.newPage();
    await login(viewer, 'viewer');
    await viewer.goto(detailUrl);
    const viewerFiles = viewer.getByRole('region', { name: 'Inventory files' });
    await expect(
      viewerFiles.locator('ul').first().getByText('first.png', { exact: true }),
    ).toBeVisible();
    await expect(
      viewerFiles.getByRole('button', { name: 'View photo' }),
    ).toBeVisible();
    await expect(viewerFiles.getByLabel('Add recognition photo')).toHaveCount(
      0,
    );
    await expect(
      viewerFiles.getByRole('button', { name: 'Remove' }),
    ).toHaveCount(0);
  } finally {
    await viewerContext.close();
  }

  await files
    .getByLabel('Replace a ready file')
    .selectOption({ label: 'first.png' });
  await files.getByLabel('Add recognition photo').setInputFiles({
    name: 'invalid.png',
    mimeType: 'image/png',
    buffer: Buffer.from('not a PNG'),
  });
  const rejectedValidation = page.waitForResponse(
    (response) => response.url().includes('/api/inventory-files/validate'),
    { timeout: 20_000 },
  );
  await files.getByRole('button', { name: 'Upload and review' }).click();
  expect((await rejectedValidation).ok()).toBe(false);
  await expect(
    cards.getByRole('listitem').getByText('first.png', { exact: true }),
  ).toBeVisible();
  await expect(files.getByRole('button', { name: 'View photo' })).toBeVisible();
  await files
    .getByLabel('Replace a ready file')
    .selectOption({ label: 'first.png' });
  await files.getByLabel('Add recognition photo').setInputFiles({
    name: 'second.png',
    mimeType: 'image/png',
    buffer: png(40),
  });
  await expect(
    files.getByRole('button', { name: 'Upload and review' }),
  ).toBeEnabled();
  const secondValidation = page.waitForResponse(
    (response) => response.url().includes('/api/inventory-files/validate'),
    { timeout: 20_000 },
  );
  await files.getByRole('button', { name: 'Upload and review' }).click();
  const secondResult = await secondValidation;
  expect(secondResult.ok(), JSON.stringify(await secondResult.json())).toBe(
    true,
  );
  await expect(
    cards.getByRole('listitem').getByText('second.png', { exact: true }),
  ).toBeVisible();
  await expect(cards.getByText('first.png', { exact: true })).toHaveCount(0);
  await files.getByRole('button', { name: 'Remove' }).click();
  await expect(files.getByText('No ready files yet.')).toBeVisible();
  await expect(
    page.getByRole('heading', {
      name: 'Current stock — 0 available in storage',
    }),
  ).toBeVisible();
});

test('asset PDF is structurally validated and downloads as an attachment', async ({
  page,
}, testInfo) => {
  test.setTimeout(150_000);
  await login(page, 'staff');
  const siteCode = 'FILES-' + randomUUID().slice(0, 12).toUpperCase();
  const siteName = 'Fictional file site ' + siteCode;
  await page.goto('/settings/sites');
  const siteForm = custodyForm(page, 'Add property / site');
  await siteForm
    .getByLabel('Permanent code (uppercase letters, digits, hyphens)')
    .fill(siteCode);
  await siteForm.getByLabel('Name', { exact: true }).fill(siteName);
  await siteForm.getByRole('button', { name: 'Save site' }).click();
  await expect(siteForm.getByRole('status')).toContainText('Site saved');
  await page.goto('/inventory/assets/new');
  const form = page.getByRole('form', { name: 'Create asset inventory' });
  const assetName = 'PDF browser ' + crypto.randomUUID();
  await form.getByLabel('Name', { exact: true }).fill(assetName);
  await chooseLocation(form, 'Current location', 'ITC-RACK');
  await confirm(form);
  await expect(page).toHaveURL(/\/inventory\/assets\/[0-9a-f-]+$/);
  const pdf = await PDFDocument.create();
  pdf.addPage([300, 300]);
  const bytes = await pdf.save();
  const files = page.getByRole('region', { name: 'Inventory files' });
  const cards = files.locator('ul').first();
  await files.getByLabel('Add photo or PDF').setInputFiles({
    name: 'manual.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from(bytes),
  });
  const pdfValidation = page.waitForResponse(
    (response) => response.url().includes('/api/inventory-files/validate'),
    { timeout: 20_000 },
  );
  await files.getByRole('button', { name: 'Upload and review' }).click();
  const pdfResult = await pdfValidation;
  expect(pdfResult.ok(), JSON.stringify(await pdfResult.json())).toBe(true);
  await expect(
    cards.getByRole('listitem').getByText('manual.pdf', { exact: true }),
  ).toBeVisible();
  const assetUrl = page.url();
  await testInfo.attach('ready-asset-pdf-desktop', {
    body: await page.screenshot({ fullPage: true }),
    contentType: 'image/png',
  });
  const assign = custodyForm(page, 'Assign asset to a site');
  await assign
    .getByLabel('Destination site')
    .selectOption({ label: `${siteName} (${siteCode})` });
  await submitCustody(assign, 'Assign asset to a site');
  await page.reload();
  await expect(
    page.getByRole('link', { name: `Assigned to ${siteName} (${siteCode})` }),
  ).toBeVisible();
  await expect(cards.getByText('manual.pdf', { exact: true })).toBeVisible();
  const downloadPromise = page.waitForEvent('download');
  await files.getByRole('button', { name: 'Download PDF' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('manual.pdf');
  expect(sha256(await readFile(await download.path()))).toBe(sha256(bytes));
  const returned = custodyForm(page, 'Return to storage');
  await chooseLocation(returned, 'Return to storage', 'ITC-RACK');
  await submitCustody(returned, 'Return to storage');
  await page.goto(assetUrl);
  await expect(cards.getByText('manual.pdf', { exact: true })).toBeVisible();
  page.once('dialog', (dialog) => dialog.accept('Updated manual title'));
  await files.getByRole('button', { name: 'Rename' }).click();
  await expect(
    cards.getByText('Updated manual title', { exact: true }),
  ).toBeVisible();
  await expect(files.getByText('Original: manual.pdf')).toBeVisible();
  await expect(
    files.getByText(/renamed manual.pdf → Updated manual title/),
  ).toBeVisible();
  await expect(files.getByRole('button', { name: 'View photo' })).toHaveCount(
    0,
  );
  await page.goto('/inventory?q=' + encodeURIComponent(assetName));
  const listRow = page
    .locator('li')
    .filter({
      has: page.getByRole('link', { name: assetName, exact: true }),
    })
    .first();
  await expect(listRow.getByText('1 PDF')).toBeVisible();
  await page.goto(assetUrl);
  await files
    .getByLabel('Replace a ready file')
    .selectOption({ label: 'Updated manual title' });
  const replacement = await PDFDocument.create();
  replacement.addPage([400, 400]);
  const replacementBytes = await replacement.save();
  await files.getByLabel('Add photo or PDF').setInputFiles({
    name: 'replacement.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from(replacementBytes),
  });
  const replaceValidation = page.waitForResponse(
    (response) => response.url().includes('/api/inventory-files/validate'),
    { timeout: 20_000 },
  );
  await files.getByRole('button', { name: 'Upload and review' }).click();
  expect((await replaceValidation).ok()).toBe(true);
  await expect(
    cards.getByText('replacement.pdf', { exact: true }),
  ).toBeVisible();
  await expect(
    cards.getByText('Updated manual title', { exact: true }),
  ).toHaveCount(0);
  const replacementDownload = page.waitForEvent('download');
  await files.getByRole('button', { name: 'Download PDF' }).click();
  const savedReplacement = await replacementDownload;
  expect(savedReplacement.suggestedFilename()).toBe('replacement.pdf');
  expect(sha256(await readFile(await savedReplacement.path()))).toBe(
    sha256(replacementBytes),
  );
  await files.getByRole('button', { name: 'Remove' }).click();
  await expect(files.getByText('No ready files yet.')).toBeVisible();
});

test('browser Storage denial does not block a near-20 MiB PDF upload', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const api = process.env.LOCAL_API_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  expect(api).toMatch(/^http:\/\/(127\.0\.0\.1|localhost):54321$/);
  expect(key).toBeTruthy();
  const actor = createClient(api!, key!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const signedIn = await actor.auth.signInWithPassword({
    email: fixture.emails.staff,
    password: fixture.password,
  });
  expect(signedIn.error).toBeNull();
  const token = signedIn.data.session!.access_token;

  await login(page, 'staff');
  await page.goto('/inventory/assets/new');
  const form = page.getByRole('form', { name: 'Create asset inventory' });
  await form
    .getByLabel('Name', { exact: true })
    .fill('Large PDF browser ' + randomUUID());
  await chooseLocation(form, 'Current location', 'ITC-RACK');
  await confirm(form);
  await expect(page).toHaveURL(/\/inventory\/assets\/[0-9a-f-]+$/);

  const deniedPath = `s/${randomUUID()}/${randomUUID().replaceAll('-', '')}`;
  const denied = await page.evaluate(
    async ({ apiUrl, anonKey, accessToken, path }) => {
      const bytes = new Uint8Array(2 * 1048576);
      bytes.set(new TextEncoder().encode('%PDF-'));
      const body = new FormData();
      body.append('cacheControl', '3600');
      body.append(
        '',
        new File([bytes], 'denied.pdf', { type: 'application/pdf' }),
      );
      const response = await fetch(
        `${apiUrl}/storage/v1/object/inventory-files/${path}`,
        {
          method: 'POST',
          headers: {
            apikey: anonKey,
            Authorization: `Bearer ${accessToken}`,
            'x-upsert': 'false',
          },
          body,
        },
      );
      const result = await response.json();
      return {
        http: response.status,
        code: String(result.statusCode ?? result.code ?? ''),
      };
    },
    { apiUrl: api!, anonKey: key!, accessToken: token, path: deniedPath },
  );
  expect(denied.http).toBeGreaterThanOrEqual(400);
  expect(denied.code).toBe('403');

  const pdf = await PDFDocument.create();
  pdf.addPage([300, 300]);
  const minimal = Buffer.from(await pdf.save());
  const nearLimit = Buffer.alloc(20971519, 0x20);
  minimal.copy(nearLimit);
  expect((await PDFDocument.load(nearLimit)).getPageCount()).toBe(1);
  const files = page.getByRole('region', { name: 'Inventory files' });
  await files.getByLabel('Add photo or PDF').setInputFiles({
    name: 'large-manual.pdf',
    mimeType: 'application/pdf',
    buffer: nearLimit,
  });
  let reservationId: string | null = null;
  let published = false;
  let primaryError: unknown = null;
  const reserved = page.waitForResponse(
    (response) =>
      response.url().includes('/rpc/inventory_file_reserve') &&
      response.request().method() === 'POST',
  );
  const validation = page.waitForResponse(
    (response) => response.url().includes('/api/inventory-files/validate'),
    { timeout: 60_000 },
  );
  // A denied reservation has no validation response. Keep that separate
  // listener handled while preserving its rejection for the success path.
  void validation.catch(() => undefined);
  try {
    await files.getByRole('button', { name: 'Upload and review' }).click();
    const reserveResponse = await reserved;
    const reserveBody = (await reserveResponse.json()) as {
      id?: string;
      code?: string;
    };
    expect(
      reserveResponse.ok(),
      JSON.stringify({ code: reserveBody.code }),
    ).toBe(true);
    reservationId = reserveBody.id ?? null;
    expect(reservationId).toMatch(/^[0-9a-f-]{36}$/);
    const result = await validation;
    expect(result.ok(), JSON.stringify(await result.json())).toBe(true);
    await expect(
      files
        .locator('ul')
        .first()
        .getByText('large-manual.pdf', { exact: true }),
    ).toBeVisible();
    const downloadPromise = page.waitForEvent('download');
    await files.getByRole('button', { name: 'Download PDF' }).click();
    const download = await downloadPromise;
    expect(sha256(await readFile(await download.path()))).toBe(
      sha256(nearLimit),
    );
    await files.getByRole('button', { name: 'Remove' }).click();
    await expect(files.getByText('No ready files yet.')).toBeVisible();
    published = true;
  } catch (error) {
    primaryError = error;
    throw error;
  } finally {
    if (reservationId && !published) {
      let cleanupError: unknown = null;
      try {
        // Closing the browser settles its in-flight request before the
        // authenticated cancel. Late backend completion remains fenced by the
        // Storage lifecycle guard.
        await page.close();
        const cancelled = await actor.rpc('inventory_file_cancel', {
          p_file_id: reservationId,
        });
        if (cancelled.error)
          throw new Error(`Fixture cancel failed: ${cancelled.error.code}`);
        const dbUrl = new URL(process.env.LOCAL_DB_URL ?? '');
        expect(['127.0.0.1', 'localhost']).toContain(dbUrl.hostname);
        expect(dbUrl.port).toBe('54322');
        const db = new Client({ connectionString: dbUrl.toString() });
        await db.connect();
        try {
          let deleted = false;
          for (let attempt = 0; attempt < 5 && !deleted; attempt++) {
            const cleanup = await page
              .context()
              .request.post('/api/inventory-files/cleanup', {
                timeout: 10_000,
              });
            expect(cleanup.ok()).toBe(true);
            const source = await db.query<{ state: string }>(
              `select cleanup_state state from private.file_objects
               where file_id=$1 and variant='source'`,
              [reservationId],
            );
            deleted = source.rows[0]?.state === 'deleted';
          }
          expect(deleted).toBe(true);
        } finally {
          await db.end();
        }
      } catch (error) {
        cleanupError = error;
      }
      if (cleanupError && !primaryError) throw cleanupError;
      if (cleanupError)
        console.error(
          'Fictional reservation cleanup also failed:',
          (cleanupError as { code?: string }).code ?? 'unknown',
        );
    }
  }
});
