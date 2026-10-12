// Bounded DB-free browser proof using the real LabelSheet and canonical Tailwind CSS.
// It proves software dimensions/code rendering, not application authorization or physical output.
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createServer } from 'node:http';
import { build } from 'esbuild';
import postcss from 'postcss';
import tailwind from '@tailwindcss/postcss';
import { chromium } from '@playwright/test';
import { PDFDocument } from 'pdf-lib';
import { imageConfigDefault } from 'next/dist/shared/lib/image-config';
import { PNG } from 'pngjs';
import jsQR from 'jsqr';
import {
  BinaryBitmap,
  BarcodeFormat,
  DecodeHintType,
  HybridBinarizer,
  MultiFormatReader,
  RGBLuminanceSource,
} from '@zxing/library';
import {
  sheetGeometry,
  type PrintLayout,
} from '../../src/features/labels/print-layout';

const output = 'test-results/print-media';
await mkdir(output, { recursive: true });
const [bundle, css] = await Promise.all([
  build({
    entryPoints: ['tests/fixtures/print-media-browser.tsx'],
    bundle: true,
    write: false,
    platform: 'browser',
    format: 'iife',
    jsx: 'automatic',
    define: {
      'process.env.NODE_ENV': '"production"',
      'process.env.__NEXT_IMAGE_OPTS': JSON.stringify(imageConfigDefault),
    },
    plugins: [
      {
        name: 'next-image-commonjs-entry',
        setup(plugin) {
          // esbuild outside Next does not unwrap Next's CommonJS image entry.
          // Re-export the real framework Image renderer, without replacing it.
          plugin.onResolve({ filter: /^next\/image$/ }, () => ({
            path: 'image',
            namespace: 'next-image-entry',
          }));
          plugin.onLoad(
            { filter: /.*/, namespace: 'next-image-entry' },
            () => ({
              contents:
                "import { Image } from 'next/dist/client/image-component.js'; export default Image;",
              resolveDir: process.cwd(),
            }),
          );
        },
      },
    ],
  }),
  postcss([tailwind()]).process(await readFile('src/app/globals.css', 'utf8'), {
    from: 'src/app/globals.css',
  }),
]);
const server = createServer((request, response) => {
  if (request.url === '/bundle.js') {
    response.setHeader('Content-Type', 'text/javascript');
    response.end(bundle.outputFiles[0].contents);
  } else if (request.url === '/style.css') {
    response.setHeader('Content-Type', 'text/css');
    response.end(css.css);
  } else
    response.end(
      '<!doctype html><html><head><link rel="stylesheet" href="/style.css"></head><body><div id="fixture"></div><script src="/bundle.js"></script></body></html>',
    );
});
await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
const address = server.address();
assert.ok(address && typeof address !== 'string');
const browser = await chromium.launch({ headless: true });
const close = () =>
  new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
