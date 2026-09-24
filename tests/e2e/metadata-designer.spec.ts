import { expect, test, type Page } from '@playwright/test';
import fixture from '../fixtures/auth.json' with { type: 'json' };

async function signIn(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Email', { exact: true }).fill(fixture.emails.staff);
  await page.getByLabel('Password', { exact: true }).fill(fixture.password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Inventory workspace' }),
  ).toBeVisible();
}

test('an account switch in another tab masks the old designer on focus', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await signIn(page);
  await page.goto('/settings');
  const designer = page.getByRole('region', { name: 'Forms and fields' });
  await expect(
    designer.getByRole('button', { name: 'Save draft' }),
  ).toBeVisible();
  const other = await page.context().newPage();
  try {
    await other.goto('/settings');
    await other.getByRole('button', { name: 'Sign out' }).click();
    await expect(other.getByLabel('Email', { exact: true })).toBeVisible();
    await other
      .getByLabel('Email', { exact: true })
      .fill(fixture.emails.viewer);
    await other.getByLabel('Password', { exact: true }).fill(fixture.password);
    await other.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(
      other.getByRole('heading', { name: 'Inventory workspace' }),
    ).toBeVisible();
    await page.bringToFront();
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect(
      designer.getByRole('button', { name: 'Save draft' }),
    ).toHaveCount(0);
  } finally {
    await other.close();
  }
});

