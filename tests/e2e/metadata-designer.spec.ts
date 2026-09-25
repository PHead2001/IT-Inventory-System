import { expect, test, type Page } from '@playwright/test';
import fixture from '../fixtures/auth.json' with { type: 'json' };
import { chooseLocation } from './location-picker';

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
}, testInfo) => {
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
  const firstControl = designer
    .locator('[data-section-id]')
    .first()
    .locator('[data-control-id]')
    .first();
  const touchTargets = [
    firstControl.getByRole('button', { name: /^Drag Category Id$/ }),
    firstControl.getByRole('button', { name: /^Resize Category Id$/ }),
    firstControl.getByRole('button', { name: 'Move down' }),
  ];
  for (const target of touchTargets) {
    const box = await target.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.height).toBeGreaterThanOrEqual(44);
  }
  expect((await touchTargets[0].boundingBox())!.width).toBeGreaterThanOrEqual(
    44,
  );
  await designer.getByRole('button', { name: 'Phone width' }).click();
  const preview = designer.getByRole('form', {
    name: 'Preview quantity metadata',
  });
  await expect(preview).toContainText('Connector family');
  await designer.getByLabel('New field type').selectOption('boolean');
  for (const name of ['Flag one', 'Flag two', 'Flag three']) {
    await designer.getByRole('button', { name: 'Add field' }).click();
    await designer.getByLabel('Label', { exact: true }).last().fill(name);
    await designer
      .locator('[data-control-id]')
      .filter({ has: page.getByRole('button', { name: `Drag ${name}` }) })
      .getByLabel('Section')
      .selectOption({ label: 'Specifications' });
  }
  const checks = ['Flag one', 'Flag two', 'Flag three'].map((name) =>
    preview.getByRole('checkbox', { name }),
  );
  const checkBoxes = await Promise.all(
    checks.map((check) => check.boundingBox()),
  );
  for (const box of checkBoxes) expect(box).not.toBeNull();
  expect(checkBoxes[0]!.y).toBeCloseTo(checkBoxes[1]!.y, 0);
  expect(checkBoxes[1]!.y).toBeCloseTo(checkBoxes[2]!.y, 0);
  expect(checkBoxes[0]!.x).toBeLessThan(checkBoxes[1]!.x);
  expect(checkBoxes[1]!.x).toBeLessThan(checkBoxes[2]!.x);
  for (const box of checkBoxes) expect(box!.height).toBeGreaterThanOrEqual(44);
  await expect(checks[0]).toHaveAttribute('aria-checked', 'mixed');
  await checks[0].check();
  await checks[0].uncheck();
  await expect(checks[0]).toHaveAttribute('aria-checked', 'false');
  await preview.getByRole('button', { name: 'Unset' }).first().click();
  await expect(checks[0]).toHaveAttribute('aria-checked', 'mixed');
  const longLabel = 'LongFieldLabel'.repeat(12);
  const longHelp = 'LongHelpText'.repeat(25);
  await designer.getByLabel('New field type').selectOption('short_text');
  await designer.getByRole('button', { name: 'Add field' }).click();
  const longField = designer.locator('[data-testid^="field-"]').last();
  await longField.getByLabel('Label', { exact: true }).fill(longLabel);
  await longField.getByLabel('Help text').fill(longHelp);
  const previewLabel = preview.getByText(longLabel, { exact: true });
  const previewHelp = preview.getByText(longHelp, { exact: true });
  await expect(previewLabel).toBeVisible();
  await expect(previewHelp).toBeVisible();
  for (const [name, text] of [
    ['label', previewLabel],
    ['help', previewHelp],
  ] as const) {
    const fit = await text.evaluate((element) => {
      const parent = element.parentElement!;
      return {
        scroll: parent.scrollWidth,
        client: parent.clientWidth,
        right: parent.getBoundingClientRect().right,
        viewport: innerWidth,
      };
    });
    expect(fit.scroll, `${name} parent scroll width`).toBeLessThanOrEqual(
      fit.client + 1,
    );
    expect(fit.right, `${name} parent right edge`).toBeLessThanOrEqual(
      fit.viewport,
    );
  }
  await longField.getByRole('checkbox', { name: 'Quantity' }).uncheck();
  await longField.getByRole('checkbox', { name: 'Asset' }).uncheck();
  const issue = designer.getByRole('alert');
  await expect(issue).toContainText(
    `${longLabel} needs inventory applicability`,
  );
  const issueFits = await issue.evaluate(
    (element) => element.scrollWidth <= element.clientWidth + 1,
  );
  expect(issueFits).toBe(true);
  await longField.getByRole('checkbox', { name: 'Quantity' }).check();
  await longField.getByRole('checkbox', { name: 'Asset' }).check();
  const layout = await page.evaluate(() => ({
    viewport: innerWidth,
    content: document.documentElement.scrollWidth,
  }));
  expect(layout.content).toBeLessThanOrEqual(layout.viewport);
  await testInfo.attach('designer-phone', {
    body: await preview.screenshot(),
    contentType: 'image/png',
  });
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
      .first()
      .fill('Connector family retained');
    await designer.getByRole('button', { name: 'Save draft' }).click();
    await expect(designer.getByRole('status')).toContainText(
      'draft or published revision changed',
    );
    await expect(
      designer.getByLabel('Label', { exact: true }).first(),
    ).toHaveValue('Connector family retained');
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
    await expect(
      designer.getByLabel('Label', { exact: true }).first(),
    ).toHaveValue('Connector family retained');
    page.once('dialog', (dialog) => dialog.accept());
    await designer.getByRole('button', { name: 'Refresh from server' }).click();
    await expect(
      designer.getByLabel('Label', { exact: true }).first(),
    ).toHaveValue('Connector type');
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
  await testInfo.attach('designer-desktop-published', {
    body: await designer
      .getByRole('form', { name: 'Preview quantity metadata' })
      .screenshot(),
    contentType: 'image/png',
  });
  await page.goto('/inventory/quantity/new');
  const create = page.getByRole('form', { name: 'Create quantity inventory' });
  await create.getByLabel('Category').selectOption({ label: name });
  await expect(create.getByLabel('Connector type')).toBeVisible();
  await create
    .getByLabel('Name', { exact: true })
    .fill(`Designer item ${name}`);
  await create.getByLabel('Connector type').fill('USB-C');
  await create.getByRole('button', { name: 'Review metadata' }).click();
  await expect(
    create.getByRole('region', { name: 'Metadata review' }),
  ).toBeVisible();
  await expect(create.getByLabel('Connector type')).toHaveValue('USB-C');
  await create.getByRole('button', { name: 'Confirm save' }).click();
  await expect(page).toHaveURL(/\/inventory\/quantity\/[0-9a-f-]+$/);
  await expect(page.getByText('USB-C', { exact: true })).toBeVisible();
  const detailUrl = page.url();
  const edit = page.getByRole('form', { name: 'Edit quantity metadata' });
  await edit.getByLabel('Connector type').fill('USB-A');
  await edit.getByRole('button', { name: 'Review metadata' }).click();
  await edit.getByRole('button', { name: 'Confirm save' }).click();
  await expect(page.getByText('USB-A', { exact: true })).toBeVisible();
  await page.goto(detailUrl);
  await expect(page.getByText('USB-A', { exact: true })).toBeVisible();
  await page.goto('/inventory/assets/new');
  const createAsset = page.getByRole('form', {
    name: 'Create asset inventory',
  });
  await createAsset.getByLabel('Category').selectOption({ label: name });
  await expect(createAsset.getByLabel('Connector type')).toBeVisible();
  await createAsset
    .getByLabel('Name', { exact: true })
    .fill(`Designer asset ${name}`);
  await createAsset.getByLabel('Asset tag').fill(`D-${Date.now()}`);
  await chooseLocation(createAsset, 'Current location', 'ITC-RACK');
  await createAsset.getByLabel('Connector type').fill('DisplayPort');
  await createAsset.getByRole('button', { name: 'Review metadata' }).click();
  await createAsset.getByRole('button', { name: 'Confirm save' }).click();
  await expect(page).toHaveURL(/\/inventory\/assets\/[0-9a-f-]+$/);
  await expect(page.getByText('DisplayPort', { exact: true })).toBeVisible();
  const assetUrl = page.url();
  const editAsset = page.getByRole('form', { name: 'Edit asset metadata' });
  await editAsset.getByLabel('Connector type').fill('HDMI');
  await editAsset.getByRole('button', { name: 'Review metadata' }).click();
  await editAsset.getByRole('button', { name: 'Confirm save' }).click();
  await expect(page.getByText('HDMI', { exact: true })).toBeVisible();
  await page.goto(assetUrl);
  await expect(page.getByText('HDMI', { exact: true })).toBeVisible();
  await testInfo.attach('live-asset-edited', {
    body: await page.screenshot({ fullPage: true }),
    contentType: 'image/png',
  });
});
