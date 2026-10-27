import { custodyButtons, custodyReceiptTitle } from './custody-controls';
import { openRecordTask } from './record-task-controls';
import { metadataReviewButton, metadataSaveButton } from './metadata-controls';
import { expect, test, type Page, type Locator } from '@playwright/test';
import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { PNG } from 'pngjs';
import { PDFDocument } from 'pdf-lib';
import { createClient } from '@supabase/supabase-js';
import { Client } from 'pg';
import fixture from '../fixtures/auth.json' with { type: 'json' };
import { chooseLocation } from './location-picker';
import { displayedInstant } from '../helpers/displayed-instant';
import { exactOperationalTime as exactTime } from '../helpers/operational-time';
import { auditReadback } from './audit-two-controls';
import { inventoryFileCardsSchema } from '../../src/features/files/contract';

function richStatePath(name: string) {
  const directory = resolve('.local-tools/experience-visual/rich-states');
  mkdirSync(directory, { recursive: true });
  return join(directory, name + '.png');
}
async function confirmNamedRemoval(files: Locator, filename: string) {
  const page = files.page();
  let removalRequests = 0;
  const countRemoval = (request: import('@playwright/test').Request) => {
    if (request.url().endsWith('/rest/v1/rpc/inventory_file_remove'))
      removalRequests++;
  };
  page.on('request', countRemoval);
  try {
    const parentName = await page
      .getByRole('heading', { level: 1 })
      .innerText();
    const trigger = files.getByRole('button', { name: 'Remove', exact: true });
    await expect(trigger).toBeEnabled();
    await trigger.focus();
    await expect(trigger).toBeFocused();
    await page.keyboard.press('Enter');
    // Native modal dialogs enter the accessibility top layer; locate the named
    // confirmation from the page rather than through its inert file region.
    const dialog = page.getByRole('dialog', {
      name: `Remove ${filename}?`,
      exact: true,
    });
    await expect(dialog).toContainText(filename);
    await expect(dialog).toContainText(parentName);
    await expect(dialog).toContainText('This cannot be undone');
    await expect(
      dialog.getByRole('button', { name: 'Cancel', exact: true }),
    ).toBeFocused();
    const viewport = page.viewportSize();
    for (const width of [1280, 502, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await expect(dialog).toBeVisible();
      await page.screenshot({
        path: richStatePath(`named-removal-${filename}-${width}`),
        fullPage: true,
      });
    }
    if (viewport) await page.setViewportSize(viewport);
    await page.keyboard.press('Enter');
    await expect(dialog).toHaveCount(0);
    await expect(trigger).toBeFocused();
    expect(removalRequests).toBe(0);
    await expect(
      files.locator('ul').first().getByText(filename, { exact: true }),
    ).toBeVisible();
    await page.keyboard.press('Enter');
    await dialog
      .getByRole('button', { name: 'Remove file', exact: true })
      .focus();
    const removed = page.waitForResponse(
      (response) =>
        response.url().endsWith('/rest/v1/rpc/inventory_file_remove') &&
        response.request().method() === 'POST',
    );
    await page.keyboard.press('Enter');
    expect((await removed).ok()).toBe(true);
    // This successful observation proves the same real transport counter used
    // by the preceding Cancel assertion is engaged, rather than vacuous.
    expect(removalRequests).toBe(1);
  } finally {
    page.off('request', countRemoval);
  }
}
async function expectRemovedFile(files: Locator, filename: string) {
  await expect(
    files
      .getByRole('alert')
      .or(files.getByRole('status'))
      .filter({ hasText: /^File removed\./ }),
  ).toBeVisible();
  await expect(files.locator('ul').first().getByRole('listitem')).toHaveCount(
    0,
  );
  await expect(
    files.locator('ul').first().getByText(filename, { exact: true }),
  ).toHaveCount(0);
  await expect(
    files.getByRole('button', { name: 'Remove', exact: true }),
  ).toHaveCount(0);
}

async function login(page: Page, role: 'staff' | 'viewer') {
  await page.goto('/login');
  await page.getByLabel('Email', { exact: true }).fill(fixture.emails[role]);
  await page.getByLabel('Password', { exact: true }).fill(fixture.password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Inventory', exact: true }),
  ).toBeVisible();
}
async function confirm(form: Locator) {
  await metadataReviewButton(form).click();
  await expect(
    form.getByRole('region', { name: 'Metadata review' }),
  ).toBeVisible();
  await metadataSaveButton(form).click();
}
async function custodyForm(page: Page, title: string) {
  if (
    [
      'Assign asset to a site',
      'Issue stock to a site',
      'Return to storage',
      'Transfer between sites',
      'Write off at site',
      'Record existing site holding',
      'Correct recorded site holding',
      'Correct recorded site custody',
      'Retire asset at site',
    ].includes(title)
  )
    return openRecordTask(page, title);
  return page
    .locator('form')
    .filter({ has: page.getByRole('heading', { name: title, exact: true }) });
}
async function submitCustody(form: Locator, title: string) {
  await form
    .getByRole('button', { name: custodyButtons(title)[0], exact: true })
    .click();
  await expect(
    form.getByRole('region', { name: 'Review changes' }),
  ).toBeVisible();
  await form
    .getByRole('button', {
      name: custodyButtons(title)[1],
      exact: true,
    })
    .click();
  await expect(
    form.page().getByRole('region', { name: 'Custody completion' }),
  ).toContainText(custodyReceiptTitle(title, 'asset'));
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
function equipmentPhoto() {
  const image = new PNG({ width: 640, height: 480 });
  const paint = (
    left: number,
    top: number,
    width: number,
    height: number,
    color: [number, number, number],
  ) => {
    for (let y = top; y < top + height; y++) {
      for (let x = left; x < left + width; x++) {
        const index = (y * image.width + x) * 4;
        image.data[index] = color[0];
        image.data[index + 1] = color[1];
        image.data[index + 2] = color[2];
        image.data[index + 3] = 255;
      }
    }
  };
  paint(0, 0, 640, 480, [225, 234, 239]);
  paint(30, 50, 580, 370, [177, 191, 201]);
  paint(65, 140, 510, 190, [31, 48, 64]);
  paint(75, 152, 490, 15, [75, 94, 109]);
  for (let port = 0; port < 12; port++) {
    const x = 86 + port * 39;
    paint(x, 205, 31, 38, [9, 20, 30]);
    paint(x + 3, 209, 25, 27, [78, 95, 106]);
    paint(x + 7, 209, 17, 21, [14, 31, 43]);
    paint(x + 12, 247, 6, 6, port % 3 === 0 ? [70, 225, 135] : [84, 99, 111]);
  }
  paint(455, 280, 88, 22, [55, 168, 185]);
  paint(470, 285, 58, 12, [205, 243, 240]);
  return PNG.sync.write(image);
}
const sha256 = (bytes: Uint8Array) =>
  createHash('sha256').update(bytes).digest('hex');

test('quantity recognition photo uploads, previews for viewers, replaces and removes without stock changes', async ({
  page,
  browser,
}, testInfo) => {
  test.setTimeout(120_000);
  const timezoneSession = await page.context().newCDPSession(page);
  await timezoneSession.send('Emulation.setTimezoneOverride', {
    timezoneId: 'America/Los_Angeles',
  });
  const timeErrors: string[] = [];
  page.on('pageerror', (error) => timeErrors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') timeErrors.push(message.text());
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page, 'staff');
  await page.goto('/inventory/quantity/new');
  const form = page.getByRole('form', { name: 'Add quantity item' });
  const quantityName = 'Photo browser ' + crypto.randomUUID();
  await form.getByLabel('Name', { exact: true }).fill(quantityName);
  await confirm(form);
  await expect(page).toHaveURL(/\/inventory\/quantity\/[0-9a-f-]+$/);
  const detailUrl = page.url();
  const files = page.getByRole('region', { name: 'Inventory files' });
  const cards = files.locator('ul').first();
  const browse = files.getByRole('button', {
    name: 'Browse files',
    exact: true,
  });
  await expect(browse).toHaveCount(1);
  try {
    // Native capture temporarily disables/inerts the page fieldset. A one-shot
    // focus before release is ignored; waiting for focus alone cannot replay it.
    await expect(browse).toBeEnabled();
    await expect
      .poll(
        () =>
          browse.evaluate((button) => {
            for (
              let node: Element | null = button;
              node;
              node = node.parentElement
            )
              if (
                (node instanceof HTMLElement && (node.hidden || node.inert)) ||
                node.hasAttribute('hidden') ||
                node.hasAttribute('inert') ||
                node.matches(':disabled')
              )
                return false;
            return true;
          }),
        { timeout: 5000 },
      )
      .toBe(true);
    await browse.focus();
    await expect(browse).toBeFocused();
  } catch (error) {
    // The original CI trace was unavailable. Capture structure/state only,
    // without filenames, record text, URLs or user-entered values.
    const diagnostics = await browse
      .evaluate((button) => {
        const ancestors = [];
        for (let node: Element | null = button; node; node = node.parentElement)
          ancestors.push({
            tag: node.tagName,
            hidden:
              (node instanceof HTMLElement && node.hidden) ||
              node.hasAttribute('hidden'),
            inert:
              (node instanceof HTMLElement && node.inert) ||
              node.hasAttribute('inert'),
            disabled: node.matches(':disabled'),
          });
        return {
          connected: button.isConnected,
          focused: document.activeElement === button,
          activeTag: document.activeElement?.tagName,
          ancestors,
        };
      })
      .catch(() => ({ unavailable: true }));
    await testInfo.attach('browse-focus-admission', {
      body: JSON.stringify(diagnostics),
      contentType: 'application/json',
    });
    throw error;
  }
  await browse.evaluate((button) => {
    const observed = { click: false, trusted: false };
    Object.defineProperty(button, '__browseClickObservation', {
      value: observed,
      configurable: true,
    });
    button.addEventListener(
      'click',
      (event) => {
        observed.click = true;
        observed.trusted = event.isTrusted;
      },
      { capture: true, once: true },
    );
  });
  const chooserEvent = page.waitForEvent('filechooser');
  let chooser: Awaited<typeof chooserEvent>;
  try {
    await page.keyboard.press('Enter');
    chooser = await chooserEvent;
  } catch (error) {
    const diagnostics = await browse
      .evaluate((button) => {
        const ready = (element: Element) => ({
          connected: element.isConnected,
          hidden:
            (element instanceof HTMLElement && element.hidden) ||
            element.hasAttribute('hidden'),
          inert:
            (element instanceof HTMLElement && element.inert) ||
            element.hasAttribute('inert'),
          disabled: element.matches(':disabled'),
        });
        const active = document.activeElement;
        const inputs = Array.from(
          document.querySelectorAll<HTMLInputElement>('input[type="file"]'),
        ).slice(0, 10);
        const observed = (
          button as HTMLButtonElement & {
            __browseClickObservation?: { click: boolean; trusted: boolean };
          }
        ).__browseClickObservation;
        return {
          button: {
            ...ready(button),
            focused: active === button,
          },
          activeElement: {
            tag: active?.tagName ?? null,
            isButton: active === button,
            isFileInput:
              active instanceof HTMLInputElement && active.type === 'file',
          },
          fileInputs: {
            count: document.querySelectorAll('input[type="file"]').length,
            readiness: inputs.map((input) => ({
              ...ready(input),
              focused: active === input,
            })),
          },
          click: observed ?? { click: false, trusted: false },
        };
      })
      .catch(() => ({ unavailable: true }));
    await testInfo.attach('browse-chooser-admission', {
      body: JSON.stringify(diagnostics),
      contentType: 'application/json',
    });
    throw error;
  }
  await chooser.setFiles({
    name: 'browse.png',
    mimeType: 'image/png',
    buffer: equipmentPhoto(),
  });
  await expect(
    files.getByRole('img', { name: 'Selected file preview' }),
  ).toBeVisible();
  await expect(cards.getByRole('listitem')).toHaveCount(0);
  const selectedUrl = await files
    .getByRole('img', { name: 'Selected file preview' })
    .getAttribute('src');
  expect(selectedUrl).toMatch(/^blob:/);
  // A real browser DataTransfer replaces the local selection; no direct upload API.
  const dropped = await page.evaluateHandle(
    (bytes) => {
      const transfer = new DataTransfer();
      transfer.items.add(
        new File([Uint8Array.from(bytes)], 'first.png', { type: 'image/png' }),
      );
      return transfer;
    },
    [...equipmentPhoto()],
  );
  await expect(
    files.getByText(/Nothing uploads until you choose Upload and review\./),
  ).toBeVisible();
  const beforeDrop = page.url();
  await page.locator('body').dispatchEvent('drop', { dataTransfer: dropped });
  await expect(page).toHaveURL(beforeDrop);
  await files
    .getByRole('group', { name: 'Choose an inventory file' })
    .dispatchEvent('drop', { dataTransfer: dropped });
  await dropped.dispose();
  await expect(files.getByText(/Selected: first.png/)).toBeVisible();
  await expect(
    files.getByRole('img', { name: 'Selected file preview' }),
  ).not.toHaveAttribute('src', selectedUrl!);
  await expect(cards.getByRole('listitem')).toHaveCount(0);
  let releaseValidation!: () => void;
  const validationGate = new Promise<void>((resolve) => {
    releaseValidation = resolve;
  });
  const holdValidation = async (route: import('@playwright/test').Route) => {
    await validationGate;
    await route.continue();
  };
  await page.route('**/api/inventory-files/validate', holdValidation);
  const firstValidation = page.waitForResponse(
    (response) => response.url().includes('/api/inventory-files/validate'),
    { timeout: 20_000 },
  );
  const firstRequest = page.waitForRequest((request) =>
    request.url().includes('/api/inventory-files/validate'),
  );
  try {
    await files.getByRole('button', { name: 'Upload and review' }).click();
    await firstRequest;
    await expect(files.getByRole('button', { name: 'Working…' })).toBeVisible();
    const pendingFileAnnouncement = page
      .getByRole('status')
      .filter({ hasText: /^File request in progress…$/ });
    await expect(pendingFileAnnouncement).toHaveCount(1);
    await expect(pendingFileAnnouncement).toBeVisible();
    expect(
      await pendingFileAnnouncement.evaluate(
        (node) => node.closest('[aria-busy="true"]') === null,
      ),
    ).toBe(true);
    await expect(files).toHaveAttribute('aria-busy', 'true');
    await expect(files.getByText('No photo yet.', { exact: true })).toHaveCount(
      0,
    );
    await testInfo.attach('pending-photo-validation-mobile', {
      body: await page.screenshot({
        path: richStatePath('pending-photo-validation-mobile'),
        fullPage: true,
      }),
      contentType: 'image/png',
    });
  } finally {
    releaseValidation();
  }
  const firstResult = await firstValidation;
  await page.unroute('**/api/inventory-files/validate', holdValidation);
  expect(firstResult.ok(), JSON.stringify(await firstResult.json())).toBe(true);
  await expect(
    cards.getByRole('listitem').getByText('first.png', { exact: true }),
  ).toBeVisible();
  await expect(cards.getByRole('listitem').getByText(/^Ready/)).toBeVisible();
  await expect(cards.getByRole('listitem')).toContainText(
    /\b\d+(?:\.\d+)? KiB\b/,
  );
  await expect(cards.getByRole('listitem')).not.toContainText('0.0 MiB');
  const publishedTime = cards.getByRole('listitem').locator('time');
  await expect(publishedTime).toContainText('America/Los_Angeles');
  const publishedAt = await publishedTime.getAttribute('datetime');
  expect(displayedInstant((await publishedTime.textContent())!)).toBe(
    Math.floor(Date.parse(publishedAt!) / 1000) * 1000,
  );
  await expect(cards.getByRole('listitem')).toContainText('Published:');
  await files.locator('summary').filter({ hasText: 'File activity' }).click();
  const activityTimes = files.locator('ol time');
  await expect(activityTimes.first()).toBeVisible();
  for (const time of await activityTimes.all()) {
    await expect(await exactTime(time)).toContainText('America/Los_Angeles');
    expect(
      displayedInstant((await (await exactTime(time)).textContent())!),
    ).toBe(
      Math.floor(Date.parse((await time.getAttribute('datetime'))!) / 1000) *
        1000,
    );
  }
  await files.screenshot({
    path: testInfo.outputPath('real-file-published-activity-los-angeles.png'),
  });
  await page.reload();
  await expect(publishedTime).toHaveAttribute('datetime', publishedAt!);
  await expect(publishedTime).toContainText('America/Los_Angeles');
  await page.getByRole('link', { name: 'View all item history' }).click();
  await expect(page).toHaveURL(/\/history\?/);
  await expect(await exactTime(page.locator('time').first())).toContainText(
    'America/Los_Angeles',
  );
  for (const time of await page.locator('time').all()) {
    await expect(await exactTime(time)).toContainText('America/Los_Angeles');
    expect(
      displayedInstant((await (await exactTime(time)).textContent())!),
    ).toBe(
      Math.floor(Date.parse((await time.getAttribute('datetime'))!) / 1000) *
        1000,
    );
  }
  await page.screenshot({
    path: testInfo.outputPath('real-file-record-history-los-angeles.png'),
    fullPage: true,
  });
  await page.goto(detailUrl);
  expect(
    timeErrors.filter((error) => /hydrat|mismatch|uncaught/i.test(error)),
  ).toEqual([]);
  await expect(
    files.getByRole('button', { name: 'Preview first.png' }).locator('img'),
  ).toBeVisible();
  await expect(
    files.getByRole('button', { name: 'Preview first.png' }).locator('img'),
  ).toHaveJSProperty('naturalWidth', 320);
  await testInfo.attach('ready-quantity-photo-mobile', {
    body: await page.screenshot({
      path: richStatePath('ready-quantity-photo-mobile'),
      fullPage: true,
    }),
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
  const openedPhoto = page
    .getByRole('dialog', { name: 'first.png' })
    .locator('img');
  await expect(openedPhoto).toBeVisible();
  await expect(openedPhoto).toHaveJSProperty('naturalWidth', 640);
  await expect(openedPhoto).toHaveJSProperty('naturalHeight', 480);
  const photoBounds = await openedPhoto.boundingBox();
  expect(photoBounds?.width).toBeGreaterThan(250);
  expect(photoBounds?.height).toBeGreaterThan(180);
  await testInfo.attach('populated-photo-viewer-mobile', {
    body: await page.screenshot({
      path: richStatePath('populated-photo-viewer-mobile'),
      fullPage: false,
    }),
    contentType: 'image/png',
  });
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
    await testInfo.attach('read-only-populated-files-mobile', {
      body: await viewer.screenshot({
        path: richStatePath('read-only-populated-files-mobile'),
        fullPage: true,
      }),
      contentType: 'image/png',
    });
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
  await expect(files.getByRole('alert')).toBeVisible();
  await testInfo.attach('invalid-photo-error-mobile', {
    body: await page.screenshot({
      path: richStatePath('invalid-photo-error-mobile'),
      fullPage: true,
    }),
    contentType: 'image/png',
  });
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
  await confirmNamedRemoval(files, 'second.png');
  await expectRemovedFile(files, 'second.png');
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
  const siteForm = await custodyForm(page, 'Add property/site');
  await siteForm.getByLabel('Permanent code', { exact: true }).fill(siteCode);
  await siteForm.getByLabel('Name', { exact: true }).fill(siteName);
  await siteForm.getByRole('button', { name: 'Save site' }).click();
  await expect(
    page.getByRole('region', { name: 'Site creation complete' }),
  ).toBeVisible();
  await page.goto('/inventory/assets/new');
  const form = page.getByRole('form', { name: 'Add individual asset' });
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
  await expect(files.getByText(/Selected: manual.pdf/)).toBeVisible();
  await expect(files.locator('iframe, embed, object')).toHaveCount(0);
  await expect(
    files.getByRole('img', { name: 'Selected file preview' }),
  ).toHaveCount(0);
  await expect(cards.getByRole('listitem')).toHaveCount(0);
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
  // A collapsed secondary launcher stays connected but cannot receive focus.
  await openRecordTask(page, 'Correct recorded location');
  const tasks = page.getByRole('region', { name: 'Record tasks' });
  await tasks
    .locator('summary')
    .filter({ hasText: /^Other tasks$/ })
    .click();
  await expect(
    tasks.getByRole('button', {
      name: 'Correct recorded location',
      exact: true,
    }),
  ).toBeHidden();
  await tasks.getByRole('button', { name: 'Close task', exact: true }).click();
  await expect(
    tasks.getByRole('heading', { name: 'Tasks', exact: true }),
  ).toBeFocused();
  const assign = await custodyForm(page, 'Assign asset to a site');
  await assign
    .getByLabel('Destination site')
    .selectOption({ label: `${siteName} (${siteCode})` });
  await submitCustody(assign, 'Assign asset to a site');
  await page.reload();
  await expect(
    page
      .locator('dt')
      .filter({ hasText: /^Current custody$/ })
      .locator('xpath=following-sibling::dd')
      .getByRole('link', { name: `${siteName} (${siteCode})`, exact: true }),
  ).toBeVisible();
  await expect(cards.getByText('manual.pdf', { exact: true })).toBeVisible();
  const downloadPromise = page.waitForEvent('download');
  await files.getByRole('button', { name: 'Download PDF' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('manual.pdf');
  expect(sha256(await readFile(await download.path()))).toBe(sha256(bytes));
  const returned = await custodyForm(page, 'Return to storage');
  await chooseLocation(returned, 'Storage location', 'ITC-RACK');
  await submitCustody(returned, 'Return to storage');
  await page.goto(assetUrl);
  await expect(cards.getByText('manual.pdf', { exact: true })).toBeVisible();
  page.once('dialog', (dialog) => dialog.accept('Updated manual title'));
  await files.getByRole('button', { name: 'Rename' }).click();
  await expect(
    cards.getByText('Updated manual title', { exact: true }),
  ).toBeVisible();
  await expect(files.getByText('Original: manual.pdf')).toBeVisible();
  await files.locator('summary').filter({ hasText: 'File activity' }).click();
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
  await expect(
    cards.getByText('Updated manual title', { exact: true }),
  ).toBeVisible();
  // Detail cards are server-seeded. Read the reviewed version through the same
  // caller-scoped RPC rather than waiting for a browser request that cannot occur.
  const readback = await auditReadback();
  const reviewedFiles = await (async () => {
    try {
      const result = await readback.rpc('inventory_file_cards', {
        p_parent_type: 'asset',
        p_parent_id: new URL(assetUrl).pathname.split('/').at(-1)!,
      });
      expect(result.error).toBeNull();
      return inventoryFileCardsSchema.parse(result.data);
    } finally {
      await readback.auth.signOut({ scope: 'local' });
    }
  })();
  const input = files.getByLabel('Add photo or PDF');
  let reserves = 0;
  const countReserve = (request: import('@playwright/test').Request) => {
    if (request.url().includes('/api/inventory-files/reserve')) reserves++;
  };
  page.on('request', countReserve);
  await input.setInputFiles({
    name: 'abandoned-selection.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from(bytes),
  });
  await expect(
    files.getByRole('button', { name: 'Upload and review' }),
  ).toBeEnabled();
  // A native picker opened without a new selection is a cancel/no-change intent.
  const picker = page.waitForEvent('filechooser');
  await files.getByRole('button', { name: 'Replace', exact: true }).click();
  await picker;
  await expect(input).toHaveValue('');
  expect(
    await input.evaluate((element: HTMLInputElement) => element.files?.length),
  ).toBe(0);
  await expect(
    files.getByRole('button', { name: 'Upload and review' }),
  ).toBeDisabled();
  expect(reserves).toBe(0);
  const reviewedTarget = await files
    .getByLabel('Replace a ready file')
    .inputValue();
  expect(reviewedTarget).toMatch(/^[0-9a-f-]{36}$/);
  const reviewedVersion = reviewedFiles.files.find(
    (file) => file.id === reviewedTarget,
  )?.version;
  expect(reviewedVersion).toMatch(/^\d+$/);
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
  const replaceReserve = page.waitForRequest((request) =>
    request.url().includes('/api/inventory-files/reserve'),
  );
  await files.getByRole('button', { name: 'Upload and review' }).click();
  expect((await replaceReserve).postDataJSON()).toMatchObject({
    name: 'replacement.pdf',
    bytes: replacementBytes.length,
    replaces: reviewedTarget,
    expectedFileVersion: reviewedVersion,
  });
  expect(reserves).toBe(1);
  page.off('request', countReserve);
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
  await confirmNamedRemoval(files, 'replacement.pdf');
  await expectRemovedFile(files, 'replacement.pdf');
});

test('browser Storage denial does not block a near-20 MiB PDF upload', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const api = process.env.LOCAL_API_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  expect(api).toMatch(/^http:\/\/(127\.0\.0\.1|localhost):45321$/);
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
  const form = page.getByRole('form', { name: 'Add individual asset' });
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
      response.url().includes('/api/inventory-files/reserve') &&
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
      result?: { id: string };
      code?: string;
    };
    expect(
      reserveResponse.ok(),
      JSON.stringify({ code: reserveBody.code }),
    ).toBe(true);
    reservationId = reserveBody.result?.id ?? null;
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
    await confirmNamedRemoval(files, 'large-manual.pdf');
    await expectRemovedFile(files, 'large-manual.pdf');
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
        expect(dbUrl.port).toBe('45322');
        const db = new Client({ connectionString: dbUrl.toString() });
        await db.connect();
        try {
          let deleted = false;
          for (let attempt = 0; attempt < 5 && !deleted; attempt++) {
            const cleanup = await page
              .context()
              .request.post('/api/inventory-files/cleanup', {
                timeout: 10_000,
                data: {
                  parentType: 'asset',
                  parentId: (
                    await db.query(
                      'select asset_id from public.inventory_files where id=$1',
                      [reservationId],
                    )
                  ).rows[0].asset_id,
                },
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
