import { expect, type Page } from '@playwright/test';

/** Check browser identity and every retained head node for private values. */
export async function expectPrivateTitleExcluded(
  page: Page,
  privateValue: string,
) {
  await expect.poll(() => page.title()).not.toContain(privateValue);
  await expect
    .poll(async () =>
      (await page.locator('head title').allTextContents()).join('\n'),
    )
    .not.toContain(privateValue);
}
