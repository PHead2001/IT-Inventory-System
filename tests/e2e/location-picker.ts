import { expect, type Locator } from '@playwright/test';

/** Exercise the visible picker, including its search and result controls. */
export async function chooseLocation(
  scope: Locator,
  label: string,
  code: string,
) {
  await scope.getByLabel(label, { exact: true }).click();
  const search = scope.getByRole('combobox', { name: 'Search locations' });
  await expect(search).toBeFocused();
  await search.fill(code);
  const result = scope.getByRole('option').filter({ hasText: code }).first();
  await expect(result).toBeVisible();
  await result.click();
  await expect(scope.getByLabel(label, { exact: true })).toContainText(code);
}
