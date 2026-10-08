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
