import { expect, type Page } from '@playwright/test';

export async function expectCategoryAdded(page: Page, name: string) {
  const message = `Category added: ${name}.`;
  // The committed receipt can coexist with the real router-refresh announcer.
  await expect(
    page.getByRole('status').filter({ hasText: message }),
  ).toHaveText(message);
  // Do not hide a stuck refresh by navigating away immediately after receipt.
  await expect(
    page
      .getByRole('list', { name: 'Categories', exact: true })
      .getByText(name, { exact: true }),
  ).toBeVisible();
  await expect(page.locator('.experience-route-progress')).toHaveAttribute(
    'data-visible',
    'false',
  );
}
