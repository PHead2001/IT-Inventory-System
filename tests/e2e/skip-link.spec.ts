import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import postcss from 'postcss';
import tailwindcss from '@tailwindcss/postcss';

let stylesheet: string;
test.beforeAll(async () => {
  const source = fileURLToPath(
    new URL('../../src/app/globals.css', import.meta.url),
  );
  // Use the application stylesheet and its existing PostCSS plugin, without a
  // backend or Next build. Compile once for both viewport cases.
  stylesheet = (
    await postcss([tailwindcss()]).process(await readFile(source, 'utf8'), {
      from: source,
    })
  ).css;
});

for (const viewport of [
  { width: 1280, height: 800 },
  { width: 390, height: 844 },
]) {
  test(`skip link preserves cleanup clicks and native keyboard access at ${viewport.width}px`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    // Match CleanupStatus's retained-owner structure before the opaque protected
    // shell. This is a source-CSS geometry fixture, not an Auth runtime substitute.
    await page.setContent(`
      <div class="space-y-5">
        <p role="alert">This workspace’s original account access could not be verified. Retry when that account’s access is restored.</p>
        <button type="button" class="inline-flex min-h-11 items-center px-4 py-2 text-sm font-semibold experience-interactive">Retry privacy cleanup</button>
        <p>Restore this workspace’s original account access and retry. Keep this page open if an outcome is still unknown. You can <a href="/inventory" target="_blank" rel="noopener noreferrer" class="underline">open Inventory in a new tab</a> to use the current account without replacing this page’s recovery.</p>
      </div>
      <div class="experience-app">
        <a href="#main-content" class="experience-skip-link">Skip to content</a>
        <main id="main-content" class="experience-main" tabindex="-1">Workspace</main>
      </div>
      <output aria-live="polite"></output>
    `);
    await page.addStyleTag({ content: stylesheet });
    await page.evaluate(() => {
      document.querySelector('button')!.addEventListener('click', () => {
        document.querySelector('output')!.textContent =
          'Workspace retry requested';
      });
    });

    const retry = page.getByRole('button', {
      name: 'Retry privacy cleanup',
      exact: true,
    });
    const skip = page.getByRole('link', {
      name: 'Skip to content',
      exact: true,
    });
    await expect(skip).not.toBeFocused();
    expect(
      await retry.evaluate((button) => {
        const box = button.getBoundingClientRect();
        return document
          .elementFromPoint(box.x + box.width / 2, box.y + box.height / 2)
          ?.closest('button, a')
          ?.textContent?.trim();
      }),
    ).toBe('Retry privacy cleanup');
    await retry.click();
    await expect(
      page.getByText('Workspace retry requested', { exact: true }),
    ).toBeVisible();
    expect(
      await skip.evaluate((link) => {
        const box = link.getBoundingClientRect();
        return (
          document.elementFromPoint(
            box.x + box.width / 2,
            box.y + box.height / 2,
          ) === link
        );
      }),
    ).toBe(false);

    await page.keyboard.press('Tab');
    await expect(
      page.getByRole('link', { name: 'open Inventory in a new tab' }),
    ).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(skip).toBeFocused();
    expect(
      await skip.evaluate((link) => {
        const box = link.getBoundingClientRect();
        return (
          document.elementFromPoint(
            box.x + box.width / 2,
            box.y + box.height / 2,
          ) === link
        );
      }),
    ).toBe(true);
    await page.keyboard.press('Enter');
    await expect(page.getByRole('main')).toBeFocused();
  });
}
