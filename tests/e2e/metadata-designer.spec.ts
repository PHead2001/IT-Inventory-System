import { openRecordTask } from './record-task-controls';
import { metadataReviewButton, metadataSaveButton } from './metadata-controls';
import { randomUUID } from 'node:crypto';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import fixture from '../fixtures/auth.json' with { type: 'json' };
import { chooseLocation } from './location-picker';
import type { MetadataDefinition } from '../../src/features/metadata/contracts';

async function signIn(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Email', { exact: true }).fill(fixture.emails.staff);
  await page.getByLabel('Password', { exact: true }).fill(fixture.password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Inventory', exact: true }),
  ).toBeVisible();
}

async function chooseDesigner(page: Page, name: string) {
  await page.goto('/settings/forms');
  await page.getByRole('link', { name, exact: true }).click();
  const designer = page.getByRole('region', { name: 'Forms and fields' });
  await expect(
    designer.getByRole('button', { name: 'Save changes' }),
  ).toBeVisible();
  return designer;
}

function inspectorFor(control: Locator) {
  return control
    .locator('xpath=ancestor::*[@data-testid="designer-panes"]')
    .getByTestId('designer-inspector');
}

async function inspectControl(control: Locator) {
  const designer = control.locator(
    'xpath=ancestor::section[@aria-labelledby="metadata-settings-heading"]',
  );
  const canvas = designer.getByRole('button', { name: 'Canvas', exact: true });
  if (await canvas.isVisible()) await canvas.click();
  await control.press('Enter');
  const tab = designer.getByRole('button', { name: 'Inspector', exact: true });
  if (await tab.isVisible()) await tab.click();
  await expect(
    inspectorFor(control).getByRole('combobox', {
      name: 'Preferred width',
      exact: true,
    }),
  ).toBeVisible();
}

async function chooseControlSection(control: Locator, name: string) {
  const section = inspectorFor(control).getByLabel('Section');
  const option = section.locator('option').filter({ hasText: name });
  await expect(option).toHaveCount(1);
  const id = await option.getAttribute('value');
  expect(id).toBeTruthy();
  await section.selectOption(id!);
}

test('an account switch in another tab masks the old designer on focus', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await signIn(page);
  await page.goto('/settings/forms');
  await page.locator('main a[href^="/settings/forms/"]').first().click();
  const designer = page.getByRole('region', { name: 'Forms and fields' });
  await expect(
    designer.getByRole('button', { name: 'Save changes' }),
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
      other.getByRole('heading', { name: 'Inventory', exact: true }),
    ).toBeVisible();
    await page.bringToFront();
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect(
      designer.getByRole('button', { name: 'Save changes' }),
    ).toHaveCount(0);
  } finally {
    await other.close();
  }
});