test('phone and desktop designer saves, publishes, and rejects a stale draft without losing edits', async ({
  page,
  browser,
}) => {
  test.setTimeout(120_000);
  page.setDefaultTimeout(10_000);
  const name = `Designer ${Date.now()}`;
  await signIn(page);
  await page.goto('/settings');
  await page.getByLabel('Display name').fill(name);
  await page.getByRole('button', { name: 'Add category' }).click();
  const designer = page.getByRole('region', { name: 'Forms and fields' });
  await designer
    .getByRole('combobox', { name: 'Category' })
    .first()
    .selectOption({ label: name });
  await page.setViewportSize({ width: 390, height: 844 });
  await designer.getByRole('button', { name: 'Add field' }).click();
  await designer.getByLabel('Label', { exact: true }).fill('Connector family');
  await designer.getByRole('button', { name: 'Add section' }).click();
  await designer.getByLabel('Section heading').last().fill('Specifications');
  await designer.getByRole('button', { name: 'Move down' }).first().focus();
  await page.keyboard.press('Enter');
  await expect(
    designer
      .locator('[data-section-id]')
      .first()
      .locator('[data-control-id] button[aria-label^="Drag"]')
      .first(),
  ).toHaveAttribute('aria-label', 'Drag Category Id');
  await designer.getByRole('button', { name: 'Phone width' }).click();
  await expect(
    designer.getByRole('form', { name: 'Preview quantity metadata' }),
  ).toContainText('Connector family');
  const layout = await page.evaluate(() => ({
    viewport: innerWidth,
    content: document.documentElement.scrollWidth,
  }));
  expect(layout.content).toBeLessThanOrEqual(layout.viewport);
  await designer.getByRole('button', { name: 'Save draft' }).click();
  await expect(designer.getByRole('status')).toContainText('Draft saved');

  const other = await browser.newPage();
  try {
    await signIn(other);
    await other.goto('/settings');
    const second = other.getByRole('region', { name: 'Forms and fields' });
    await second
      .getByRole('combobox', { name: 'Category' })
      .first()
      .selectOption({ label: name });
    other.once('dialog', (dialog) => dialog.accept());
    await second.getByRole('button', { name: 'Discard saved draft' }).click();
    await expect(second.getByRole('status')).toContainText(
      'Saved draft discarded',
    );
    await second.getByRole('button', { name: 'Add field' }).click();
    await second.getByLabel('Label', { exact: true }).fill('Connector type');
    await second.getByRole('button', { name: 'Save draft' }).click();
    await expect(second.getByRole('status')).toContainText('Draft saved');
    await designer
      .getByRole('button', { name: 'Review publish impact' })
      .click();
    await expect(designer.getByRole('status')).toContainText(
      'draft or published revision changed',
    );
    await expect(
      designer.getByRole('region', { name: 'Form publication impact' }),
    ).toHaveCount(0);
    await designer
      .getByLabel('Label', { exact: true })
      .fill('Connector family retained');
    await designer.getByRole('button', { name: 'Save draft' }).click();
    await expect(designer.getByRole('status')).toContainText(
      'draft or published revision changed',
    );
    await expect(designer.getByLabel('Label', { exact: true })).toHaveValue(
      'Connector family retained',
    );
    page.once('dialog', (dialog) => dialog.accept());
    await page.goBack();
    await expect(
      page.getByRole('heading', { name: 'Inventory workspace' }),
    ).toBeVisible();
    await page.goForward();
    await designer
      .getByRole('combobox', { name: 'Category' })
      .first()
      .selectOption({ label: name });
    await expect(
      designer.getByRole('region', { name: 'Recover unsaved form edits' }),
    ).toBeVisible();
    await expect(designer.getByLabel('Label', { exact: true })).toHaveCount(0);
    await designer.getByRole('button', { name: 'Recover edits' }).click();
    await expect(designer.getByLabel('Label', { exact: true })).toHaveValue(
      'Connector family retained',
    );
    page.once('dialog', (dialog) => dialog.accept());
    await designer.getByRole('button', { name: 'Refresh from server' }).click();
    await expect(designer.getByLabel('Label', { exact: true })).toHaveValue(
      'Connector type',
    );
  } finally {
    await other.close();
  }

  await page.setViewportSize({ width: 1280, height: 900 });
  const first = designer.getByRole('button', { name: /^Drag Category Id$/ });
  const secondHandle = designer.getByRole('button', {
    name: /^Drag Name$/,
  });
  const from = await first.boundingBox();
  const to = await secondHandle.boundingBox();
  expect(from).not.toBeNull();
  expect(to).not.toBeNull();
  await page.mouse.move(from!.x + from!.width / 2, from!.y + from!.height / 2);
  await page.mouse.down();
  await page.mouse.move(to!.x + to!.width / 2, to!.y + to!.height / 2, {
    steps: 8,
  });
  await page.mouse.up();
  const handles = designer
    .locator('[data-section-id]')
    .first()
    .locator('[data-control-id] button[aria-label^="Drag"]');
  await expect(handles.nth(0)).toHaveAttribute('aria-label', 'Drag Name');
  await expect(handles.nth(1)).toHaveAttribute(
    'aria-label',
    'Drag Category Id',
  );
  const nameControl = designer
    .locator('[data-control-id]')
    .filter({ has: page.getByRole('button', { name: /^Resize Name$/ }) });
  await expect(nameControl).toHaveCount(1);
  const width = nameControl.getByLabel('Width');
  await width.selectOption('3');
  const handle = designer.getByRole('button', { name: /^Resize Name$/ });
  await handle.scrollIntoViewIfNeeded();
  const box = await handle.boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    box!.x + box!.width / 2 + 300,
    box!.y + box!.height / 2,
    { steps: 8 },
  );
  await page.mouse.up();
  await expect(width).not.toHaveValue('3');
  const resizedWidth = await width.inputValue();
  await designer.getByRole('button', { name: 'Save draft' }).click();
  await expect(designer.getByRole('status')).toContainText('Draft saved');
  await page.reload();
  await designer
    .getByRole('combobox', { name: 'Category' })
    .first()
    .selectOption({ label: name });
  await expect(handles.nth(0)).toHaveAttribute('aria-label', 'Drag Name');
  await expect(handles.nth(1)).toHaveAttribute(
    'aria-label',
    'Drag Category Id',
  );
  await expect(nameControl.getByLabel('Width')).toHaveValue(resizedWidth);
  await designer.getByRole('button', { name: 'Review publish impact' }).click();
  await expect(
    designer.getByRole('region', { name: 'Form publication impact' }),
  ).toContainText('Existing values');
  await designer
    .getByRole('button', { name: 'Publish reviewed revision' })
    .click();
  await expect(designer.getByRole('status')).toContainText(
    'Published form revision',
  );
  await page.goto('/inventory/quantity/new');
  await page
    .getByRole('form', { name: 'Create quantity inventory' })
    .getByLabel('Category')
    .selectOption({ label: name });
  await expect(
    page.getByRole('form', { name: 'Create quantity inventory' }),
  ).toContainText('Connector type');
});
