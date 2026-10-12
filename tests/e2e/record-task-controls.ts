import { expect, type Page } from '@playwright/test';

/** Verify the visible lifecycle state independently of technical record data. */
export async function expectRecordStatus(
  page: Page,
  status: 'active' | 'archived' | 'retired',
) {
  const indicator = page.locator(
    `.experience-record-status[data-state="${status}"]`,
  );
  await expect(indicator).toBeVisible();
  await expect(indicator).toHaveText(
    status.charAt(0).toUpperCase() + status.slice(1),
  );
}

/** Inspect the current version through the same disclosure available to users. */
export async function expectRecordVersion(page: Page, version: number) {
  const details = page.locator('details').filter({
    has: page.getByText('Technical record details', { exact: true }),
  });
  const summary = details.locator('summary');
  await expect(summary).toBeVisible();
  if ((await details.getAttribute('open')) === null) await summary.click();
  await expect(
    details.getByText(`Record version: ${version}`, { exact: true }),
  ).toBeVisible();
}

/** Finish a committed operation before starting another transaction. */
export async function beginNewRecordTransaction(
  page: Page,
  action: 'New transaction' | 'Move more',
) {
  const task = page.getByRole('region', { name: 'Record tasks' });
  await expect(
    task.getByRole('button', { name: 'Close task', exact: true }),
  ).toBeEnabled();
  const next = task.getByRole('button', {
    name: action === 'New transaction' ? 'Done' : action,
    exact: true,
  });
  await expect(next).toBeEnabled();
  await next.click();
  await expect(next).toHaveCount(0);
}

/** A resting pointer at the receipt's bottom edge must not move its hitbox. */
export async function expectStableReceiptAction(
  page: Page,
  action: 'New transaction' | 'Move more',
) {
  const task = page.getByRole('region', { name: 'Record tasks' });
  const receipt = task
    .getByRole('status')
    .filter({ hasText: /move completed\./ });
  const receiptText = await receipt.textContent();
  const next = task.getByRole('button', {
    name: action === 'New transaction' ? 'Done' : action,
    exact: true,
  });
  await expect(next).toBeEnabled();
  await page.mouse.move(0, 0);
  await next.scrollIntoViewIfNeeded();
  const neutral = await next.boundingBox();
  expect(neutral).not.toBeNull();
  await page.mouse.move(
    neutral!.x + neutral!.width / 2,
    neutral!.y + neutral!.height - 0.02,
  );
  const samples = await next.evaluate(async (element) => {
    const frames = [];
    for (let frame = 0; frame < 20; frame++) {
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => resolve()),
      );
      const rect = element.getBoundingClientRect();
      frames.push({
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
        hovered: element.matches(':hover'),
      });
    }
    return frames;
  });
  for (const frame of samples) {
    expect(frame.hovered).toBe(true);
    for (const key of ['x', 'y', 'width', 'height'] as const)
      expect(Math.abs(frame[key] - neutral![key])).toBeLessThan(0.001);
  }
  await expect(receipt).toHaveText(receiptText!);
  await expect(
    task.getByRole('button', { name: 'Close task', exact: true }),
  ).toBeEnabled();
}

/** Open a task through its ordinary launcher; forms mount only on demand. */
export async function openRecordTask(page: Page, formName: string) {
  const task = page.getByRole('region', {
    name: 'Record tasks',
    includeHidden: true,
  });
  const labels: Record<string, string> = {
    'Edit quantity metadata': 'Edit details',
    'Edit asset metadata': 'Edit details',
    'Archive quantity definition and clear stock':
      'Archive quantity item and clear stock',
    'Restore quantity definition': 'Restore quantity item',
    'Restore asset': 'Restore individual asset',
  };
  const launcher = task.getByRole('button', {
    name: labels[formName] ?? formName,
    exact: true,
    includeHidden: true,
  });
  const formLabels: Record<string, string> = {
    'Archive quantity definition and clear stock':
      'Archive quantity item and clear stock',
    'Restore quantity definition': 'Restore quantity item',
  };
  const current = page.getByRole('form', {
    name: formLabels[formName] ?? formName,
    exact: true,
  });
  if (await current.isVisible()) return current;
  // Privacy readiness can defer attachment or hide the whole workspace. Neither
  // implies a closed task group; primary launchers have no details ancestor.
  await launcher.waitFor({ state: 'attached' });
  const section = launcher.locator('xpath=ancestor::details[1]');
  if (
    (await section.count()) > 0 &&
    (await section.getAttribute('open')) === null
  ) {
    await section.locator('summary').click();
  }
  await launcher.click();
  await expect(current).toBeVisible();
  return current;
}
