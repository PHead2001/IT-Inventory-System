import { readFileSync, writeFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import fixture from '../fixtures/auth.json' with { type: 'json' };

const officialScript = readFileSync(
  new URL('../fixtures/speed-insights-script.js', import.meta.url),
  'utf8',
);
const measuredRoutes = [
  '/dashboard',
  '/inventory',
  '/locations',
  '/room',
  '/labels',
];
type Intake = {
  method: string;
  headers: Record<string, string>;
  body: string | null;
};
type Metric = {
  type: string;
  value: number;
  href: string;
  route: string;
  attribution?: { eventTarget?: string };
};
type LayoutShiftObservation = {
  value: number;
  hadRecentInput: boolean;
  sourceIds: string[];
};

test.use({
  // The official intake script intentionally suppresses headless browsers.
  // Exercise its real request path under Chromium without that sampling guard.
  userAgent:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36',
});

async function captureTelemetry(page: Page, blockScript = false) {
  const requests: Intake[] = [];
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', {
      configurable: true,
      get: () => false,
    });
  });
  await page.route('**/_vercel/speed-insights/script.js', async (route) => {
    if (blockScript) return route.abort('blockedbyclient');
    await route.fulfill({
      status: 200,
      contentType: 'text/javascript',
      body: officialScript,
    });
  });
  await page.route('**/_vercel/speed-insights/vitals', async (route) => {
    const request = route.request();
    requests.push({
      method: request.method(),
      headers: await request.allHeaders(),
      body: request.postData(),
    });
    await route.fulfill({ status: 204 });
  });
  return requests;
}

async function signIn(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Email', { exact: true }).fill(fixture.emails.viewer);
  await page.getByLabel('Password', { exact: true }).fill(fixture.password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Inventory', exact: true }),
  ).toBeVisible();
}

async function waitForOfficialScript(page: Page) {
  await expect(
    page.locator('script[src="/_vercel/speed-insights/script.js"]'),
  ).toHaveCount(1);
  await page.waitForFunction(
    () => (window as Window & { sil?: boolean }).sil === true,
  );
  // TTFB and paint metrics are queued asynchronously by the provider script.
  await page.waitForTimeout(150);
}

async function flush(page: Page) {
  await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
}

async function expectNoIntake(page: Page, requests: Intake[]) {
  await flush(page);
  // Request interception crosses the browser/Playwright process boundary.
  await page.waitForTimeout(150);
  expect(requests).toEqual([]);
}

function emittedMetrics(requests: Intake[], expectedPath: string): Metric[] {
  expect(requests.length).toBeGreaterThan(0);
  const metrics = requests.flatMap((request) => {
    expect(request.method).toBe('POST');
    expect(request.headers['content-type']).toMatch(/^text\/plain/i);
    expect(request.headers).not.toHaveProperty('referer');
    const body = JSON.parse(request.body ?? '') as {
      metrics: Metric[];
      sdkName: string;
    };
    expect(body.sdkName).toBe('@vercel/speed-insights/next');
    expect(body.metrics.length).toBeGreaterThan(0);
    expect(request.body).not.toMatch(/private-search-sentinel|local-section/);
    return body.metrics;
  });
  expect(metrics.length).toBeGreaterThan(0);
  for (const metric of metrics) {
    expect(metric.href).toBe('http://localhost:3000' + expectedPath);
    expect(metric.route).toBe(expectedPath);
  }
  return metrics;
}

for (const path of measuredRoutes) {
  test(`${path} sends only static route and redacted search URL`, async ({
    page,
  }) => {
    test.setTimeout(60_000);
    const requests = await captureTelemetry(page);
    await signIn(page);
    await page.goto(`${path}?q=private-search-sentinel#local-section`);
    await waitForOfficialScript(page);
    requests.length = 0;
    await flush(page);
    await expect.poll(() => requests.length).toBeGreaterThan(0);
    emittedMetrics(requests, path);
  });
}

