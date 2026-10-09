import { expect, type Page } from '@playwright/test';

/** Change the preference through Settings while preserving a camera/form in another tab. */
export async function setLocalReducedMotion(page: Page, reduced: boolean) {
  const settings = await page.context().newPage();
  try {
    await settings.goto('/settings');
    const toggle = settings.getByRole('switch', {
      name: 'Reduce motion in this browser',
    });
    if ((await toggle.getAttribute('aria-checked')) !== String(reduced))
      await toggle.click();
    await expect(
      settings.getByRole('switch', {
        name: 'Reduce motion in this browser',
      }),
    ).toHaveAttribute('aria-checked', String(reduced));
  } finally {
    await settings.close();
  }
}
