import {
  expect,
  test,
  type Locator,
  type Page,
  type TestInfo,
} from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import fixture from '../fixtures/auth.json' with { type: 'json' };
import { chooseLocation } from './location-picker';
import { captureE2eEvidence } from '../../scripts/e2e-diagnostics';
import {
  expectRecordStatus,
  expectRecordVersion,
} from './record-task-controls';

async function login(page: Page, role: 'staff' | 'viewer' = 'staff') {
  await page.goto('/login');
  await page.getByLabel('Email', { exact: true }).fill(fixture.emails[role]);
  await page.getByLabel('Password', { exact: true }).fill(fixture.password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Inventory', exact: true }),
  ).toBeVisible();
}
async function capture(page: Page, info: TestInfo, name: string) {
  if (!captureE2eEvidence()) return;
  const directory = resolve('.local-tools/cp3');
  mkdirSync(directory, { recursive: true });
  await page.screenshot({ path: resolve(directory, `${name}.png`) });
  await info.attach(name, {
    body: await page.screenshot(),
    contentType: 'image/png',
  });
}
async function finishRecording(page: Page, name: string) {
  if (!captureE2eEvidence()) return;
  const video = page.video();
  await page.close();
  if (video) await video.saveAs(resolve('.local-tools/cp3', name + '.webm'));
}
// Native browser zoom is unavailable in this headless runner. Match its effective
// CSS viewport and pixel density explicitly, without CSS zoom's media-query gap.
async function emulate200Percent(page: Page) {
  await page.setViewportSize({ width: 590, height: 378 });
  const session = await page.context().newCDPSession(page);
  await session.send('Emulation.setDeviceMetricsOverride', {
    width: 590,
    height: 378,
    deviceScaleFactor: 2,
    mobile: false,
  });
  expect(await page.evaluate(() => innerWidth)).toBe(590);
}
function summaryValue(review: Locator, label: string) {
  return review
    .locator('dt')
    .filter({ hasText: new RegExp('^' + label + '( ·.*)?$') })
    .locator('xpath=following-sibling::dd');
}
async function expectWithinViewport(page: Page, target: Locator) {
  await expect(target).toBeVisible();
  await expect(async () => {
    const bounds = await target.boundingBox();
    expect(bounds).toBeTruthy();
    expect(bounds!.y).toBeGreaterThanOrEqual(0);
    expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(
      page.viewportSize()!.height,
    );
  }).toPass();
}
async function localReader() {
  const api = new URL(process.env.LOCAL_API_URL!);
  expect(['localhost', '127.0.0.1']).toContain(api.hostname);
  expect(api.port).toBe('54321');
  const client = createClient(
    api.href,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const signed = await client.auth.signInWithPassword({
    email: fixture.emails.staff,
    password: fixture.password,
  });
  expect(signed.error).toBeNull();
  return { client, actorId: signed.data.user!.id };
}
async function customCategory() {
  const { client, actorId } = await localReader();
  const suffix = randomUUID().slice(0, 12);
  const name = 'CP3 summary ' + suffix;
  const created = await client.rpc(
    'category_create' as never,
    {
      p_request_id: randomUUID(),
      p_payload: { code: 'CP3-' + suffix.toUpperCase(), name, sort_order: 750 },
    } as never,
  );
  expect(created.error).toBeNull();
  const id = (created.data as { category_id: string }).category_id;
  const baselineRead = await client.rpc(
    'metadata_form_get_v2' as never,
    { p_category_id: id } as never,
  );
  expect(baselineRead.error).toBeNull();
  const baseline = baselineRead.data as {
    draft_id: string | null;
    draft_version: string | null;
    published_revision_id: string;
    published_definition: {
      fields: unknown[];
      layout: { controls: unknown[] }[];
    };
  };
  const fields = [
    {
      id: randomUUID(),
      type: 'boolean',
      label: 'Checked answer',
      default: true,
    },
    { id: randomUUID(), type: 'integer', label: 'Zero answer', default: 9 },
    {
      id: randomUUID(),
      type: 'short_text',
      label: 'Default answer',
      default: 'Applied default',
    },
    {
      id: randomUUID(),
      type: 'short_text',
      label: 'Cleared answer',
      default: 'Clear me',
    },
    { id: randomUUID(), type: 'short_text', label: 'Absent answer' },
    { id: randomUUID(), type: 'hierarchical_select', label: 'Nested answer' },
  ].map((field) => ({
    ...field,
    applies_to: ['quantity', 'asset'],
    required: false,
    rules: {},
    options: [] as {
      id: string;
      label: string;
      parent_id: string | null;
      active: boolean;
    }[],
  }));
  const parent = randomUUID(),
    leaf = randomUUID();
  fields[5].options = [
    { id: parent, label: 'Connection', parent_id: null, active: true },
    { id: leaf, label: 'USB-C', parent_id: parent, active: true },
  ];
  const definition = structuredClone(baseline.published_definition);
  definition.fields.push(...fields);
  definition.layout.push({
    id: randomUUID(),
    label: 'CP3 answers',
    controls: fields.map((field) => ({
      id: randomUUID(),
      kind: 'field',
      field_id: field.id,
      width: 12,
    })),
  } as never);
  const payload = {
    category_id: id,
    expected_actor_id: actorId,
    expected_draft_id: baseline.draft_id,
    expected_draft_version: baseline.draft_version ?? '0',
    expected_published_revision_id: baseline.published_revision_id,
    definition,
  };
  let saved = await client.rpc(
    'metadata_form_save' as never,
    { p_request_id: randomUUID(), p_payload: payload } as never,
  );
  expect(saved.error).toBeNull();
  const result = saved.data as { status: string; token?: string };
  if (result.status === 'confirmation_required')
    saved = await client.rpc(
      'metadata_form_save' as never,
      {
        p_request_id: randomUUID(),
        p_payload: { ...payload, review_token: result.token },
      } as never,
    );
  expect(saved.error).toBeNull();
  expect((saved.data as { status: string }).status).toBe('saved');
  return { client, id, name };
}
async function createQuantity(page: Page, name: string, count = 0) {
  await page.goto('/inventory/quantity/new');
  const form = page.getByRole('form', {
    name: 'Add quantity item',
    exact: true,
  });
  await form.getByLabel('Name', { exact: true }).fill(name);
  await form.getByLabel('Initial quantity').fill(String(count));
  if (count) await chooseLocation(form, 'Initial location', 'ITC-RED');
  await form
    .getByRole('button', { name: 'Review quantity item', exact: true })
    .click();
  await form
    .getByRole('button', { name: 'Add quantity item', exact: true })
    .click();
  await expect(page).toHaveURL(/\/inventory\/quantity\/[0-9a-f-]+$/);
  return page.url();
}
async function launch(page: Page, label: string, group?: string) {
  const workspace = page.getByRole('region', { name: 'Record tasks' });
  if (group)
    await workspace
      .locator('summary')
      .filter({ hasText: new RegExp('^' + group + '$') })
      .click();
  await workspace.getByRole('button', { name: label, exact: true }).click();
  return workspace;
}
async function retire(page: Page, url: string) {
  await page.goto(url);
  await launch(page, 'Retire asset', 'Retire or archive');
  const form = page.getByRole('form', { name: 'Retire asset', exact: true });
  await form
    .getByLabel('Reason (required)')
    .fill('CP3 fictional lifecycle acceptance');
  await form
    .getByRole('button', { name: 'Review retire asset', exact: true })
    .click();
  await form
    .getByRole('button', { name: 'Confirm retire asset', exact: true })
    .click();
  await expectRecordStatus(page, 'retired');
  await expectRecordVersion(page, 2);
}

test('CP3 U04 U09 review shows exact normalized intent, Back preserves answers and creates only the edited review', async ({
  page,
}, info) => {
  test.setTimeout(180_000);
  const category = await customCategory();
  const initialName =
    'CP3 quantity long ' +
    randomUUID() +
    ' supplied values remain completely reviewable';
  const finalName = initialName + ' changed';
  await login(page);
  await page.setViewportSize({ width: 1180, height: 757 });
  await page.goto('/inventory/quantity/new');
  const form = page.getByRole('form', {
    name: 'Add quantity item',
    exact: true,
  });
  await form.getByLabel('Category', { exact: true }).selectOption(category.id);
  await expect(form.getByLabel('Default answer', { exact: true })).toHaveValue(
    'Applied default',
  );
  await form.getByLabel('Name', { exact: true }).fill(initialName);
  await form.getByLabel('Initial quantity').fill('4');
  await chooseLocation(form, 'Initial location', 'ITC-RED');
  await form
    .getByRole('checkbox', { name: 'Checked answer', exact: true })
    .uncheck();
  await form.getByLabel('Zero answer', { exact: true }).fill('0');
  await form
    .getByLabel('Cleared answer', { exact: true })
    .locator('xpath=ancestor::div[contains(@id,"-validation-group")][1]')
    .getByRole('button', { name: 'Clear answer', exact: true })
    .click();
  await form
    .getByRole('group', { name: 'Nested answer', exact: true })
    .getByRole('button', { name: 'USB-C', exact: true })
    .click();
  await form
    .getByRole('button', { name: 'Review quantity item', exact: true })
    .click();
  const review = form.getByRole('region', { name: 'Metadata review' });
  await expectWithinViewport(
    page,
    review.getByRole('heading', { name: 'Review quantity item', exact: true }),
  );
  await capture(page, info, 'quantity-review-first-viewport');
  await expect(summaryValue(review, 'Name')).toHaveText(initialName);
  await expect(summaryValue(review, 'Starting count')).toHaveText('4');
  await expect(summaryValue(review, 'Initial storage')).toContainText(
    'Red Container',
  );
  await review
    .locator('summary')
    .filter({ hasText: 'Record details & custom answers' })
    .click();
  await expect(summaryValue(review, 'Checked answer')).toHaveText('No');
  await expect(summaryValue(review, 'Zero answer')).toHaveText('0');
  await expect(summaryValue(review, 'Default answer')).toHaveText(
    'Applied default',
  );
  await expect(summaryValue(review, 'Cleared answer')).toHaveText('Cleared');
  await expect(summaryValue(review, 'Absent answer')).toHaveText(
    'Not recorded',
  );
  await expect(summaryValue(review, 'Nested answer')).toHaveText(
    'Connection / USB-C',
  );
  await capture(page, info, 'quantity-reviewed-values');
  const before = await category.client
    .from('quantity_items')
    .select('id')
    .eq('name', initialName);
  expect(before.error).toBeNull();
  expect(before.data).toEqual([]);
  await form.getByRole('button', { name: 'Back to edit', exact: true }).click();
  await expect(form.getByLabel('Name', { exact: true })).toBeFocused();
  await expect(form.getByLabel('Zero answer', { exact: true })).toHaveValue(
    '0',
  );
  await form.getByLabel('Name', { exact: true }).fill(finalName);
  await form.getByLabel('Initial quantity').fill('3');
  await expect(review).toHaveCount(0);
  await form
    .getByRole('button', { name: 'Review quantity item', exact: true })
    .click();
  await expect(summaryValue(review, 'Name')).toHaveText(finalName);
  await expect(summaryValue(review, 'Starting count')).toHaveText('3');
  await form
    .getByRole('button', { name: 'Add quantity item', exact: true })
    .click();
  await expect(page).toHaveURL(/\/inventory\/quantity\/[0-9a-f-]+$/);
  await expect(
    page.getByRole('heading', { name: finalName, exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('heading', { name: /Current stock — 3 available/ }),
  ).toBeVisible();
  await capture(page, info, 'quantity-created');
  await page.goto('/inventory/quantity/new');
  await form
    .getByLabel('Name', { exact: true })
    .fill('CP3 zero ' + randomUUID());
  await form
    .getByRole('button', { name: 'Review quantity item', exact: true })
    .click();
  await expect(summaryValue(review, 'Starting count')).toHaveText('0');
  await expect(summaryValue(review, 'Initial storage')).toHaveText(
    'No initial stock · no storage destination',
  );
  await form.getByRole('button', { name: 'Back to edit', exact: true }).click();
  await finishRecording(page, 'review-edit-create');
});

test('CP3 U05 one task retains dirty intent, discards explicitly, and keeps a committed move receipt until a new transaction', async ({
  page,
}, info) => {
  test.setTimeout(120_000);
  await login(page);
  await page.setViewportSize({ width: 1180, height: 757 });
  const url = await createQuantity(page, 'CP3 tasks ' + randomUUID(), 4);
  const tasks = await launch(page, 'Move stock');
  await expect(tasks).toContainText('Red Container: 4');
  let form = page.getByRole('form', { name: 'Move stock', exact: true });
  await chooseLocation(form, 'Source location', 'ITC-RED');
  await chooseLocation(form, 'Destination location', 'ITC-BLACK');
  await form.getByLabel('Quantity to move', { exact: true }).fill('1');
  await tasks
    .getByRole('button', { name: 'Receive stock', exact: true })
    .click();
  const decision = tasks.getByRole('alertdialog', {
    name: 'Discard task draft?',
  });
  await expect(decision).toBeVisible();
  await decision.getByRole('button', { name: 'Stay with this task' }).click();
  await expect(
    form.getByLabel('Quantity to move', { exact: true }),
  ).toHaveValue('1');
  await tasks
    .getByRole('button', { name: 'Receive stock', exact: true })
    .click();
  await decision.getByRole('button', { name: 'Discard and switch' }).click();
  await expect(form).toHaveCount(0);
  await expect(
    page.getByRole('form', { name: 'Receive stock', exact: true }),
  ).toHaveCount(1);
  await tasks.getByRole('button', { name: 'Move stock', exact: true }).click();
  form = page.getByRole('form', { name: 'Move stock', exact: true });
  await chooseLocation(form, 'Source location', 'ITC-RED');
  await chooseLocation(form, 'Destination location', 'ITC-BLACK');
  await form.getByLabel('Quantity to move', { exact: true }).fill('1');
  await form
    .getByRole('button', { name: 'Review move stock', exact: true })
    .click();
  await form
    .getByRole('button', { name: 'Confirm move stock', exact: true })
    .click();
  await expect(form.getByRole('status')).toContainText(
    /Moved|Move completed|Stock moved/,
  );
  await expect(
    tasks.getByRole('button', { name: 'Receive stock', exact: true }),
  ).toBeEnabled();
  await expect(form.getByText(/Baseline refreshed/)).toHaveCount(0);
  await capture(page, info, 'task-success-receipt');
  await form.getByRole('button', { name: 'Move more', exact: true }).click();
  await expect(
    form.getByRole('button', { name: 'Review move stock', exact: true }),
  ).toBeVisible();
  await tasks.getByRole('button', { name: 'Close task', exact: true }).click();
  await expect(
    tasks.getByRole('button', { name: 'Move stock', exact: true }),
  ).toBeFocused();
  await page.setViewportSize({ width: 390, height: 844 });
  await launch(page, 'Receive stock');
  await tasks
    .getByRole('heading', { name: 'Receive stock', exact: true })
    .scrollIntoViewIfNeeded();
  await expect(page.getByRole('form', { name: 'Receive stock' })).toBeVisible();
  await capture(page, info, 'quantity-tasks-narrow');
  await page.goto(url);
  await emulate200Percent(page);
  await launch(page, 'Receive stock');
  await tasks
    .getByRole('heading', { name: 'Receive stock', exact: true })
    .scrollIntoViewIfNeeded();
  await capture(page, info, 'quantity-tasks-200-percent-emulated');
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await finishRecording(page, 'task-switch-success');
});

test('CP3 U07 U14 asset identity is concise and an actual other-tab retirement requires explicit current snapshot review', async ({
  page,
  context,
}, info) => {
  test.setTimeout(120_000);
  await login(page);
  await page.setViewportSize({ width: 1180, height: 757 });
  const suffix = randomUUID(),
    name = 'CP3 lifecycle asset ' + suffix,
    tag = ('cp3-' + suffix).toUpperCase();
  await page.goto('/inventory/assets/new');
  const form = page.getByRole('form', {
    name: 'Add individual asset',
    exact: true,
  });
  await form.getByLabel('Name', { exact: true }).fill(name);
  await form.getByLabel('Asset tag').fill(tag.toUpperCase());
  await form.getByLabel('Serial number').fill('Serial ' + suffix);
  await form.getByLabel('Manufacturer').fill('CP3 supplied manufacturer');
  await chooseLocation(form, 'Current location', 'ITC-CLEAR');
  await form
    .getByRole('button', { name: 'Review individual asset', exact: true })
    .click();
  const review = form.getByRole('region', { name: 'Metadata review' });
  await expectWithinViewport(
    page,
    review.getByRole('heading', {
      name: 'Review individual asset',
      exact: true,
    }),
  );
  await expect(summaryValue(review, 'Asset tag')).toHaveText(tag);
  await expect(summaryValue(review, 'Count')).toHaveText(
    '1 individually tracked asset',
  );
  await form
    .getByRole('button', { name: 'Add individual asset', exact: true })
    .click();
  await expect(page).toHaveURL(/\/inventory\/assets\/[0-9a-f-]+$/);
  const url = page.url(),
    id = new URL(url).pathname.split('/').at(-1)!;
  const identity = page
    .getByRole('main')
    .locator('section')
    .filter({ has: page.getByRole('heading', { name, exact: true }) });
  await expect(identity).toHaveCount(1);
  await expect(
    identity.locator('dl').getByText(tag, { exact: true }),
  ).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, 0));
  await capture(page, info, 'asset-primary-identity');
  const created = page.getByRole('listitem').filter({
    has: page.getByRole('heading', { name: 'Created', exact: true }),
  });
  await expect(created).toHaveCount(1);
  await expect(
    created.getByRole('heading', { name: 'Created', exact: true }),
  ).toBeVisible();
  await expect(
    created.getByRole('link', { name, exact: true }),
  ).toHaveAttribute('href', '/inventory/assets/' + id);
  await expect(created.getByText(tag, { exact: true })).not.toBeVisible();
  await created
    .locator('summary')
    .filter({ hasText: 'View event details' })
    .click();
  await expect(created).toContainText(tag);
  await expect(created).toContainText('Serial ' + suffix);
  await expect(created).toContainText('CP3 supplied manufacturer');
  const history = page.getByRole('link', { name: 'View all asset history' });
  await expect(history).toHaveAttribute(
    'href',
    '/history?type=asset&entityId=' + id,
  );
  await created.scrollIntoViewIfNeeded();
  await capture(page, info, 'asset-created-history-details');
  await page.goto('/inventory/assets/new');
  await form
    .getByLabel('Name', { exact: true })
    .fill('CP3 second asset ' + suffix);
  await form.getByLabel('Asset tag').fill('cp3-second-' + suffix);
  await chooseLocation(form, 'Current location', 'ITC-RED');
  await form
    .getByRole('button', { name: 'Review individual asset', exact: true })
    .click();
  await form
    .getByRole('button', { name: 'Add individual asset', exact: true })
    .click();
  await expect(page).toHaveURL(/\/inventory\/assets\/[0-9a-f-]+$/);
  const secondURL = page.url(),
    secondId = new URL(secondURL).pathname.split('/').at(-1)!;
  await page.goto('/labels?asset=' + secondId);
  await expect(page.getByText(/1 distinct record · 1 label/)).toBeVisible();
  await page.goto('/labels?asset=' + id);
  await expect(page.getByText(/2 distinct records.*2 labels/)).toBeVisible();
  await expect(
    page.getByRole('button', { name: /Print selected labels/ }),
  ).toBeEnabled();
  const other = await context.newPage();
  await retire(other, url);
  await retire(other, secondURL);
  await page.bringToFront();
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  const decisions = page.getByRole('alert', { name: 'Label item decisions' });
  await expect(decisions).toHaveCount(1);
  await expect(decisions).toContainText(name);
  await expect(decisions).toContainText(/retired/i);
  await expect(
    page.getByRole('button', { name: /Print selected labels/ }),
  ).toBeDisabled();
  const namedDecision = decisions
    .getByRole('heading', { name: name + ' · Individual asset', exact: true })
    .locator('xpath=parent::div');
  await expect(
    decisions.getByRole('button', { name: 'Review item', exact: true }),
  ).toHaveCount(2);
  await namedDecision
    .getByRole('button', { name: 'Review item', exact: true })
    .click();
  await expect(
    namedDecision.getByRole('checkbox', { name: /historical record/ }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: /Print selected labels/ }),
  ).toBeDisabled();
  await capture(page, info, 'label-lifecycle-decision');
  await namedDecision
    .getByRole('checkbox', { name: /historical record/ })
    .check();
  await namedDecision
    .getByRole('button', { name: 'Acknowledge reviewed item' })
    .click();
  await expect(
    page.getByRole('button', { name: /Print selected labels/ }),
  ).toBeDisabled();
  await decisions
    .getByRole('heading', {
      name: 'CP3 second asset ' + suffix + ' · Individual asset',
      exact: true,
    })
    .locator('xpath=parent::div')
    .getByRole('button', { name: 'Remove from queue', exact: true })
    .click();
  await expect(
    page.getByRole('button', { name: /Print selected labels/ }),
  ).toBeEnabled();
  await other.goto(url);
  await launch(other, 'Restore individual asset', 'Retire or archive');
  const restore = other.getByRole('form', {
    name: 'Restore asset',
    exact: true,
  });
  await chooseLocation(restore, 'Confirmed current location', 'ITC-CLEAR');
  await restore
    .getByLabel('Reason (required)')
    .fill('CP3 restored current custody verified');
  await restore
    .getByRole('button', { name: 'Review restore asset', exact: true })
    .click();
  await restore
    .getByRole('button', { name: 'Confirm restore asset', exact: true })
    .click();
  await expectRecordStatus(other, 'active');
  await expectRecordVersion(other, 3);
  await page.bringToFront();
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(decisions).toHaveCount(1);
  await expect(
    page.getByRole('button', { name: /Print selected labels/ }),
  ).toBeDisabled();
  await decisions
    .getByRole('button', { name: 'Remove from queue', exact: true })
    .click();
  await expect(decisions).toHaveCount(0);
  await page.reload();
  await expect(
    page
      .getByRole('region', { name: 'Label queue' })
      .getByText('0 distinct records · 0 labels', { exact: true }),
  ).toBeVisible();
  await expect(decisions).toHaveCount(0);
  await other.close();
  await finishRecording(page, 'label-lifecycle-review-remove');
});

