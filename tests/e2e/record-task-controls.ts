import { expect, type Page } from '@playwright/test';

/** A test must deliberately finish its retained receipt before new intent. */
export async function beginNewRecordTransaction(
  page: Page,
  action: 'New transaction' | 'Move more',
) {
  const task = page.getByRole('region', { name: 'Record tasks' });
  await expect(
    task.getByText(/^Completed transaction retained\./),
  ).toBeVisible();
  await expect(
    task.getByRole('button', { name: 'Close task', exact: true }),
  ).toBeDisabled();
  const next = task.getByRole('button', { name: action, exact: true });
  await expect(next).toBeEnabled();
  await next.click();
  await expect(task.getByText(/^Completed transaction retained\./)).toHaveCount(
    0,
  );
}

/** A resting pointer at the receipt's bottom edge must not move its hitbox. */
export async function expectStableReceiptAction(
  page: Page,
  action: 'New transaction' | 'Move more',
) {
  const task = page.getByRole('region', { name: 'Record tasks' });
  const retained = task.getByText(/^Completed transaction retained\./);
  await expect(retained).toBeVisible();
  const receipt = await retained.innerText();
  const next = task.getByRole('button', { name: action, exact: true });
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
  await expect(retained).toHaveText(receipt);
  await expect(
    task.getByRole('button', { name: 'Close task', exact: true }),
  ).toBeDisabled();
}

/** Open a task through its ordinary launcher; forms mount only on demand. */
export async function openRecordTask(page: Page, formName: string) {
  const task = page.getByRole('region', { name: 'Record tasks' });
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
  if (!(await launcher.isVisible())) {
    const section = launcher.locator('xpath=ancestor::details[1]');
    await section.locator('summary').click();
  }
  await launcher.click();
  await expect(current).toBeVisible();
  return current;
}
