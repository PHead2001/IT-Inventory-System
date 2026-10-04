import { expect, test, type Page } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import fixture from '../fixtures/auth.json' with { type: 'json' };
import { chooseLocation } from './location-picker';

async function login(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Email', { exact: true }).fill(fixture.emails.staff);
  await page.getByLabel('Password', { exact: true }).fill(fixture.password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Inventory', exact: true }),
  ).toBeVisible();
}
async function inventory(page: Page) {
  const menu = page.getByRole('button', { name: 'Menu', exact: true });
  if (await menu.isVisible()) await menu.click();
  await page
    .getByRole('link', { name: 'Inventory', exact: true })
    .first()
    .click();
  await expect(
    page.getByRole('heading', { name: 'Inventory', exact: true }),
  ).toBeVisible();
}
test('creation recovery retains serialized input across Back/Forward, internal navigation and reload; saved draft stays terminal', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const warnings: string[] = [];
  page.on('dialog', async (dialog) => {
    warnings.push(dialog.type());
    await dialog.accept();
  });
  await login(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page
    .getByRole('link', { name: 'Create serialized asset', exact: true })
    .click();
  let form = page.getByRole('form', {
    name: 'Create asset inventory',
    exact: true,
  });
  await expect(form.getByLabel('Name', { exact: true })).toBeEnabled();
  await expect(page).toHaveURL(/draft=[0-9a-f-]{36}/);
  const draftURL = page.url();
  const suffix = crypto.randomUUID();
  const name = 'Checkpoint recovered asset ' + suffix,
    tag = 'REC-' + suffix,
    serial = 'SER-' + suffix;
  await form.getByLabel('Name', { exact: true }).fill(name);
  await form.getByLabel('Asset tag').fill(tag);
  await form.getByLabel('Serial number').fill(serial);
  await form.getByLabel('Manufacturer').fill('Fictional manufacturer');
  await form.getByLabel('Model').fill('Fictional model');
  await form.getByLabel('Description').fill('Raw recovery acceptance');
  const category = await form
    .getByLabel('Category', { exact: true })
    .inputValue();
  await chooseLocation(form, 'Current location', 'ITC-RED');
  await page.goBack();
  await expect(
    page.getByRole('heading', { name: 'Inventory', exact: true }),
  ).toBeVisible();
  await page.goForward();
  await expect(form.getByLabel('Name', { exact: true })).toHaveValue(name);
  await inventory(page);
  await page.goBack();
  await expect(form.getByLabel('Asset tag')).toHaveValue(tag);
  const warningsBefore = warnings.length;
  await page.reload();
  await expect(form.getByLabel('Name', { exact: true })).toHaveValue(name);
  await expect(form.getByLabel('Serial number')).toHaveValue(serial);
  await expect(form.getByLabel('Manufacturer')).toHaveValue(
    'Fictional manufacturer',
  );
  await expect(form.getByLabel('Model')).toHaveValue('Fictional model');
  await expect(form.getByLabel('Description')).toHaveValue(
    'Raw recovery acceptance',
  );
  await expect(form.getByLabel('Category', { exact: true })).toHaveValue(
    category,
  );
  await expect(
    form.getByLabel('Current location', { exact: true }),
  ).toContainText('ITC-RED');
  expect(warnings.slice(warningsBefore)).toContain('beforeunload');
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await form.getByRole('button', { name: 'Review metadata' }).click();
  await expect(
    form.getByRole('region', { name: 'Metadata review' }),
  ).toBeVisible();
  await form.getByRole('button', { name: 'Confirm save' }).click();
  await expect(page).toHaveURL(/\/inventory\/assets\/[0-9a-f-]+$/);
  const savedURL = page.url();
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
  await page.goto(draftURL);
  await expect(
    page.getByText('This creation draft was already saved.'),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Confirm save' })).toHaveCount(
    0,
  );
  const afterSaveWarnings = warnings.length;
  await page.reload();
  expect(warnings.length).toBe(afterSaveWarnings);
  await page.goto(savedURL);
  await page
    .locator('summary')
    .filter({ hasText: /^Retire asset$/ })
    .click();
  form = page.getByRole('form', { name: 'Retire asset', exact: true });
  await form
    .getByLabel('Reason (required)')
    .fill('Checkpoint local recovery acceptance cleanup');
  await form
    .getByRole('button', { name: 'Review retire asset', exact: true })
    .click();
  await form
    .getByRole('button', { name: 'Confirm retire asset', exact: true })
    .click();
  await expect(page.getByText(/Version 2$/)).toBeVisible();
});
test('quantity creation preserves stock input; explicit discard survives return and pristine forms do not warn', async ({
  page,
}) => {
  test.setTimeout(90_000);
  const warnings: string[] = [];
  page.on('dialog', async (dialog) => {
    warnings.push(dialog.type());
    await dialog.accept();
  });
  await login(page);
  await page
    .getByRole('link', { name: 'Create quantity inventory', exact: true })
    .click();
  const form = page.getByRole('form', {
    name: 'Create quantity inventory',
    exact: true,
  });
  await expect(form.getByLabel('Name', { exact: true })).toBeEnabled();
  await page.reload();
  expect(warnings).toEqual([]);
  const name = 'Checkpoint discarded quantity ' + crypto.randomUUID();
  await form.getByLabel('Name', { exact: true }).fill(name);
  await form.getByLabel('Item code (SKU)').fill('RECOVERY-SKU');
  await form.getByLabel('Initial quantity').fill('3');
  await chooseLocation(form, 'Initial location', 'ITC-RED');
  const draftURL = page.url();
  await inventory(page);
  await page.goBack();
  await expect(form.getByLabel('Name', { exact: true })).toHaveValue(name);
  await expect(form.getByLabel('Item code (SKU)')).toHaveValue('RECOVERY-SKU');
  await expect(form.getByLabel('Initial quantity')).toHaveValue('3');
  await expect(
    form.getByLabel('Initial location', { exact: true }),
  ).toContainText('ITC-RED');
  await form.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Keep editing' }),
  ).toBeFocused();
  await page.getByRole('button', { name: 'Keep editing' }).click();
  await expect(
    form.getByRole('button', { name: 'Cancel', exact: true }),
  ).toBeFocused();
  await form.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page
    .getByRole('button', { name: 'Discard changes', exact: true })
    .click();
  await expect(
    page.getByRole('heading', { name: 'Inventory', exact: true }),
  ).toBeVisible();
  await page.goBack();
  await expect(
    page.getByText('This creation draft was discarded.'),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByText('This creation draft was discarded.'),
  ).toBeVisible();
  await expect(
    page.getByRole('textbox', { name: 'Name', exact: true }),
  ).toHaveCount(0);
  expect(page.url()).toBe(draftURL);
});
test('unavailable creation storage explains internal-navigation limits, blocks dispatch and still warns before tab closure', async ({
  page,
}) => {
  test.setTimeout(90_000);
  await page.addInitScript(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key.startsWith('inventory-creation-v1:'))
        throw new DOMException('Fixture quota', 'QuotaExceededError');
      return original.call(this, key, value);
    };
  });
  await login(page);
  await page
    .getByRole('link', { name: 'Create serialized asset', exact: true })
    .click();
  const form = page.getByRole('form', {
    name: 'Create asset inventory',
    exact: true,
  });
  await form
    .getByLabel('Name', { exact: true })
    .fill('Checkpoint storage failure');
  await chooseLocation(form, 'Current location', 'ITC-RED');
  await form.getByRole('button', { name: 'Review metadata' }).click();
  await form.getByRole('button', { name: 'Confirm save' }).click();
  await expect(form.getByRole('alert')).toContainText(
    'browser and internal navigation may lose',
  );
  await expect(page).toHaveURL(/\/inventory\/assets\/new/);
  const closing = page.waitForEvent('dialog');
  void page.close({ runBeforeUnload: true });
  const warning = await closing;
  expect(warning.type()).toBe('beforeunload');
  await warning.accept();
});