const checks: Record<string, unknown>[] = [];
try {
  const page = await browser.newPage({
    viewport: { width: 1400, height: 1000 },
    deviceScaleFactor: 2,
  });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${address.port}`);
  const cases: {
    name: string;
    size: '90x50' | '70x35';
    page: 'letter' | 'A4';
    layout?: PrintLayout;
    count: number;
  }[] = [
    { name: 'large-letter', size: '90x50', page: 'letter', count: 11 },
    { name: 'large-a4', size: '90x50', page: 'A4', count: 11 },
    { name: 'small-letter', size: '70x35', page: 'letter', count: 15 },
    { name: 'small-a4', size: '70x35', page: 'A4', count: 15 },
    {
      name: 'single',
      size: '90x50',
      page: 'letter',
      layout: { version: 1, mode: 'single', labelWidth: 700, labelHeight: 350 },
      count: 3,
    },
    {
      name: 'custom-asymmetric',
      size: '90x50',
      page: 'A4',
      layout: {
        version: 1,
        mode: 'sheet',
        labelWidth: 600,
        labelHeight: 400,
        sheetWidth: 1600,
        sheetHeight: 1100,
        marginTop: 50,
        marginRight: 100,
        marginBottom: 150,
        marginLeft: 70,
        gapX: 40,
        gapY: 60,
      },
      count: 5,
    },
  ];
  for (const test of cases) {
    const geometry = sheetGeometry(test.size, test.page, test.layout);
    await page.emulateMedia({ media: 'screen', reducedMotion: 'reduce' });
    await page.evaluate(
      (test) => window.renderPrintMedia({ ...test, format: 'qr' }, test.count),
      test,
    );
    const expected = {
      count: test.count,
      generation: JSON.stringify([{ ...test, format: 'qr' }, test.count]),
    };
    try {
      await page.waitForFunction(
        ({ count, generation }) => {
          const root = document.querySelector<HTMLElement>('.label-print-root');
          const cards = Array.from(
            root?.querySelectorAll<HTMLElement>('.label-card') ?? [],
          );
          return (
            root?.dataset.sheetGeneration === generation &&
            cards.length === count &&
            cards.every(
              (card) =>
                card.dataset.sheetGeneration === generation &&
                card.dataset.codeReady === 'true',
            )
          );
        },
        expected,
        { timeout: 15000 },
      );
    } catch (error) {
      console.error(
        JSON.stringify({
          test: test.name,
          errors,
          diagnostic: await page.evaluate(() =>
            Array.from(document.querySelectorAll<HTMLElement>('.label-card'))
              .slice(0, 1)
              .map((card) => ({
                ready: card.dataset,
                box: card.getBoundingClientRect().toJSON(),
                text: card.textContent,
              })),
          ),
        }),
      );
      throw error;
    }
    await page
      .locator('.label-print-root')
      .evaluate((element) =>
        element.setAttribute('data-print-authorized', 'true'),
      );
    // Explicit screen emulation otherwise also affects PrintToPDF. Physical
    // geometry is measured in print media, where preview motion is disabled.
    await page.emulateMedia({ media: 'print' });
    await page.waitForFunction(
      ({ count, generation }) => {
        const root = document.querySelector<HTMLElement>('.label-print-root');
        const cards = Array.from(
          root?.querySelectorAll<HTMLElement>('.label-card') ?? [],
        );
        return (
          root?.dataset.sheetGeneration === generation &&
          cards.length === count &&
          cards.every(
            (card) =>
              card.dataset.sheetGeneration === generation &&
              card.dataset.codeReady === 'true',
          )
        );
      },
      expected,
      { timeout: 15000 },
    );
    const position = await page
      .locator('.label-page')
      .first()
      .evaluate((element) => {
        const pageBox = element.getBoundingClientRect();
        return Array.from(element.querySelectorAll('.label-card')).map(
          (card) => {
            const box = card.getBoundingClientRect();
            return {
              x: box.x - pageBox.x,
              y: box.y - pageBox.y,
              width: box.width,
              height: box.height,
            };
          },
        );
      });
    const pxPerTenthMm = 96 / 254;
    for (const [index, box] of position.entries()) {
      assert.ok(
        Math.abs(
          box.x -
            (geometry.marginLeft +
              (index % geometry.columns) *
                (geometry.labelWidth + geometry.gapX)) *
              pxPerTenthMm,
        ) < 0.2,
        'row-major X ' + test.name,
      );
      assert.ok(
        Math.abs(
          box.y -
            (geometry.marginTop +
              Math.floor(index / geometry.columns) *
                (geometry.labelHeight + geometry.gapY)) *
              pxPerTenthMm,
        ) < 0.2,
        'row-major Y ' + test.name,
      );
      assert.ok(
        Math.abs(box.width - geometry.labelWidth * pxPerTenthMm) < 0.2,
        'label width ' + test.name,
      );
      assert.ok(
        Math.abs(box.height - geometry.labelHeight * pxPerTenthMm) < 0.2,
        'label height ' + test.name,
      );
    }
    const qr = PNG.sync.read(
      await page.locator('.label-card img').first().screenshot(),
    );
    assert.equal(
      jsQR(new Uint8ClampedArray(qr.data), qr.width, qr.height)?.data,
      'https://inventory.example.test/locations/ITC-D01',
      'actual rendered QR ' + test.name,
    );
    // This fixture uses the same explicit software grant as the existing PDF E2E helper.
    // Application one-lifecycle authorization is proven separately in component/E2E checks.
    const pdf = await page.pdf({
      path: `${output}/${test.name}.pdf`,
      preferCSSPageSize: true,
      printBackground: true,
      displayHeaderFooter: false,
    });
    const pdfDocument = await PDFDocument.load(pdf);
    if (
      pdfDocument.getPageCount() !== Math.ceil(test.count / geometry.capacity)
    ) {
      await page.emulateMedia({ media: 'print' });
      console.error(
        JSON.stringify(
          await page.evaluate(() =>
            Array.from(
              document.querySelectorAll(
                'html,body,#fixture,.sheet-frame,.label-print-root,.label-page',
              ),
            ).map((element) => {
              const s = getComputedStyle(element);
              return {
                tag: element.tagName,
                class: element.className,
                box: element.getBoundingClientRect().toJSON(),
                scroll: (element as HTMLElement).scrollHeight,
                height: s.height,
                minHeight: s.minHeight,
                margin: s.margin,
                padding: s.padding,
                breakAfter: s.breakAfter,
              };
            }),
          ),
        ),
      );
    }
    assert.equal(
      pdfDocument.getPageCount(),
      Math.ceil(test.count / geometry.capacity),
      'no blank or extra pages ' + test.name,
    );
    for (const pdfPage of pdfDocument.getPages()) {
      assert.ok(
        Math.abs(pdfPage.getWidth() - (geometry.sheetWidth * 72) / 254) < 1,
        'PDF width ' + test.name,
      );
      assert.ok(
        Math.abs(pdfPage.getHeight() - (geometry.sheetHeight * 72) / 254) < 1,
        'PDF height ' + test.name,
      );
    }
    await page.emulateMedia({ media: 'screen' });
    await page
      .locator('.label-print-root')
      .evaluate((element) => element.removeAttribute('data-print-authorized'));
    if (test.name === 'custom-asymmetric')
      await page.screenshot({
        path: `${output}/custom-sheet.png`,
        fullPage: true,
      });
    checks.push({
      name: test.name,
      pages: pdfDocument.getPageCount(),
      widthMm: geometry.sheetWidth / 10,
      heightMm: geometry.sheetHeight / 10,
      labels: test.count,
      qrDecoded: true,
    });
  }
  await page.emulateMedia({ media: 'screen' });
  await page.evaluate(() =>
    window.renderPrintMedia(
      { size: '70x35', page: 'letter', format: 'code128' },
      1,
    ),
  );
  await page.waitForFunction(
    () =>
      document.querySelectorAll('.label-card').length === 1 &&
      document.querySelector('.label-card')?.getAttribute('data-code-ready') ===
        'true' &&
      document.querySelector('.label-card svg')?.getAttribute('viewBox'),
  );
  const svg = page.locator('.label-card svg');
  const quiet = await svg.evaluate((element) => ({
    viewBox: element.getAttribute('viewBox')!.split(' ').map(Number),
    width: (element as SVGSVGElement).style.width,
  }));
  assert.ok(
    Math.abs(Number.parseFloat(quiet.width) - quiet.viewBox[2] * 0.3) < 0.0001,
    'Code 128 modules stay 0.3 mm',
  );
  const barcode = PNG.sync.read(
    await svg.screenshot({ path: `${output}/code128.png` }),
  );
  const gray = new Uint8ClampedArray(barcode.width * barcode.height);
  for (let pixel = 0; pixel < gray.length; pixel++)
    gray[pixel] =
      (barcode.data[pixel * 4] +
        2 * barcode.data[pixel * 4 + 1] +
        barcode.data[pixel * 4 + 2]) /
      4;
  const decoded = new MultiFormatReader().decode(
    new BinaryBitmap(
      new HybridBinarizer(
        new RGBLuminanceSource(gray, barcode.width, barcode.height),
      ),
    ),
    new Map([[DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.CODE_128]]]),
  );
  assert.equal(decoded.getText(), 'LOC:ITC-D01');
  checks.push({ name: 'code128', moduleMm: 0.3, decoded: true });
  assert.deepEqual(errors, [], 'no runtime errors');
  await writeFile(
    `${output}/evidence.json`,
    JSON.stringify(
      {
        deviceScaleFactor: 2,
        checks,
        limitations: [
          'Standalone component fixture; no authenticated app or database',
          'Code 128 screenshot decoded at DPR 2; DPR 1 decode failed',
          'Browser PDF and pixels do not prove physical alignment/decoding or future printer compatibility',
        ],
      },
      null,
      2,
    ),
  );
  console.log(JSON.stringify(checks));
} finally {
  await browser.close();
  await close();
}
