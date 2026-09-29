import { randomUUID } from 'node:crypto';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { PNG } from 'pngjs';
import {
  BinaryBitmap,
  HybridBinarizer,
  MultiFormatReader,
  RGBLuminanceSource,
} from '@zxing/library';
import fixture from '../fixtures/auth.json' with { type: 'json' };
import { chooseLocation } from './location-picker';

const code = (prefix: string) =>
  prefix + '-' + randomUUID().slice(0, 12).toUpperCase();

async function signIn(page: Page, role: 'staff' | 'viewer' = 'staff') {
  await page.goto('/login');
  await page.getByLabel('Email', { exact: true }).fill(fixture.emails[role]);
  await page.getByLabel('Password', { exact: true }).fill(fixture.password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Inventory workspace' }),
  ).toBeVisible();
}
function custodyForm(page: Page, title: string) {
  return page
    .locator('form')
    .filter({ has: page.getByRole('heading', { name: title, exact: true }) });
}
async function createSite(page: Page, siteCode: string, name: string) {
  await page.goto('/settings/sites');
  const form = custodyForm(page, 'Add property / site');
  await form.getByLabel('Name', { exact: true }).fill(name);
  await form.getByLabel('Permanent code', { exact: true }).fill(siteCode);
  await form.getByRole('button', { name: 'Save site' }).click();
  await expect(form.getByRole('status')).toContainText('Site saved');
  await page.goto('/sites/' + siteCode);
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
}
async function createQuantity(
  page: Page,
  name: string,
  storageCode: string,
  count: number,
  threshold?: number,
) {
  await page.goto('/inventory/quantity/new');
  const form = page.getByRole('form', { name: 'Create quantity inventory' });
  await form.getByLabel('Name', { exact: true }).fill(name);
  await form.getByLabel('Initial quantity').fill(String(count));
  if (count) await chooseLocation(form, 'Initial location', storageCode);
  if (threshold !== undefined)
    await form
      .getByLabel('Reorder threshold (optional)')
      .fill(String(threshold));
  await form.getByRole('button', { name: 'Review metadata' }).click();
  await expect(
    form.getByRole('region', { name: 'Metadata review' }),
  ).toBeVisible();
  await form.getByRole('button', { name: 'Confirm save' }).click();
  await expect(page).toHaveURL(/\/inventory\/quantity\/[0-9a-f-]+$/);
  return page.url().split('/').at(-1)!;
}
async function submitCustody(form: Locator, title: string) {
  await form.getByRole('button', { name: title, exact: true }).click();
  await expect(form.getByRole('status')).toContainText('Custody saved');
}
function decodeQrDataUrl(source: string) {
  expect(source).toMatch(/^data:image\/png;base64,/);
  const image = PNG.sync.read(Buffer.from(source.split(',')[1], 'base64'));
  const gray = new Uint8ClampedArray(image.width * image.height);
  for (let index = 0; index < gray.length; index++)
    gray[index] = image.data[index * 4];
  return new MultiFormatReader()
    .decode(
      new BinaryBitmap(
        new HybridBinarizer(
          new RGBLuminanceSource(gray, image.width, image.height),
        ),
      ),
      new Map(),
    )
    .getText();
}
async function noHorizontalOverflow(page: Page) {
  const layout = await page.evaluate(() => ({
    viewport: innerWidth,
    document: document.documentElement.scrollWidth,
    offenders: Array.from(document.querySelectorAll<HTMLElement>('body *'))
      .filter((node) => node.getBoundingClientRect().right > innerWidth + 1)
      .slice(0, 10)
      .map((node) => ({
        tag: node.tagName,
        className: node.className,
        right: Math.round(node.getBoundingClientRect().right),
      })),
  }));
  expect(layout.document, JSON.stringify(layout)).toBeLessThanOrEqual(
    layout.viewport,
  );
}
async function siteId(code: string) {
  const client = createClient(
    process.env.LOCAL_API_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const signed = await client.auth.signInWithPassword({
    email: fixture.emails.staff,
    password: fixture.password,
  });
  expect(signed.error).toBeNull();
  try {
    const result = await client
      .from('sites')
      .select('id')
      .eq('code', code)
      .single();
    expect(result.error).toBeNull();
    return result.data!.id;
  } finally {
    await client.auth.signOut({ scope: 'local' });
  }
}

test('office storage and property custody keep an asset UUID and avoid fictional room links', async ({
  page,
}, testInfo) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page);
  const locationCode = code('ITO-E2E');
  const siteCode = code('E2E-SITE');
  const siteName = 'Fictional field office ' + siteCode;
  await page.goto('/settings/locations');
  const locationForm = custodyForm(page, 'Add logical storage location');
  await locationForm
    .getByLabel('Permanent code', { exact: true })
    .fill(locationCode);
  await locationForm
    .getByLabel('Name', { exact: true })
    .fill('Fictional overflow cabinet');
  await locationForm
    .getByLabel('Parent location')
    .selectOption({ label: 'IT Office (ITO)' });
  await locationForm.getByLabel('Kind').selectOption('storage_area');
  await locationForm.getByRole('button', { name: 'Save location' }).click();
  await expect(locationForm.getByRole('status')).toContainText(
    'Location saved',
  );
  await page.goto('/locations/' + locationCode);
  const officeSpace = page.getByRole('link', {
    name: `Show ${locationCode} in Spaces`,
  });
  await expect(officeSpace).toHaveAttribute(
    'href',
    '/room?location=' + locationCode,
  );
  await officeSpace.click();
  await expect(page.getByRole('combobox', { name: 'Space' })).toHaveValue(
    'it-office',
  );
  await expect(
    page.getByRole('heading', { name: 'IT Office inventory' }),
  ).toBeVisible();
  await expect(
    page.getByRole('region', { name: 'Location inventory' }),
  ).toContainText(`Fictional overflow cabinet (${locationCode})`);
  await expect(page.getByTestId('room-viewer')).toHaveCount(0);
  await page.goto('/locations/' + locationCode);
  await expect(
    page.getByRole('link', { name: 'Print location label' }),
  ).toBeVisible();
  await noHorizontalOverflow(page);
  await page.goto('/labels?location=' + locationCode);
  await page.getByRole('combobox', { name: 'Code' }).selectOption('qr');
  await expect(
    page.getByRole('status').filter({
      hasText: 'Print preview refreshed from current inventory',
    }),
  ).toBeVisible();
  await expect(
    page.locator('.label-card[data-code-ready="true"]').first(),
  ).toBeVisible();
  await expect(page.locator('.label-card').first()).toContainText(locationCode);
  await expect(
    page
      .locator('.label-card')
      .first()
      .getByRole('img', { name: /QR code for/ }),
  ).toBeVisible();
  await createSite(page, siteCode, siteName);
  await page.goto('/inventory/assets/new');
  const name = 'Fictional office laptop ' + randomUUID().slice(0, 8);
  const form = page.getByRole('form', { name: 'Create asset inventory' });
  await form.getByLabel('Name', { exact: true }).fill(name);
  await form.getByLabel('Asset tag').fill(code('E2E-TAG'));
  await form.getByLabel('Serial number').fill(code('E2E-SERIAL'));
  await chooseLocation(form, 'Current location', locationCode);
  await form.getByRole('button', { name: 'Review metadata' }).click();
  await expect(
    form.getByRole('region', { name: 'Metadata review' }),
  ).toBeVisible();
  await form.getByRole('button', { name: 'Confirm save' }).click();
  await expect(page).toHaveURL(/\/inventory\/assets\/[0-9a-f-]+$/);
  const assetUrl = page.url();
  const assetId = assetUrl.split('/').at(-1)!;
  await expect(
    page.getByRole('link', { name: new RegExp(locationCode) }).first(),
  ).toBeVisible();
  const assign = custodyForm(page, 'Assign asset to a site');
  await assign
    .getByLabel('Destination site')
    .selectOption({ label: `${siteName} (${siteCode})` });
  await assign.getByRole('button', { name: 'Assign asset to a site' }).click();
  await expect(
    page.getByRole('link', { name: `Assigned to ${siteName} (${siteCode})` }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole('link', { name: `Assigned to ${siteName} (${siteCode})` }),
  ).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Custody history' }),
  ).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath('mobile-assigned-asset.png'),
    fullPage: true,
  });
  await expect(
    page.getByRole('link', { name: 'Print asset label' }),
  ).toHaveAttribute('href', '/labels?asset=' + assetId);
  await page.goto('/labels?asset=' + assetId);
  await page.getByRole('combobox', { name: 'Code' }).selectOption('qr');
  await expect(
    page.getByRole('status').filter({
      hasText: 'Print preview refreshed from current inventory',
    }),
  ).toBeVisible();
  await expect(
    page.locator('.label-card[data-code-ready="true"]').first(),
  ).toBeVisible();
  const assetCard = page.locator('.label-card').filter({ hasText: name });
  await expect(assetCard).toBeVisible();
  await expect(assetCard).toContainText(name);
  const originalQr = assetCard.getByRole('img', { name: /QR code for/ });
  await expect(originalQr).toBeVisible();
  const originalQrBytes = await originalQr.getAttribute('src');
  expect(decodeQrDataUrl(originalQrBytes!)).toBe(
    process.env.APP_ORIGIN + '/inventory/assets/' + assetId,
  );
  await page.goto('/sites/' + siteCode);
  await expect(page.getByRole('link', { name })).toBeVisible();
  await expect(
    page.getByRole('region', { name: 'Grouped current holdings' }),
  ).toContainText('1 distinct serialized devices');
  await expect(
    page.getByText('Current serialized assets').locator('..'),
  ).toContainText('1');
  // The browse filter uses site UUIDs. Search by unique asset name here, and
  // verify the row links to the site rather than claiming a closet drawer.
  await page.goto('/inventory?q=' + encodeURIComponent(name));
  await expect(
    page.getByRole('link', {
      name: `Assigned to ${siteName} (${siteCode}) · no room model`,
    }),
  ).toBeVisible();
  const csv = await page.request.get(
    '/api/exports/inventory?q=' + encodeURIComponent(name),
  );
  expect(csv.status()).toBe(200);
  const body = await csv.text();
  expect(body).toContain(assetId);
  expect(body).toContain(siteCode);
  await page.goto('/scan');
  await page
    .getByLabel('Paste a label URL, barcode text, or exact identifier')
    .fill(new URL(assetUrl).pathname);
  await page.getByRole('button', { name: 'Open', exact: true }).click();
  await expect(page).toHaveURL(assetUrl);
  const transfer = custodyForm(page, 'Return to storage');
  await chooseLocation(transfer, 'Return to storage', locationCode);
  await submitCustody(transfer, 'Return to storage');
  await page.reload();
  await expect(
    page.getByRole('link', { name: new RegExp(locationCode) }).first(),
  ).toBeVisible();
  await expect(
    page.getByRole('link', { name: 'Print asset label' }),
  ).toHaveAttribute('href', '/labels?asset=' + assetId);
  await page.goto('/labels?asset=' + assetId);
  await page.getByRole('combobox', { name: 'Code' }).selectOption('qr');
  await expect(
    page.getByRole('status').filter({
      hasText: 'Print preview refreshed from current inventory',
    }),
  ).toBeVisible();
  await expect(
    page.locator('.label-card[data-code-ready="true"]').first(),
  ).toBeVisible();
  const returnedCard = page.locator('.label-card').filter({ hasText: name });
  await expect(returnedCard).toBeVisible();
  const returnedQr = returnedCard.getByRole('img', { name: /QR code for/ });
  await expect(returnedQr).toBeVisible();
  expect(await returnedQr.getAttribute('src')).toBe(originalQrBytes);
  await noHorizontalOverflow(page);
  const labelSearch = page.getByRole('form', { name: 'Search label records' });
  await labelSearch.getByRole('textbox').fill(name);
  await labelSearch.getByRole('button', { name: 'Search' }).click();
  await page
    .getByRole('region', { name: 'Label search results' })
    .getByRole('link', { name })
    .scrollIntoViewIfNeeded();
  await page.screenshot({
    path: testInfo.outputPath('mobile-label-search.png'),
  });
  await page.getByRole('button', { name: 'Sign out' }).click();
  await signIn(page, 'viewer');
  await page.goto('/sites/' + siteCode);
  await expect(
    page.getByRole('heading', { name: siteName, exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('link', { name: 'Record existing serialized asset' }),
  ).toHaveCount(0);
  await page.goto(assetUrl);
  await expect(
    page.getByRole('heading', { name: 'Manage serialized asset' }),
  ).toHaveCount(0);
  await page.goto('/settings/locations');
  await expect(page.getByText('Location settings are read-only')).toBeVisible();
  await noHorizontalOverflow(page);
});