async function localAssetSnapshot(name: string) {
  const apiURL = process.env.LOCAL_API_URL;
  const publicKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!apiURL || !publicKey)
    throw new Error('Canonical local E2E environment is required.');
  const target = new URL(apiURL);
  if (
    !['127.0.0.1', 'localhost', '[::1]'].includes(target.hostname) ||
    target.port !== '54321'
  )
    throw new Error('Refusing nonlocal create recovery evidence.');
  const caller = createClient(apiURL, publicKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const signed = await caller.auth.signInWithPassword({
    email: fixture.emails.staff,
    password: fixture.password,
  });
  if (signed.error) throw new Error('Local evidence reader could not sign in.');
  try {
    const assets = await caller
      .from('serialized_assets')
      .select('id,name,version,status')
      .eq('name', name);
    if (assets.error) throw new Error('Authorized asset evidence read failed.');
    const ids = assets.data.map((asset) => asset.id);
    const events = ids.length
      ? await caller
          .from('asset_events')
          .select('id,asset_id,kind,version')
          .in('asset_id', ids)
          .order('version')
      : { data: [], error: null };
    if (events.error)
      throw new Error('Authorized asset event evidence read failed.');
    return { assets: assets.data, events: events.data };
  } finally {
    await caller.auth.signOut({ scope: 'local' });
  }
}