test('phone designer edits publish with one save and render in quantity and asset forms', async ({
  page,
}, testInfo) => {
  test.setTimeout(120_000);
  const category = `Designer ${Date.now()}`;
  await signIn(page);
  await page.goto('/settings/categories');
  await page.getByLabel('Display name').fill(category);
  await page.getByRole('button', { name: 'Add category' }).click();
  await expect(page.getByRole('status')).toContainText('Category added.');
  const designer = await chooseDesigner(page, category);
  await page.setViewportSize({ width: 390, height: 844 });
  const panels = designer.getByRole('navigation', { name: 'Designer panels' });
  await panels.getByRole('button', { name: 'Library' }).click();
  await designer
    .getByRole('button', { name: 'Add field', exact: true })
    .click();
  const addition = designer.getByRole('dialog', { name: 'Add field' });
  await addition.getByLabel('Field name').fill('Connector type');
  await addition.getByRole('button', { name: 'Add to form' }).click();
  await expect(panels.getByRole('button', { name: 'Inspector' })).toBeVisible();
  await designer
    .getByLabel('Field name', { exact: true })
    .fill('Connector type');
  await panels.getByRole('button', { name: 'Canvas' }).click();
  await designer.getByLabel('Section heading').first().focus();
  await panels.getByRole('button', { name: 'Inspector' }).click();
  await expect(
    designer
      .getByTestId('designer-inspector')
      .getByLabel('Field name', { exact: true }),
  ).toHaveCount(0);
  await expect(designer.getByTestId('designer-inspector')).toContainText(
    'Section Details',
  );
  await panels.getByRole('button', { name: 'Canvas' }).click();
  const connectorControl = designer.locator(
    '[data-control-id]:has(button[aria-label="Drag Connector type"])',
  );
  await connectorControl.press('Enter');
  await expect(
    designer
      .getByTestId('designer-inspector')
      .getByRole('heading', { name: 'Inspector', exact: true }),
  ).toBeFocused();
  await panels.getByRole('button', { name: 'Canvas', exact: true }).click();
  await expect(
    designer.getByRole('button', { name: 'Drag Connector type' }),
  ).toBeVisible();
  await designer.getByRole('button', { name: 'Add section' }).click();
  await designer.getByLabel('Section heading').last().fill('Specifications');
  await inspectControl(connectorControl);
  await chooseControlSection(connectorControl, 'Specifications');
  await designer
    .getByText('Try form · quantity items or individual assets')
    .click();
  const preview = designer.getByRole('form', {
    name: 'Preview quantity metadata',
  });
  await expect(preview.getByLabel('Connector type')).toBeVisible();
  const layout = await page.evaluate(() => ({
    viewport: innerWidth,
    content: document.documentElement.scrollWidth,
  }));
  expect(layout.content).toBeLessThanOrEqual(layout.viewport);
  await testInfo.attach('designer-phone', {
    body: await preview.screenshot(),
    contentType: 'image/png',
  });
  await designer.getByRole('button', { name: 'Save changes' }).click();
  await expect(designer.getByText(/Saved active form revision/)).toBeVisible();

  await page.goto('/inventory/quantity/new');
  const create = page.getByRole('form', { name: 'Add quantity item' });
  await create.getByLabel('Category').selectOption({ label: category });
  await expect(create.getByLabel('Connector type')).toBeVisible();
  await create
    .getByLabel('Name', { exact: true })
    .fill(`Designer item ${category}`);
  await create.getByLabel('Connector type').fill('USB-C');
  await metadataReviewButton(create).click();
  await metadataSaveButton(create).click();
  await expect(page).toHaveURL(/\/inventory\/quantity\/[0-9a-f-]+$/);
  await expect(page.getByText('USB-C', { exact: true })).toBeVisible();
  const quantityUrl = page.url();
  const edit = await openRecordTask(page, 'Edit quantity metadata');
  await edit.getByLabel('Connector type').fill('USB-A');
  await metadataReviewButton(edit).click();
  await metadataSaveButton(edit).click();
  await expect(
    edit.getByRole('status').filter({ hasText: /^Details saved\.$/ }),
  ).toBeVisible();
  await edit.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(page.getByText('USB-A', { exact: true })).toBeVisible();
  await page.goto(quantityUrl);
  await expect(page.getByText('USB-A', { exact: true })).toBeVisible();

  await page.goto('/inventory/assets/new');
  const createAsset = page.getByRole('form', {
    name: 'Add individual asset',
  });
  await createAsset.getByLabel('Category').selectOption({ label: category });
  await expect(createAsset.getByLabel('Connector type')).toBeVisible();
  await createAsset
    .getByLabel('Name', { exact: true })
    .fill(`Designer asset ${category}`);
  await createAsset.getByLabel('Asset tag').fill(`D-${Date.now()}`);
  await chooseLocation(createAsset, 'Current location', 'ITC-RACK');
  await createAsset.getByLabel('Connector type').fill('DisplayPort');
  await metadataReviewButton(createAsset).click();
  await metadataSaveButton(createAsset).click();
  await expect(page).toHaveURL(/\/inventory\/assets\/[0-9a-f-]+$/);
  await expect(page.getByText('DisplayPort', { exact: true })).toBeVisible();
  const assetUrl = page.url();
  const editAsset = await openRecordTask(page, 'Edit asset metadata');
  await editAsset.getByLabel('Connector type').fill('HDMI');
  await metadataReviewButton(editAsset).click();
  await metadataSaveButton(editAsset).click();
  await expect(
    editAsset.getByRole('status').filter({ hasText: /^Details saved\.$/ }),
  ).toBeVisible();
  await editAsset.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(page.getByText('HDMI', { exact: true })).toBeVisible();
  await page.goto(assetUrl);
  await expect(page.getByText('HDMI', { exact: true })).toBeVisible();
});

