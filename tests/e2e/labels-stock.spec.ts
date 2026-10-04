import { expect, test, type Page } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { PNG } from 'pngjs';
import {
  BinaryBitmap,
  BarcodeFormat,
  DecodeHintType,
  HybridBinarizer,
  MultiFormatReader,
  RGBLuminanceSource,
} from '@zxing/library';
import { decodeInventoryFrame } from '../../src/features/scan/decode-frame';
import fixture from '../fixtures/auth.json' with { type: 'json' };
import { chooseLocation } from './location-picker';

const rootCode = 'ITC';
test.use({ deviceScaleFactor: 2, trace: 'on' });

test('one-time label links survive removal and reload, clear obsolete lifecycle warnings, and allow an intentional re-add', async ({
  page,
}, testInfo) => {
  test.setTimeout(90_000);
  await signIn(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/inventory/assets/new');
  const create = page.getByRole('form', { name: 'Create asset inventory' });
  const name = 'Checkpoint retired label ' + crypto.randomUUID();
  await create.getByLabel('Name', { exact: true }).fill(name);
  await chooseLocation(create, 'Current location', 'ITC-RED');
  await create.getByRole('button', { name: 'Review metadata' }).click();
  await create.getByRole('button', { name: 'Confirm save' }).click();
  await expect(page).toHaveURL(/\/inventory\/assets\/[0-9a-f-]+$/);
  const assetUrl = page.url();
  await page
    .locator('summary')
    .filter({ hasText: /^Retire asset$/ })
    .click();
  const retire = page.getByRole('form', {
    name: 'Retire asset',
    exact: true,
  });
  await retire
    .getByLabel('Reason (required)')
    .fill('Checkpoint fictional retired label fixture');
  await retire.getByRole('button', { name: 'Review retire asset' }).click();
  await retire.getByRole('button', { name: 'Confirm retire asset' }).click();
  await expect(page.getByText(/retired · Version 2/)).toBeVisible();
  await page.getByRole('link', { name: 'Print asset label' }).click();
  await expect(page).toHaveURL(/\/labels$/);
  const queue = page.getByRole('region', { name: 'Label queue' });
  await expect(queue).toContainText('1 distinct records · 1 labels');
  await expect(
    page.getByRole('button', { name: 'Acknowledge changes' }),
  ).toBeVisible();
  await queue.getByRole('button', { name: 'Remove', exact: true }).click();
  await expect(queue).toContainText('0 distinct records · 0 labels');
  await expect(
    page.getByRole('button', { name: 'Acknowledge changes' }),
  ).toHaveCount(0);
  await page.screenshot({
    path: testInfo.outputPath('retired-label-removed.png'),
  });
  await page.reload();
  await expect(queue).toContainText('0 distinct records · 0 labels');
  await expect(
    page.getByRole('button', { name: 'Acknowledge changes' }),
  ).toHaveCount(0);
  await page.goto(assetUrl);
  await page.getByRole('link', { name: 'Print asset label' }).click();
  await expect(queue).toContainText('1 distinct records · 1 labels');
  await expect(
    page.getByRole('button', { name: 'Acknowledge changes' }),
  ).toBeVisible();
  await queue.getByRole('button', { name: 'Clear queue' }).click();
  await page.reload();
  await expect(queue).toContainText('0 distinct records · 0 labels');
  await page.goto('/labels?location=ITC-RED&keep=state#sheet');
  await expect(page).toHaveURL(/\/labels\?keep=state#sheet$/);
  await expect(queue).toContainText('1 distinct records · 1 labels');
  await queue.getByRole('button', { name: 'Remove', exact: true }).click();
  await page.reload();
  await expect(queue).toContainText('0 distinct records · 0 labels');
  await expect(page).toHaveURL(/\/labels\?keep=state#sheet$/);
});
async function signIn(page: Page, role: 'staff' | 'viewer' = 'staff') {
  await page.goto('/login');
  await page.getByLabel('Email', { exact: true }).fill(fixture.emails[role]);
  await page.getByLabel('Password', { exact: true }).fill(fixture.password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Inventory', exact: true }),
  ).toBeVisible();
}

async function addSearchRecord(page: Page, name: string) {
  const row = page
    .getByRole('region', { name: 'Search result records' })
    .locator(':scope > div')
    .filter({ has: page.getByRole('link', { name, exact: true }) });
  await expect(row).toHaveCount(1);
  await row.getByRole('button', { name: 'Add to queue', exact: true }).click();
}

async function openEditForm(
  page: Page,
  name: 'Edit asset metadata' | 'Edit quantity metadata',
) {
  const form = page.getByRole('form', { name });
  if (!(await form.isVisible()))
    await page.locator('summary').filter({ hasText: name }).click();
  await expect(form).toBeVisible();
  return form;
}

async function decodeScreenshot(
  _page: Page,
  png: Buffer,
  format?: BarcodeFormat,
): Promise<string> {
  const image = PNG.sync.read(png);
  const rgba = new Uint8ClampedArray(image.data);
  const canvas = {
    width: image.width,
    height: image.height,
    getContext: () => ({
      getImageData: () => ({
        data: rgba,
        width: image.width,
        height: image.height,
      }),
    }),
  } as unknown as HTMLCanvasElement;
  return decodeInventoryFrame(canvas, () => {
    const gray = new Uint8ClampedArray(image.width * image.height);
    for (let i = 0; i < gray.length; i++) gray[i] = rgba[i * 4];
    return new MultiFormatReader().decode(
      new BinaryBitmap(
        new HybridBinarizer(
          new RGBLuminanceSource(gray, image.width, image.height),
        ),
      ),
      format === undefined
        ? new Map()
        : new Map([[DecodeHintType.POSSIBLE_FORMATS, [format]]]),
    );
  }).getText();
}

async function generatedLocationQr(page: Page, code = rootCode) {
  await page.goto('/labels?location=' + code);
  await readyPreview(page, 1);
  const card = page.locator('.label-card').first();
  const qr = card.getByRole('img', { name: /QR code for/ });
  await expect(qr).toBeVisible();
  const source = await qr.getAttribute('src');
  expect(source).toMatch(/^data:image\/png;base64,/);
  return { card, source: source! };
}

async function readyPreview(page: Page, count: number) {
  await expect(
    page.getByRole('status').filter({
      hasText: 'Print preview refreshed from current inventory',
    }),
  ).toBeVisible();
  await expect(page.locator('.label-card')).toHaveCount(count);
  await expect(page.locator('.label-card[data-code-ready="true"]')).toHaveCount(
    count,
  );
}

async function verifiedPreviewPdf(page: Page, destination: string) {
  const cards = page.locator('.label-card');
  await expect(page.locator('.label-card[data-code-ready="true"]')).toHaveCount(
    await cards.count(),
  );
  await page.evaluate(() => {
    window.print = () => {
      window.dispatchEvent(new Event('beforeprint'));
      document.body.dataset.verifiedPrint =
        document
          .querySelector('.label-print-root')
          ?.getAttribute('data-print-authorized') ?? 'missing';
      window.dispatchEvent(new Event('afterprint'));
    };
  });
  await page.getByRole('button', { name: /Print selected labels/ }).click();
  await expect(page.locator('body')).toHaveAttribute(
    'data-verified-print',
    'true',
  );
  await expect(page.locator('.label-print-root')).not.toHaveAttribute(
    'data-print-authorized',
  );
  // page.pdf bypasses the browser dialog; briefly mirror its verified print
  // state only to inspect physical layout, then revoke it in the test harness.
  await page
    .locator('.label-print-root')
    .evaluate((node) => node.setAttribute('data-print-authorized', 'true'));
  try {
    return await page.pdf({
      path: destination,
      preferCSSPageSize: true,
      printBackground: true,
    });
  } finally {
    await page
      .locator('.label-print-root')
      .evaluate((node) => node.removeAttribute('data-print-authorized'));
  }
}

test('larger labels retry normal text fitting while preserving the QR and print barrier', async ({
  page,
}, testInfo) => {
  await signIn(page);
  // The wide-letter name crosses the small label's text-height budget.
  const name = 'W'.repeat(80);
  await page.goto('/inventory/quantity/new');
  const form = page.getByRole('form', { name: 'Create quantity inventory' });
  await form.getByLabel('Name', { exact: true }).fill(name);
  await form.getByLabel('Initial quantity').fill('1');
  await chooseLocation(form, 'Initial location', 'ITC-S1A');
  await form.getByRole('button', { name: 'Review metadata' }).click();
  await form.getByRole('button', { name: 'Confirm save' }).click();
  await expect(page).toHaveURL(/\/inventory\/quantity\/[0-9a-f-]+$/);
  const id = page.url().split('/').at(-1)!;
  await page.goto('/labels?quantity=' + id);
  await readyPreview(page, 1);
  const size = page.getByRole('combobox', { name: 'Label size', exact: true });
  await size.selectOption('70x35');
  const card = page.locator('.label-card').first();
  const title = card.locator('strong[data-fit-text]');
  await testInfo.attach('small-label-fitting', {
    body: JSON.stringify(
      await title.evaluate((element) => ({
        text: element.textContent,
        font: getComputedStyle(element).fontSize,
        width: element.clientWidth,
        height: element.clientHeight,
        scrollWidth: element.scrollWidth,
        scrollHeight: element.scrollHeight,
        card: (element.closest('.label-card') as HTMLElement)?.style.cssText,
      })),
    ),
    contentType: 'application/json',
  });
  await expect
    .poll(() => title.evaluate((element) => getComputedStyle(element).fontSize))
    .toBe('10.6667px');
  const originalQr = await card.getByRole('img').elementHandle();
  await size.selectOption('90x50');
  await expect
    .poll(() => title.evaluate((element) => getComputedStyle(element).fontSize))
    .toBe('12px');
  await expect(card).toHaveAttribute('data-text-overflow', 'false');
  await expect(card).toHaveAttribute('data-text-measured', 'true');
  await expect(card).toHaveAttribute('data-code-ready', 'true');
  expect(
    await card
      .getByRole('img')
      .evaluate((element, previous) => element === previous, originalQr),
  ).toBe(true);
  await page.emulateMedia({ media: 'print' });
  await expect(page.locator('.label-print-root')).toBeHidden();
  await page.emulateMedia({ media: 'screen' });
  await card.screenshot({ path: testInfo.outputPath('refitted-label.png') });
});

test('printed QR and Code 128 decode from rendered label cards with physical size and page breaks', async ({
  page,
}, testInfo) => {
  test.setTimeout(90_000);
  await signIn(page, 'viewer');
  const { card } = await generatedLocationQr(page);
  await expect(page.getByText(/Preview labels for/)).toBeVisible();
  const dimensions = await card.evaluate((element) => {
    const box = element.getBoundingClientRect();
    const code = element.querySelector('img')!.getBoundingClientRect();
    return { width: box.width, height: box.height, code: code.width };
  });
  expect(dimensions.width).toBeCloseTo((90 * 96) / 25.4, 0);
  expect(dimensions.height).toBeCloseTo((50 * 96) / 25.4, 0);
  expect(dimensions.code).toBeGreaterThanOrEqual((30 * 96) / 25.4 - 2);
  const qrShot = await card.screenshot({
    path: testInfo.outputPath('location-qr.png'),
    scale: 'css',
  });
  await page.screenshot({
    path: testInfo.outputPath('labels-desktop.png'),
    fullPage: true,
  });
  expect(await decodeScreenshot(page, qrShot)).toBe(
    process.env.APP_ORIGIN + '/locations/ITC',
  );
  const codeFormat = page
    .locator('select')
    .filter({ has: page.locator('option[value="code128"]') });
  await codeFormat.selectOption('code128');
  await readyPreview(page, 1);
  const barcode = card.getByRole('img', { name: 'Code 128 LOC:ITC' });
  await expect(barcode).toBeVisible();
  await expect(barcode).not.toHaveClass(/hidden/);
  await card.screenshot({
    path: testInfo.outputPath('location-code128.png'),
    scale: 'device',
  });
  expect(
    await decodeScreenshot(
      page,
      await barcode.screenshot({
        path: testInfo.outputPath('location-code128-crop.png'),
      }),
    ),
  ).toBe('LOC:ITC');
  await codeFormat.selectOption('qr');
  await readyPreview(page, 1);
  for (const code of [
    'ITC-L',
    'ITC-R',
    'ITC-S1',
    'ITC-S2',
    'ITC-S3',
    'ITC-S4',
    'ITC-D01',
    'ITC-D02',
    'ITC-D03',
    'ITC-D04',
  ]) {
    await chooseLocation(
      page.locator('section').filter({ hasText: 'Add a location' }).first(),
      'Location',
      code,
    );
    await page.getByRole('button', { name: 'Add location label' }).click();
  }
  await readyPreview(page, 11);
  await page.emulateMedia({ media: 'print' });
  await expect(page.locator('.label-print-root')).toBeHidden();
  await page.emulateMedia({ media: 'screen' });
  const pdf = await verifiedPreviewPdf(
    page,
    testInfo.outputPath('labels-letter.pdf'),
  );
  const pdfText = pdf.toString('latin1');
  expect((pdfText.match(/\/Type\s*\/Page\b/g) ?? []).length).toBeGreaterThan(1);
  expect(pdfText).toMatch(/\/MediaBox\s*\[\s*0\s+0\s+612\s+792\s*\]/);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: testInfo.outputPath('labels-phone.png'),
    fullPage: true,
  });
  const phoneLayout = await page.evaluate(() => ({
    viewport: innerWidth,
    scrollWidth: document.documentElement.scrollWidth,
    offenders: [...document.querySelectorAll('body *')]
      .filter(
        (element) => element.getBoundingClientRect().right > innerWidth + 1,
      )
      .slice(0, 8)
      .map((element) => ({
        tag: element.tagName,
        className: element.className,
        width: Math.round(element.getBoundingClientRect().width),
        right: Math.round(element.getBoundingClientRect().right),
      })),
  }));
  expect(
    phoneLayout.scrollWidth,
    JSON.stringify(phoneLayout),
  ).toBeLessThanOrEqual(phoneLayout.viewport);
});

test('generated QR crosses the synthetic camera frame path and releases its stream', async ({
  page,
}) => {
  test.setTimeout(60_000);
  await signIn(page);
  const { source } = await generatedLocationQr(page, 'ITC-S1A');
  const events: string[] = [];
  await page.exposeFunction('recordCameraEvent', (event: string) => {
    events.push(event);
  });
  await page.addInitScript(
    ({ qr }) => {
      const record = (event: string) =>
        (
          window as typeof window & {
            recordCameraEvent: (event: string) => Promise<void>;
          }
        ).recordCameraEvent(event);
      Object.defineProperty(navigator.mediaDevices, 'getUserMedia', {
        configurable: true,
        value: async (constraints: MediaStreamConstraints) => {
          void record('requested:' + JSON.stringify(constraints));
          const canvas = document.createElement('canvas');
          canvas.width = canvas.height = 640;
          const ctx = canvas.getContext('2d')!;
          const image = new Image();
          image.src = qr;
          await image.decode();
          const draw = () => {
            ctx.fillStyle = '#fff';
            ctx.fillRect(0, 0, 640, 640);
            ctx.drawImage(image, 120, 120, 400, 400);
          };
          draw();
          const stream = canvas.captureStream(15);
          const track = stream.getVideoTracks()[0];
          const originalStop = track.stop.bind(track);
          track.stop = () => {
            void record('stopped');
            originalStop();
          };
          const timer = setInterval(draw, 100);
          track.addEventListener('ended', () => clearInterval(timer));
          return stream;
        },
      });
    },
    { qr: source },
  );
  await page.goto('/scan');
  await expect(
    page.getByRole('heading', { name: 'Scan and open' }),
  ).toBeVisible();
  expect(events).toEqual([]);
  await page.getByRole('button', { name: 'Start camera' }).click();
  await expect(page).toHaveURL(/\/locations\/ITC-S1A$/);
  expect(events.filter((event) => event.startsWith('requested:'))).toHaveLength(
    1,
  );
  expect(events[0]).toContain('environment');
  await expect
    .poll(() => events.filter((event) => event === 'stopped').length)
    .toBeGreaterThan(0);
});

test('denied camera has manual fallback, rejects external text and opens exact records', async ({
  page,
}) => {
  await signIn(page, 'viewer');
  await page.addInitScript(() => {
    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', {
      configurable: true,
      value: async () => {
        throw new DOMException('Denied', 'NotAllowedError');
      },
    });
  });
  await page.goto('/scan');
  await page.getByRole('button', { name: 'Start camera' }).click();
  await expect(page.getByRole('status')).toContainText(
    'Camera permission was denied',
  );
  const input = page.getByLabel(
    'Paste a label URL, barcode text, or exact identifier',
  );
  await input.fill('https://example.com/locations/ITC');
  await page.getByRole('button', { name: 'Open', exact: true }).click();
  await expect(page.getByRole('status')).toContainText(
    'not a supported inventory label',
  );
  await expect(page).toHaveURL(/\/scan$/);
  await input.fill('LOC:ITC-S1A');
  await page.getByRole('button', { name: 'Open', exact: true }).click();
  await expect(page).toHaveURL(/\/locations\/ITC-S1A$/);
});