test('CP3 U08 designer starts with useful canvas and supports keyboard recovery, Undo, cancel, Try form and save', async ({
  page,
}, info) => {
  test.setTimeout(120_000);
  await login(page);
  await page.goto('/settings/categories');
  const category = 'CP3 canvas ' + randomUUID().slice(0, 8);
  await page.getByLabel('Display name').fill(category);
  await page.getByRole('button', { name: 'Add category' }).click();
  await expect(page.getByRole('status')).toContainText(
    `Category added: ${category}.`,
  );
  await page.goto('/settings/forms');
  await page.getByRole('link', { name: category, exact: true }).click();
  await page.setViewportSize({ width: 1180, height: 757 });
  const designer = page.getByRole('region', { name: 'Forms and fields' });
  await expect(
    designer.getByRole('heading', { name: 'Field library', exact: true }),
  ).toBeVisible();
  await expect(
    designer.getByRole('complementary', {
      name: 'Designer inspector',
      exact: true,
    }),
  ).toBeVisible();
  const canvasWidth = await designer
    .getByRole('heading', { name: 'Form canvas', exact: true })
    .evaluate(
      (heading) => heading.parentElement!.getBoundingClientRect().width,
    );
  expect(canvasWidth).toBeGreaterThanOrEqual(400);
  const field = designer.locator('[aria-label="Select Name control"]');
  await expect(field).toBeVisible();
  const box = await field.boundingBox();
  expect(box!.y + box!.height).toBeLessThan(757);
  await expect(
    designer.getByRole('button', { name: 'Save changes', exact: true }),
  ).toHaveCount(1);
  await capture(page, info, 'designer-first-viewport');
  await field.focus();
  await page.keyboard.press('Enter');
  await expect(
    field.getByRole('button', { name: 'Drag Name', exact: true }),
  ).toBeVisible();
  await expect(
    field.getByRole('button', { name: 'Resize Name', exact: true }),
  ).toBeVisible();
  const controls = designer
    .locator('[data-section-id]')
    .first()
    .locator('[data-control-id]');
  const order = () =>
    controls.evaluateAll((nodes) =>
      nodes.map((node) => node.getAttribute('data-control-id')),
    );
  const before = await order();
  const categoryControl = designer.locator(
    '[aria-label="Select Category control"]',
  );
  await categoryControl.press('Enter');
  const drag = categoryControl.getByRole('button', { name: 'Drag Category' });
  await drag.scrollIntoViewIfNeeded();
  const from = (await drag.boundingBox())!,
    to = (await field.boundingBox())!;
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  try {
    await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, {
      steps: 16,
    });
    await expect.poll(order).not.toEqual(before);
  } finally {
    await page.mouse.up();
  }
  await designer.getByRole('button', { name: 'Undo edit' }).click();
  await expect.poll(order).toEqual(before);
  await field.press('Enter');
  const inspector = designer.getByTestId('designer-inspector'),
    width = inspector.getByRole('combobox', {
      name: 'Preferred width',
      exact: true,
    });
  await expect(width).toBeVisible();
  await width.selectOption('12');
  const resize = field.getByRole('button', { name: 'Resize Name' });
  await resize.scrollIntoViewIfNeeded();
  const handle = (await resize.boundingBox())!;
  await page.mouse.move(
    handle.x + handle.width / 2,
    handle.y + handle.height / 2,
  );
  await page.mouse.down();
  try {
    await page.mouse.move(
      handle.x + handle.width / 2 - 250,
      handle.y + handle.height / 2,
      { steps: 12 },
    );
    await expect(width).not.toHaveValue('12');
  } finally {
    await page.mouse.up();
  }
  await designer.getByRole('button', { name: 'Undo edit' }).click();
  const section = designer.getByLabel('Section heading').first(),
    original = await section.inputValue();
  await section.fill('CP3 changed section');
  await designer
    .getByRole('button', { name: 'Undo edit', exact: true })
    .click();
  await expect(section).toHaveValue(original);
  const recovery = designer.getByRole('button', {
    name: 'Recovery & advanced',
    exact: true,
  });
  await recovery.focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Recovery & advanced' });
  await expect(dialog).toBeVisible();
  await expect(
    dialog.getByRole('button', { name: 'Refresh from server' }),
  ).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(recovery).toBeFocused();
  await designer
    .getByRole('button', { name: 'Add field', exact: true })
    .click();
  const add = designer.getByRole('dialog', { name: 'Add field', exact: true });
  await add.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(add).toHaveCount(0);
  await designer.getByText(/^Try form|^Live preview ·/).click();
  await expect(
    designer.getByRole('form', { name: 'Preview quantity metadata' }),
  ).toBeVisible();
  await designer.getByText(/^Try form|^Live preview ·/).click();
  await section.fill('CP3 reviewed canvas');
  await designer
    .getByRole('button', { name: 'Save changes', exact: true })
    .click();
  await expect(
    designer
      .getByRole('status')
      .filter({ hasText: 'Saved active form revision' }),
  ).toContainText('Saved active form revision');
  await page.setViewportSize({ width: 390, height: 844 });
  const panels = designer.getByRole('navigation', { name: 'Designer panels' });
  await panels.getByRole('button', { name: 'Canvas', exact: true }).click();
  await designer
    .getByRole('heading', { name: 'Form canvas', exact: true })
    .scrollIntoViewIfNeeded();
  await capture(page, info, 'designer-narrow');
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await emulate200Percent(page);
  await panels.getByRole('button', { name: 'Canvas', exact: true }).click();
  await designer
    .getByRole('heading', { name: 'Form canvas', exact: true })
    .scrollIntoViewIfNeeded();
  await capture(page, info, 'designer-200-percent-emulated');
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await finishRecording(page, 'canvas-first-designer');
});