for (const { width, height } of [
  { width: 1180, height: 757 },
  { width: 1050, height: 757 },
  { width: 390, height: 757 },
  { width: 1180, height: 300 },
]) {
  test(`late nested field settings remain reachable with real pointer and keyboard input at ${width}x${height}`, async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await signIn(page);
    const category = `Inspector ${randomUUID().slice(0, 8)}`;
    await page.goto('/settings/categories');
    await page.getByLabel('Display name').fill(category);
    await page.getByRole('button', { name: 'Add category' }).click();
    await expect(page.getByRole('status')).toContainText('Category added.');
    const designer = await chooseDesigner(page, category);
    await designer
      .getByRole('button', { name: 'Recovery & advanced', exact: true })
      .click();
    await designer.getByText('Advanced JSON recovery', { exact: true }).click();
    await designer
      .getByRole('button', { name: 'Load current document JSON' })
      .click();
    const json = designer.getByLabel('Form definition JSON');
    const definition = JSON.parse(
      await json.inputValue(),
    ) as MetadataDefinition;
    for (let index = 0; index < 14; index++) {
      const fieldId = randomUUID();
      definition.fields.push({
        id: fieldId,
        type: 'short_text',
        label: `Earlier field ${index}`,
        applies_to: ['quantity', 'asset'],
        required: false,
        rules: {},
        options: [],
      });
      definition.layout.push({
        id: randomUUID(),
        label: `Earlier section ${index}`,
        controls: [
          { id: randomUUID(), kind: 'field', field_id: fieldId, width: 12 },
        ],
      });
    }
    const fieldId = randomUUID();
    const controlId = randomUUID();
    const options: MetadataDefinition['fields'][number]['options'] = [];
    for (let index = 0; index < 40; index++) {
      const parent = randomUUID();
      options.push({
        id: parent,
        parent_id: null,
        label: `Long parent choice ${index}`,
        active: true,
      });
      options.push({
        id: randomUUID(),
        parent_id: parent,
        label: `Nested child choice ${index}`,
        active: true,
      });
    }
    const label = 'Late nested inspector field';
    definition.fields.push({
      id: fieldId,
      type: 'hierarchical_select',
      label,
      applies_to: ['quantity', 'asset'],
      required: false,
      rules: {},
      options,
    });
    definition.layout.push({
      id: randomUUID(),
      label: 'Late section',
      controls: [
        { id: controlId, kind: 'field', field_id: fieldId, width: 12 },
      ],
    });
    await json.fill(JSON.stringify(definition));
    await designer
      .getByRole('button', { name: 'Apply JSON to visual editor' })
      .click();
    await page.setViewportSize({ width, height });
    const panels = designer.getByRole('navigation', {
      name: 'Designer panels',
    });
    if (width < 1152)
      await panels
        .getByRole('button', { name: 'Library', exact: true })
        .click();
    await designer
      .getByTestId('designer-library')
      .getByRole('button', { name: new RegExp(`^${label} ·`) })
      .click();
    const inspector = designer.getByTestId('designer-inspector');
    const control = designer.locator(`[data-control-id="${controlId}"]`);
    await expect(
      inspector.getByLabel('Field name', { exact: true }),
    ).toBeInViewport();
    const flow = height === 300;
    if (width >= 1152 && !flow) await expect(control).toBeFocused();
    else
      await expect(
        inspector.getByRole('heading', { name: 'Inspector', exact: true }),
      ).toBeFocused();
    await expect
      .poll(() => inspector.evaluate((node) => node.scrollTop))
      .toBe(0);
    const geometry = await inspector.evaluate((node) => {
      const bounds = node.getBoundingClientRect();
      const toolbar = document.querySelector(
        '[role="toolbar"][aria-label="Form designer"]',
      )!;
      return {
        width: bounds.width,
        canvasWidth: node
          .closest('[data-testid="designer-panes"]')!
          .querySelector('[data-testid="designer-canvas"]')!
          .getBoundingClientRect().width,
        top: bounds.top,
        bottom: bounds.bottom,
        height: bounds.height,
        toolbarBottom:
          getComputedStyle(toolbar).position === 'sticky'
            ? toolbar.getBoundingClientRect().bottom
            : 0,
        scroll: node.scrollHeight,
        viewport: innerHeight,
      };
    });
    if (width >= 1152) expect(geometry.width).toBeGreaterThanOrEqual(288);
    if (width === 1180)
      expect(geometry.canvasWidth).toBeGreaterThanOrEqual(400);
    expect(geometry.top).toBeGreaterThanOrEqual(geometry.toolbarBottom);
    if (!flow)
      expect(geometry.bottom).toBeLessThanOrEqual(geometry.viewport + 1);
    if (!flow) expect(geometry.scroll).toBeGreaterThan(geometry.height);
    else expect(geometry.height).toBeGreaterThan(geometry.viewport);
    if (flow) {
      await expect(designer.getByTestId('designer-panes')).toHaveAttribute(
        'data-designer-flow',
        'true',
      );
      expect(
        await designer
          .getByRole('toolbar', { name: 'Form designer' })
          .evaluate((node) => getComputedStyle(node).position),
      ).toBe('static');
      expect(
        await inspector.evaluate((node) => getComputedStyle(node).maxHeight),
      ).toBe('none');
    }
    await inspector
      .getByLabel('Field name', { exact: true })
      .fill('Unsaved nested field');
    await inspector
      .getByRole('button', { name: 'Choices', exact: true })
      .click();
    await expect(
      inspector.getByRole('heading', { name: 'Choices', exact: true }),
    ).toBeInViewport();
    const pageY = await page.evaluate(() => scrollY);
    const bounds = (await inspector.boundingBox())!;
    await page.mouse.move(
      bounds.x + bounds.width / 2,
      Math.max(32, Math.min(bounds.y + bounds.height / 2, height - 32)),
    );
    await page.mouse.wheel(0, 500);
    if (flow) {
      await expect
        .poll(() => page.evaluate(() => scrollY))
        .toBeGreaterThan(pageY);
      expect(await inspector.evaluate((node) => node.scrollTop)).toBe(0);
    } else {
      await expect
        .poll(() => inspector.evaluate((node) => node.scrollTop))
        .toBeGreaterThan(100);
      expect(await page.evaluate(() => scrollY)).toBe(pageY);
    }
    await inspector
      .getByRole('button', { name: 'Layout', exact: true })
      .click();
    await expect(
      inspector.getByRole('combobox', { name: 'Preferred width', exact: true }),
    ).toBeInViewport();
    await expect(
      inspector.getByRole('region', { name: 'Appearance' }),
    ).toBeFocused();
    await inspector
      .getByRole('button', { name: 'Basics', exact: true })
      .focus();
    await page.keyboard.press('Shift+Tab');
    expect(
      await inspector.evaluate((node) => node.contains(document.activeElement)),
    ).toBe(false);
    if (width < 1152)
      await panels.getByRole('button', { name: 'Canvas', exact: true }).click();
    await control.press('Enter');
    await expect(control).toHaveAttribute('data-selected', 'true');
    await expect(
      inspector.getByLabel('Field name', { exact: true }),
    ).toHaveValue('Unsaved nested field');
    await expect
      .poll(() => inspector.evaluate((node) => node.scrollTop))
      .toBe(0);
    await expect(
      designer.getByRole('status', { name: 'Form save state' }),
    ).toContainText('Unsaved changes');
    if (width < 1152 || flow)
      await expect(
        inspector.getByRole('heading', { name: 'Inspector', exact: true }),
      ).toBeFocused();
    if (flow) {
      await page.setViewportSize({ width, height: 757 });
      await expect(designer.getByTestId('designer-panes')).not.toHaveAttribute(
        'data-designer-flow',
      );
      await control.press('Enter');
      await expect(control).toBeFocused();
      await expect(
        inspector.getByLabel('Field name', { exact: true }),
      ).toHaveValue('Unsaved nested field');
      expect(
        await inspector.evaluate((node) => getComputedStyle(node).maxHeight),
      ).not.toBe('none');
    }
  });
}

