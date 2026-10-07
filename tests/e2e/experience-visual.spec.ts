import { openRecordTask } from './record-task-controls';
import { auditCreateRecord, auditReadback } from './audit-two-controls';
import { expect, test, type Page } from '@playwright/test';
import fixture from '../fixtures/auth.json' with { type: 'json' };
import { setLocalReducedMotion } from './motion-settings';

async function signIn(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Email', { exact: true }).fill(fixture.emails.staff);
  await page.getByLabel('Password', { exact: true }).fill(fixture.password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Inventory', exact: true }),
  ).toBeVisible();
}

async function noHorizontalOverflow(page: Page) {
  const dimensions = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    content: document.documentElement.scrollWidth,
  }));
  expect(dimensions.content).toBeLessThanOrEqual(dimensions.viewport + 1);
}

async function openInventoryRecord(
  page: Page,
  kind: 'quantity' | 'assets',
  expectedScope?: string,
) {
  const inventory = new URL(page.url());
  const record = page
    .locator(`a[href^="/inventory/${kind}/"]:not([href*="/new"])`)
    .first();
  const destination = new URL((await record.getAttribute('href'))!, inventory);
  expect(destination.pathname).toMatch(
    new RegExp(`^/inventory/${kind}/[0-9a-f-]{36}$`),
  );
  const rowId = await record
    .locator('xpath=ancestor::li[1]')
    .getAttribute('id');
  expect(rowId).toMatch(/^inventory-row-\d+$/);
  const returnTo =
    (expectedScope ?? inventory.pathname + inventory.search) + '#' + rowId;
  expect(destination.searchParams.get('returnTo')).toBe(returnTo);
  await record.click();
  await expect(page).toHaveURL(
    (url) =>
      url.pathname === destination.pathname &&
      url.searchParams.size === 1 &&
      url.searchParams.get('returnTo') === returnTo,
  );
}

