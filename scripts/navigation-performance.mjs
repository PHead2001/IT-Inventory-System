import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { chromium } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { seedUsers, fixtureEmails, fixturePassword } from './fixtures.mjs';
import { npm, localStatus } from './runtime.mjs';
import {
  performanceTables,
  assertFreshPerformanceDataset,
  measuredFixtureCounts,
  assertCommittedPerformanceSource,
  performanceBuildBinding,
  assertPerformanceBuildReuse,
  installNavigationFeedbackObserver,
} from './navigation-performance-contract.mjs';

const options = Object.fromEntries(
  process.argv.slice(2).map((entry) => {
    const [key, ...value] = entry.replace(/^--/, '').split('=');
    return [key, value.join('=')];
  }),
);
const workspace = resolve(options.workspace || process.cwd());
const samples = Number(options.samples || 3);
if (!Number.isInteger(samples) || samples < 1 || samples > 20)
  throw new Error('Use 1–20 samples.');
const dataset = options.dataset || 'empty';
if (!['empty', 'populated'].includes(dataset))
  throw new Error('Unknown dataset.');
const output = resolve(
  options.output ||
    `test-results/performance/${options.label || 'candidate'}-${dataset}.json`,
);
const traceFile = output + '.fetch.jsonl';
const originalCwd = process.cwd();
process.chdir(workspace);
// A diff alone excludes new files. Refuse both tracked and untracked source
// changes; measurements may create documentation artifacts outside these roots.
const sourceStatus = execFileSync(
  'git',
  [
    'status',
    '--porcelain=v1',
    '--untracked-files=all',
    '--',
    'src',
    'scripts',
    'data',
    'tests',
    'supabase',
    'next.config.ts',
    'package.json',
    'package-lock.json',
    'tsconfig.json',
    'postcss.config.mjs',
    'eslint.config.mjs',
  ],
  { encoding: 'utf8' },
);
assertCommittedPerformanceSource(sourceStatus);
const sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], {
  encoding: 'utf8',
}).trim();
const status = localStatus(); // Canonical loopback guards; never a hosted target.
const admin = createClient(status.API_URL, status.SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
async function readFixtureCounts() {
  return Object.fromEntries(
    await Promise.all(
      performanceTables.map(async (table) => {
        const result = await admin
          .from(table)
          .select('*', { head: true, count: 'exact' });
        if (result.error) throw result.error;
        return [table, result.count];
      }),
    ),
  );
}
assertFreshPerformanceDataset(await readFixtureCounts());
await seedUsers(status);
if (dataset === 'populated') {
  const actor = createClient(status.API_URL, status.ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const login = await actor.auth.signInWithPassword({
    email: fixtureEmails.staff,
    password: fixturePassword,
  });
  if (login.error) throw login.error;
  const categories = await actor
    .from('categories')
    .select('id')
    .order('sort_order');
  const locations = await actor
    .from('locations')
    .select('id')
    .eq('code', 'ITC-S1A')
    .single();
  if (categories.error || locations.error)
    throw new Error('Canonical fixture references unavailable.');
  for (let index = 0; index < 30; index++) {
    for (const kind of ['quantity', 'asset']) {
      const result = await actor.rpc(
        kind === 'quantity' ? 'quantity_create' : 'asset_create',
        {
          p_request_id: randomUUID(),
          p_payload: {
            name: `Performance fixture ${kind} ${String(index).padStart(2, '0')}`,
            category_id: categories.data[index % categories.data.length].id,
            ...(kind === 'quantity'
              ? {
                  initial_quantity: index + 1,
                  initial_location_id: locations.data.id,
                  reorder_threshold: 40,
                }
              : { location_id: locations.data.id, asset_tag: `PERF-${index}` }),
          },
        },
      );
      if (result.error)
        throw new Error(
          `Fixture ${kind} creation failed: ${result.error.code}`,
        );
    }
  }
  for (let index = 0; index < 8; index++) {
    const result = await actor.rpc('site_create', {
      p_request_id: randomUUID(),
      p_payload: {
        code: `PERF-${index}`,
        name: `Performance fixture site ${index}`,
      },
    });
    if (result.error)
      throw new Error(`Site fixture failed: ${result.error.code}`);
  }
  await actor.auth.signOut({ scope: 'local' });
}
const fixtureCounts = measuredFixtureCounts(dataset, await readFixtureCounts());
const categories = await admin
  .from('categories')
  .select('id')
  .eq('active', true)
  .order('sort_order')
  .limit(2);
if (categories.error || categories.data.length < 2)
  throw new Error('Two canonical categories required.');
const env = {
  ...process.env,
  NEXT_PUBLIC_SUPABASE_URL: status.API_URL,
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: status.ANON_KEY,
  APP_ORIGIN: 'http://localhost:3000',
  APP_ENV: 'local',
  SPEED_INSIGHTS_ENABLED: 'false',
};
delete env.VERCEL;
delete env.VERCEL_ENV;
const buildBinding = performanceBuildBinding({
  commit: sourceCommit,
  env,
  nodeVersion: process.version,
  frameworkVersion: JSON.parse(readFileSync('node_modules/next/package.json'))
    .version,
  envFileHashes: [
    '.env.production.local',
    '.env.local',
    '.env.production',
    '.env',
  ].map((path) => [
    path,
    existsSync(path)
      ? createHash('sha256').update(readFileSync(path)).digest('hex')
      : null,
  ]),
});
const manifestPath = '.next/navigation-performance-build.json';
if (options.build === 'false') {
  let manifest;
  let actualBuildId;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    actualBuildId = readFileSync('.next/BUILD_ID', 'utf8').trim();
  } catch {
    /* A missing/corrupt manifest is an unverified build. */
  }
  assertPerformanceBuildReuse(manifest, buildBinding, actualBuildId);
} else {
  npm(['run', 'build'], { env });
  writeFileSync(
    manifestPath,
    JSON.stringify(
      {
        ...buildBinding,
        buildId: readFileSync('.next/BUILD_ID', 'utf8').trim(),
      },
      null,
      2,
    ) + '\n',
  );
}
mkdirSync(dirname(output), { recursive: true });
writeFileSync(traceFile, '');
const nextBin = resolve('node_modules/next/dist/bin/next');
const tracer = fileURLToPath(
  new URL('./performance-fetch-trace.mjs', import.meta.url),
);
let serverOutput = '';
const server = spawn(
  process.execPath,
  [
    '--import',
    pathToFileURL(tracer).href,
    nextBin,
    'start',
    '--hostname',
    '127.0.0.1',
  ],
  {
    cwd: workspace,
    env: { ...env, NAVIGATION_TRACE_FILE: traceFile },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  },
);
// Also retire the direct Next process when startup/browser launch fails before
// the measurement finally block is reached. Never leave a reused dev server.
process.once('exit', () => {
  server.kill();
});
server.stdout.on('data', (value) => {
  serverOutput += value;
});
server.stderr.on('data', (value) => {
  serverOutput += value;
});
const deadline = Date.now() + 60_000;
while (!serverOutput.includes('Ready')) {
  if (server.exitCode !== null || Date.now() > deadline)
    throw new Error('Production server did not become ready.');
  await new Promise((done) => setTimeout(done, 250));
}
const browser = await chromium.launch();
const routes = [
  ['overview', '/dashboard', 'Low-stock overview'],
  ['inventory', '/inventory', 'Inventory'],
  ['scan', '/scan', 'Scan and open'],
  ['labels', '/labels', 'Print labels'],
  ['spaces', '/room', 'Spaces & maps'],
  ['locations', '/locations', 'Locations'],
  ['sites', '/sites', 'Properties and sites'],
  ['history', '/history', 'Inventory history'],
  ['settings', '/settings', 'Settings'],
  ['category-form', `/settings/forms/${categories.data[1].id}`, null],
];
const records = [];
const supplemental = [];
async function ready(page, route) {
  await page.waitForURL((url) => url.pathname === route[1]);
  if (route[2])
    await page
      .getByRole('heading', { level: 1, name: route[2], exact: true })
      .waitFor();
  else await page.locator('#main-content select').first().waitFor();
  if (route[0] === 'labels')
    await page.getByText(/matching records\. Scroll this list/).waitFor();
  // Conventional content/control availability, two painted frames. This is not
  // an assertion that every background render/renderer hydration has completed.
  await page
    .locator(
      '#main-content a, #main-content button, #main-content input, #main-content select',
    )
    .first()
    .waitFor();
  await page.evaluate(
    () =>
      new Promise((done) =>
        requestAnimationFrame(() => requestAnimationFrame(done)),
      ),
  );
}
async function measure(page, route, mode, sample) {
  const startEpoch = Date.now();
  const requests = [];
  const requestDone = async (request) => {
    const response = await request.response();
    if (!response) return;
    const timing = request.timing();
    const sizes = await request.sizes().catch(() => null);
    const url = new URL(request.url());
    requests.push({
      kind: request.resourceType(),
      route: url.pathname.startsWith('/_next/')
        ? 'next-resource'
        : routes.find((item) => item[1] === url.pathname)?.[0] || 'other',
      status: response.status(),
      prefetch: request.headers()['next-router-prefetch'] === '1',
      ttfbMs:
        timing.responseStart >= 0
          ? timing.responseStart - Math.max(0, timing.requestStart)
          : null,
      durationMs: timing.responseEnd,
      encodedBodyBytes: sizes?.responseBodySize ?? null,
    });
  };
  page.on('requestfinished', requestDone);
  await page.evaluate(installNavigationFeedbackObserver, {
    heading: route[2],
    category: route[0] === 'category-form',
  });
  const start = performance.now();
  if (mode === 'deep-link')
    await page.goto(`http://localhost:3000${route[1]}`, {
      waitUntil: 'domcontentloaded',
    });
  else if (route[0] === 'category-form') {
    const categorySelect = page.locator('#main-content select').first();
    if ((await categorySelect.locator('option').count()) > 1)
      await categorySelect.selectOption(categories.data[1].id);
    else {
      // Baseline selector is broken; route-link navigation is recorded distinctly.
      await page.evaluate((href) => {
        const link = document.createElement('a');
        link.href = href;
        link.id = 'performance-category-link';
        link.textContent = 'Open category';
        document.querySelector('#main-content').append(link);
      }, route[1]);
      await page.locator('#performance-category-link').click();
    }
  } else
    await page
      .getByRole('navigation', { name: 'Main navigation' })
      .locator(`a[href="${route[1]}"]`)
      .click();
  await ready(page, route);
  const usableMs = performance.now() - start;
  const metrics = await page.evaluate(() => {
    window.__navObserver?.disconnect();
    const nav = performance.getEntriesByType('navigation')[0];
    return {
      feedbackMs: window.__navMeasure?.feedbackMs ?? null,
      longTasks: (window.__longTasks || []).filter(
        (entry) => entry.startTime >= (window.__navMeasure?.start || 0),
      ),
      documentTtfbMs: nav?.responseStart - nav?.requestStart,
      resourceBytes: performance
        .getEntriesByType('resource')
        .filter((entry) => entry.startTime >= (window.__navMeasure?.start || 0))
        .reduce((sum, entry) => sum + entry.transferSize, 0),
    };
  });
  await page.waitForTimeout(100);
  page.off('requestfinished', requestDone);
  const fetches = readFileSync(traceFile, 'utf8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map(JSON.parse)
    .filter((entry) => entry.at >= startEpoch);
  records.push({
    route: route[0],
    mode,
    sample,
    usableMs,
    ...metrics,
    requests,
    fetches,
  });
  writeFileSync(
    output,
    JSON.stringify({ provenance, records, supplemental }, null, 2) + '\n',
  );
}
const provenance = {
  capturedAt: new Date().toISOString(),
  label: options.label || 'candidate',
  dataset,
  samples,
  commit: sourceCommit,
  buildInputsSha256: buildBinding.buildInputsSha256,
  sourceDiffSha256: createHash('sha256')
    .update(execFileSync('git', ['diff', '--binary', 'HEAD']))
    .digest('hex'),
  sourceStatus:
    'committed source unchanged; tracked and untracked source checked',
  buildId: readFileSync('.next/BUILD_ID', 'utf8').trim(),
  harnessSha256: createHash('sha256')
    .update(readFileSync(fileURLToPath(import.meta.url)))
    .digest('hex'),
  node: process.version,
  framework: JSON.parse(readFileSync('node_modules/next/package.json')).version,
  browser: browser.version(),
  environment: 'local-production-build-loopback-supabase',
  motion: 'full, OS no-preference',
  backendState: 'warm local containers; server coldness not established',
  usableDefinition:
    'route URL + conventional heading/control visible + two painted frames; Labels additionally waits for loaded search results; renderer readiness separately unproven',
  feedbackDefinition:
    'pending indicator/loading boundary, category navigation status or target heading DOM observed; deep-link feedback unavailable after document replacement, documentTtfbMs recorded separately',
  categoryBaselineLimitation:
    'frozen baseline one-option selector cannot switch and uses an ordinary route link; candidate uses its actual category selector; baseline clicks are not comparable',
  fixtures: fixtureCounts,
};
try {
  for (let sample = 1; sample <= samples; sample++)
    for (const route of routes) {
      const context = await browser.newContext({
        viewport: { width: 1440, height: 1000 },
        reducedMotion: 'no-preference',
      });
      await context.addInitScript(() => {
        window.__longTasks = [];
        new PerformanceObserver((list) =>
          window.__longTasks.push(
            ...list.getEntries().map((entry) => ({
              startTime: entry.startTime,
              durationMs: entry.duration,
            })),
          ),
        ).observe({ type: 'longtask', buffered: true });
      });
      const page = await context.newPage();
      // A supported login return target avoids visiting the measured route as
      // part of authentication. This is one source page, never a warm-up tour.
      const source =
        route[0] === 'category-form'
          ? `/settings/forms/${categories.data[0].id}`
          : '/locations/ITC-S1A';
      await page.goto(
        'http://localhost:3000/login?next=%2Flocations%2FITC-S1A',
      );
      await page.getByLabel('Email', { exact: true }).fill(fixtureEmails.staff);
      await page.getByLabel('Password', { exact: true }).fill(fixturePassword);
      await page.getByRole('button', { name: 'Sign in', exact: true }).click();
      await page.waitForURL((url) => url.pathname === '/locations/ITC-S1A');
      if (route[0] === 'category-form')
        await page.goto(`http://localhost:3000${source}`, {
          waitUntil: 'networkidle',
        });
      await page.waitForTimeout(150);
      if (route[0] === 'spaces') {
        const at = Date.now();
        const began = performance.now();
        const response = await page.request.get(
          'http://localhost:3000/api/room/contents?space=it-closet&location=ITC-S1A',
        );
        if (response.status() !== 200)
          throw new Error('Room content read failed.');
        supplemental.push({
          sample,
          path: 'room-contents',
          durationMs: performance.now() - began,
          bytes: (await response.body()).length,
          fetches: readFileSync(traceFile, 'utf8')
            .trim()
            .split('\n')
            .filter(Boolean)
            .map(JSON.parse)
            .filter((entry) => entry.at >= at),
        });
      }
      await measure(page, route, 'unvisited-click', sample);
      await page.goto(`http://localhost:3000${source}`, {
        waitUntil: 'networkidle',
      });
      await measure(page, route, 'repeat-click', sample);
      const session = await context.storageState();
      await context.close();
      const fresh = await browser.newContext({
        storageState: session,
        viewport: { width: 1440, height: 1000 },
        reducedMotion: 'no-preference',
      });
      await fresh.addInitScript(() => {
        window.__longTasks = [];
        new PerformanceObserver((list) =>
          window.__longTasks.push(
            ...list.getEntries().map((entry) => ({
              startTime: entry.startTime,
              durationMs: entry.duration,
            })),
          ),
        ).observe({ type: 'longtask', buffered: true });
      });
      await measure(await fresh.newPage(), route, 'deep-link', sample);
      await fresh.close();
      console.log(
        `${provenance.label} ${dataset} ${sample}/${samples} ${route[0]} measured`,
      );
    }
} finally {
  await browser.close();
  server.kill();
  process.chdir(originalCwd);
}