test('CP3 U04 site opening review identifies existing equipment and site without inventing a storage issue', async ({
  page,
}, info) => {
  test.setTimeout(120_000);
  await login(page);
  await page.setViewportSize({ width: 1180, height: 757 });
  const code = 'CP3-SITE-' + randomUUID().slice(0, 8).toUpperCase(),
    siteName = 'CP3 existing equipment ' + code;
  await page.goto('/settings/sites');
  const setup = page.locator('form').filter({
    has: page.getByRole('heading', {
      name: 'Add property/site',
      exact: true,
    }),
  });
  await setup.getByLabel('Name', { exact: true }).fill(siteName);
  await setup.getByLabel('Permanent code', { exact: true }).fill(code);
  await setup.getByRole('button', { name: 'Save site' }).click();
  await expect(
    page.getByRole('heading', { name: 'Site created' }),
  ).toBeVisible();
  await expect(
    page.getByRole('region', { name: 'Site creation complete' }),
  ).toContainText(siteName);
  await page.goto('/sites/' + code);
  await page
    .getByText('Record equipment already at this site', { exact: true })
    .click();
  await page
    .getByRole('link', { name: 'Record existing quantity item', exact: true })
    .click();
  let form = page.getByRole('form', {
    name: 'Record opening quantity item at site',
    exact: true,
  });
  const quantityName = 'CP3 existing adapters ' + randomUUID();
  await form.getByLabel('Name', { exact: true }).fill(quantityName);
  await form.getByLabel('Units already at this site').fill('2');
  await form
    .getByRole('button', { name: 'Review quantity item', exact: true })
    .click();
  let review = form.getByRole('region', { name: 'Metadata review' });
  await expectWithinViewport(
    page,
    review.getByRole('heading', { name: 'Review quantity item', exact: true }),
  );
  await expectWithinViewport(page, summaryValue(review, 'Site'));
  await expect(summaryValue(review, 'Site')).toHaveText(siteName);
  await expect(summaryValue(review, 'Count already at site')).toHaveText('2');
  await expect(review).toContainText(
    'Records equipment already at this site. No issue from storage is recorded.',
  );
  await capture(page, info, 'site-opening-review');
  await form
    .getByRole('button', { name: 'Add quantity item', exact: true })
    .click();
  await expect(page).toHaveURL(/\/inventory\/quantity\/[0-9a-f-]+$/);
  await expect(
    page.getByRole('heading', {
      name: 'Current stock — 0 available in storage',
    }),
  ).toBeVisible();
  await expect(
    page.getByText('2 assigned to sites · 2 total recorded'),
  ).toBeVisible();
  await page.goto('/sites/' + code);
  await page
    .getByText('Record equipment already at this site', { exact: true })
    .click();
  await page
    .getByRole('link', {
      name: 'Record existing individual asset',
      exact: true,
    })
    .click();
  form = page.getByRole('form', {
    name: 'Record opening individual asset at site',
    exact: true,
  });
  await form
    .getByLabel('Name', { exact: true })
    .fill('CP3 existing asset ' + randomUUID());
  await form
    .getByRole('button', { name: 'Review individual asset', exact: true })
    .click();
  review = form.getByRole('region', { name: 'Metadata review' });
  await expect(summaryValue(review, 'Site')).toHaveText(siteName);
  await expect(summaryValue(review, 'Count')).toHaveText(
    '1 individually tracked asset',
  );
  await expect(review).toContainText('No issue from storage is recorded.');
  await form
    .getByRole('button', { name: 'Add individual asset', exact: true })
    .click();
  await expect(page).toHaveURL(/\/inventory\/assets\/[0-9a-f-]+$/);
  await expect(
    page
      .locator('dt')
      .filter({ hasText: /^Current custody$/ })
      .locator('xpath=following-sibling::dd'),
  ).toContainText(siteName);
  await finishRecording(page, 'site-opening-review-create');
});

