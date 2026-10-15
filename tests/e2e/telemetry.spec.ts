import { readFileSync, writeFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import fixture from '../fixtures/auth.json' with { type: 'json' };
import {
  observeNativeLayoutShifts,
  nativeProbeDominance,
  shiftProbeId,
  winningLayoutShift,
  type LayoutShiftObservation,
} from '../helpers/native-layout-shifts';

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

async function waitForNativeMetrics(requests: Intake[]) {
  // A transport request can arrive before the separately flushed CLS batch.
  // Wait for both native metrics before taking the assertion snapshot.
  await expect
    .poll(() =>
      requests.flatMap((request) => {
        const body = JSON.parse(request.body ?? '') as { metrics: Metric[] };
        return body.metrics.map((metric) => metric.type);
      }),
    )
    .toEqual(expect.arrayContaining(['INP', 'CLS']));
}

test('native telemetry readiness waits for a later CLS intake batch', async () => {
  const requests: Intake[] = [];
  const captureMetric = (type: string) =>
    requests.push({
      method: 'POST',
      headers: { 'content-type': 'text/plain' },
      body: JSON.stringify({ metrics: [{ type }] }),
    });
  captureMetric('INP');
  let ready = false;
  const readiness = waitForNativeMetrics(requests).then(() => {
    ready = true;
  });
  // Give the first readiness check a turn while CLS has not arrived.
  await new Promise<void>((resolve) => setImmediate(resolve));
  const readyBeforeCls = ready;
  captureMetric('CLS');
  await readiness;
  expect(readyBeforeCls).toBe(false);
  expect(ready).toBe(true);
});

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
    .getByRole('link', {
      name: 'View IT Closet location details',
      exact: true,
    })
    .click();
  await expect(page).toHaveURL((url) => url.pathname === '/locations/ITC');
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

async function nativeShifts(page: Page) {
  return page.evaluate(() => {
    const observed = window as Window & {
      __testLayoutShifts?: LayoutShiftObservation[];
      __testDrainLayoutShifts?: () => void;
    };
    observed.__testDrainLayoutShifts?.();
    return observed.__testLayoutShifts ?? [];
  });
}

async function exerciseNativeShift(page: Page) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    );
    const shift = document.createElement('div');
    shift.id = 'inventory-location-results-tree-2';
    shift.textContent = 'Exercise layout shift';
    // Large visible physical movement; dominance is checked from actual native
    // entries, rather than inferred from the probe's dimensions.
    shift.style.cssText =
      'position:fixed;top:0;left:0;width:100vw;height:90vh;z-index:2147483647;background:#123456;pointer-events:none';
    document.body.append(shift);
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    );
  });
  // End the input-exclusion period and separate our shift from page-load shifts.
  await page.waitForTimeout(1100);
  await page.evaluate(() => {
    document.getElementById('inventory-location-results-tree-2')!.style.top =
      '50vh';
  });
  await expect
    .poll(async () =>
      (await nativeShifts(page)).some(
        (entry) =>
          !entry.hadRecentInput &&
          entry.value > 0 &&
          entry.sources.some((source) => source.target === 'probe'),
      ),
    )
    .toBe(true);
  const winner = nativeProbeDominance(await nativeShifts(page));
  expect(
    winner.target,
    'controlled probe must be the largest native shift with its first Element source',
  ).toBe('probe');
  expect(
    winner.dominates,
    'probe must outweigh all other eligible shifts combined',
  ).toBe(true);
  return winner;
}

// Runs without Auth or telemetry: proves real Chromium layout-shift generation
// and buffered capture, including an observer installed after the shift.
test('native layout probe proves buffered winning shift', async ({ page }) => {
  await page.setContent('<!doctype html><main>Native layout fixture</main>');
  await page.evaluate(observeNativeLayoutShifts);
  const winner = await exerciseNativeShift(page);
  await page.evaluate(observeNativeLayoutShifts);
  await expect
    .poll(async () => nativeProbeDominance(await nativeShifts(page)).dominates)
    .toBe(true);
  expect(nativeProbeDominance(await nativeShifts(page)).value).toBe(
    winner.value,
  );
});

test('native INP and CLS attribution emits only opaque element identifiers', async ({
  page,
}, testInfo) => {
  const requests = await captureTelemetry(page);
  await page.addInitScript(observeNativeLayoutShifts);
  try {
    await signIn(page);
    // A fresh authenticated document gives both observers the same navigation,
    // including buffered load shifts rather than the preceding login document.
    await page.goto('/inventory');
    await expect(
      page.getByRole('heading', { name: 'Inventory', exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole('form', { name: 'Search inventory' }),
    ).toBeVisible();
    await waitForOfficialScript(page);
    requests.length = 0;
    await page.evaluate(() => {
      const interaction = document.createElement('button');
      interaction.id = 'inventory-location-results-tree-1';
      interaction.textContent = 'Exercise interaction timing';
      interaction.addEventListener('click', () => {
        const end = performance.now() + 100;
        while (performance.now() < end) {
          /* deterministic long interaction */
        }
      });
      document.querySelector('main')!.append(interaction);
    });
    await exerciseNativeShift(page);
    await page.locator('#inventory-location-results-tree-1').click();
    await page.waitForTimeout(200);
    expect(nativeProbeDominance(await nativeShifts(page)).dominates).toBe(true);
    // CLS queues after the transport listener; the second event drains it.
    await flush(page);
    await flush(page);
    await waitForNativeMetrics(requests);
    expect(nativeProbeDominance(await nativeShifts(page)).dominates).toBe(true);
    const metrics = emittedMetrics(requests, '/inventory');
    expect(
      metrics.find((metric) => metric.type === 'INP')?.attribution?.eventTarget,
    ).toBe('#inventory-location-results-tree-1');
    const cls = metrics.find((metric) => metric.type === 'CLS');
    // The pinned intake serializes the first Element source in the winning
    // session's largest individual shift; native dominance proves its identity.
    expect(cls?.attribution?.eventTarget).toBe('#' + shiftProbeId);
    expect(cls?.value).toBeGreaterThan(0);
    expect(JSON.stringify(metrics)).not.toMatch(
      /private-token-sentinel|[0-9a-f]{8}-[0-9a-f-]{27,}/i,
    );
  } catch (error) {
    const shifts = await nativeShifts(page).catch(() => []);
    const winner = winningLayoutShift(shifts);
    const diagnostic = JSON.stringify({
      entryCount: shifts.length,
      // Bounded metadata only: no captured private DOM IDs, selectors or URLs.
      shifts: shifts
        .slice(-24)
        .map((shift) => ({ ...shift, sources: shift.sources.slice(0, 5) })),
      dominance: nativeProbeDominance(shifts),
      reconstructedWinner: {
        value: winner.value,
        target: winner.target,
        time: winner.largest?.startTime,
      },
      cls: requests
        .flatMap((request) => {
          const body = JSON.parse(request.body ?? '{}') as {
            metrics?: Metric[];
          };
          return (body.metrics ?? [])
            .filter((metric) => metric.type === 'CLS')
            .map((metric) => ({
              value: metric.value,
              target:
                metric.attribution?.eventTarget === '#' + shiftProbeId
                  ? 'probe'
                  : metric.attribution?.eventTarget
                    ? 'other'
                    : 'absent',
            }));
        })
        .slice(-8),
    });
    console.error('Native CLS fixture diagnostic: ' + diagnostic);
    writeFileSync(testInfo.outputPath('native-layout-shifts.json'), diagnostic);
    await testInfo.attach('native-layout-shifts', {
      body: diagnostic,
      contentType: 'application/json',
    });
    throw error;
  }
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