test('explicit Stop and route navigation release a camera stream without a decoded frame', async ({
  page,
}) => {
  await signIn(page, 'viewer');
  const events: string[] = [];
  await page.exposeFunction('recordCameraEvent', (event: string) => {
    events.push(event);
  });
  await page.addInitScript(() => {
    const record = (event: string) =>
      (
        window as typeof window & {
          recordCameraEvent: (event: string) => Promise<void>;
        }
      ).recordCameraEvent(event);
    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', {
      configurable: true,
      value: async () => {
        void record('requested');
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = 640;
        const ctx = canvas.getContext('2d')!;
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, 640, 640);
        const stream = canvas.captureStream(15);
        const track = stream.getVideoTracks()[0];
        const originalStop = track.stop.bind(track);
        track.stop = () => {
          void record('stopped');
          originalStop();
        };
        return stream;
      },
    });
  });
  await page.goto('/scan');
  await page.getByRole('button', { name: 'Start camera' }).click();
  await expect(page.getByRole('button', { name: 'Stop camera' })).toBeVisible();
  await expect
    .poll(() => events.filter((event) => event === 'requested').length)
    .toBe(1);
  await expect
    .poll(() =>
      page
        .getByLabel('Camera preview')
        .evaluate(
          (video: HTMLVideoElement) => video.srcObject instanceof MediaStream,
        ),
    )
    .toBe(true);
  await page.getByRole('button', { name: 'Stop camera' }).click();
  await expect
    .poll(() => events.filter((event) => event === 'stopped').length)
    .toBeGreaterThanOrEqual(1);
  await page.getByRole('button', { name: 'Start camera' }).click();
  await expect(page.getByRole('button', { name: 'Stop camera' })).toBeVisible();
  await expect
    .poll(() => events.filter((event) => event === 'requested').length)
    .toBe(2);
  await expect
    .poll(() =>
      page
        .getByLabel('Camera preview')
        .evaluate(
          (video: HTMLVideoElement) => video.srcObject instanceof MediaStream,
        ),
    )
    .toBe(true);
  await page.getByRole('link', { name: 'Inventory', exact: true }).click();
  await expect
    .poll(() => events.filter((event) => event === 'stopped').length)
    .toBeGreaterThanOrEqual(2);
  expect(events.filter((event) => event === 'requested')).toHaveLength(2);
});