test('site movements distinguish available, assigned and recorded; dated activity leaves holdings current', async ({
  page,
}, testInfo) => {
  test.setTimeout(120_000);
  await signIn(page);
  const aCode = code('E2E-A');
  const bCode = code('E2E-B');
  await createSite(page, aCode, 'Fictional site ' + aCode);
  await createSite(page, bCode, 'Fictional site ' + bCode);
  const name = 'Fictional custody cables ' + randomUUID().slice(0, 8);
  const id = await createQuantity(page, name, 'ITO-GENERAL', 10, 7);
  const issue = custodyForm(page, 'Issue stock to a site');
  await issue
    .getByLabel('Destination site')
    .selectOption({ label: `Fictional site ${aCode} (${aCode})` });
  await issue.getByLabel('Units').fill('3');
  await submitCustody(issue, 'Issue stock to a site');
  await page.reload();
  await expect(
    page.getByRole('heading', {
      name: 'Current stock — 7 available in storage',
    }),
  ).toBeVisible();
  await expect(
    page.getByText('3 assigned to sites · 10 total recorded'),
  ).toBeVisible();
  await expect(
    page.getByText(/Needs restocking.*available in storage 7/),
  ).toBeVisible();
  await expect(
    page.getByText('Archive is blocked while site holdings remain.'),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Review archive and clear stock' }),
  ).toHaveCount(0);
  const overReturn = custodyForm(page, 'Return to storage');
  await overReturn
    .getByLabel('Source site')
    .selectOption({ label: `Fictional site ${aCode} (${aCode})` });
  await chooseLocation(overReturn, 'Return to storage', 'ITO-GENERAL');
  await overReturn.getByLabel('Units').fill('4');
  await overReturn.getByRole('button', { name: 'Return to storage' }).click();
  await expect(overReturn.getByRole('status')).toContainText(
    'valid whole-unit quantity',
  );
  await page.goto('/settings/sites/' + aCode);
  const archiveSite = custodyForm(page, `Manage Fictional site ${aCode}`);
  await archiveSite.getByLabel('Active site').uncheck();
  await archiveSite
    .getByLabel(/I have resolved every assigned holding/)
    .check();
  await archiveSite.getByRole('button', { name: 'Save site' }).click();
  await expect(archiveSite.getByRole('status')).toContainText(
    'Resolve current holdings',
  );
  await page.goto('/sites/' + aCode);
  await expect(
    page.getByText(`${aCode} · Active · No room model`),
  ).toBeVisible();
  await page.goto('/settings/locations/ITO-GENERAL');
  const deactivateStorage = custodyForm(
    page,
    'Manage General Storage / Unsorted',
  );
  await deactivateStorage.getByLabel('Active location').uncheck();
  await deactivateStorage
    .getByLabel(/All stock and assets have been moved/)
    .check();
  await deactivateStorage
    .getByRole('button', { name: 'Save location' })
    .click();
  await expect(deactivateStorage.getByRole('status')).toContainText(
    'Resolve current holdings',
  );
  await page.goto('/locations/ITO-GENERAL');
  await expect(page.getByText('Inventory destination')).toBeVisible();
  await page.goto('/dashboard');
  const row = page
    .locator('li')
    .filter({ has: page.getByRole('link', { name }) });
  await expect(row).toContainText('Available 7 · Assigned 3');
  await expect(row).toContainText('Total 10 · Threshold 7');
  await page.goto('/inventory/quantity/' + id);
  const returned = custodyForm(page, 'Return to storage');
  await returned
    .getByLabel('Source site')
    .selectOption({ label: `Fictional site ${aCode} (${aCode})` });
  await chooseLocation(returned, 'Return to storage', 'ITO-GENERAL');
  await returned.getByLabel('Units').fill('1');
  await submitCustody(returned, 'Return to storage');
  await page.reload();
  await expect(
    page.getByText('2 assigned to sites · 10 total recorded'),
  ).toBeVisible();
  const transferred = custodyForm(page, 'Transfer between sites');
  await transferred
    .getByLabel('Source site')
    .selectOption({ label: `Fictional site ${aCode} (${aCode})` });
  await transferred
    .getByLabel('Destination site')
    .selectOption({ label: `Fictional site ${bCode} (${bCode})` });
  await transferred.getByLabel('Units').fill('1');
  await submitCustody(transferred, 'Transfer between sites');
  await page.reload();
  await expect(
    page.getByRole('heading', {
      name: 'Current stock — 8 available in storage',
    }),
  ).toBeVisible();
  await expect(
    page.getByText('2 assigned to sites · 10 total recorded'),
  ).toBeVisible();
  await page.goto('/sites/' + bCode);
  await expect(page.getByRole('link', { name })).toBeVisible();
  await expect(
    page.getByText('Current assigned quantity units').locator('..'),
  ).toContainText('1');
  await expect(
    page.getByText('Transferred in / out (quantity units)').locator('..'),
  ).toContainText('1 / 0');
  await page.screenshot({
    path: testInfo.outputPath('desktop-site-holdings.png'),
  });
  await page.getByLabel('From (UTC)').fill('2000-01-01T00:00');
  await page.getByLabel('Until (UTC, exclusive)').fill('2000-01-02T00:00');
  await page.getByRole('button', { name: 'Filter activity' }).click();
  await expect(page.getByText('No activity in this date range.')).toBeVisible();
  await expect(
    page.getByText('Current assigned quantity units').locator('..'),
  ).toContainText('1');
  await expect(
    page.getByText('Transferred in / out (quantity units)').locator('..'),
  ).toContainText('0 / 0');
  const selectedSite = await siteId(bCode);
  await page.goto(
    '/inventory?site=' + selectedSite + '&q=' + encodeURIComponent(name),
  );
  await expect(page.getByLabel('Property / site')).toHaveValue(selectedSite);
  await expect(page.getByRole('link', { name, exact: true })).toHaveCount(1);
  const siteCsv = await page.request.get(
    '/api/exports/inventory?site=' +
      selectedSite +
      '&q=' +
      encodeURIComponent(name),
  );
  expect(siteCsv.status()).toBe(200);
  const siteCsvText = await siteCsv.text();
  expect(siteCsvText).toContain(bCode);
  expect(siteCsvText).not.toContain(aCode);
  expect(siteCsvText).not.toContain('ITO-GENERAL');
  await page.goto('/inventory?q=' + encodeURIComponent(name));
  await expect(page.getByRole('link', { name, exact: true })).toHaveCount(3);
  await expect(
    page.getByText('Available 8 · Assigned 2 · Total recorded 10'),
  ).toHaveCount(3);
  await page.goto('/sites/' + aCode + '/open/quantity');
  await expect(
    page.getByRole('heading', { name: /Record existing quantity holding/ }),
  ).toBeVisible();
  await expect(
    page.getByText('Ordinary future issues start from a real storage holding.'),
  ).toBeVisible();
});

