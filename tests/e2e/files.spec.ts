import { expect, test, type Page, type Locator } from '@playwright/test';
import { PNG } from 'pngjs';
import { PDFDocument } from 'pdf-lib';
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
async function confirm(form: Locator, name: string) {
  await form
    .getByRole('button', { name: 'Review ' + name.toLowerCase() })
    .click();
  await expect(
    form.getByRole('region', { name: 'Review changes' }),
  ).toBeVisible();
  await form
    .getByRole('button', { name: 'Confirm ' + name.toLowerCase() })
    .click();
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

test('quantity recognition photo uploads, previews for viewers, replaces and removes without stock changes', async ({
  page,
  browser,
}) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page, 'staff');
  await page.goto('/inventory/quantity/new');
  const form = page.getByRole('form', { name: 'Create quantity inventory' });
  const quantityName = 'Photo browser ' + crypto.randomUUID();
  await form.getByLabel('Name', { exact: true }).fill(quantityName);
  await confirm(form, 'Create quantity inventory');
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
  await page.goto('/inventory?q=' + encodeURIComponent(quantityName));
  const listRow = page
    .locator('li')
    .filter({
      has: page.getByRole('link', { name: quantityName, exact: true }),
    })
    .first();
  await listRow.scrollIntoViewIfNeeded();
  await expect(listRow.getByText('Recognition photo')).toBeVisible();
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
    name: 'second.png',
    mimeType: 'image/png',
    buffer: png(40),
  });
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
    page.getByRole('heading', { name: 'Current stock — 0 units total' }),
  ).toBeVisible();
});

test('asset PDF is structurally validated and downloads as an attachment', async ({
  page,
}) => {
  test.setTimeout(90_000);
  await login(page, 'staff');
  await page.goto('/inventory/assets/new');
  const form = page.getByRole('form', { name: 'Create serialized asset' });
  const assetName = 'PDF browser ' + crypto.randomUUID();
  await form.getByLabel('Name', { exact: true }).fill(assetName);
  await chooseLocation(form, 'Destination location', 'ITC-RACK');
  await confirm(form, 'Create serialized asset');
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
  const downloadPromise = page.waitForEvent('download');
  await files.getByRole('button', { name: 'Download PDF' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('manual.pdf');
  page.once('dialog', (dialog) => dialog.accept('Updated manual title'));
  await files.getByRole('button', { name: 'Rename' }).click();
  await expect(
    files.getByText('Updated manual title', { exact: true }),
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
});