test('CP3 U15 empty file panel leads with the permitted task and viewer cannot mutate', async ({
  page,
  browser,
}, info) => {
  test.setTimeout(90_000);
  await login(page);
  const url = await createQuantity(page, 'CP3 empty photo ' + randomUUID());
  const files = page.getByRole('region', { name: 'Inventory files' });
  await expect(
    files.getByRole('heading', { name: 'Recognition photo' }),
  ).toBeVisible();
  await expect(files.getByText('No photo yet.', { exact: true })).toBeVisible();
  await expect(
    files.getByRole('button', { name: 'Browse files', exact: true }),
  ).toBeVisible();
  await expect(
    files.getByRole('button', { name: 'Check file cleanup' }),
  ).not.toBeVisible();
  await files
    .locator('summary')
    .filter({ hasText: /^File activity/ })
    .click();
  await expect(
    files.getByRole('button', { name: 'Check file cleanup' }),
  ).toBeVisible();
  await files.scrollIntoViewIfNeeded();
  await capture(page, info, 'staff-empty-photo');
  const viewerContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
  });
  try {
    const viewer = await viewerContext.newPage();
    await login(viewer, 'viewer');
    await viewer.goto(url);
    const readOnly = viewer.getByRole('region', { name: 'Inventory files' });
    await expect(
      readOnly.getByText('No photo yet.', { exact: true }),
    ).toBeVisible();
    await expect(
      readOnly.getByRole('button', { name: 'Browse files' }),
    ).toHaveCount(0);
    await expect(
      viewer.getByRole('region', { name: 'Record tasks' }),
    ).toHaveCount(0);
    await readOnly.scrollIntoViewIfNeeded();
    await capture(viewer, info, 'viewer-empty-photo-narrow');
  } finally {
    await viewerContext.close();
  }
  await finishRecording(page, 'empty-files-staff-viewer');
});
