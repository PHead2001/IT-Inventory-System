import { expect, type Locator } from '@playwright/test';
// The actual native hit surface is measured; trial preserves the current route.
export async function expectTouchTarget(control: Locator) {
  await expect(control).toBeVisible();
  await control.scrollIntoViewIfNeeded();
  await expect
    .poll(async () => {
      const b = await control.boundingBox();
      return !!b && b.width >= 44 && b.height >= 44;
    })
    .toBe(true);
  await control.click({ trial: true });
}