test('unavailable camera still permits exact manual lookup', async ({
  page,
}) => {
  await signIn(page, 'viewer');
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: undefined,
    });
  });
  await page.goto('/scan');
  await page.getByRole('button', { name: 'Start camera' }).click();
  await expect(page.getByRole('status')).toContainText(
    'Camera access is unavailable',
  );
  await page
    .getByLabel('Paste a label URL, barcode text, or exact identifier')
    .fill('LOC:ITC');
  await page.getByRole('button', { name: 'Open', exact: true }).click();
  await expect(page).toHaveURL(/\/locations\/ITC$/);
});

test('anonymous label opens login then exact destination; unsafe return is ignored', async ({
  page,
}) => {
  await page.goto('/locations/ITC-S1A');
  await expect(page).toHaveURL(/\/login\?next=%2Flocations%2FITC-S1A$/);
  await page.getByLabel('Email', { exact: true }).fill(fixture.emails.viewer);
  await page.getByLabel('Password', { exact: true }).fill(fixture.password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page).toHaveURL(/\/locations\/ITC-S1A$/);
  await page.getByRole('button', { name: 'Sign out' }).click();
  await page.goto(
    '/login?next=' + encodeURIComponent('//example.com/locations/ITC'),
  );
  await page.getByLabel('Email', { exact: true }).fill(fixture.emails.viewer);
  await page.getByLabel('Password', { exact: true }).fill(fixture.password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page).toHaveURL(/\/inventory$/);
});