test('phone designer preserves touch targets, inline boolean state, and long-text validation', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await signIn(page);
  await page.goto('/settings/forms');
  await page.getByRole('link', { name: 'Cables', exact: true }).click();
  const designer = page.getByRole('region', { name: 'Forms and fields' });
  await expect(
    designer.getByRole('button', { name: 'Save changes' }),
  ).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  const panels = designer.getByRole('navigation', { name: 'Designer panels' });
  await panels.getByRole('button', { name: 'Canvas' }).click();
  const nameControl = designer.locator(
    '[data-control-id]:has(button[aria-label="Drag Name"])',
  );
  await nameControl.press('Enter');
  await expect(
    inspectorFor(nameControl).getByRole('heading', {
      name: 'Inspector',
      exact: true,
    }),
  ).toBeFocused();
  // Selecting opens settings on a phone; gesture handles belong to Canvas.
  await panels.getByRole('button', { name: 'Canvas', exact: true }).click();
  await expect(nameControl).toHaveAttribute('data-selected', 'true');
  for (const control of [
    nameControl.getByRole('button', { name: 'Drag Name' }),
    nameControl.getByRole('button', { name: 'Resize Name' }),
  ]) {
    const bounds = await control.boundingBox();
    expect(bounds).toBeTruthy();
    expect(bounds!.height).toBeGreaterThanOrEqual(44);
  }
  expect(
    (await nameControl
      .getByRole('button', { name: 'Drag Name' })
      .boundingBox())!.width,
  ).toBeGreaterThanOrEqual(44);
  await inspectControl(nameControl);
  expect(
    (await inspectorFor(nameControl)
      .getByRole('button', { name: 'Move down' })
      .boundingBox())!.height,
  ).toBeGreaterThanOrEqual(44);
  await inspectorFor(nameControl)
    .getByRole('button', { name: 'Move down' })
    .focus();
  await page.keyboard.press('Enter');
  await expect(
    designer
      .locator('[data-section-id]')
      .first()
      .locator('[data-control-id] button[aria-label^="Drag "]')
      .first(),
  ).toHaveAttribute('aria-label', 'Drag Category');
  await designer.getByRole('button', { name: 'Undo edit' }).click();
  await panels.getByRole('button', { name: 'Canvas', exact: true }).click();
  await designer.getByRole('button', { name: 'Add section' }).click();
  await designer.getByLabel('Section heading').last().fill('Phone checks');

  const addField = async (
    type: 'boolean' | 'short_text',
    fieldName: string,
  ) => {
    await panels.getByRole('button', { name: 'Library' }).click();
    await designer
      .getByRole('button', { name: 'Add field', exact: true })
      .click();
    const addition = designer.getByRole('dialog', { name: 'Add field' });
    await addition
      .getByRole('button', {
        name: type === 'boolean' ? /Checkbox/ : /Short text/,
      })
      .click();
    await addition.getByLabel('Field name').fill(fieldName);
    await addition.getByRole('button', { name: 'Add to form' }).click();
    await panels.getByRole('button', { name: 'Canvas' }).click();
    const control = designer.locator(
      `[data-control-id]:has(button[aria-label="Drag ${fieldName}"])`,
    );
    await inspectControl(control);
    await chooseControlSection(control, 'Phone checks');
  };
  for (const name of ['Flag one', 'Flag two', 'Flag three'])
    await addField('boolean', name);
  await designer
    .getByText('Try form · quantity items or individual assets')
    .click();
  await designer.getByRole('button', { name: 'Phone width' }).click();
  const preview = designer.getByRole('form', {
    name: 'Preview quantity metadata',
  });
  const checks = ['Flag one', 'Flag two', 'Flag three'].map((name) =>
    preview.getByRole('checkbox', { name }),
  );
  // The associated label is the complete touch target, including its padding.
  const targets = checks.map((check) =>
    check.locator('xpath=ancestor::label[1]'),
  );
  await targets[0].scrollIntoViewIfNeeded();
  const boxes = await Promise.all(
    targets.map((target) => target.boundingBox()),
  );
  for (const box of boxes) {
    expect(box).toBeTruthy();
    expect(box!.height).toBeGreaterThanOrEqual(44);
    expect(box!.width).toBeGreaterThanOrEqual(44);
  }
  expect(boxes[0]!.y).toBeCloseTo(boxes[1]!.y, 0);
  expect(boxes[1]!.y).toBeCloseTo(boxes[2]!.y, 0);
  expect(boxes[0]!.x).toBeLessThan(boxes[1]!.x);
  expect(boxes[1]!.x).toBeLessThan(boxes[2]!.x);
  expect(boxes[0]!.x + boxes[0]!.width).toBeLessThanOrEqual(boxes[1]!.x);
  expect(boxes[1]!.x + boxes[1]!.width).toBeLessThanOrEqual(boxes[2]!.x);
  await expect(checks[0]).toHaveAttribute('aria-checked', 'mixed');
  const glyph = await checks[0].boundingBox();
  const paddingPoint = {
    x: boxes[0]!.x + boxes[0]!.width / 2,
    y: boxes[0]!.y + boxes[0]!.height - 3,
  };
  expect(paddingPoint.y).toBeGreaterThan(glyph!.y + glyph!.height);
  expect(paddingPoint.y).toBeLessThan(page.viewportSize()!.height);
  expect(paddingPoint.y).toBeGreaterThanOrEqual(0);
  await test.info().attach('boolean-touch-targets', {
    body: JSON.stringify({ labels: boxes, glyph, paddingPoint }),
    contentType: 'application/json',
  });
  await page.mouse.click(paddingPoint.x, paddingPoint.y);
  await expect(checks[0]).toBeChecked();
  await expect(checks[1]).not.toBeChecked();
  await checks[0].focus();
  await page.keyboard.press('Space');
  await expect(checks[0]).not.toBeChecked();
  await page.screenshot({
    path: test.info().outputPath('phone-checkbox-targets.png'),
  });
  await checks[0].check();
  await checks[0].uncheck();
  await expect(checks[0]).toHaveAttribute('aria-checked', 'false');
  await preview.getByRole('button', { name: 'Clear answer' }).first().click();
  await expect(checks[0]).toHaveAttribute('aria-checked', 'mixed');

  const longLabel = 'LongFieldLabel'.repeat(12);
  const longHelp = 'LongHelpText'.repeat(25);
  await addField('short_text', longLabel);
  await panels.getByRole('button', { name: 'Library' }).click();
  await designer.getByRole('button', { name: new RegExp(longLabel) }).click();
  await designer
    .getByLabel('Description shown below this field')
    .fill(longHelp);
  const label = preview.getByText(longLabel, { exact: true });
  const help = preview.getByText(longHelp, { exact: true });
  for (const text of [label, help]) {
    await expect(text).toBeVisible();
    const metrics = await text.evaluate((node) => ({
      scroll: node.parentElement!.scrollWidth,
      client: node.parentElement!.clientWidth,
      right: node.getBoundingClientRect().right,
      viewport: innerWidth,
    }));
    expect(metrics.scroll).toBeLessThanOrEqual(metrics.client + 1);
    expect(metrics.right).toBeLessThanOrEqual(metrics.viewport);
  }
  await designer.getByText('Optional rules', { exact: true }).click();
  await designer
    .getByRole('checkbox', { name: 'Use minimum characters' })
    .check();
  await designer.getByLabel('Minimum characters', { exact: true }).fill('501');
  await expect(
    designer.getByRole('alert').filter({
      hasText: 'Minimum characters must be a whole number from 0 to 500.',
    }),
  ).toBeVisible();
  const issue = designer
    .getByRole('alert')
    .filter({ hasText: 'Resolve before saving:' });
  await expect(issue).toContainText(`${longLabel} has invalid text bounds`);
  expect(
    await issue.evaluate((node) => node.scrollWidth <= node.clientWidth + 1),
  ).toBe(true);
  await designer
    .getByRole('checkbox', { name: 'Use minimum characters' })
    .uncheck();

  const inspectorHeading = designer
    .getByTestId('designer-inspector')
    .getByRole('heading', { level: 3, name: new RegExp(longLabel) });
  expect(
    await inspectorHeading.evaluate(
      (node) => node.scrollWidth <= node.clientWidth + 1,
    ),
  ).toBe(true);

  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test('saved layout survives reload and unsaved navigation requires explicit recovery or discard', async ({
  page,
}) => {
  test.setTimeout(90_000);
  const category = `Designer persistence ${crypto.randomUUID().slice(0, 8)}`;
  await signIn(page);
  await page.goto('/settings/categories');
  await page.getByLabel('Display name').fill(category);
  await page.getByRole('button', { name: 'Add category' }).click();
  await expect(page.getByRole('status')).toContainText('Category added.');
  const designer = await chooseDesigner(page, category);
  await designer.getByRole('button', { name: 'Add section' }).click();
  await designer.getByLabel('Section heading').last().fill('Persisted section');
  const nameControl = designer.locator(
    '[data-control-id]:has(button[aria-label="Drag Name"])',
  );
  await inspectControl(nameControl);
  await inspectorFor(nameControl)
    .getByRole('combobox', { name: 'Preferred width', exact: true })
    .selectOption('6');
  await inspectorFor(nameControl)
    .getByRole('button', { name: 'Move down' })
    .focus();
  await page.keyboard.press('Enter');
  await designer.getByRole('button', { name: 'Save changes' }).click();
  await expect(
    designer
      .getByRole('status')
      .filter({ hasText: 'Saved active form revision' }),
  ).toContainText('Saved active form revision');
  await page.reload();
  await expect(designer.getByLabel('Section heading').last()).toHaveValue(
    'Persisted section',
  );
  const reloadedName = designer.locator(
    '[data-control-id]:has(button[aria-label="Drag Name"])',
  );
  await inspectControl(reloadedName);
  await expect(
    inspectorFor(reloadedName).getByRole('combobox', {
      name: 'Preferred width',
      exact: true,
    }),
  ).toHaveValue('6');
  await expect(
    designer
      .locator('[data-section-id]')
      .first()
      .locator('[data-control-id] button[aria-label^="Drag "]')
      .first(),
  ).toHaveAttribute('aria-label', 'Drag Category');
  await designer
    .getByLabel('Section heading')
    .last()
    .fill('Unsaved navigation edit');
  await page.goBack();
  await expect(
    page.getByRole('heading', { name: 'Forms & fields', level: 1 }),
  ).toBeVisible();
  await page.goForward();
  await expect(
    designer.getByRole('region', { name: 'Recover unsaved form edits' }),
  ).toBeVisible();
  await expect(designer.getByLabel('Section heading')).toHaveCount(0);
  await designer.getByRole('button', { name: 'Recover edits' }).click();
  await expect(designer.getByLabel('Section heading').last()).toHaveValue(
    'Unsaved navigation edit',
  );
  page.once('dialog', (dialog) => dialog.accept());
  await designer
    .getByRole('button', { name: 'Recovery & advanced', exact: true })
    .click();
  await designer.getByRole('button', { name: 'Refresh from server' }).click();
  await expect(designer.getByLabel('Section heading').last()).toHaveValue(
    'Persisted section',
  );
});

test('a pre-existing server draft remains reviewable and can be explicitly discarded', async ({
  page,
}) => {
  test.setTimeout(90_000);
  const category = `Legacy draft ${randomUUID().slice(0, 8)}`;
  await signIn(page);
  await page.goto('/settings/categories');
  await page.getByLabel('Display name').fill(category);
  await page.getByRole('button', { name: 'Add category' }).click();
  await expect(page.getByRole('status')).toContainText('Category added.');
  const designer = await chooseDesigner(page, category);
  const categoryId = new URL(page.url()).pathname.split('/').at(-1)!;
  const client = createClient(
    process.env.LOCAL_API_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const signed = await client.auth.signInWithPassword({
    email: fixture.emails.staff,
    password: fixture.password,
  });
  expect(signed.error).toBeNull();
  const current = await client.rpc('metadata_form_get', {
    p_category_id: categoryId,
  });
  expect(current.error).toBeNull();
  const form = current.data as {
    draft_id: string | null;
    draft_version: string | null;
    published_revision_id: string;
    published_definition: { fields: unknown[]; layout: { label: string }[] };
  };
  const definition = structuredClone(form.published_definition);
  definition.layout[0].label = 'Recovered server draft section';
  const saved = await client.rpc(
    'metadata_draft_save' as never,
    {
      p_request_id: randomUUID(),
      p_payload: {
        category_id: categoryId,
        expected_actor_id: signed.data.user!.id,
        expected_draft_id: form.draft_id,
        expected_draft_version: form.draft_version ?? '0',
        expected_published_revision_id: form.published_revision_id,
        definition,
      },
    } as never,
  );
  expect(saved.error).toBeNull();
  await page.reload();
  await expect(designer.getByLabel('Section heading').first()).toHaveValue(
    'Recovered server draft section',
  );
  await designer
    .getByRole('button', { name: 'Recovery & advanced', exact: true })
    .click();
  await expect(designer.getByText('Legacy draft available')).toBeVisible();
  page.once('dialog', (dialog) => dialog.accept());
  await designer.getByRole('button', { name: 'Discard saved draft' }).click();
  await expect(
    designer.getByRole('status').filter({ hasText: 'Saved draft discarded.' }),
  ).toContainText('Saved draft discarded.');
  await expect(designer.getByText('Legacy draft available')).toHaveCount(0);
  await expect(designer.getByLabel('Section heading').first()).not.toHaveValue(
    'Recovered server draft section',
  );
  await client.auth.signOut();
});
