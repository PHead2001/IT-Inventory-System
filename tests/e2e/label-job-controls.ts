import { expect, type Page } from '@playwright/test';

// Identity and lifecycle journeys own their job media; shared-default
// inheritance and Code 128 fallback acceptance have separate coverage.
export async function useStandardQrLabelJob(page: Page) {
  for (const [name, value] of [
    ['Label size', '90x50'],
    ['Paper size', 'letter'],
    ['Barcode type', 'qr'],
  ]) {
    const control = page.getByRole('combobox', { name, exact: true });
    await control.selectOption(value);
    await expect(control).toHaveValue(value);
  }
}