test('opening holdings and write-off retain history without inventing a closet issue', async ({
  page,
}, testInfo) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page);
  const siteCode = code('E2E-OPEN');
  const siteName = 'Fictional opening site ' + siteCode;
  await createSite(page, siteCode, siteName);
  await page
    .getByRole('link', { name: 'Record existing quantity holding' })
    .click();
  const form = page.getByRole('form', {
    name: 'Record opening quantity at site',
  });
  const name = 'Fictional preexisting adapters ' + randomUUID().slice(0, 8);
  await form.getByLabel('Name', { exact: true }).fill(name);
  await form.getByLabel('Units already at this site').fill('2');
  await form.getByRole('button', { name: 'Review metadata' }).click();
  await expect(
    form.getByRole('region', { name: 'Metadata review' }),
  ).toContainText('Opening details');
  await form.getByRole('button', { name: 'Confirm save' }).click();
  await expect(page).toHaveURL(/\/inventory\/quantity\/[0-9a-f-]+$/);
  await expect(
    page.getByRole('heading', {
      name: 'Current stock — 0 available in storage',
    }),
  ).toBeVisible();
  await expect(
    page.getByText('2 assigned to sites · 2 total recorded'),
  ).toBeVisible();
  await expect(
    page.getByRole('region', { name: 'Custody history' }),
  ).toContainText('opened');
  await expect(
    page.getByText('Archive is blocked while site holdings remain.'),
  ).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath('mobile-opening-holding.png'),
    fullPage: true,
  });
  const writeOff = custodyForm(page, 'Write off at site');
  await writeOff
    .getByLabel('Source site')
    .selectOption({ label: `${siteName} (${siteCode})` });
  await writeOff.getByLabel('Units').fill('2');
  await writeOff
    .getByLabel('Reason (required)')
    .fill('Fictional disposal evidence');
  await submitCustody(writeOff, 'Write off at site');
  await page.reload();
  await expect(
    page.getByText('0 assigned to sites · 0 total recorded'),
  ).toBeVisible();
  await expect(
    page.getByRole('region', { name: 'Custody history' }),
  ).toContainText('written off');
  await page.goto('/sites/' + siteCode);
  await expect(
    page.getByText('Opening quantity units').locator('..'),
  ).toContainText('2');
  await expect(
    page.getByText('Written off quantity units').locator('..'),
  ).toContainText('2');
  await expect(
    page.getByText('Storage-issued quantity units').locator('..'),
  ).toContainText('0');
  await noHorizontalOverflow(page);
  await page.getByRole('button', { name: 'Sign out' }).click();
  await signIn(page, 'viewer');
  await page.goto('/sites/' + siteCode);
  await expect(
    page.getByRole('link', { name: 'Record existing quantity holding' }),
  ).toHaveCount(0);
});
