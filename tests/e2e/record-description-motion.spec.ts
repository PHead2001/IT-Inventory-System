import { expect, test } from '@playwright/test';
import { build } from 'esbuild';
import { resolve } from 'node:path';
import { writeFile } from 'node:fs/promises';
import { freemem } from 'node:os';

declare global {
  interface Window {
    recordDescriptionHeights: number[];
  }
}
let source: string;
let memoryGuard: ReturnType<typeof setInterval> | undefined;
test.beforeAll(async ({ browser }) => {
  if (process.env.PR56_NATIVE_MEMORY_GUARD === '1') {
    expect(freemem() / 1024 ** 3).toBeGreaterThanOrEqual(8);
    memoryGuard = setInterval(() => {
      if (freemem() < 6 * 1024 ** 3) void browser.close();
    }, 2000);
  }
  const result = await build({
    stdin: {
      contents: `
        import React from 'react';
        import {createRoot} from 'react-dom/client';
        import {RecordDescription} from './src/components/record-description';
        window.recordDescriptionHeights = [];
        let frames = 0;
        const sample = () => {
          const paragraph = document.getElementById('root').querySelector('p');
          if (paragraph) window.recordDescriptionHeights.push(paragraph.parentElement.getBoundingClientRect().height);
          if (++frames < 60) requestAnimationFrame(sample);
        };
        requestAnimationFrame(sample);
        createRoot(document.getElementById('root')).render(<RecordDescription description={'Actual description line. '.repeat(100)}/>);
      `,
      resolveDir: process.cwd(),
      loader: 'tsx',
    },
    bundle: true,
    write: false,
    define: { 'process.env.NODE_ENV': '"production"' },
    alias: {
      '@': resolve('src'),
      react: resolve('node_modules/next/dist/compiled/react'),
      'react-dom/client': resolve(
        'node_modules/next/dist/compiled/react-dom/client',
      ),
      'react-dom': resolve('node_modules/next/dist/compiled/react-dom'),
    },
  });
  source = result.outputFiles[0].text;
});
test.afterAll(() => {
  if (memoryGuard) clearInterval(memoryGuard);
});
async function mount(page: import('@playwright/test').Page) {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.setViewportSize({ width: 390, height: 812 });
  // Fulfilled fictional origin permits the real browser preference store, with
  // no network/backend/account dependency and no substitute preference hook.
  await page.route('https://record-disclosure.fixture.invalid/**', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: `<style>
      body {margin:24px;font:16px/24px system-ui}
      p {margin:0;overflow-wrap:break-word}
      #root > div {display:grid;min-height:44px;grid-template-columns:minmax(0,1fr) 44px;gap:8px;align-items:start}
      button {width:44px;height:44px}
    </style><div id="root"></div>`,
    }),
  );
  await page.goto('https://record-disclosure.fixture.invalid/');
  await page.evaluate(() =>
    localStorage.setItem('it-inventory-reduce-motion', 'false'),
  );
  await page.addScriptTag({ content: source });
  await expect(
    page.getByRole('button', { name: 'Show full description' }),
  ).toBeVisible();
}

test('first overflow measurement never releases the description to its full height', async ({
  page,
}, info) => {
  await mount(page);
  await page.waitForFunction(() => window.recordDescriptionHeights.length >= 5);
  const samples = await page.evaluate(() => window.recordDescriptionHeights);
  await writeFile(
    info.outputPath('initial-description-heights.json'),
    JSON.stringify(samples),
  );
  await page.screenshot({
    path: info.outputPath('initial-description.png'),
    animations: 'allow',
  });
  await info.attach('initial-description-heights', {
    body: JSON.stringify(samples),
    contentType: 'application/json',
  });
  expect(samples.length).toBeGreaterThanOrEqual(5);
  expect(Math.max(...samples)).toBeLessThanOrEqual(73);
  const paragraph = page.locator('#root p');
  expect(await paragraph.textContent()).toBe(
    'Actual description line. '.repeat(100),
  );
  await expect(paragraph).toHaveCount(1);
});

for (const direction of ['expand', 'collapse'] as const) {
  test(`live Reduced motion settles an actually interpolating ${direction} by the next frame`, async ({
    page,
  }, info) => {
    await mount(page);
    const result = await page
      .getByRole('button', { name: 'Show full description' })
      .evaluate(async (button, direction) => {
        const paragraph = document.getElementById(
          button.getAttribute('aria-controls')!,
        )!;
        const viewport = paragraph.parentElement!;
        const closed = viewport.getBoundingClientRect().height;
        const full = paragraph.getBoundingClientRect().height;
        const samples: number[] = [];
        const until = (predicate: (height: number) => boolean) =>
          new Promise<number>((yes, no) => {
            const started = performance.now();
            const sample = () => {
              const height = viewport.getBoundingClientRect().height;
              samples.push(height);
              if (predicate(height)) yes(height);
              else if (performance.now() - started > 3000)
                no(
                  new Error(
                    'No required real height progression was observed.',
                  ),
                );
              else requestAnimationFrame(sample);
            };
            requestAnimationFrame(sample);
          });
        if (direction === 'collapse') {
          button.click();
          await until((height) => Math.abs(height - full) <= 1);
        }
        button.click();
        const middle = await until(
          (height) => height > closed + 1 && height < full - 1,
        );
        // Same target, changed effective preference: duration updates alone do
        // not cancel the installed Motion animation's protected height key.
        localStorage.setItem('it-inventory-reduce-motion', 'true');
        window.dispatchEvent(new Event('it-inventory-motion-change'));
        await new Promise<void>((yes) => requestAnimationFrame(() => yes()));
        const firstFrame = viewport.getBoundingClientRect().height;
        await new Promise<void>((yes) => requestAnimationFrame(() => yes()));
        const secondFrame = viewport.getBoundingClientRect().height;
        return {
          closed,
          full,
          middle,
          firstFrame,
          secondFrame,
          samples,
          sameParagraph: document.getElementById(paragraph.id) === paragraph,
          expanded: button.getAttribute('aria-expanded'),
        };
      }, direction);
    await info.attach('live-reduced-description', {
      body: JSON.stringify({ direction, ...result }, null, 2),
      contentType: 'application/json',
    });
    await writeFile(
      info.outputPath('live-reduced-description.json'),
      JSON.stringify({ direction, ...result }, null, 2),
    );
    await page.screenshot({
      path: info.outputPath('reduced-settled.png'),
      animations: 'allow',
    });
    expect(result.middle).toBeGreaterThan(result.closed + 1);
    expect(result.middle).toBeLessThan(result.full - 1);
    const target = direction === 'expand' ? result.full : result.closed;
    expect(Math.abs(result.firstFrame - target)).toBeLessThanOrEqual(1);
    expect(Math.abs(result.secondFrame - target)).toBeLessThanOrEqual(1);
    expect(result.sameParagraph).toBe(true);
    expect(result.expanded).toBe(direction === 'expand' ? 'true' : 'false');
  });
}
