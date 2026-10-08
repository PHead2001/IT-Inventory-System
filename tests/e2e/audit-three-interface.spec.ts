import { randomUUID } from 'node:crypto';
import {
  expect,
  test as base,
  type Page,
  type Request,
  type Route,
} from '@playwright/test';
import fixture from '../fixtures/auth.json' with { type: 'json' };
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { displayedInstant } from '../helpers/displayed-instant';

async function command(
  caller: SupabaseClient,
  operation: string,
  payload: Record<string, unknown>,
) {
  const result = await caller.rpc(operation, {
    p_request_id: randomUUID(),
    p_payload: payload,
  });
  expect(result.error, `${operation}: ${result.error?.message}`).toBeNull();
  return result.data as Record<string, string>;
}
const test = base.extend<{
  interfaceRecord: { id: string; categoryId: string; name: string };
}>({
  interfaceRecord: async ({ baseURL }, provideRecord) => {
    expect(['localhost', '127.0.0.1']).toContain(new URL(baseURL!).hostname);
    const api = new URL(process.env.LOCAL_API_URL!);
    expect(['localhost', '127.0.0.1']).toContain(api.hostname);
    expect(api.port).toBe('54321');
    const caller = createClient(
      api.href,
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
    const signedIn = await caller.auth.signInWithPassword({
      email: fixture.emails.staff,
      password: fixture.password,
    });
    expect(signedIn.error).toBeNull();
    let categoryId: string | undefined, itemId: string | undefined;
    try {
      const suffix = randomUUID();
      const category = await command(caller, 'category_create', {
        code: 'A3-UI-' + suffix.replaceAll('-', '').slice(0, 16).toUpperCase(),
        name: 'Interface fixture ' + suffix,
        sort_order: 900,
      });
      categoryId = category.category_id;
      const form = await caller
        .from('categories')
        .select('published_form_revision_id')
        .eq('id', categoryId)
        .single();
      expect(form.error).toBeNull();
      const name = 'Interface quantity ' + suffix;
      const item = await command(caller, 'quantity_create_v2', {
        name,
        category_id: categoryId,
        initial_quantity: 0,
        expected_published_revision_id: form.data!.published_form_revision_id,
        custom_patch: { set: {}, unset: [] },
      });
      itemId = item.entity_id;
      await provideRecord({ id: itemId, categoryId, name });
    } finally {
      try {
        if (itemId) {
          const current = await caller
            .from('quantity_items')
            .select('version,archived')
            .eq('id', itemId)
            .single();
          expect(current.error).toBeNull();
          if (!current.data!.archived)
            await command(caller, 'quantity_archive_and_clear', {
              item_id: itemId,
              expected_version: current.data!.version,
              confirm_clear_stock: true,
              reason: 'Owned Audit three interface fixture cleanup',
            });
        }
        if (categoryId) {
          const replacement = await caller
            .from('categories')
            .select('id')
            .eq('code', 'CABLES')
            .eq('active', true)
            .single();
          expect(replacement.error).toBeNull();
          const review = await caller.rpc('category_removal_review', {
            p_category_id: categoryId,
            p_replacement_id: replacement.data!.id,
          });
          expect(review.error).toBeNull();
          await command(caller, 'category_remove', {
            category_id: categoryId,
            replacement_id: replacement.data!.id,
            review_token: (review.data as { token: string }).token,
          });
        }
      } finally {
        await caller.auth.signOut({ scope: 'local' });
      }
    }
  },
});

async function login(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Email', { exact: true }).fill(fixture.emails.staff);
  await page.getByLabel('Password', { exact: true }).fill(fixture.password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Inventory', exact: true }),
  ).toBeVisible();
}

test('local UI and code fonts load on an existing location label', async ({
  page,
}) => {
  await login(page);
  await page.goto('/labels?location=ITC-RED');
  const code = page
    .locator('.label-card span.font-mono[title="ITC-RED"]')
    .first();
  await expect(code).toBeVisible();
  await expect(code).toHaveText('ITC-RED');
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  const fonts = await code.evaluate((node) => {
    const root = getComputedStyle(document.documentElement);
    return {
      body: getComputedStyle(document.body).fontFamily,
      code: getComputedStyle(node).fontFamily,
      ui: root
        .getPropertyValue('--font-ui')
        .split(',')[0]
        .trim()
        .replaceAll('"', ''),
      mono: root
        .getPropertyValue('--font-code')
        .split(',')[0]
        .trim()
        .replaceAll('"', ''),
      loaded: [...document.fonts]
        .filter((face) => face.status === 'loaded')
        .map((face) => face.family.replaceAll('"', '')),
      resources: performance
        .getEntriesByType('resource')
        .map((entry) => entry.name),
    };
  });
  expect(fonts.ui).not.toBe('');
  expect(fonts.mono).not.toBe('');
  expect(fonts.body.replaceAll('"', '')).toContain(fonts.ui);
  expect(fonts.code.replaceAll('"', '')).toContain(fonts.mono);
  expect(fonts.loaded).toContain(fonts.ui);
  expect(fonts.loaded).toContain(fonts.mono);
  expect(fonts.resources.some((url) => /inter.*\.woff2/.test(url))).toBe(true);
  expect(fonts.resources.some((url) => /jetbrains.*\.woff2/.test(url))).toBe(
    true,
  );
});

async function fits(page: Page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
}

test('loaded local fonts and populated scan, labels and form designer remain usable at phone widths', async ({
  page,
  interfaceRecord,
}, info) => {
  await login(page);
  const origin = new URL(process.env.APP_ORIGIN!);
  expect(['localhost', '127.0.0.1']).toContain(origin.hostname);
  const id = interfaceRecord.id;
  await page.goto(`/inventory/quantity/${id}`);
  await expect(page).toHaveTitle('Quantity item · IT Inventory');
  const disclosure = page
    .locator('details')
    .filter({ has: page.locator('summary > time') })
    .first();
  await disclosure.locator('summary').click();
  const code = disclosure.locator('.experience-code');
  await expect(code).toBeVisible();
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  const fonts = await code.evaluate((node) => {
    const root = getComputedStyle(document.documentElement);
    return {
      body: getComputedStyle(document.body).fontFamily,
      code: getComputedStyle(node).fontFamily,
      ui: root
        .getPropertyValue('--font-ui')
        .split(',')[0]
        .trim()
        .replaceAll('"', ''),
      mono: root
        .getPropertyValue('--font-code')
        .split(',')[0]
        .trim()
        .replaceAll('"', ''),
      loaded: [...document.fonts]
        .filter((face) => face.status === 'loaded')
        .map((face) => face.family.replaceAll('"', '')),
      resources: performance
        .getEntriesByType('resource')
        .map((entry) => entry.name),
    };
  });
  expect(fonts.ui).not.toBe('');
  expect(fonts.mono).not.toBe('');
  expect(fonts.body.replaceAll('"', '')).toContain(fonts.ui);
  expect(fonts.code.replaceAll('"', '')).toContain(fonts.mono);
  expect(fonts.loaded).toContain(fonts.ui);
  expect(fonts.loaded).toContain(fonts.mono);
  expect(fonts.resources.some((url) => /inter.*\.woff2/.test(url))).toBe(true);
  expect(fonts.resources.some((url) => /jetbrains.*\.woff2/.test(url))).toBe(
    true,
  );
  for (const width of [375, 390]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto(`/labels?quantity=${id}`);
    await expect(page.locator('.label-card')).not.toHaveCount(0);
    await page.evaluate(() => document.fonts.ready.then(() => undefined));
    await expect(
      page.getByRole('combobox', { name: 'Label size', exact: true }),
    ).toBeEnabled();
    await fits(page);
    await page.screenshot({
      path: info.outputPath(`labels-${width}.png`),
      fullPage: true,
    });
    await page.goto('/scan');
    const manual = page.getByRole('textbox').first();
    await manual.fill(
      new URL(`/inventory/quantity/${id}`, process.env.APP_ORIGIN!).href,
    );
    await expect(
      page.getByRole('button', { name: 'Open', exact: true }),
    ).toBeEnabled();
    await fits(page);
    await page.screenshot({
      path: info.outputPath(`scan-${width}.png`),
      fullPage: true,
    });
    await page.getByRole('button', { name: 'Open', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/inventory/quantity/${id}$`));
    await page.goto('/settings/forms');
    await page
      .locator(`main a[href="/settings/forms/${interfaceRecord.categoryId}"]`)
      .click();
    await expect(
      page.getByRole('region', { name: 'Forms and fields' }),
    ).toBeVisible();
    await expect(page).toHaveTitle('Category forms · IT Inventory');
    await expect(
      page.getByRole('navigation', { name: 'Designer panels' }),
    ).toBeVisible();
    await fits(page);
    await page.screenshot({
      path: info.outputPath(`form-designer-${width}.png`),
      fullPage: true,
    });
  }
});

test('designer dialog hands focus to visible additions and existing fields while Cancel returns to its trigger', async ({
  page,
  interfaceRecord,
}) => {
  await login(page);
  await page.goto(`/settings/forms/${interfaceRecord.categoryId}`);
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 844 });
    const designer = page.getByRole('region', { name: 'Forms and fields' });
    const panels = designer.getByRole('navigation', {
      name: 'Designer panels',
    });
    const library = async () => {
      if (width === 390)
        await panels
          .getByRole('button', { name: 'Library', exact: true })
          .click();
    };
    await library();
    const trigger = designer.getByRole('button', {
      name: 'Add field',
      exact: true,
    });
    await trigger.click();
    let dialog = page.getByRole('dialog', { name: 'Add field' });
    const fieldName = `Focus field ${width}`;
    await dialog.getByLabel('Field name', { exact: true }).fill(fieldName);
    await dialog
      .getByRole('button', { name: 'Add to form', exact: true })
      .click();
    await expect(dialog).toHaveCount(0);
    const control = designer
      .getByRole('button', {
        name: `Drag ${fieldName}`,
        exact: true,
        includeHidden: true,
      })
      .locator('xpath=ancestor::*[@data-control-id][1]');
    const inspector = designer.getByTestId('designer-inspector');
    await expect(control).toHaveAttribute('data-selected', 'true');
    if (width === 1440) await expect(control).toBeFocused();
    else {
      await expect(
        inspector.getByRole('heading', { name: 'Inspector', exact: true }),
      ).toBeFocused();
      await expect(inspector).toBeVisible();
    }
    await library();
    await trigger.click();
    dialog = page.getByRole('dialog', { name: 'Add field' });
    await dialog
      .getByRole('button', { name: 'Cancel field addition', exact: true })
      .click();
    await expect(trigger).toBeVisible();
    await expect(trigger).toBeFocused();
    await trigger.click();
    dialog = page.getByRole('dialog', { name: 'Add field' });
    await dialog
      .getByRole('tab', { name: 'Standard fields', exact: true })
      .click();
    await dialog
      .getByText('Name', { exact: true })
      .locator('..')
      .getByRole('button', { name: 'Go to field', exact: true })
      .click();
    await expect(dialog).toHaveCount(0);
    const name = designer
      .getByRole('button', {
        name: 'Drag Name',
        exact: true,
        includeHidden: true,
      })
      .locator('xpath=ancestor::*[@data-control-id][1]');
    await expect(name).toHaveAttribute('data-selected', 'true');
    await expect(
      inspector.getByRole('region', {
        name: 'Name layout properties',
        exact: true,
      }),
    ).toBeVisible();
    if (width === 1440) await expect(name).toBeFocused();
    else
      await expect(
        inspector.getByRole('heading', { name: 'Inspector', exact: true }),
      ).toBeFocused();
  }
});

test('relative history exposes exact timezone and original precision through keyboard disclosure', async ({
  page,
  interfaceRecord,
}, info) => {
  await login(page);
  await page.goto(`/history?type=quantity&entityId=${interfaceRecord.id}`);
  const time = page.locator('summary > time').first();
  await expect(time).toBeVisible();
  const original = await time.getAttribute('datetime');
  const summary = time.locator('xpath=parent::summary');
  const disclosure = summary.locator('xpath=parent::details');
  await summary.focus();
  await expect(summary).toBeFocused();
  await summary.press('Enter');
  await expect(disclosure).toHaveAttribute('open', '');
  const exact = disclosure.locator(':scope > p').first();
  await expect(exact).toBeVisible();
  await expect(exact).toContainText(/UTC|GMT/);
  expect(displayedInstant((await exact.textContent())!)).toBe(
    Math.floor(Date.parse(original!) / 1000) * 1000,
  );
  await expect(disclosure.getByText(original!, { exact: true })).toBeVisible();
  await expect(time).toHaveAttribute('datetime', original!);
  await page.screenshot({
    path: info.outputPath('history-exact-disclosure.png'),
    fullPage: true,
  });
});

// Synthetic navigation-boundary fixture: the record remains real and intact.
// Rewrite only its actual navigation RSC request to the server's real missing-record
// route. This exercises client notFound handling, not a missing-data integration.
test('synthetic RSC missing-resource response uses the client navigation boundary and private-safe recovery', async ({
  page,
  interfaceRecord,
}, info) => {
  await login(page);
  const ownedPath = `/inventory/quantity/${interfaceRecord.id}`;
  const missingId = randomUUID();
  const missingPath = `/inventory/quantity/${missingId}`;
  const navigations: string[] = [];
  const prefetches: string[] = [];
  const intercepted: Request[] = [];
  let responseStatus: number | undefined;
  let responseTitle: string | undefined;
  const matches = (url: URL) => url.pathname === ownedPath;
  const handler = async (route: Route) => {
    const request = route.request();
    const headers = request.headers();
    const prefetch =
      headers['next-router-prefetch'] === '1' ||
      headers.purpose === 'prefetch' ||
      headers['sec-purpose']?.includes('prefetch');
    if (prefetch) prefetches.push(request.url());
    if (!prefetch && request.method() === 'GET' && headers.rsc === '1') {
      const target = new URL(request.url());
      target.pathname = missingPath;
      intercepted.push(request);
      await route.continue({ url: target.href });
    } else await route.continue();
  };
  const recordDocument = (request: Request) => {
    if (request.resourceType() === 'document') navigations.push(request.url());
  };
  await page.route(matches, handler);
  try {
    await page.goto('/inventory?q=' + encodeURIComponent(interfaceRecord.name));
    const link = page.getByRole('link', {
      name: interfaceRecord.name,
      exact: true,
    });
    await expect(link).toBeVisible();
    expect(
      new URL((await link.getAttribute('href'))!, page.url()).pathname,
    ).toBe(ownedPath);
    page.on('request', recordDocument);
    const arrived = page.waitForResponse((response) =>
      intercepted.includes(response.request()),
    );
    await link.click();
    const response = await arrived;
    responseStatus = response.status();
    expect(response.headers()['content-type']).toContain('text/x-component');
    expect(intercepted.length).toBeGreaterThan(0);
    await expect(
      page.getByRole('heading', {
        name: 'Inventory record unavailable',
        exact: true,
      }),
    ).toBeVisible();
    // Successful static layout metadata may remain when page-data notFound
    // activates the client boundary independently of metadata resolution.
    await expect(page).toHaveTitle('Quantity item · IT Inventory');
    responseTitle = await page.title();
    for (const privateValue of [
      interfaceRecord.id,
      missingId,
      interfaceRecord.name,
    ]) {
      await expect(page.locator('head title')).not.toContainText(privateValue);
      await expect(page.locator('main')).not.toContainText(privateValue);
    }
    expect(
      navigations,
      'Client RSC arrival must not fall back to document navigation',
    ).toEqual([]);
    await page
      .getByRole('link', { name: 'Search inventory', exact: true })
      .click();
    await expect(page).toHaveURL(/\/inventory$/);
    await expect(page).toHaveTitle('Inventory · IT Inventory');
    expect(navigations).toEqual([]);
  } finally {
    page.off('request', recordDocument);
    await page.unroute(matches, handler);
    await info.attach('synthetic RSC navigation evidence', {
      body: JSON.stringify({
        synthetic: true,
        observedNavigationRsc: intercepted.length,
        untouchedPrefetches: prefetches,
        rscResponseStatus: responseStatus,
        observedClientTitle: responseTitle,
        documentNavigations: navigations,
      }),
      contentType: 'application/json',
    });
  }
});

test('missing resources keep direct transport status and private-safe identity with client recovery', async ({
  page,
  browser,
}, info) => {
  await login(page);
  for (const [path, heading] of [
    ['/audit-three-missing-' + randomUUID(), 'Page not found'],
    ['/inventory/quantity/' + randomUUID(), 'Inventory record unavailable'],
    ['/inventory/assets/' + randomUUID(), 'Inventory record unavailable'],
  ]) {
    const response = await page.goto(path);
    expect(
      response!.status(),
      `Direct missing-resource status for ${path}`,
    ).toBe(404);
    await expect(
      page.getByRole('heading', { name: heading, exact: true }),
    ).toBeVisible();
    await expect(page).toHaveTitle(/IT Inventory/);
    await expect(page.locator('head title')).not.toContainText(
      path.split('/').at(-1)!,
    );
    await page.screenshot({
      path: info.outputPath(
        `missing-${path.includes('quantity') ? 'quantity' : path.includes('assets') ? 'asset' : 'route'}.png`,
      ),
      fullPage: true,
    });
    await page
      .getByRole('link', { name: 'Search inventory', exact: true })
      .click();
    await expect(page).toHaveURL(/\/inventory$/);
    await expect(page).toHaveTitle('Inventory · IT Inventory');
  }
  const anonymous = await browser.newContext();
  try {
    const visitor = await anonymous.newPage();
    await visitor.goto('/inventory/assets/' + randomUUID());
    await expect(visitor).toHaveURL(/\/login/);
    await expect(visitor).toHaveTitle(/Sign in.*IT Inventory/);
    await expect(
      visitor.getByRole('heading', { name: 'Inventory record unavailable' }),
    ).toHaveCount(0);
  } finally {
    await anonymous.close();
  }
  for (const [path, title] of [
    ['/scan', 'Scan'],
    ['/labels', 'Labels'],
    ['/history', 'History'],
  ]) {
    await page.goto(path);
    await expect(page).toHaveTitle(`${title} · IT Inventory`);
  }
  const icon = page.locator('link[rel="icon"]').first();
  const iconResponse = await page.request.get(
    (await icon.getAttribute('href'))!,
  );
  expect(iconResponse.ok()).toBe(true);
  expect(iconResponse.headers()['content-type']).toMatch(/image/);
});

test('route titles describe owned inventory and configuration types without private identity', async ({
  page,
  interfaceRecord,
}) => {
  await login(page);
  for (const [path, title] of [
    [`/inventory/quantity/${interfaceRecord.id}`, 'Quantity item'],
    [`/settings/forms/${interfaceRecord.categoryId}`, 'Category forms'],
  ]) {
    await page.goto(path);
    await expect(page).toHaveTitle(`${title} · IT Inventory`);
    for (const privateValue of [
      interfaceRecord.id,
      interfaceRecord.categoryId,
      interfaceRecord.name,
    ])
      await expect(page.locator('head title')).not.toContainText(privateValue);
  }
});
