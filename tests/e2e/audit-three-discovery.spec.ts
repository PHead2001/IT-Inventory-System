import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import {
  expect,
  test,
  type Locator,
  type Page,
  type Route,
} from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';
import fixture from '../fixtures/auth.json' with { type: 'json' };

async function signIn(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Email', { exact: true }).fill(fixture.emails.staff);
  await page.getByLabel('Password', { exact: true }).fill(fixture.password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page).toHaveURL(/\/inventory$/);
}

/** Caller-scoped RPCs prepare fictional rows; discovery assertions use the UI. */
async function discoveryFixture() {
  const endpoint = new URL(process.env.LOCAL_API_URL!);
  expect(['localhost', '127.0.0.1', '[::1]']).toContain(endpoint.hostname);
  expect(endpoint.port).toBe('54321');
  const caller = createClient(
    endpoint.href,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const signedIn = await caller.auth.signInWithPassword({
    email: fixture.emails.staff,
    password: fixture.password,
  });
  expect(signedIn.error).toBeNull();
  const category = await caller
    .from('categories')
    .select('id')
    .eq('active', true)
    .order('sort_order')
    .limit(1)
    .single();
  expect(category.error).toBeNull();
  const prefix = 'Audit3Discovery-' + randomUUID().slice(0, 8);
  const ids: string[] = [];
  const names: string[] = [];
  async function mutate(operation: string, payload: Record<string, unknown>) {
    const result = await caller.rpc(operation, {
      p_request_id: randomUUID(),
      p_payload: payload,
    });
    expect(result.error, `${operation} fixture operation`).toBeNull();
    return z.record(z.string(), z.unknown()).parse(result.data);
  }
  async function cleanup() {
    try {
      for (const id of ids) {
        const record = await caller
          .from('quantity_items')
          .select('version,archived')
          .eq('id', id)
          .single();
        expect(record.error).toBeNull();
        if (!record.data!.archived)
          await mutate('quantity_archive_and_clear', {
            item_id: id,
            expected_version: record.data!.version,
            confirm_clear_stock: true,
            reason: 'Audit 3 fictional discovery fixture cleanup',
          });
      }
    } finally {
      await caller.auth.signOut({ scope: 'local' });
    }
  }
  try {
    for (let index = 0; index < 26; index++) {
      const name = `${prefix} ${index < 24 ? 'Alpha' : 'Beta'} ${String(index).padStart(2, '0')}`;
      const created = await mutate('quantity_create', {
        name,
        category_id: category.data!.id,
        initial_quantity: 0,
        initial_location_id: null,
      });
      ids.push(z.uuid().parse(created.entity_id));
      names.push(name);
    }
    return { prefix, names, cleanup };
  } catch (error) {
    await cleanup();
    throw error;
  }
}

/** Hold one real search response without removing an in-flight route handler. */
async function holdFirstSearch(page: Page, query: string) {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const requests: string[] = [];
  const active = new Set<Promise<void>>();
  let held = false;
  const matches = (url: URL) => url.pathname === '/inventory';
  const handler = async (route: Route) => {
    const work = (async () => {
      const request = route.request();
      if (request.method() === 'GET' && request.headers().rsc === '1') {
        const value = new URL(request.url()).searchParams.get('q') ?? '';
        requests.push(value);
        if (!held && value === query) {
          held = true;
          await gate;
        }
      }
      await route.continue();
    })();
    active.add(work);
    try {
      await work;
    } finally {
      active.delete(work);
    }
  };
  await page.route(matches, handler);
  return {
    requests,
    isHeld: () => held,
    release,
    async dispose() {
      release();
      while (active.size) await Promise.all([...active]);
      await page.unroute(matches, handler);
    },
  };
}

async function appliedSearch(page: Page, query: string, count: number) {
  await expect(page).toHaveURL((url) => url.searchParams.get('q') === query);
  await expect(
    page.getByRole('textbox', { name: 'Search inventory', exact: true }),
  ).toHaveValue(query);
  await expect(
    page.getByText(`${count} matching rows`, { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText('Results and CSV use the applied search.', { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('navigation', { name: 'Active inventory filters' }),
  ).toContainText(`Search: ${query}`);
}

async function exportScope(page: Page, query: string) {
  const summary = page.locator('summary').filter({ hasText: 'Export CSV' });
  const link = page.getByRole('link', {
    name: 'Filtered inventory',
    exact: true,
  });
  if (!(await link.isVisible())) await summary.click();
  await expect(link).toHaveAttribute('href', /\/api\/exports\/inventory\?/);
  const href = await link.getAttribute('href');
  expect(new URL(href!, page.url()).searchParams.get('q')).toBe(query);
  return link;
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

test('live inventory typing keeps applied rows, chips and CSV coherent through delay, composition, history and competing navigation', async ({
  page,
}, info) => {
  test.setTimeout(180_000);
  const setup = await discoveryFixture();
  const alpha = setup.prefix + ' Alpha';
  const beta = setup.prefix + ' Beta';
  let dispose = async () => {};
  try {
    await signIn(page);
    await page.goto('/inventory?q=' + encodeURIComponent(setup.prefix));
    await appliedSearch(page, setup.prefix, 26);
    const fixtureRows = page.getByRole('link', {
      name: new RegExp('^' + setup.prefix + ' (Alpha|Beta) \\d{2}$'),
    });
    await expect(fixtureRows).toHaveCount(25);
    const form = page.getByRole('form', {
      name: 'Search inventory',
      exact: true,
    });
    const input = form.getByRole('textbox', {
      name: 'Search inventory',
      exact: true,
    });
    const delayed = await holdFirstSearch(page, alpha);
    dispose = delayed.dispose;
    await input.fill(alpha);
    await expect.poll(delayed.isHeld).toBe(true);
    await expect(input).toHaveValue(alpha);
    await expect(
      page.getByText('26 matching rows', { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole('navigation', { name: 'Active inventory filters' }),
    ).toContainText(`Search: ${setup.prefix}`);
    await expect(
      page.getByText(
        'Updating results. Displayed rows, active filters and CSV still use the previous applied search.',
        { exact: true },
      ),
    ).toBeVisible();
    await exportScope(page, setup.prefix);
    // A is in flight; rapid B/A edits must survive that earlier response.
    await input.fill(beta);
    await input.fill(alpha);
    delayed.release();
    await appliedSearch(page, alpha, 24);
    await expect(fixtureRows).toHaveCount(24);
    for (const name of await fixtureRows.allTextContents())
      expect(name).toContain(alpha);
    expect(delayed.requests).not.toContain(beta);

    await input.dispatchEvent('compositionstart');
    await input.fill(beta);
    // Deliberately cross the real 250ms debounce while composition is active.
    await page.waitForTimeout(350);
    expect(delayed.requests).not.toContain(beta);
    await expect(input).toHaveValue(beta);
    await expect(
      page.getByText('24 matching rows', { exact: true }),
    ).toBeVisible();
    await exportScope(page, alpha);
    await input.dispatchEvent('compositionend');
    await appliedSearch(page, beta, 2);
    await expect(fixtureRows).toHaveCount(2);
    for (const name of await fixtureRows.allTextContents())
      expect(name).toContain(beta);

    // Explicit Search creates history entries; live typing itself uses replace.
    await input.fill(setup.prefix);
    await form.getByRole('button', { name: 'Search', exact: true }).click();
    await appliedSearch(page, setup.prefix, 26);
    await input.fill(alpha);
    await form.getByRole('button', { name: 'Search', exact: true }).click();
    await appliedSearch(page, alpha, 24);
    await page.goBack();
    await appliedSearch(page, setup.prefix, 26);
    await page.goForward();
    await appliedSearch(page, alpha, 24);

    await form
      .getByLabel('Tracking type', { exact: true })
      .selectOption('quantity');
    await expect(page).toHaveURL(
      (url) => url.searchParams.get('type') === 'quantity',
    );
    const chipCancelled = setup.prefix + ' chip-cancelled';
    await input.fill(chipCancelled);
    await page
      .getByRole('link', {
        name: 'Remove Type: Quantity items filter',
        exact: true,
      })
      .click();
    await appliedSearch(page, alpha, 24);
    await expect(page).toHaveURL((url) => !url.searchParams.has('type'));
    await page.waitForTimeout(350);
    expect(delayed.requests).not.toContain(chipCancelled);

    await input.fill(setup.prefix);
    await form.getByRole('button', { name: 'Search', exact: true }).click();
    await appliedSearch(page, setup.prefix, 26);
    const pageCancelled = setup.prefix + ' page-cancelled';
    await input.fill(pageCancelled);
    await page
      .getByRole('navigation', { name: 'Pagination' })
      .getByRole('link', { name: 'Next', exact: true })
      .click();
    await expect(page).toHaveURL((url) => url.searchParams.get('page') === '2');
    await appliedSearch(page, setup.prefix, 26);
    await expect(page.getByText('Page 2 of 2', { exact: true })).toBeVisible();
    await page.waitForTimeout(350);
    expect(delayed.requests).not.toContain(pageCancelled);

    const absent = setup.prefix + ' absent';
    await input.fill(absent);
    await form.getByRole('button', { name: 'Search', exact: true }).click();
    await expect(
      page.getByText('No inventory matches these filters.', { exact: true }),
    ).toBeVisible();
    const clearCancelled = setup.prefix + ' clear-cancelled';
    await input.fill(clearCancelled);
    await page
      .getByRole('link', { name: 'Clear inventory filters', exact: true })
      .click();
    await expect(page).toHaveURL((url) => !url.searchParams.has('q'));
    await expect(input).toHaveValue('');
    await page.waitForTimeout(350);
    expect(delayed.requests).not.toContain(clearCancelled);

    // An unavailable page reconciles to real rows without broadening CSV scope.
    await page.goto(
      '/inventory?q=' + encodeURIComponent(setup.prefix) + '&page=99',
    );
    await appliedSearch(page, setup.prefix, 26);
    await expect(page).toHaveURL((url) => url.searchParams.get('page') === '2');
    await expect(
      page.getByText(
        'The previous results page is no longer available. Showing the nearest available page with your filters retained.',
        { exact: true },
      ),
    ).toBeVisible();
    await expect(
      page.getByRole('link', {
        name: new RegExp('^' + setup.prefix + ' (Alpha|Beta) \\d{2}$'),
      }),
    ).toHaveCount(1);
    const exported = await exportScope(page, setup.prefix);
    expect(
      new URL(
        (await exported.getAttribute('href'))!,
        page.url(),
      ).searchParams.has('page'),
    ).toBe(false);
    const downloadEvent = page.waitForEvent('download');
    await exported.click();
    const download = await downloadEvent;
    const path = info.outputPath('applied-discovery.csv');
    await download.saveAs(path);
    const [headers, ...rows] = csvRows(await readFile(path, 'utf8'));
    expect(rows).toHaveLength(26);
    const names = rows.map((row) => row[headers.indexOf('Name')]);
    expect(names.sort()).toEqual([...setup.names].sort());
    await info.attach('applied-discovery.csv', {
      path,
      contentType: 'text/csv',
    });
  } finally {
    try {
      await dispose();
    } finally {
      await setup.cleanup();
    }
  }
});

async function withinViewport(locator: Locator) {
  const bounds = await locator.boundingBox();
  expect(bounds).not.toBeNull();
  const viewport = await locator.evaluate(() => ({
    width: innerWidth,
    height: innerHeight,
  }));
  expect(bounds!.x).toBeGreaterThanOrEqual(-1);
  expect(bounds!.y).toBeGreaterThanOrEqual(-1);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(viewport.width + 1);
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(viewport.height + 1);
}

test('Settings hierarchy and the search location picker expose keyboard paths and stay framed on a narrow viewport', async ({
  page,
}) => {
  await signIn(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/settings/locations');
  const configuration = page.getByRole('region', {
    name: 'Location configuration',
  });
  const tree = configuration.getByRole('tree', { name: 'Locations' });
  const root = tree.getByRole('treeitem', { name: /ITC · Active$/ });
  await root.focus();
  await root.press('ArrowLeft');
  await expect(root).toHaveAttribute('aria-expanded', 'false');
  await expect(
    tree.getByRole('treeitem', { name: /ITC-R · Active$/ }),
  ).toHaveCount(0);
  await root.press('ArrowRight');
  await expect(root).toHaveAttribute('aria-expanded', 'true');
  // Reused local fixtures can add earlier-sorted children to ITC. ArrowRight
  // follows the rendered hierarchy, rather than assuming Left Storage is first.
  const rootIndex = await root.evaluate((element) =>
    Array.from(
      element.closest('[role="tree"]')!.querySelectorAll('[role="treeitem"]'),
    ).indexOf(element),
  );
  expect(rootIndex).toBeGreaterThanOrEqual(0);
  const firstChild = tree.getByRole('treeitem').nth(rootIndex + 1);
  await expect(firstChild).toHaveAttribute('aria-level', '2');
  const parentPath = await root.locator('span').nth(1).innerText();
  await expect(firstChild.locator('span').nth(1)).toContainText(
    parentPath + ' / ',
  );
  await root.press('ArrowRight');
  await expect(firstChild).toBeFocused();
  const right = tree.getByRole('treeitem', { name: /ITC-R · Active$/ });
  await right.focus();
  await right.press('ArrowLeft');
  await expect(right).toHaveAttribute('aria-expanded', 'false');
  await expect(
    tree.getByRole('treeitem', { name: /ITC-D07 · Active$/ }),
  ).toHaveCount(0);
  await right.press('ArrowRight');
  const drawer = tree.getByRole('treeitem', { name: /ITC-D07 · Active$/ });
  await drawer.focus();
  await expect(drawer).toHaveAttribute('aria-level', '3');
  await drawer.press('ArrowLeft');
  await expect(right).toBeFocused();
  await right.press('Home');
  const first = tree.getByRole('treeitem').first();
  await expect(first).toBeFocused();
  await first.press('End');
  await expect(tree.getByRole('treeitem').last()).toBeFocused();
  await configuration
    .getByLabel('Search locations', { exact: true })
    .fill('ITC-D07');
  await expect(
    configuration.getByRole('tree', { name: 'Locations' }),
  ).toBeVisible();
  await expect(
    configuration.getByText('1 matching locations', { exact: true }),
  ).toBeVisible();
  const result = configuration.getByRole('treeitem', {
    name: /ITC-D07 · Active$/,
  });
  await result.scrollIntoViewIfNeeded();
  await withinViewport(result);
  await expect(result.getByRole('link')).toHaveAttribute('tabindex', '-1');
  await result.press('Enter');
  await expect(page).toHaveURL(/\/settings\/locations\/ITC-D07$/);

  await page.goto('/inventory');
  const form = page.getByRole('form', {
    name: 'Search inventory',
    exact: true,
  });
  await form.getByRole('button', { name: 'More filters', exact: true }).click();
  const trigger = form.getByLabel('Location', { exact: true });
  await trigger.click();
  const search = form.getByRole('combobox', { name: 'Search locations' });
  await expect(search).toBeFocused();
  await withinViewport(search);
  const pickerTree = form.getByRole('tree', { name: 'Location', exact: true });
  await withinViewport(pickerTree);
  await search.press('Home');
  await expect(search).toHaveAttribute(
    'aria-activedescendant',
    (await pickerTree
      .getByRole('treeitem', { name: 'All locations, no location filter' })
      .getAttribute('id'))!,
  );
  await search.press('ArrowDown');
  await expect(search).toHaveAttribute(
    'aria-activedescendant',
    (await pickerTree.getByRole('treeitem').nth(1).getAttribute('id'))!,
  );
  const pickerRoot = pickerTree.getByRole('treeitem', { name: /, ITC$/ });
  await pickerRoot.press('ArrowRight');
  await expect(pickerRoot).toHaveAttribute('aria-expanded', 'true');
  await search.fill('ITC-D07');
  const option = form.getByRole('option', { name: /, ITC-D07$/ });
  await expect(option).toBeVisible();
  await withinViewport(option);
  await search.press('Enter');
  await expect(trigger).toBeFocused();
  await expect(trigger).toContainText('ITC-D07');
  await expect(page).toHaveURL(
    (url) => url.searchParams.get('location') === 'ITC-D07',
  );
  await trigger.click();
  await expect(search).toBeFocused();
  await search.press('Escape');
  await expect(trigger).toBeFocused();
  await expect(search).toHaveCount(0);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
