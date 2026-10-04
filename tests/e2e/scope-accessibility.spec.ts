import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import fixture from '../fixtures/auth.json' with { type: 'json' };

async function signIn(page: Page, role: 'staff' | 'viewer' = 'staff') {
  await page.goto('/login');
  await page.getByLabel('Email', { exact: true }).fill(fixture.emails[role]);
  await page.getByLabel('Password', { exact: true }).fill(fixture.password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page).toHaveURL(/\/inventory$/);
}
function localApi() {
  const url = new URL(process.env.LOCAL_API_URL!);
  expect(['localhost', '127.0.0.1']).toContain(url.hostname);
  expect(url.port).toBe('54321');
  return url.href;
}
async function fixtureCaller() {
  const caller = createClient(
    localApi(),
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const result = await caller.auth.signInWithPassword({
    email: fixture.emails.staff,
    password: fixture.password,
  });
  expect(result.error).toBeNull();
  return caller;
}
async function mutate(
  caller: SupabaseClient,
  operation: string,
  payload: Record<string, unknown>,
) {
  const result = await caller.rpc(operation, {
    p_request_id: randomUUID(),
    p_payload: payload,
  });
  expect(result.error, operation + ' fixture operation').toBeNull();
  return z.record(z.string(), z.unknown()).parse(result.data);
}
/** Initial state only. Every acceptance assertion below uses normal UI controls. */
async function scopeFixture() {
  const caller = await fixtureCaller();
  const prefix = 'AAAA Scope ' + randomUUID().slice(0, 8);
  const quantities: string[] = [];
  const assets: string[] = [];
  const locations = await caller
    .from('locations')
    .select('id,code')
    .in('code', ['ITC-RED', 'ITC-BLACK']);
  expect(locations.error).toBeNull();
  const location = (code: string) =>
    locations.data!.find((row) => row.code === code)!.id as string;
  const category = await mutate(caller, 'category_create', {
    code:
      'SCOPE-' + randomUUID().replaceAll('-', '').slice(0, 16).toUpperCase(),
    name: prefix + ' category',
    sort_order: 100,
  });
  const categoryId = category.category_id as string;
  const createQuantity = async (
    name: string,
    count: number,
    code = 'ITC-BLACK',
  ) => {
    const created = await mutate(caller, 'quantity_create', {
      name,
      category_id: categoryId,
      initial_quantity: count,
      initial_location_id: count ? location(code) : null,
    });
    quantities.push(created.entity_id as string);
    return created.entity_id as string;
  };
  const cleanup = async () => {
    for (const id of quantities) {
      const record = await caller
        .from('quantity_items')
        .select('version,archived')
        .eq('id', id)
        .single();
      expect(record.error).toBeNull();
      if (!record.data!.archived)
        await mutate(caller, 'quantity_archive_and_clear', {
          item_id: id,
          expected_version: record.data!.version,
          confirm_clear_stock: true,
          reason: 'Checkpoint 2 fictional scope fixture cleanup',
        });
    }
    for (const id of assets) {
      const record = await caller
        .from('serialized_assets')
        .select('version,status')
        .eq('id', id)
        .single();
      expect(record.error).toBeNull();
      if (record.data!.status === 'active')
        await mutate(caller, 'asset_retire', {
          asset_id: id,
          expected_version: record.data!.version,
          reason: 'Checkpoint 2 fictional scope fixture cleanup',
        });
    }
    const replacement = await caller
      .from('categories')
      .select('id')
      .eq('active', true)
      .neq('id', categoryId)
      .order('sort_order')
      .limit(1)
      .single();
    expect(replacement.error).toBeNull();
    const review = await caller.rpc('category_removal_review', {
      p_category_id: categoryId,
      p_replacement_id: replacement.data!.id,
    });
    expect(review.error).toBeNull();
    const token = z
      .object({ token: z.uuid() })
      .passthrough()
      .parse(review.data).token;
    await mutate(caller, 'category_remove', {
      category_id: categoryId,
      replacement_id: replacement.data!.id,
      review_token: token,
    });
    await caller.auth.signOut({ scope: 'local' });
  };
  try {
    const splitName = prefix + ' 00 split adapters';
    const splitId = await createQuantity(splitName, 2, 'ITC-RED');
    await mutate(caller, 'quantity_move', {
      item_id: splitId,
      expected_version: 1,
      source_location_id: location('ITC-RED'),
      destination_location_id: location('ITC-BLACK'),
      quantity: 1,
      move_all: false,
    });
    for (let index = 0; index < 26; index++)
      await createQuantity(
        prefix + ' holding ' + String(index).padStart(2, '0'),
        1,
      );
    const zeroId = await createQuantity(prefix + ' unlocated definition', 0);
    for (const historical of [false, true]) {
      const created = await mutate(caller, 'asset_create', {
        name: prefix + (historical ? ' retired laptop' : ' active laptop'),
        category_id: categoryId,
        location_id: location('ITC-BLACK'),
        asset_tag: 'SCOPE-' + randomUUID().slice(0, 16),
      });
      assets.push(created.entity_id as string);
      if (historical)
        await mutate(caller, 'asset_retire', {
          asset_id: created.entity_id,
          expected_version: 1,
          reason: 'Checkpoint 2 historical inclusion fixture',
        });
    }
    return { caller, prefix, splitName, splitId, zeroId, cleanup };
  } catch (error) {
    await cleanup();
    throw error;
  }
}
async function assertFits(page: Page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
}
async function keepDelayedFetchAlive(
  page: Page,
  pathname: string,
  query: Record<string, string | string[]>,
  rsc = false,
) {
  // Intentionally deliver superseded responses to exercise the generation guard.
  // Chromium may otherwise abort the route before Playwright can fulfill it.
  await page.addInitScript(
    ({ pathname, query, rsc }) => {
      const fetch = window.fetch.bind(window);
      window.fetch = (input, init) => {
        const url = new URL(
          input instanceof Request ? input.url : String(input),
          window.location.href,
        );
        const headers = new Headers(
          init?.headers ??
            (input instanceof Request ? input.headers : undefined),
        );
        const method = (
          init?.method ?? (input instanceof Request ? input.method : 'GET')
        ).toUpperCase();
        const delayed =
          method === 'GET' &&
          url.origin === window.location.origin &&
          url.pathname === pathname &&
          Object.entries(query).every(([key, value]) =>
            Array.isArray(value)
              ? value.includes(url.searchParams.get(key) ?? '')
              : url.searchParams.get(key) === value,
          ) &&
          (!rsc || headers.get('rsc') === '1');
        return fetch(input, delayed ? { ...init, signal: null } : init);
      };
    },
    { pathname, query, rsc },
  );
}
function csvRows(text: string) {
  return text
    .replace(/^\uFEFF/, '')
    .trimEnd()
    .split(/\r?\n/)
    .map((line) =>
      (line.match(/(?:"(?:[^"]|"")*"|[^,]*)(?:,|$)/g) ?? [])
        .slice(0, -1)
        .map((cell) =>
          cell.replace(/,$/, '').replace(/^"|"$/g, '').replaceAll('""', '"'),
        ),
    );
}

test('location status, holding scope, matching rows and real CSV agree across navigation and page boundaries', async ({
  page,
}, testInfo) => {
  test.setTimeout(180_000);
  const setup = await scopeFixture();
  let releaseScope = () => {};
  try {
    await keepDelayedFetchAlive(
      page,
      '/locations/ITC-BLACK',
      { q: setup.prefix, status: 'all' },
      true,
    );
    await signIn(page);
    await page.setViewportSize({ width: 1180, height: 757 });
    const scoped = '/locations/ITC-BLACK?q=' + encodeURIComponent(setup.prefix);
    await page.goto(scoped);
    const active = page.getByRole('link', { name: 'Active only', exact: true });
    const all = page.getByRole('link', { name: 'All statuses', exact: true });
    await expect(active).toHaveAttribute('aria-current', 'page');
    await expect(page.getByText('Current scope: Active only')).toBeVisible();
    await expect(page.getByText('28 matching rows')).toBeVisible();
    const split = page.locator('li').filter({
      has: page.getByRole('link', { name: setup.splitName, exact: true }),
    });
    await expect(split.getByText('1 unit', { exact: true })).toBeVisible();
    await expect(split.getByText('At this location')).toBeVisible();
    await expect(
      split.getByText('Across all storage: 2 available'),
    ).toBeVisible();
    let slowStarted = false;
    let slowDelivered = false;
    const slowScope = new Promise<void>((release) => {
      releaseScope = release;
    });
    await page.route('**/locations/ITC-BLACK?**', async (route) => {
      const request = route.request();
      if (
        request.headers()['rsc'] !== '1' ||
        new URL(request.url()).searchParams.get('status') !== 'all' ||
        slowStarted
      ) {
        await route.continue();
        return;
      }
      slowStarted = true;
      const response = await route.fetch();
      await slowScope;
      await route.fulfill({ response });
      slowDelivered = true;
    });
    await all.click({ noWaitAfter: true });
    await expect.poll(() => slowStarted).toBe(true);
    await expect(active).toHaveAttribute('aria-current', 'page');
    await expect(page.getByText('28 matching rows')).toBeVisible();
    await active.click({ noWaitAfter: true });
    releaseScope();
    await expect.poll(() => slowDelivered).toBe(true);
    await expect(active).toHaveAttribute('aria-current', 'page');
    await expect(page.getByText('28 matching rows')).toBeVisible();
    await page.unroute('**/locations/ITC-BLACK?**');
    await all.click();
    await expect(all).toHaveAttribute('aria-current', 'page');
    await expect(active).not.toHaveAttribute('aria-current', 'page');
    await expect(page.getByText('29 matching rows')).toBeVisible();
    await expect(page).toHaveURL(/status=all/);
    await page.reload();
    await expect(all).toHaveAttribute('aria-current', 'page');
    await page.goBack();
    await expect(active).toHaveAttribute('aria-current', 'page');
    await expect(page.getByText('28 matching rows')).toBeVisible();
    await page.goForward();
    await expect(all).toHaveAttribute('aria-current', 'page');
    const downloading = page.waitForEvent('download');
    await page
      .getByRole('link', { name: 'Download location inventory CSV' })
      .click();
    const download = await downloading;
    const path = testInfo.outputPath('all-status-location.csv');
    await download.saveAs(path);
    const csv = csvRows(await readFile(path, 'utf8'));
    expect(csv).toHaveLength(30);
    expect(csv.filter((row) => row.includes(setup.splitName))).toHaveLength(1);
    expect(
      csv.some((row) => row.some((value) => value.includes('retired laptop'))),
    ).toBe(true);
    await page.screenshot({
      path: testInfo.outputPath('location-all-status.png'),
    });
    await page.goto('/inventory');
    const search = page.getByRole('form', { name: 'Search inventory' });
    await search
      .getByLabel('Search inventory', { exact: true })
      .fill(setup.prefix);
    await search.getByRole('button', { name: 'Search', exact: true }).click();
    await expect(page.getByText('30 matching rows')).toBeVisible();
    await expect(page.getByText(/^On this page:/)).toBeVisible();
    await page.getByRole('link', { name: 'Next', exact: true }).click();
    await expect(page.getByText('Page 2 of 2')).toBeVisible();
    await expect(page.getByText('30 matching rows')).toBeVisible();
    await expect(
      page.getByRole('link', { name: 'Next', exact: true }),
    ).toHaveCount(0);
    await page.goto(
      '/inventory?q=' +
        encodeURIComponent(setup.prefix) +
        '&status=all&page=999',
    );
    await expect(page).toHaveURL(/status=all.*page=2/);
    await expect(
      search.getByLabel('Search inventory', { exact: true }),
    ).toHaveValue(setup.prefix);
    await expect(page.getByText('31 matching rows')).toBeVisible();
    await page.goto('/inventory?q=' + encodeURIComponent(setup.splitName));
    await expect(page.getByText('2 matching rows')).toBeVisible();
    await expect(
      page.getByText('On this page: 2 quantity holdings · 1 quantity item'),
    ).toBeVisible();
    await page.setViewportSize({ width: 390, height: 844 });
    await assertFits(page);
    await page.screenshot({
      path: testInfo.outputPath('phone-split-holdings.png'),
    });
  } finally {
    releaseScope();
    try {
      await page.unrouteAll({ behavior: 'wait' });
    } finally {
      await setup.cleanup();
    }
  }
});

test('record history binds kind and name, preserves other filters on clear and recovers unavailable records', async ({
  page,
}, testInfo) => {
  test.setTimeout(180_000);
  const setup = await scopeFixture();
  try {
    await signIn(page, 'viewer');
    await page.goto('/inventory/quantity/' + setup.splitId);
    await page.getByRole('link', { name: 'View all item history' }).click();
    const type = page.getByRole('combobox', { name: 'Tracking type' });
    await expect(type).toBeDisabled();
    await expect(type).toHaveValue('quantity');
    await expect(
      page.getByRole('link', { name: setup.splitName, exact: true }).first(),
    ).toBeVisible();
    await page.goto(
      '/history?entityId=' + setup.splitId + '&type=asset&location=ITC-BLACK',
    );
    await expect(type).toHaveValue('quantity');
    await expect(
      page.getByText(/Tracking type was reconciled to Quantity/),
    ).toBeVisible();
    await page
      .getByRole('button', { name: 'Filter history', exact: true })
      .click();
    await expect(page).toHaveURL(/type=quantity/);
    await expect(
      page.getByRole('heading', { name: 'Physically moved' }),
    ).toBeVisible();
    await page.screenshot({
      path: testInfo.outputPath('record-history-locked.png'),
    });
    await page.getByRole('link', { name: 'Clear record filter' }).click();
    await expect(type).toBeEnabled();
    await expect(page).toHaveURL(/location=ITC-BLACK/);
    await type.selectOption('asset');
    await page
      .getByRole('button', { name: 'Filter history', exact: true })
      .click();
    await expect(type).toHaveValue('asset');
    await expect(page.getByText(/Record:/)).toHaveCount(0);
    await page.goBack();
    await page.goBack();
    await expect(type).toBeDisabled();
    await expect(type).toHaveValue('quantity');
    for (const entityId of ['malformed', randomUUID()]) {
      await page.goto('/history?entityId=' + entityId + '&location=ITC-BLACK');
      await expect(
        page.getByText(/Record history is unavailable/),
      ).toBeVisible();
      await expect(
        page.getByText('No history matches these filters.'),
      ).toHaveCount(0);
      await expect(
        page.getByText(setup.splitName, { exact: true }),
      ).toHaveCount(0);
      await expect(
        page.getByRole('link', { name: 'Clear record filter' }),
      ).toHaveAttribute('href', '/history?location=ITC-BLACK');
    }
  } finally {
    await setup.cleanup();
  }
});

test('Spaces preserves current contents across slow responses and uses coherent browser-only guidance', async ({
  page,
}, testInfo) => {
  test.setTimeout(180_000);
  const setup = await scopeFixture();
  const pending: Array<{
    code: string;
    release: () => void;
    delivered: boolean;
  }> = [];
  let draining = false;
  try {
    await keepDelayedFetchAlive(page, '/api/room/contents', {
      space: 'it-closet',
      location: ['ITC-BLACK', 'ITC-RED'],
      page: '1',
    });
    await signIn(page);
    await page.route('**/api/room/contents?**', async (route) => {
      const code = new URL(route.request().url()).searchParams.get('location')!;
      const request = { code, release: () => {}, delivered: false };
      const delay = new Promise<void>((release) => {
        request.release = release;
      });
      pending.push(request);
      if (draining) request.release();
      const response = await route.fetch();
      await delay;
      await route.fulfill({ response });
      request.delivered = true;
    });
    await page.goto('/room?space=it-closet&location=ITC-BLACK');
    await expect.poll(() => pending.length).toBe(1);
    // The delayed-response simulation must leave ordinary fetch cancellation intact.
    expect(
      await page.evaluate(async () => {
        const controller = new AbortController();
        controller.abort();
        try {
          await fetch(
            '/api/room/contents?space=it-office&location=ITO&page=1',
            {
              signal: controller.signal,
            },
          );
          return 'resolved';
        } catch (error) {
          return error instanceof Error ? error.name : 'unknown';
        }
      }),
    ).toBe('AbortError');
    expect(
      await page.evaluate(async () => {
        const controller = new AbortController();
        controller.abort();
        try {
          await fetch(
            new Request(
              window.location.origin +
                '/api/room/contents?space=it-closet&location=ITC-BLACK&page=1',
              { method: 'POST', signal: controller.signal },
            ),
          );
          return 'resolved';
        } catch (error) {
          return error instanceof Error ? error.name : 'unknown';
        }
      }),
    ).toBe('AbortError');
    const browser = page.getByRole('navigation', { name: 'Location browser' });
    const search = browser.getByRole('searchbox', { name: 'Browse locations' });
    await search.fill('ITC-RED');
    await browser
      .getByRole('button', { name: /Red Container ITC-RED$/ })
      .click();
    await expect.poll(() => pending.length).toBe(2);
    await search.fill('ITC-BLACK');
    await browser
      .getByRole('button', { name: /Black Container ITC-BLACK$/ })
      .click();
    await expect.poll(() => pending.length).toBe(3);
    const panel = page.getByRole('region', { name: 'Location inventory' });
    await expect(
      panel.getByText('Loading contents for Black Container…'),
    ).toBeVisible();
    await expect(panel.getByText(/matching rows/)).toHaveCount(0);
    pending[2].release();
    const split = panel.locator('li').filter({
      has: page.getByRole('link', { name: setup.splitName, exact: true }),
    });
    await expect(split.getByText('1 unit', { exact: true })).toBeVisible();
    await expect(
      split.getByText('Across all storage: 2 available'),
    ).toBeVisible();
    pending[0].release();
    pending[1].release();
    await expect
      .poll(() => pending.map((request) => request.code))
      .toEqual(['ITC-BLACK', 'ITC-RED', 'ITC-BLACK']);
    await expect
      .poll(() => pending.every((request) => request.delivered))
      .toBe(true);
    await expect(
      panel.getByRole('heading', { name: 'Black Container' }),
    ).toBeVisible();
    await expect(split.getByText('1 unit', { exact: true })).toBeVisible();
    await page.unrouteAll({ behavior: 'wait' });
    await page.getByRole('button', { name: 'Clear selection' }).click();
    await page.getByRole('button', { name: 'Hide room' }).click();
    await expect(
      panel.getByText(/Choose a location in the location browser/),
    ).toBeVisible();
    await page
      .getByRole('combobox', { name: 'Space', exact: true })
      .selectOption('it-office');
    await expect(page.getByTestId('room-viewer')).toHaveCount(0);
    await expect(
      panel.getByText(/Choose a location in the location browser/),
    ).toBeVisible();
    await expect(
      page.getByText(/Choose a location in the map or browser/),
    ).toHaveCount(0);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await assertFits(page);
    await page.screenshot({
      path: testInfo.outputPath('unmodeled-office-phone.png'),
    });
  } finally {
    draining = true;
    for (const request of pending) request.release();
    try {
      await page.unrouteAll({ behavior: 'wait' });
    } finally {
      await setup.cleanup();
    }
  }
});

test('Office codes, compact duplicate child links and empty destination remain accessible at narrow width and 200% display zoom', async ({
  page,
}, testInfo) => {
  test.setTimeout(90_000);
  const admin = createClient(localApi(), process.env.LOCAL_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const parent = await admin
    .from('locations')
    .select('id')
    .eq('code', 'ITO')
    .single();
  expect(parent.error).toBeNull();
  const suffix = randomUUID().replaceAll('-', '').toUpperCase();
  const longCode = 'ITO-' + suffix + '-' + 'L'.repeat(63);
  const shortCode = 'ITO-SCOPE-' + suffix.slice(0, 8);
  const name = 'Fictional duplicate storage ' + suffix.slice(0, 8);
  const created = await admin
    .from('locations')
    .insert(
      [longCode, shortCode].map((code) => ({
        code,
        name,
        parent_id: parent.data!.id,
        kind: 'storage_area',
        can_hold_inventory: true,
      })),
    )
    .select('id,code');
  expect(created.error).toBeNull();
  const ids = created.data!.map((row) => row.id as string);
  try {
    await signIn(page, 'viewer');
    await page.goto('/locations/ITO');
    for (const code of [longCode, shortCode]) {
      const child = page.getByRole('link', {
        name: `IT Office / ${name} (${code})`,
        exact: true,
      });
      await expect(child).toHaveText(name);
      await expect(child).not.toContainText('IT Office /');
    }
    await expect(page.getByRole('link', { name: /in room/ })).toHaveCount(0);
    await page.setViewportSize({ width: 390, height: 844 });
    await page
      .getByRole('link', {
        name: `IT Office / ${name} (${longCode})`,
        exact: true,
      })
      .click();
    // The parent page also renders this code and may have the same empty state.
    // Finish navigation before focusing the destination's scrollable code.
    await expect(page).toHaveURL('http://localhost:3000/locations/' + longCode);
    await expect(page.getByText('No active inventory here.')).toBeVisible();
    await expect(
      page.getByRole('navigation', { name: 'Pagination' }),
    ).toHaveCount(0);
    const code = page.getByRole('region', {
      name: 'Full location code: ' + longCode,
    });
    await expect(code).toHaveText(longCode);
    await code.focus();
    await expect(code).toBeFocused();
    await code.press('ArrowRight');
    await expect
      .poll(() => code.evaluate((element) => element.scrollLeft))
      .toBeGreaterThan(0);
    await assertFits(page);
    await page.getByRole('link', { name: 'Include all statuses' }).click();
    await expect(page.getByText('No recorded inventory here.')).toBeVisible();
    const downloaded = page.waitForEvent('download');
    await page
      .getByRole('link', { name: 'Download location inventory CSV' })
      .click();
    const path = testInfo.outputPath('empty-destination.csv');
    await (await downloaded).saveAs(path);
    expect(csvRows(await readFile(path, 'utf8'))).toHaveLength(1);
    await page.goto('/room?space=it-office');
    const browser = page.getByRole('navigation', { name: 'Location browser' });
    await browser
      .getByRole('searchbox', { name: 'Browse locations' })
      .fill(name);
    await expect(
      browser.getByRole('button', {
        name: `IT Office / ${name} ${longCode}`,
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      browser.getByRole('button', {
        name: `IT Office / ${name} ${shortCode}`,
        exact: true,
      }),
    ).toBeVisible();
    await assertFits(page);
    await page.screenshot({
      path: testInfo.outputPath('office-long-code-phone.png'),
    });
    await page.setViewportSize({ width: 1180, height: 757 });
    await page.evaluate(() => {
      document.documentElement.style.zoom = '2';
    });
    await assertFits(page);
    await expect(
      browser.getByRole('region', { name: 'Full location code: ' + longCode }),
    ).toBeVisible();
    await page.screenshot({
      path: testInfo.outputPath('office-long-code-200-percent-display.png'),
    });
  } finally {
    await page.evaluate(() => {
      document.documentElement.style.zoom = '';
    });
    for (const id of ids) {
      const [balances, assets, history, children] = await Promise.all([
        admin
          .from('stock_balances')
          .select('item_id')
          .eq('location_id', id)
          .limit(1),
        admin
          .from('serialized_assets')
          .select('id')
          .eq('location_id', id)
          .limit(1),
        admin
          .from('inventory_history_rows')
          .select('id')
          .contains('location_ids', [id])
          .limit(1),
        admin.from('locations').select('id').eq('parent_id', id).limit(1),
      ]);
      for (const result of [balances, assets, history, children]) {
        expect(result.error).toBeNull();
        expect(result.data).toHaveLength(0);
      }
    }
    // Location codes are permanent, including trusted disposable-local fixtures.
    // Keep these exact empty IDs until the next canonical database reset.
    await testInfo.attach('retained local location fixtures', {
      body: JSON.stringify({
        ids,
        codes: [longCode, shortCode],
        inventoryReferences: 0,
        childReferences: 0,
        cleanup: 'Retained until canonical local database reset',
      }),
      contentType: 'application/json',
    });
  }
});
