import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import fixture from '../fixtures/auth.json' with { type: 'json' };
import { captureE2eEvidence } from '../../scripts/e2e-diagnostics';

test.use({ viewport: { width: 1440, height: 900 } });

async function saveRecording(page: Page, name: string) {
  if (!captureE2eEvidence()) {
    await page.close();
    return;
  }
  const video = page.video();
  expect(video).not.toBeNull();
  const directory = resolve('.local-tools/experience-visual/recordings');
  mkdirSync(directory, { recursive: true });
  await page.close();
  await video!.saveAs(join(directory, name + '.webm'));
}

async function signIn(page: Page, role: 'staff' | 'viewer' = 'staff') {
  await page.goto('/login');
  await page.getByLabel('Email', { exact: true }).fill(fixture.emails[role]);
  await page.getByLabel('Password', { exact: true }).fill(fixture.password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Inventory', exact: true }),
  ).toBeVisible();
}

test('records navigation, a held designer drag and resize, and the saved form', async ({
  page,
}) => {
  test.setTimeout(60_000);
  await signIn(page);
  await page
    .getByRole('navigation', { name: 'Main navigation' })
    .getByRole('link', { name: 'Settings' })
    .click();
  await expect(page).toHaveURL(/\/settings$/);
  await page.goto('/settings/categories');
  const category = 'Recording ' + randomUUID().slice(0, 8);
  await page.getByLabel('Display name').fill(category);
  await page.getByRole('button', { name: 'Add category' }).click();
  await expect(page.getByRole('status')).toContainText('Settings saved.');
  await page.goto('/settings/forms');
  await page.getByRole('link', { name: category, exact: true }).click();
  const designer = page.getByRole('region', { name: 'Forms and fields' });
  const controls = designer
    .locator('[data-section-id]')
    .first()
    .locator('[data-control-id]');
  const order = () =>
    controls.evaluateAll((nodes) =>
      nodes.map((node) => node.getAttribute('data-control-id')),
    );
  const before = await order();
  await designer
    .locator('[data-control-id]:has(button[aria-label="Drag Category"])')
    .press('Enter');
  const source = designer.getByRole('button', { name: 'Drag Category' });
  const target = designer.locator(
    '[data-control-id]:has(button[aria-label="Drag Name"])',
  );
  await source.scrollIntoViewIfNeeded();
  const from = await source.boundingBox();
  const to = await target.boundingBox();
  expect(from && to).toBeTruthy();
  await page.mouse.move(from!.x + from!.width / 2, from!.y + from!.height / 2);
  await page.mouse.down();
  try {
    await page.mouse.move(to!.x + to!.width / 2, to!.y + to!.height / 2, {
      steps: 16,
    });
    await expect.poll(order).not.toEqual(before);
  } finally {
    await page.mouse.up();
  }
  const name = designer.locator(
    '[data-control-id]:has(button[aria-label="Resize Name"])',
  );
  await name.press('Enter');
  const width = designer
    .getByTestId('designer-inspector')
    .getByRole('combobox', { name: 'Preferred width', exact: true });
  await width.selectOption('12');
  const handle = name.getByRole('button', { name: 'Resize Name' });
  await handle.scrollIntoViewIfNeeded();
  const box = await handle.boundingBox();
  expect(box).toBeTruthy();
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await page.mouse.down();
  try {
    await page.mouse.move(
      box!.x + box!.width / 2 - 250,
      box!.y + box!.height / 2,
      {
        steps: 12,
      },
    );
    await expect(width).not.toHaveValue('12');
  } finally {
    await page.mouse.up();
  }
  await designer.getByRole('button', { name: 'Save changes' }).click();
  await expect(designer.getByText(/Saved active form revision/)).toBeVisible();
  await saveRecording(page, 'navigation-designer-gesture-save');
});

test('records modeled space selection, manual camera control, and label print preview', async ({
  page,
}) => {
  test.setTimeout(60_000);
  await signIn(page, 'viewer');
  await page
    .getByRole('navigation', { name: 'Main navigation' })
    .getByRole('link', { name: 'Spaces & maps' })
    .click();
  const browser = page.getByRole('navigation', { name: 'Location browser' });
  await browser
    .getByRole('searchbox', { name: 'Browse locations' })
    .fill('ITC-S1A');
  await browser.getByRole('button', { name: /ITC-S1A$/ }).click();
  const viewer = page.getByTestId('room-viewer');
  await expect(viewer).toHaveAttribute('data-selected-code', 'ITC-S1A');
  await expect(viewer).toHaveAttribute('data-focused-code', 'ITC-S1A');
  const toolbar = page.getByRole('toolbar', { name: 'Room camera controls' });
  await toolbar.locator('summary').click();
  const before = await viewer.getAttribute('data-camera-view');
  await toolbar.getByRole('button', { name: 'Pan right' }).click();
  await expect
    .poll(() => viewer.getAttribute('data-camera-view'))
    .not.toBe(before);
  await page.goto('/labels?location=ITC');
  const card = page.locator('.label-card').first();
  await expect(card).toHaveAttribute('data-code-ready', 'true');
  await page
    .getByRole('combobox', { name: 'Label size' })
    .selectOption('90x50');
  await page
    .getByRole('combobox', { name: 'Barcode type' })
    .selectOption('code128');
  await expect(card).toHaveAttribute('data-code-ready', 'true');
  await expect(
    page.getByRole('button', { name: /Print selected labels/ }),
  ).toBeEnabled();
  await saveRecording(page, 'room-camera-label-print-preview');
});