test('representative shell and auth surfaces render at desktop and phone sizes with keyboard navigation and motion preference', async ({
  page,
}, testInfo) => {
  test.setTimeout(90_000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/login');
  await expect(
    page.getByRole('heading', { name: 'Welcome back' }),
  ).toBeVisible();
  await noHorizontalOverflow(page);
  await page.screenshot({
    path: testInfo.outputPath('login-desktop-1440.png'),
    fullPage: true,
  });
  await page.goto('/access-denied');
  await expect(
    page.getByRole('heading', { name: 'Access is not enabled' }),
  ).toBeVisible();
  await noHorizontalOverflow(page);
  await page.screenshot({
    path: testInfo.outputPath('access-denied-desktop-1440.png'),
    fullPage: true,
  });
  await signIn(page);
  // A unique ordinary search makes the long owned title deterministic across
  // retries, independent of database collation and earlier suites' fixtures.
  const identity = crypto.randomUUID();
  const firstRowName = 'Audit two deep answer ' + identity;
  const owned = await auditCreateRecord(
    page,
    'quantity',
    'Tools',
    firstRowName,
  );
  try {
    await page.goto('/dashboard');
    await expect(
      page.getByRole('heading', { name: 'Low-stock overview' }),
    ).toBeVisible();
    await expect(
      page
        .getByRole('navigation', { name: 'Main navigation' })
        .getByRole('link', { name: 'Overview' }),
    ).toHaveAttribute('aria-current', 'page');
    await noHorizontalOverflow(page);
    await page.screenshot({
      path: testInfo.outputPath('overview-desktop-1440.png'),
      fullPage: true,
    });
    await page.goto('/inventory');
    await expect(
      page.getByRole('form', { name: 'Search inventory' }),
    ).toBeVisible();
    await noHorizontalOverflow(page);
    await page.screenshot({
      path: testInfo.outputPath('inventory-desktop-1440.png'),
      fullPage: true,
    });
    await openInventoryRecord(page, 'quantity');
    await noHorizontalOverflow(page);
    await page.screenshot({
      path: testInfo.outputPath('quantity-detail-desktop-1440.png'),
      fullPage: true,
    });
    await openRecordTask(page, 'Edit quantity metadata');
    await expect(
      page.getByRole('form', { name: 'Edit quantity metadata' }),
    ).toBeVisible();
    await noHorizontalOverflow(page);
    await page.screenshot({
      path: testInfo.outputPath('quantity-detail-edit-open-desktop-1440.png'),
      fullPage: true,
    });
    await page.goto('/inventory?type=asset');
    await openInventoryRecord(page, 'assets');
    await noHorizontalOverflow(page);
    await page.screenshot({
      path: testInfo.outputPath('asset-detail-desktop-1440.png'),
      fullPage: true,
    });
    await openRecordTask(page, 'Edit asset metadata');
    await expect(
      page.getByRole('form', { name: 'Edit asset metadata' }),
    ).toBeVisible();
    await noHorizontalOverflow(page);
    await page.screenshot({
      path: testInfo.outputPath('asset-detail-edit-open-desktop-1440.png'),
      fullPage: true,
    });
    // Halving CSS viewport width exercises the same responsive breakpoints as
    // 200% browser zoom on a 1440px desktop window without changing app styles.
    await page.setViewportSize({ width: 720, height: 900 });
    await page.goto('/inventory');
    await noHorizontalOverflow(page);
    await page.screenshot({
      path: testInfo.outputPath('inventory-200pct-reflow-equivalent-720.png'),
      fullPage: true,
    });

    await page.setViewportSize({ width: 390, height: 844 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/dashboard');
    await noHorizontalOverflow(page);
    await page.screenshot({
      path: testInfo.outputPath('overview-phone-390.png'),
      fullPage: true,
    });
    await page.screenshot({
      path: testInfo.outputPath('overview-phone-390-viewport.png'),
    });
    await expect(
      page.getByRole('button', { name: 'Reduce motion locally' }),
    ).toHaveCount(0);
    await expect(
      page.getByRole('heading', { name: 'Low-stock overview' }),
    ).toBeVisible();
    const menu = page.getByRole('button', { name: 'Menu', exact: true });
    await menu.focus();
    await page.keyboard.press('Enter');
    await expect(
      page.getByRole('button', { name: 'Close menu' }),
    ).toHaveAttribute('aria-expanded', 'true');
    await page.screenshot({
      path: testInfo.outputPath('navigation-menu-phone-390.png'),
      fullPage: true,
    });
    const navigation = page.getByRole('navigation', {
      name: 'Main navigation',
    });
    await navigation.getByRole('link', { name: 'Inventory' }).click();
    await expect(page).toHaveURL(/\/inventory$/);
    await expect(
      page.locator('#experience-navigation a[href="/inventory"]'),
    ).toHaveAttribute('aria-current', 'page');
    await expect(page.getByRole('button', { name: 'Menu' })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    await noHorizontalOverflow(page);
    const firstName = page
      .locator('li[id^="inventory-row-"] a[href^="/inventory/"]')
      .first();
    // Retain the unfiltered acceptance check as well as the deterministic case.
    await page.setViewportSize({ width: 502, height: 757 });
    await expect(firstName).toBeInViewport({ ratio: 1 });
    await page.screenshot({
      path: testInfo.outputPath('inventory-phone-502-global-viewport.png'),
    });
    await page.setViewportSize({ width: 390, height: 844 });
    const query = identity.slice(0, 8);
    const scopedSearch = page.getByRole('form', { name: 'Search inventory' });
    await scopedSearch.getByRole('textbox').fill(query);
    await scopedSearch
      .getByRole('button', { name: 'Search', exact: true })
      .click();
    await expect(page).toHaveURL(
      (url) =>
        url.pathname === '/inventory' && url.searchParams.get('q') === query,
    );
    await expect(
      page.getByText('1 matching row', { exact: true }),
    ).toBeVisible();
    await expect(firstName).toHaveText(firstRowName);
    await expect(firstName).toBeInViewport({ ratio: 1 });
    await page.screenshot({
      path: testInfo.outputPath('inventory-phone-390.png'),
      fullPage: true,
    });
    await page.screenshot({
      path: testInfo.outputPath('inventory-phone-390-viewport.png'),
      fullPage: false,
    });
    await page.setViewportSize({ width: 502, height: 757 });
    await noHorizontalOverflow(page);
    await expect(firstName).toHaveText(firstRowName);
    await expect(firstName).toBeInViewport({ ratio: 1 });
    const search = page.getByRole('form', { name: 'Search inventory' });
    for (const control of [
      search.getByRole('textbox'),
      search.getByRole('combobox', { name: 'Tracking type', exact: true }),
      search.getByRole('combobox', { name: 'Status', exact: true }),
      search.getByRole('button', { name: 'Search', exact: true }),
      search.getByRole('button', { name: 'More filters', exact: true }),
      page.locator('.experience-export-menu > summary'),
    ]) {
      const bounds = await control.boundingBox();
      expect(bounds).not.toBeNull();
      expect(bounds!.height).toBeGreaterThanOrEqual(44);
    }
    await page.screenshot({
      path: testInfo.outputPath('inventory-phone-502-viewport.png'),
      fullPage: false,
    });
    await page.setViewportSize({ width: 390, height: 844 });
    // Form GET includes empty/default controls; record return scope is canonical.
    await openInventoryRecord(page, 'quantity', '/inventory?q=' + query);
    await noHorizontalOverflow(page);
    await page.screenshot({
      path: testInfo.outputPath('quantity-detail-phone-390.png'),
      fullPage: true,
    });
    await openRecordTask(page, 'Edit quantity metadata');
    await expect(
      page.getByRole('form', { name: 'Edit quantity metadata' }),
    ).toBeVisible();
    await noHorizontalOverflow(page);
    await page.screenshot({
      path: testInfo.outputPath('quantity-detail-edit-open-phone-390.png'),
      fullPage: true,
    });
    await page.goto('/inventory?type=asset');
    await openInventoryRecord(page, 'assets');
    await noHorizontalOverflow(page);
    await page.screenshot({
      path: testInfo.outputPath('asset-detail-phone-390.png'),
      fullPage: true,
    });
    await openRecordTask(page, 'Edit asset metadata');
    await expect(
      page.getByRole('form', { name: 'Edit asset metadata' }),
    ).toBeVisible();
    await noHorizontalOverflow(page);
    await page.screenshot({
      path: testInfo.outputPath('asset-detail-edit-open-phone-390.png'),
      fullPage: true,
    });
    await expect(
      page.evaluate(
        () => matchMedia('(prefers-reduced-motion: reduce)').matches,
      ),
    ).resolves.toBe(true);
    await setLocalReducedMotion(page, true);
    await expect(page.locator('html')).toHaveAttribute(
      'data-motion',
      'reduced',
    );
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute(
      'data-motion',
      'reduced',
    );
    await setLocalReducedMotion(page, false);
    await expect(page.locator('html')).toHaveAttribute(
      'data-motion',
      'reduced',
    );
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await expect(page.locator('html')).toHaveAttribute('data-motion', 'full');

    await page.goto('/settings/forms');
    await page.locator('main a[href^="/settings/forms/"]').first().click();
    await expect(
      page.getByRole('region', { name: 'Forms and fields' }),
    ).toBeVisible();
    await noHorizontalOverflow(page);
    await page.screenshot({
      path: testInfo.outputPath('designer-phone-390.png'),
      fullPage: true,
    });

    await page.context().clearCookies();
    await page.goto('/forgot-password');
    await expect(
      page.getByRole('heading', { name: 'Reset your password' }),
    ).toBeVisible();
    await noHorizontalOverflow(page);
    await page.screenshot({
      path: testInfo.outputPath('recovery-phone-390.png'),
      fullPage: true,
    });
    expect(
      errors.filter((error) => /hydration|uncaught|error:/i.test(error)),
    ).toEqual([]);
  } finally {
    // Only this attempt's zero-stock fixture is archived, including on failure.
    const client = await auditReadback();
    const current = await client
      .from('quantity_items')
      .select('name,version,archived')
      .eq('id', owned.id)
      .single();
    expect(current.error).toBeNull();
    expect(current.data!.name).toBe(firstRowName);
    if (!current.data!.archived) {
      const archived = await client.rpc('quantity_archive', {
        p_request_id: crypto.randomUUID(),
        p_payload: {
          item_id: owned.id,
          expected_version: current.data!.version,
          reason: 'Completed disposable browser visibility fixture',
        },
      });
      expect(archived.error).toBeNull();
    }
    await client.auth.signOut();
  }
});

test('the first styled paint is reduced before hydration and the saved preference wins afterward', async ({
  page,
  context,
}) => {
  test.setTimeout(60_000);
  await signIn(page);
  await page.emulateMedia({ reducedMotion: 'no-preference' });

  async function inspect(saved: boolean) {
    await page.evaluate(
      (value) =>
        localStorage.setItem('it-inventory-reduce-motion', String(value)),
      saved,
    );
    const probe = await context.newPage();
    await probe.emulateMedia({ reducedMotion: 'no-preference' });
    let release!: () => void;
    const scripts = new Promise<void>((resolve) => {
      release = resolve;
    });
    await probe.route('**/*', async (route) => {
      if (route.request().resourceType() === 'script') await scripts;
      await route.continue();
    });
    try {
      await probe.goto('/dashboard', { waitUntil: 'commit' });
      await probe.waitForFunction(
        () => document.body !== null && document.styleSheets.length > 0,
      );
      const before = await probe.evaluate(() => {
        const element = document.createElement('div');
        element.style.animation = 'first-paint-probe 2s linear';
        document.body.append(element);
        const duration = getComputedStyle(element).animationDuration;
        element.remove();
        return {
          motion: document.documentElement.dataset.motion,
          duration: Number.parseFloat(duration),
        };
      });
      expect(before.motion).toBe('reduced');
      expect(before.duration).toBeLessThan(0.001);
      release();
      await expect(
        probe.getByRole('heading', { name: 'Low-stock overview' }),
      ).toBeVisible();
      await expect(probe.locator('html')).toHaveAttribute(
        'data-motion',
        saved ? 'reduced' : 'full',
      );
      await probe.goto('/settings');
      await expect(
        probe.getByRole('button', {
          name: saved ? 'Use system motion setting' : 'Reduce motion locally',
        }),
      ).toHaveAttribute('aria-pressed', String(saved));
    } finally {
      release();
      await probe.close();
    }
  }

  await inspect(true);
  await inspect(false);
});

test('desktop navigation reaches personal motion Settings after long-page scrolling', async ({
  page,
}) => {
  await signIn(page);
  for (const height of [500, 330]) {
    await page.setViewportSize({ width: 1440, height });
    await page.goto('/inventory');
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    const stack = page.locator('.experience-nav-stack');
    await stack.evaluate((element) => {
      element.scrollTop = element.scrollHeight;
    });
    const settings = page
      .getByRole('navigation', { name: 'Main navigation' })
      .getByRole('link', { name: 'Settings' });
    const settingsBox = await settings.boundingBox();
    expect(settingsBox).toBeTruthy();
    await expect(
      page.getByRole('button', { name: 'Reduce motion locally' }),
    ).toHaveCount(0);
    await settings.click();
    await expect(page).toHaveURL(/\/settings$/);
    const toggle = page.getByRole('button', { name: 'Reduce motion locally' });
    await toggle.scrollIntoViewIfNeeded();
    const toggleBox = await toggle.boundingBox();
    expect(toggleBox).toBeTruthy();
    expect(toggleBox!.y + toggleBox!.height).toBeLessThanOrEqual(height);
    expect(
      await toggle.evaluate((button) => {
        const box = button.getBoundingClientRect();
        return button.contains(
          document.elementFromPoint(
            box.x + box.width / 2,
            box.y + box.height / 2,
          ),
        );
      }),
    ).toBe(true);
    await toggle.focus();
    await expect(toggle).toBeFocused();
  }
});

test('configuration, site custody, and location browsing remain legible at desktop and phone widths', async ({
  page,
}, testInfo) => {
  test.setTimeout(120_000);
  await signIn(page);
  for (const viewport of [
    { width: 1440, height: 900, suffix: 'desktop-1440' },
    { width: 390, height: 844, suffix: 'phone-390' },
  ]) {
    await page.setViewportSize(viewport);
    for (const route of [
      { path: '/settings', heading: 'Settings', file: 'settings' },
      {
        path: '/settings/sites',
        heading: 'Properties & sites',
        file: 'manage-sites',
      },
      {
        path: '/settings/locations',
        heading: 'Manage logical locations',
        file: 'manage-locations',
      },
      { path: '/sites', heading: 'Properties & sites', file: 'sites' },
    ]) {
      await page.goto(route.path);
      await expect(
        page.getByRole('heading', { level: 1, name: route.heading }),
      ).toBeVisible();
      await noHorizontalOverflow(page);
      await page.screenshot({
        path: testInfo.outputPath(`${route.file}-${viewport.suffix}.png`),
        fullPage: true,
      });
    }
    const site = page.locator('a[href^="/sites/"]').first();
    await expect(site).toBeVisible();
    await site.click();
    await expect(
      page.getByRole('heading', { name: 'Assignment activity' }),
    ).toBeVisible();
    await expect(
      page.getByLabel('From (UTC, inclusive)', { exact: true }),
    ).toBeVisible();
    await expect(page.getByLabel('Until (UTC, exclusive)')).toBeVisible();
    await page
      .locator('summary')
      .filter({ hasText: /^Activity breakdown ·/ })
      .click();
    const siteLayout = await page.evaluate(() => {
      const heading = document.querySelector('main h1')!;
      const hero = heading.closest('header')!;
      const metrics = document
        .querySelector('#activity-heading')!
        .closest('section')!
        .querySelectorAll('dl > div');
      return {
        heroPadding: Number.parseFloat(getComputedStyle(hero).paddingLeft),
        firstMetric: metrics[0].getBoundingClientRect().toJSON(),
        secondMetric: metrics[1].getBoundingClientRect().toJSON(),
      };
    });
    expect(siteLayout.heroPadding).toBeGreaterThanOrEqual(20);
    if (viewport.width === 390) {
      expect(siteLayout.secondMetric.y).toBeCloseTo(
        siteLayout.firstMetric.y,
        0,
      );
      expect(siteLayout.secondMetric.x).toBeGreaterThan(
        siteLayout.firstMetric.x,
      );
    }
    await noHorizontalOverflow(page);
    await page.screenshot({
      path: testInfo.outputPath(`site-detail-${viewport.suffix}.png`),
      fullPage: true,
    });

    await page
      .locator('summary')
      .filter({ hasText: /^Manage site \/ Archive or restore$/ })
      .click();
    const management = page.locator('form').filter({
      has: page.getByRole('heading', { level: 2, name: /^Manage / }),
    });
    await expect(
      management.getByRole('textbox', { name: 'Name', exact: true }),
    ).toBeVisible();
    await expect(
      management.getByRole('button', { name: 'Archive site', exact: true }),
    ).toBeVisible();
    expect(
      await management.evaluate((element) =>
        Number.parseFloat(getComputedStyle(element).paddingLeft),
      ),
    ).toBeGreaterThanOrEqual(16);
    await noHorizontalOverflow(page);
    await page.screenshot({
      path: testInfo.outputPath(`site-management-${viewport.suffix}.png`),
      fullPage: true,
    });

    await page.goto('/locations');
    await expect(
      page.getByRole('heading', { level: 1, name: 'Locations' }),
    ).toBeVisible();
    const locationBrowser = page.getByRole('navigation', {
      name: 'Location browser',
    });
    const browserPadding = await locationBrowser.evaluate((element) =>
      Number.parseFloat(getComputedStyle(element).paddingLeft),
    );
    expect(browserPadding).toBeGreaterThanOrEqual(12);
    const searchMetrics = await locationBrowser
      .getByRole('searchbox', { name: 'Browse locations' })
      .evaluate((input) => ({
        height: input.getBoundingClientRect().height,
        minimumHeight: Number.parseFloat(getComputedStyle(input).minHeight),
      }));
    expect(searchMetrics.minimumHeight).toBeGreaterThanOrEqual(44);
    // Chromium can report 43.999969px for a 44px box. Normalize only
    // sub-millipixel geometry precision while retaining the 44px minimum.
    expect(
      Math.round(searchMetrics.height * 1000) / 1000,
    ).toBeGreaterThanOrEqual(44);
    await locationBrowser
      .getByRole('button', { name: 'IT Closet ITC', exact: true })
      .click();
    const selectedLocation = page.getByRole('region', {
      name: 'Selected location',
    });
    await expect(
      selectedLocation.getByRole('heading', { name: 'IT Closet', exact: true }),
    ).toBeVisible();
    await expect(
      selectedLocation.getByText('ITC', { exact: true }),
    ).toBeVisible();
    await expect(
      selectedLocation.getByRole('link', { name: 'View contents and history' }),
    ).toHaveAttribute('href', '/locations/ITC');
    await expect(
      page.getByRole('region', { name: 'Selected location' }),
    ).toContainText('View contents and history');
    const selectedPadding = await page
      .getByRole('region', { name: 'Selected location' })
      .evaluate((element) =>
        Number.parseFloat(getComputedStyle(element).paddingLeft),
      );
    expect(selectedPadding).toBeGreaterThanOrEqual(16);
    await noHorizontalOverflow(page);
    await page.screenshot({
      path: testInfo.outputPath(`locations-selected-${viewport.suffix}.png`),
      fullPage: true,
    });
    await page.getByRole('link', { name: 'View contents and history' }).click();
    await expect(page).toHaveURL(/\/locations\/[^/]+$/);
    await noHorizontalOverflow(page);
    await page.screenshot({
      path: testInfo.outputPath(`location-detail-${viewport.suffix}.png`),
      fullPage: true,
    });
  }
});

test('modeled Spaces, inventory-only Spaces, and manual scan surfaces render at desktop and phone widths', async ({
  page,
}, testInfo) => {
  test.setTimeout(120_000);
  await signIn(page);
  for (const viewport of [
    { width: 1440, height: 900, suffix: 'desktop-1440' },
    { width: 390, height: 844, suffix: 'phone-390' },
  ]) {
    await page.setViewportSize(viewport);
    await page.goto('/room?space=it-closet');
    const viewer = page.getByTestId('room-viewer');
    await expect(viewer.locator('canvas')).toBeVisible();
    await expect
      .poll(() => viewer.getAttribute('data-camera-view'))
      .not.toBe('null');
    await noHorizontalOverflow(page);
    await page.screenshot({
      path: testInfo.outputPath(`spaces-modeled-${viewport.suffix}.png`),
      fullPage: true,
    });
    await page.getByLabel('Space', { exact: true }).selectOption('it-office');
    await expect(viewer).toHaveCount(0);
    await expect(
      page.getByRole('heading', { name: 'IT Office inventory' }),
    ).toBeVisible();
    await noHorizontalOverflow(page);
    await page.screenshot({
      path: testInfo.outputPath(`spaces-inventory-only-${viewport.suffix}.png`),
      fullPage: true,
    });
    await page.goto('/scan');
    await expect(
      page.getByRole('heading', { name: 'Camera scanner' }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Start camera' }),
    ).toBeVisible();
    await noHorizontalOverflow(page);
    await page.screenshot({
      path: testInfo.outputPath(`scan-idle-${viewport.suffix}.png`),
      fullPage: true,
    });
    await page
      .getByLabel('Paste a label URL, barcode text, or exact identifier')
      .fill('LOC:UNKNOWN-VISUAL-CHECK');
    await page.getByRole('button', { name: 'Open', exact: true }).click();
    await expect(page.getByRole('status')).toBeVisible();
    await noHorizontalOverflow(page);
    await page.screenshot({
      path: testInfo.outputPath(`scan-manual-result-${viewport.suffix}.png`),
      fullPage: true,
    });
  }
});

test('label search, queue, and both physical preview sizes render at desktop and phone widths', async ({
  page,
}, testInfo) => {
  test.setTimeout(120_000);
  await signIn(page);
  for (const viewport of [
    { width: 1440, height: 900, suffix: 'desktop-1440' },
    { width: 390, height: 844, suffix: 'phone-390' },
  ]) {
    await page.setViewportSize(viewport);
    await page.goto('/labels');
    await expect(
      page.getByRole('heading', { name: 'Print labels' }),
    ).toBeVisible();
    await expect(
      page.getByRole('form', { name: 'Search label records' }),
    ).toBeVisible();
    const records = page.getByRole('region', { name: 'Search result records' });
    await expect
      .poll(() =>
        records.evaluate(
          (element) => element.scrollHeight > element.clientHeight,
        ),
      )
      .toBe(true);
    const scrollGeometry = await records.evaluate((element) => ({
      height: element.getBoundingClientRect().height,
      maxHeight: Number.parseFloat(getComputedStyle(element).maxHeight),
      overflow: getComputedStyle(element).overflowY,
    }));
    expect(scrollGeometry.height).toBeLessThanOrEqual(
      scrollGeometry.maxHeight + 1,
    );
    expect(scrollGeometry.overflow).toBe('auto');
    await records.focus();
    await page.keyboard.press('End');
    await expect
      .poll(() => records.evaluate((element) => element.scrollTop))
      .toBeGreaterThan(0);
    await records.evaluate((element) => {
      element.scrollTop = 0;
    });
    await records.hover();
    await page.mouse.wheel(0, 400);
    await expect
      .poll(() => records.evaluate((element) => element.scrollTop))
      .toBeGreaterThan(0);
    await expect(page.getByRole('button', { name: 'Previous' })).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Next', exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole('region', { name: 'Label queue' }),
    ).toBeVisible();
    await noHorizontalOverflow(page);
    await page.screenshot({
      path: testInfo.outputPath(`labels-search-empty-${viewport.suffix}.png`),
      fullPage: true,
    });
    await page.goto('/labels?location=ITC');
    await page
      .getByRole('combobox', { name: 'Label size' })
      .selectOption('90x50');
    const card = page.locator('.label-card').first();
    await expect(card).toHaveAttribute('data-code-ready', 'true');
    await expect(
      page.getByRole('status').filter({
        hasText: 'Print preview refreshed from current inventory',
      }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: /Print selected labels/ }),
    ).toBeEnabled();
    await noHorizontalOverflow(page);
    await page.screenshot({
      path: testInfo.outputPath(`labels-90x50-${viewport.suffix}.png`),
      fullPage: true,
    });
    await page.emulateMedia({ media: 'print' });
    await page
      .locator('.label-print-root')
      .evaluate((element) =>
        element.setAttribute('data-print-authorized', 'true'),
      );
    await expect(
      page.getByRole('form', { name: 'Search label records' }),
    ).toBeHidden();
    await page.screenshot({
      path: testInfo.outputPath(`labels-print-90x50-${viewport.suffix}.png`),
      fullPage: true,
    });
    await page
      .locator('.label-print-root')
      .evaluate((element) => element.removeAttribute('data-print-authorized'));
    await page.emulateMedia({ media: 'screen' });
    await page
      .getByRole('combobox', { name: 'Label size' })
      .selectOption('70x35');
    await expect(card).toHaveAttribute('data-code-ready', 'true');
    await noHorizontalOverflow(page);
    await page.screenshot({
      path: testInfo.outputPath(`labels-70x35-${viewport.suffix}.png`),
      fullPage: true,
    });
  }
});

test('configuration and inventory creation surfaces render at desktop and phone widths', async ({
  page,
}, testInfo) => {
  test.setTimeout(120_000);
  await signIn(page);
  for (const viewport of [
    { width: 1440, height: 900, suffix: 'desktop-1440' },
    { width: 390, height: 844, suffix: 'phone-390' },
  ]) {
    await page.setViewportSize(viewport);
    for (const route of [
      {
        path: '/settings/categories',
        heading: 'Categories',
        file: 'categories',
      },
      {
        path: '/settings/labels',
        heading: 'Labels & printing defaults',
        file: 'label-defaults',
      },
      { path: '/history', heading: 'Inventory history', file: 'history' },
      {
        path: '/inventory/quantity/new',
        heading: 'Add quantity item',
        file: 'create-quantity',
      },
      {
        path: '/inventory/assets/new',
        heading: 'Add individual asset',
        file: 'create-asset',
      },
    ]) {
      await page.goto(route.path);
      await expect(
        page.getByRole('heading', { level: 1, name: route.heading }),
      ).toBeVisible();
      await noHorizontalOverflow(page);
      await page.screenshot({
        path: testInfo.outputPath(`${route.file}-${viewport.suffix}.png`),
        fullPage: true,
      });
    }
    await page.goto('/settings/forms');
    await page.locator('main a[href^="/settings/forms/"]').first().click();
    await expect(
      page.getByRole('region', { name: 'Forms and fields' }),
    ).toBeVisible();
    if (viewport.width > 390) {
      await page
        .getByRole('button', { name: 'Add field', exact: true })
        .click();
      const addition = page.getByRole('dialog', { name: 'Add field' });
      await addition
        .getByRole('button', { name: 'Short text', exact: true })
        .click();
      await addition
        .getByLabel('Field name', { exact: true })
        .fill('Visual check field');
      await addition
        .getByRole('button', { name: 'Add to form', exact: true })
        .click();
      await expect(
        page.getByRole('complementary', { name: 'Designer inspector' }),
      ).toBeVisible();
      const fieldLabel = page
        .getByRole('complementary', { name: 'Designer inspector' })
        .getByLabel('Field name', { exact: true });
      await expect(fieldLabel).toBeVisible();
      await fieldLabel.fill('Visual check field');
      await expect(
        page
          .locator('[data-control-id]')
          .filter({ hasText: 'Visual check field' }),
      ).toBeVisible();
      const panels = await page.evaluate(() => {
        const heading = (text: string) =>
          [...document.querySelectorAll('main h3')].find(
            (element) => element.textContent?.trim() === text,
          )!;
        const libraryHeading = heading('Field library');
        const canvasHeading = heading('Form canvas');
        const inspectorHeading = heading('Inspector');
        return {
          library: libraryHeading
            .parentElement!.getBoundingClientRect()
            .toJSON(),
          canvas: canvasHeading.parentElement!.getBoundingClientRect().toJSON(),
          inspector: inspectorHeading
            .parentElement!.getBoundingClientRect()
            .toJSON(),
          canvasHeadingHeight: canvasHeading.getBoundingClientRect().height,
        };
      });
      expect(panels.library.x + panels.library.width).toBeLessThanOrEqual(
        panels.canvas.x + 1,
      );
      expect(panels.canvas.x + panels.canvas.width).toBeLessThanOrEqual(
        panels.inspector.x + 1,
      );
      expect(panels.canvas.width).toBeGreaterThan(400);
      expect(panels.canvas.width).toBeGreaterThan(panels.library.width);
      expect(panels.canvas.width).toBeGreaterThan(panels.inspector.width);
      expect(
        Math.abs(panels.canvas.y - panels.inspector.y),
      ).toBeLessThanOrEqual(8);
      expect(Math.abs(panels.canvas.y - panels.library.y)).toBeLessThanOrEqual(
        8,
      );
      expect(panels.canvasHeadingHeight).toBeLessThan(40);
      const labelLines = await page.evaluate(() =>
        ['Manufacturer', 'Serial Number'].map((name) => {
          const label = [
            ...document.querySelectorAll('[data-control-id] span'),
          ].find((element) => element.textContent?.trim() === name)!;
          const node = label.firstChild!;
          const lines = new Map<number, string>();
          for (let index = 0; index < node.textContent!.length; index++) {
            const range = document.createRange();
            range.setStart(node, index);
            range.setEnd(node, index + 1);
            const y = Math.round(range.getBoundingClientRect().y);
            lines.set(y, (lines.get(y) ?? '') + node.textContent![index]);
          }
          return {
            name,
            lines: [...lines.values()].map((line) => line.trim()),
          };
        }),
      );
      for (const label of labelLines)
        expect(label.lines.at(-1)!.length, label.name).toBeGreaterThan(1);
    }
    await noHorizontalOverflow(page);
    await page.screenshot({
      path: testInfo.outputPath(`designer-${viewport.suffix}.png`),
      fullPage: true,
    });
    if (viewport.width > 390) {
      page.once('dialog', (dialog) => void dialog.accept());
      await page
        .getByRole('button', { name: 'Recovery & advanced', exact: true })
        .click();
      await page.getByRole('button', { name: 'Discard unsaved edits' }).click();
    }
    if (viewport.width === 390) {
      const panels = page.getByRole('navigation', { name: 'Designer panels' });
      await panels.getByRole('button', { name: 'Library' }).click();
      await expect(
        page.getByRole('heading', { name: 'Field library' }),
      ).toBeVisible();
      await noHorizontalOverflow(page);
      await page.screenshot({
        path: testInfo.outputPath('designer-library-phone-390.png'),
        fullPage: true,
      });
      await panels.getByRole('button', { name: 'Inspector' }).click();
      await expect(
        page.getByRole('complementary', { name: 'Designer inspector' }),
      ).toBeVisible();
      await noHorizontalOverflow(page);
      await page.screenshot({
        path: testInfo.outputPath('designer-inspector-phone-390.png'),
        fullPage: true,
      });
    }
  }
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.goto('/settings/forms');
  await page.locator('main a[href^="/settings/forms/"]').first().click();
  const tabletPanels = page.getByRole('navigation', {
    name: 'Designer panels',
  });
  await tabletPanels.getByRole('button', { name: 'Canvas' }).click();
  await expect(
    page.getByRole('heading', { name: 'Form canvas' }),
  ).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Field library' }),
  ).toBeHidden();
  await expect(
    page.getByRole('complementary', { name: 'Designer inspector' }),
  ).toBeHidden();
  const canvasLayout = await page
    .getByRole('heading', { name: 'Form canvas' })
    .evaluate((heading) => ({
      panelWidth: heading.parentElement!.getBoundingClientRect().width,
      headingHeight: heading.getBoundingClientRect().height,
    }));
  expect(canvasLayout.panelWidth).toBeGreaterThanOrEqual(400);
  expect(canvasLayout.headingHeight).toBeLessThan(40);
  await noHorizontalOverflow(page);
  await page.screenshot({
    path: testInfo.outputPath('designer-tablet-1024.png'),
    fullPage: true,
  });
});