test('client navigation drops queued metrics on scan and detail routes', async ({
  page,
}) => {
  const requests = await captureTelemetry(page);
  await signIn(page);
  await waitForOfficialScript(page);
  requests.length = 0;
  await page.getByRole('link', { name: 'Scan', exact: true }).click();
  await expect(page).toHaveURL(/\/scan$/);
  await expectNoIntake(page, requests);

  await page.getByRole('link', { name: 'Locations', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Locations' })).toBeVisible();
  requests.length = 0;
  await page
    .getByRole('navigation', { name: 'Location browser' })
    .getByRole('button', { name: /IT Closet ITC/ })
    .click();
  await page
    .getByRole('region', { name: 'Selected location' })
    .getByRole('link', { name: 'View contents and history' })
    .click();
  await expect(page).toHaveURL(/\/locations\/[^/]+$/);
  await expectNoIntake(page, requests);
});

test('auth/token navigation and queued logout do not send vitals', async ({
  page,
}) => {
  const requests = await captureTelemetry(page);
  await signIn(page);
  await waitForOfficialScript(page);
  for (const sensitivePath of [
    '/login',
    '/auth/confirm?token=private-token-sentinel',
    '/inventory?access_token=private-token-sentinel',
    '/inventory#refresh_token=private-token-sentinel',
  ]) {
    requests.length = 0;
    await page.evaluate(
      (path) => history.pushState(null, '', path),
      sensitivePath,
    );
    await expectNoIntake(page, requests);
    await page.goto('/inventory');
    await waitForOfficialScript(page);
  }
  await page.goto('/inventory?access_token=private-token-sentinel');
  await waitForOfficialScript(page);
  requests.length = 0;
  await expectNoIntake(page, requests);
  await page.goto('/inventory');
  await waitForOfficialScript(page);
  requests.length = 0;
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/login$/);
  await page.waitForTimeout(150);
  expect(requests).toEqual([]);
});

test('native INP and CLS attribution emits only opaque element identifiers', async ({
  page,
}, testInfo) => {
  const requests = await captureTelemetry(page);
  await signIn(page);
  await waitForOfficialScript(page);
  requests.length = 0;
  await page.evaluate(() => {
    const observed = window as Window & {
      __testLayoutShifts?: LayoutShiftObservation[];
    };
    observed.__testLayoutShifts = [];
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        const shift = entry as PerformanceEntry & {
          value: number;
          hadRecentInput: boolean;
          sources?: { node?: Node }[];
        };
        observed.__testLayoutShifts!.push({
          value: shift.value,
          hadRecentInput: shift.hadRecentInput,
          sourceIds: (shift.sources ?? [])
            .map((source) =>
              source.node instanceof Element ? source.node.id : '',
            )
            .filter(Boolean),
        });
      }
    }).observe({ type: 'layout-shift', buffered: false });
    const main = document.querySelector('main')!;
    const interaction = document.createElement('button');
    interaction.id = 'inventory-location-results-tree-1';
    interaction.textContent = 'Exercise interaction timing';
    interaction.addEventListener('click', () => {
      const end = performance.now() + 100;
      while (performance.now() < end) {
        /* deterministic long interaction */
      }
    });
    const shift = document.createElement('div');
    shift.id = 'inventory-location-results-tree-2';
    shift.textContent = 'Exercise layout shift';
    shift.style.cssText =
      'position:fixed;top:100px;left:100px;width:200px;height:50px;z-index:5;background:#123456';
    main.append(interaction);
    document.body.append(shift);
  });
  await page.waitForTimeout(900);
  await page.evaluate(() => {
    const shift = document.getElementById('inventory-location-results-tree-2')!;
    shift.style.top = '220px';
  });
  await expect
    .poll(() =>
      page.evaluate(() =>
        (
          window as Window & { __testLayoutShifts?: LayoutShiftObservation[] }
        ).__testLayoutShifts?.some(
          (entry) =>
            entry.value > 0 &&
            !entry.hadRecentInput &&
            entry.sourceIds.includes('inventory-location-results-tree-2'),
        ),
      ),
    )
    .toBe(true);
  await page.locator('#inventory-location-results-tree-1').click();
  await page.waitForTimeout(200);
  // CLS registers its hidden callback asynchronously after buffered FCP,
  // after the provider's transport listener. The first event queues CLS;
  // the second drains it without unloading the intercepted request's page.
  await flush(page);
  await flush(page);
  await expect.poll(() => requests.length).toBeGreaterThan(0);
  const metrics = emittedMetrics(requests, '/inventory');
  const nativeShifts = await page.evaluate(
    () =>
      (window as Window & { __testLayoutShifts?: LayoutShiftObservation[] })
        .__testLayoutShifts ?? [],
  );
  const diagnostic = JSON.stringify({
    shifts: nativeShifts,
    cls: metrics.filter((metric) => metric.type === 'CLS'),
  });
  writeFileSync(testInfo.outputPath('native-layout-shifts.json'), diagnostic);
  await testInfo.attach('native-layout-shifts', {
    body: diagnostic,
    contentType: 'application/json',
  });
  expect(
    metrics.find((metric) => metric.type === 'INP')?.attribution?.eventTarget,
  ).toBe('#inventory-location-results-tree-1');
  // The pinned official intake serializes CLS largestShiftTarget as
  // attribution.eventTarget on the wire.
  expect(
    metrics.find((metric) => metric.type === 'CLS')?.attribution?.eventTarget,
  ).toBe('#inventory-location-results-tree-2');
  expect(
    metrics.find((metric) => metric.type === 'CLS')?.value,
  ).toBeGreaterThan(0);
  expect(JSON.stringify(metrics)).not.toMatch(
    /private-token-sentinel|[0-9a-f]{8}-[0-9a-f-]{27,}/i,
  );
});

test('inventory stays usable when the provider script is blocked', async ({
  page,
}) => {
  const requests = await captureTelemetry(page, true);
  await signIn(page);
  await expect(
    page.getByRole('form', { name: 'Search inventory' }),
  ).toBeVisible();
  await page.getByRole('link', { name: 'Locations', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Locations' })).toBeVisible();
  expect(requests).toEqual([]);
});
