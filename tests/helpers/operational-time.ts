import { expect, type Locator } from '@playwright/test';

/** Support copy retains the original instant; ordinary history stays readable. */
export async function expectRecordedInstantCopy(
  disclosure: Locator,
  original: string,
) {
  const page = disclosure.page();
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await expect(disclosure).not.toContainText(original);
  await page.evaluate(() => navigator.clipboard.writeText(''));
  await disclosure
    .getByRole('button', { name: 'Copy technical details', exact: true })
    .click();
  await expect
    .poll(() => page.evaluate(() => navigator.clipboard.readText()))
    .toBe(`Recorded instant: ${original}`);
}

export async function exactOperationalTime(time: Locator) {
  // Client navigation can update the URL before its history rows mount.
  // Resolve the rendered time before deciding which disclosure it uses.
  await expect(time).toBeVisible();
  const summary = time.locator('xpath=parent::summary');
  if (await summary.count()) {
    const disclosure = summary.locator('xpath=parent::details');
    await summary.focus();
    if (
      !(await disclosure.evaluate((node) => (node as HTMLDetailsElement).open))
    )
      await summary.press('Enter');
    await expect(disclosure).toHaveAttribute('open', '');
    const exact = disclosure.locator(':scope > p').first();
    await expect(exact).toBeVisible();
    const original = await time.getAttribute('datetime');
    expect(original).not.toBeNull();
    await expectRecordedInstantCopy(disclosure, original!);
    await expect(time).toHaveAttribute('datetime', original!);
    return exact;
  }
  return time;
}
