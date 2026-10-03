import { expect, type Page } from '@playwright/test';

/** Change the preference through Settings while preserving a camera/form in another tab. */
export async function setLocalReducedMotion(page: Page, reduced: boolean) {
  const settings = await page.context().newPage();
  try {
    await settings.goto('/settings');
    const toggle = settings.getByRole('button', {
      name: reduced ? 'Reduce motion locally' : 'Use system motion setting',
    });
    await toggle.click();
    await expect(
      settings.getByRole('button', {
        name: reduced ? 'Use system motion setting' : 'Reduce motion locally',
      }),
    ).toHaveAttribute('aria-pressed', String(reduced));
  } finally {
    await settings.close();
  }
}