test('creation response lost after real commit reloads and resolves the original request with one asset and one creation event', async ({
  page,
}, info) => {
  test.setTimeout(120_000);
  page.on('dialog', (dialog) => void dialog.accept());
  await page.goto('/login');
  await page.getByLabel('Email', { exact: true }).fill(fixture.emails.staff);
  await page.getByLabel('Password', { exact: true }).fill(fixture.password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Inventory', exact: true }),
  ).toBeVisible();
  await page
    .getByRole('link', { name: 'Create serialized asset', exact: true })
    .click();
  const form = page.getByRole('form', {
    name: 'Create asset inventory',
    exact: true,
  });
  const name = 'Checkpoint lost-response asset ' + crypto.randomUUID();
  await form.getByLabel('Name', { exact: true }).fill(name);
  await chooseLocation(form, 'Current location', 'ITC-RED');
  await form
    .getByRole('button', { name: 'Review metadata', exact: true })
    .click();
  await expect(
    form.getByRole('button', { name: 'Confirm save', exact: true }),
  ).toBeEnabled();
  let createdId: string | undefined;
  let aborted = false;
  const routePattern = '**/inventory/assets/new**';
  await page.route(routePattern, async (route) => {
    const request = route.request();
    if (
      aborted ||
      request.method() !== 'POST' ||
      !request.headers()['next-action']
    )
      return route.continue();
    // Execute the actual authenticated server action and allow its transaction
    // to finish. Only the browser response is lost; no committed result is mocked.
    const response = await route.fetch();
    expect(response.status()).toBe(200);
    const committed = await localAssetSnapshot(name);
    createdId = committed.assets[0]?.id;
    expect(committed.assets).toHaveLength(1);
    expect(committed.assets[0].version).toBe(1);
    expect(
      committed.events.filter((event) => event.kind === 'created'),
    ).toHaveLength(1);

    aborted = true;
    await info.attach('real-commit-before-aborted-response.json', {
      body: JSON.stringify(committed, null, 2),
      contentType: 'application/json',
    });
    await route.abort('failed');
  });
  try {
    await form
      .getByRole('button', { name: 'Confirm save', exact: true })
      .click();
    await expect(
      form.getByRole('button', { name: 'Retry same save', exact: true }),
    ).toBeVisible();
    expect(aborted).toBe(true);
    const original = await page.evaluate(() => {
      const key = Object.keys(sessionStorage).find(
        (key) =>
          key.startsWith('inventory-creation-v1:') &&
          JSON.parse(sessionStorage.getItem(key)!).status === 'submitted',
      );
      if (!key)
        throw new Error('Original submitted creation command is missing.');
      return JSON.parse(sessionStorage.getItem(key)!).command;
    });
    expect(original.operation).toBe('asset_create_v2');
    expect(original.payload.name).toBe(name);
    await page.screenshot({
      path: info.outputPath('committed-response-lost.png'),
      fullPage: true,
    });
    await page.reload();
    await expect(
      form.getByRole('button', { name: 'Retry same save', exact: true }),
    ).toBeVisible();
    await expect(form.getByLabel('Name', { exact: true })).toBeDisabled();
    await expect(
      form.getByRole('button', { name: 'Cancel', exact: true }),
    ).toBeDisabled();
    const recovered = await page.evaluate(() => {
      const key = Object.keys(sessionStorage).find(
        (key) =>
          key.startsWith('inventory-creation-v1:') &&
          JSON.parse(sessionStorage.getItem(key)!).status === 'submitted',
      );
      if (!key) throw new Error('Reload lost the submitted creation command.');
      return JSON.parse(sessionStorage.getItem(key)!).command;
    });
    expect(recovered).toEqual(original);
    await page.unroute(routePattern);
    await form
      .getByRole('button', { name: 'Retry same save', exact: true })
      .click();
    await expect(page).toHaveURL(
      new RegExp('/inventory/assets/' + createdId + '$'),
    );
    const resolved = await localAssetSnapshot(name);
    expect(resolved.assets).toHaveLength(1);
    expect(resolved.assets[0].id).toBe(createdId);
    expect(resolved.assets[0].version).toBe(1);
    expect(
      resolved.events.filter((event) => event.kind === 'created'),
    ).toHaveLength(1);
    await info.attach('same-request-resolved-single-create.json', {
      body: JSON.stringify(
        { requestId: original.requestId, ...resolved },
        null,
        2,
      ),
      contentType: 'application/json',
    });
    await page.screenshot({
      path: info.outputPath('same-request-resolved.png'),
      fullPage: true,
    });
  } finally {
    await page.unroute(routePattern);
    if (createdId) {
      await page.goto('/inventory/assets/' + createdId);
      await page
        .locator('summary')
        .filter({ hasText: /^Retire asset$/ })
        .click();
      const retire = page.getByRole('form', {
        name: 'Retire asset',
        exact: true,
      });
      await retire
        .getByLabel('Reason (required)')
        .fill('Checkpoint real lost-response fixture cleanup');
      await retire
        .getByRole('button', { name: 'Review retire asset', exact: true })
        .click();
      await retire
        .getByRole('button', { name: 'Confirm retire asset', exact: true })
        .click();
      await expect(page.getByText(/Version 2$/)).toBeVisible();
      const cleaned = await localAssetSnapshot(name);
      expect(cleaned.assets[0].status).toBe('retired');
      await info.attach('lost-response-fixture-retired.json', {
        body: JSON.stringify(cleaned, null, 2),
        contentType: 'application/json',
      });
    }
  }
});
