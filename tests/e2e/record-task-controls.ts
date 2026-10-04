import { expect, type Page } from '@playwright/test';

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
  // Completion requires a deliberate new transaction, just as ordinary users do.
  const next = task.getByRole('button', {
    name: /^(New transaction|Move more)$/,
  });
  if (await next.isVisible()) await next.click();
  if (await current.isVisible()) return current;
  if (!(await launcher.isVisible())) {
    const section = launcher.locator('xpath=ancestor::details[1]');
    await section.locator('summary').click();
  }
  await launcher.click();
  await expect(current).toBeVisible();
  return current;
}
