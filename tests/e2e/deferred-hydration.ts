import type { Page } from '@playwright/test';

/** Permit only the same-origin parser bootstrap so SSR can reach the body.
 * Every other external script remains held, including application hydration.
 * This changes presentation timing only; privacy verification stays withheld. */
export async function holdHydrationScripts(page: Page, documentUrl: string) {
  const bootstrapUrl = new URL('/theme-bootstrap.v1.js', documentUrl).href;
  let release!: () => void;
  const scripts = new Promise<void>((resolve) => {
    release = resolve;
  });
  let heldScripts = 0;
  await page.route('**/*', async (route) => {
    if (
      route.request().resourceType() === 'script' &&
      route.request().url() !== bootstrapUrl
    ) {
      heldScripts += 1;
      await scripts;
    }
    await route.continue();
  });
  return { release, heldScriptCount: () => heldScripts };
}