test('asset UUID label survives rename and move, while a bare colliding identifier requires selection', async ({
  page,
}, testInfo) => {
  test.setTimeout(90_000);
  await signIn(page);
  const originalName =
    'Label asset ' + crypto.randomUUID() + ' ' + 'long-name-'.repeat(10);
  const api = new URL(process.env.LOCAL_API_URL!);
  expect(['localhost', '127.0.0.1']).toContain(api.hostname);
  expect(api.port).toBe('54321');
  const local = createClient(api.href, process.env.LOCAL_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const existing = await local
    .from('serialized_assets')
    .select('id')
    .eq('asset_tag', 'itc')
    .maybeSingle();
  expect(existing.error).toBeNull();
  let id = existing.data?.id;
  let form;
  if (!id) {
    await page.goto('/inventory/assets/new');
    form = page.getByRole('form', { name: 'Create asset inventory' });
    await form.getByLabel('Name', { exact: true }).fill(originalName);
    await form.getByLabel('Asset tag').fill('ITC');
    await chooseLocation(form, 'Current location', 'ITC-RACK');
    await form.getByRole('button', { name: 'Review metadata' }).click();
    await form.getByRole('button', { name: 'Confirm save' }).click();
    await expect(page).toHaveURL(/\/inventory\/assets\/[0-9a-f-]+$/);
    id = page.url().split('/').at(-1)!;
  } else {
    await page.goto('/inventory/assets/' + id);
    form = await openEditForm(page, 'Edit asset metadata');
    await form.getByLabel('Name', { exact: true }).fill(originalName);
    await form.getByRole('button', { name: 'Review metadata' }).click();
    await form.getByRole('button', { name: 'Confirm save' }).click();
    await expect(
      page.getByRole('heading', { name: originalName, exact: true }),
    ).toBeVisible();
  }
  await page.goto('/labels?asset=' + id);
  await readyPreview(page, 1);
  const card = page.locator('.label-card').filter({ hasText: originalName });
  await expect(card).toBeVisible();
  await card.screenshot({ path: testInfo.outputPath('asset-before-move.png') });
  const renderedQr = card.getByRole('img', { name: /QR code for/ });
  const initialCode = await decodeScreenshot(
    page,
    await renderedQr.screenshot(),
    BarcodeFormat.QR_CODE,
  );
  expect(initialCode).toBe(process.env.APP_ORIGIN + '/inventory/assets/' + id);
  const located = await local
    .from('serialized_assets')
    .select('location_id')
    .eq('id', id)
    .single();
  expect(located.error).toBeNull();
  const currentLocation = await local
    .from('inventory_locations')
    .select('code')
    .eq('id', located.data!.location_id)
    .single();
  expect(currentLocation.error).toBeNull();
  const destination =
    currentLocation.data!.code === 'ITC-D01' ? 'ITC-D02' : 'ITC-D01';
  await page.goto('/inventory/assets/' + id);
  form = page.getByRole('form', { name: 'Move asset' });
  if (!(await form.isVisible())) {
    await page
      .locator('summary')
      .filter({ hasText: /^Move asset$/ })
      .click();
  }
  await chooseLocation(form, 'Destination location', destination);
  await form.getByRole('button', { name: 'Review move asset' }).click();
  await form.getByRole('button', { name: 'Confirm move asset' }).click();
  // History can already contain the destination; wait for the current record.
  await expect(
    page
      .locator('section')
      .filter({
        has: page.getByRole('heading', {
          name: 'Current custody',
          exact: true,
        }),
      })
      .getByRole('link', {
        name: 'Show ' + destination + ' in room',
        exact: true,
      }),
  ).toBeVisible();
  await page.reload();
  form = await openEditForm(page, 'Edit asset metadata');
  await form
    .getByLabel('Name', { exact: true })
    .fill('Renamed ' + originalName);
  await form.getByRole('button', { name: 'Review metadata' }).click();
  await form.getByRole('button', { name: 'Confirm save' }).click();
  await expect(
    page.getByRole('heading', { name: 'Renamed ' + originalName, exact: true }),
  ).toBeVisible();
  await page.goto('/labels?asset=' + id);
  await readyPreview(page, 1);
  await expect(card).toContainText('Renamed Label asset');
  await card.screenshot({ path: testInfo.outputPath('asset-after-move.png') });
  expect(
    await decodeScreenshot(
      page,
      await renderedQr.screenshot(),
      BarcodeFormat.QR_CODE,
    ),
  ).toBe(initialCode);
  await page.goto('/scan');
  const input = page.getByLabel(
    'Paste a label URL, barcode text, or exact identifier',
  );
  await input.fill('ITC');
  await page.getByRole('button', { name: 'Open', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('more than one record');
  await expect(
    page.getByRole('link', { name: /IT Closet.*ITC/ }),
  ).toBeVisible();
  await expect(
    page.getByRole('link', { name: /Label asset.*itc/i }),
  ).toBeVisible();
  await input.fill('AST:ITC');
  await page.getByRole('button', { name: 'Open', exact: true }).click();
  await expect(page).toHaveURL(new RegExp('/inventory/assets/' + id + '$'));
});

test('mixed queue retains copies across navigation, decodes quantity QR, and prints a multipage job', async ({
  page,
  context,
}, testInfo) => {
  test.setTimeout(90_000);
  await signIn(page);
  const suffix = crypto.randomUUID();
  const quantityName = 'Queue adapters ' + suffix;
  const assetName = 'Queue laptop ' + suffix;
  await page.goto('/inventory/quantity/new');
  let form = page.getByRole('form', { name: 'Create quantity inventory' });
  await form.getByLabel('Name', { exact: true }).fill(quantityName);
  await form.getByLabel('Initial quantity').fill('3');
  await chooseLocation(form, 'Initial location', 'ITC-S1A');
  await form.getByRole('button', { name: 'Review metadata' }).click();
  await form.getByRole('button', { name: 'Confirm save' }).click();
  await expect(page).toHaveURL(/\/inventory\/quantity\/[0-9a-f-]+$/);
  const quantityId = page.url().split('/').at(-1)!;

  await page.goto('/inventory/assets/new');
  form = page.getByRole('form', { name: 'Create asset inventory' });
  await form.getByLabel('Name', { exact: true }).fill(assetName);
  await form.getByLabel('Asset tag').fill('Q-' + suffix);
  await chooseLocation(form, 'Current location', 'ITC-D01');
  await form.getByRole('button', { name: 'Review metadata' }).click();
  await form.getByRole('button', { name: 'Confirm save' }).click();
  await expect(page).toHaveURL(/\/inventory\/assets\/[0-9a-f-]+$/);
  const assetId = page.url().split('/').at(-1)!;

  await page.goto('/labels');
  const search = page.getByRole('form', { name: 'Search label records' });
  await search.getByRole('textbox').fill(quantityName);
  await search.getByRole('button', { name: 'Search' }).click();
  await expect(page.getByRole('link', { name: quantityName })).toBeVisible();
  await expect(
    page.getByText('Holdings: IT Closet / Left Storage / Shelf 1 / 1A: 3'),
  ).toBeVisible();
  await addSearchRecord(page, quantityName);
  await search.getByRole('textbox').fill(assetName);
  await search.getByRole('button', { name: 'Search' }).click();
  await expect(page.getByRole('link', { name: assetName })).toBeVisible();
  await addSearchRecord(page, assetName);
  await chooseLocation(
    page.locator('section').filter({ hasText: 'Add a location' }).first(),
    'Location',
    'ITC-S1B',
  );
  await page.getByRole('button', { name: 'Add location label' }).click();
  await expect(page.getByRole('region', { name: 'Label queue' })).toContainText(
    '3 distinct records',
  );
  await page.getByRole('link', { name: 'Inventory', exact: true }).click();
  await page.goto('/labels');
  await expect(page.getByRole('region', { name: 'Label queue' })).toContainText(
    '3 distinct records',
  );
  const copies = page.getByRole('spinbutton');
  await copies.first().fill('10');
  await readyPreview(page, 12);
  const quantityCard = page
    .locator('.label-card')
    .filter({ hasText: quantityName })
    .first();
  const quantityQr = quantityCard.getByRole('img', { name: /QR code for/ });
  await expect(quantityQr).toBeVisible();
  expect(
    await decodeScreenshot(
      page,
      await quantityCard.screenshot({
        path: testInfo.outputPath('quantity-qr.png'),
      }),
    ),
  ).toBe(process.env.APP_ORIGIN + '/inventory/quantity/' + quantityId);
  const pdf = await verifiedPreviewPdf(
    page,
    testInfo.outputPath('mixed-label-queue.pdf'),
  );
  expect(
    (pdf.toString('latin1').match(/\/Type\s*\/Page\b/g) ?? []).length,
  ).toBeGreaterThan(1);

  const editor = await context.newPage();
  await editor.goto('/inventory/quantity/' + quantityId);
  form = await openEditForm(editor, 'Edit quantity metadata');
  const freshQuantityName = 'Fresh adapters ' + suffix.slice(0, 8);
  await form.getByLabel('Name', { exact: true }).fill(freshQuantityName);
  await form.getByRole('button', { name: 'Review metadata' }).click();
  await form.getByRole('button', { name: 'Confirm save' }).click();
  await expect(
    editor.getByRole('heading', { name: freshQuantityName }),
  ).toBeVisible();
  // The prepared preview is now stale. Browser Ctrl/Cmd+P never runs the
  // application's revalidation, so its print media must conceal the sheet.
  await page.emulateMedia({ media: 'print' });
  await expect(page.locator('.label-print-root')).toBeHidden();
  await page.emulateMedia({ media: 'screen' });
  await page.evaluate(() => {
    window.print = () => {
      document.body.dataset.printCalled = 'yes';
      window.dispatchEvent(new Event('afterprint'));
    };
  });
  await page.getByRole('button', { name: /Print selected labels/ }).click();
  await expect(page.locator('body')).toHaveAttribute(
    'data-print-called',
    'yes',
  );
  await expect(
    page.getByRole('status').filter({ hasText: 'Label information refreshed' }),
  ).toBeVisible();
  await expect(
    page.locator('.label-card').filter({ hasText: freshQuantityName }),
  ).toHaveCount(10);

  await editor.goto('/inventory/assets/' + assetId);
  form = await openEditForm(editor, 'Edit asset metadata');
  await form.getByLabel('Asset tag').fill('Q2-' + suffix);
  await form.getByRole('button', { name: 'Review metadata' }).click();
  await form.getByRole('button', { name: 'Confirm save' }).click();
  await page.evaluate(() => {
    delete document.body.dataset.printCalled;
  });
  await page.getByRole('button', { name: /Print selected labels/ }).click();
  await expect(
    page.getByRole('button', { name: 'Acknowledge changes' }),
  ).toBeVisible();
  await expect(page.locator('body')).not.toHaveAttribute(
    'data-print-called',
    'yes',
  );
  await editor.close();

  await page.goto('/scan');
  await page
    .getByLabel('Paste a label URL, barcode text, or exact identifier')
    .fill(process.env.APP_ORIGIN + '/inventory/quantity/' + quantityId);
  await page.getByRole('button', { name: 'Open', exact: true }).click();
  await expect(page).toHaveURL(
    new RegExp('/inventory/quantity/' + quantityId + '$'),
  );
});

test('staff threshold persists into dashboard, inventory filter, and real CSV download; viewer can read and export', async ({
  page,
}, testInfo) => {
  test.setTimeout(90_000);
  const name = '=Stock,"quoted" ' + crypto.randomUUID();
  await signIn(page);
  await page.goto('/inventory/quantity/new');
  const form = page.getByRole('form', { name: 'Create quantity inventory' });
  await form.getByLabel('Name', { exact: true }).fill(name);
  await form.getByLabel('Reorder threshold (optional)').fill('0');
  await form.getByRole('button', { name: 'Review metadata' }).click();
  await form.getByRole('button', { name: 'Confirm save' }).click();
  await expect(page).toHaveURL(/\/inventory\/quantity\/[0-9a-f-]+$/);
  const id = page.url().split('/').at(-1)!;
  await expect(page.getByText(/Reorder threshold/).first()).toBeVisible();
  await page.goto('/dashboard');
  await expect(page.getByRole('link', { name, exact: true })).toBeVisible();
  const lowStockDownload = page.waitForEvent('download');
  await page.getByRole('link', { name: 'Download low-stock CSV' }).click();
  const lowStockFile = await lowStockDownload;
  expect(lowStockFile.suggestedFilename()).toMatch(
    /^preview-low-stock-\d{8}T\d{6}Z\.csv$/,
  );
  const lowStockPath = testInfo.outputPath(lowStockFile.suggestedFilename());
  await lowStockFile.saveAs(lowStockPath);
  const lowStockCsv = await import('node:fs/promises').then((fs) =>
    fs.readFile(lowStockPath, 'utf8'),
  );
  expect(lowStockCsv).toContain(
    '"Recorded Total","Reorder Threshold","Stock State"',
  );
  expect(lowStockCsv).toContain(id);
  await page.getByRole('link', { name: 'View filtered inventory' }).click();
  await expect(page).toHaveURL(/lowStock=true/);
  await expect(page.getByRole('link', { name, exact: true })).toBeVisible();
  await page.locator('details.experience-export-menu > summary').click();
  const download = page.waitForEvent('download');
  await page
    .getByRole('group', { name: 'CSV export options' })
    .getByRole('link', { name: 'Filtered inventory' })
    .click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(
    /^preview-inventory-\d{8}T\d{6}Z\.csv$/,
  );
  const destination = testInfo.outputPath(file.suggestedFilename());
  await file.saveAs(destination);
  const csv = await import('node:fs/promises').then((fs) =>
    fs.readFile(destination, 'utf8'),
  );
  expect(csv).toContain('"Record ID","Type","Name"');
  expect(csv).toContain(id);
  expect(csv).toContain('\'=Stock,""quoted""');
  await page.getByRole('button', { name: 'Sign out' }).click();
  await signIn(page, 'viewer');
  await page.goto('/inventory/quantity/' + id);
  await expect(page.getByText(/Reorder threshold/).first()).toBeVisible();
  await expect(
    page.getByRole('form', { name: 'Edit quantity metadata' }),
  ).toHaveCount(0);
  const response = await page.request.get(
    '/api/exports/inventory?lowStock=true&q=' + encodeURIComponent(name),
  );
  expect(response.status()).toBe(200);
  expect(response.headers()['cache-control']).toContain('private, no-store');
  expect(await response.text()).toContain(id);
});

test('empty CSV retains headers and anonymous export is denied', async ({
  page,
  request,
}) => {
  const denied = await request.get('/api/exports/inventory');
  expect(denied.status()).toBe(401);
  await signIn(page, 'viewer');
  const response = await page.request.get(
    '/api/exports/inventory?q=' + crypto.randomUUID(),
  );
  expect(response.status()).toBe(200);
  const csv = await response.text();
  expect(csv).toContain('"Record ID","Type","Name"');
  expect(csv.trim().split(/\r?\n/)).toHaveLength(1);
});
