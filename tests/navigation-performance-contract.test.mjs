import assert from 'node:assert/strict';
import test from 'node:test';
import {
  performanceTables,
  assertFreshPerformanceDataset,
  measuredFixtureCounts,
  assertCommittedPerformanceSource,
  performanceBuildBinding,
  assertPerformanceBuildReuse,
} from '../scripts/navigation-performance-contract.mjs';
const empty = () =>
  Object.fromEntries(performanceTables.map((table) => [table, 0]));

test('both measurement datasets require an empty fixture and audit state', () => {
  assert.doesNotThrow(() => assertFreshPerformanceDataset(empty()));
  for (const table of performanceTables) {
    assert.throws(
      () => assertFreshPerformanceDataset({ ...empty(), [table]: 1 }),
      /fresh canonical disposable DB reset/,
    );
  }
  assert.throws(
    () =>
      assertFreshPerformanceDataset({
        ...empty(),
        quantity_items: 30,
        serialized_assets: 30,
        sites: 8,
      }),
    /cannot be reused/,
  );
});

const bindingInputs = {
  commit: 'a'.repeat(40),
  env: {
    NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321',
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'fictional-public-key',
    APP_ENV: 'local',
    APP_ORIGIN: 'http://localhost:3000',
    SPEED_INSIGHTS_ENABLED: 'false',
  },
  envFileHashes: [['.env.local', null]],
  nodeVersion: 'v24.19.0',
  frameworkVersion: '16.3.6',
};
test('build reuse is bound to source SHA and actual Next BUILD_ID', () => {
  const binding = performanceBuildBinding(bindingInputs);
  const manifest = { ...binding, buildId: 'build-a' };
  assert.doesNotThrow(() =>
    assertPerformanceBuildReuse(manifest, binding, 'build-a'),
  );
  assert.throws(
    () =>
      assertPerformanceBuildReuse(
        manifest,
        { ...binding, commit: 'b'.repeat(40) },
        'build-a',
      ),
    /unchecked .next reuse is refused/,
  );
  assert.throws(
    () => assertPerformanceBuildReuse(manifest, binding, 'build-b'),
    /provenance differs/,
  );
  for (const missing of [undefined, null, {}, { ...manifest, version: 2 }]) {
    assert.throws(
      () => assertPerformanceBuildReuse(missing, binding, 'build-a'),
      /provenance differs/,
    );
  }
});
test('backend, public environment, env file and toolchain changes invalidate a reusable build without exposing values', () => {
  const binding = performanceBuildBinding(bindingInputs);
  const manifest = { ...binding, buildId: 'build-a' };
  const changes = [
    {
      env: {
        ...bindingInputs.env,
        NEXT_PUBLIC_SUPABASE_URL: 'http://localhost:54321',
      },
    },
    {
      env: {
        ...bindingInputs.env,
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'another-public-key',
      },
    },
    { env: { ...bindingInputs.env, NEXT_PUBLIC_ADDITIONAL_INPUT: 'changed' } },
    { env: { ...bindingInputs.env, APP_ORIGIN: 'http://127.0.0.1:3000' } },
    { envFileHashes: [['.env.local', 'changed-file-digest']] },
    { frameworkVersion: 'another-framework-version' },
    { nodeVersion: 'another-node-version' },
  ];
  for (const change of changes) {
    assert.throws(
      () =>
        assertPerformanceBuildReuse(
          manifest,
          performanceBuildBinding({ ...bindingInputs, ...change }),
          'build-a',
        ),
      /provenance differs/,
    );
  }
  const recorded = JSON.stringify(manifest);
  assert.ok(!recorded.includes('fictional-public-key'));
  assert.ok(!recorded.includes('127.0.0.1'));
});
test('missing, failed or nonintegral counts cannot be called empty', () => {
  for (const value of [undefined, null, -1, 0.5, NaN]) {
    assert.throws(
      () => assertFreshPerformanceDataset({ ...empty(), sites: value }),
      /count unavailable/,
    );
  }
});
test('post-creation density is validated and telemetry uses actual observed numeric counts', () => {
  const observed = {
    ...empty(),
    quantity_items: 30,
    serialized_assets: 30,
    sites: 8,
    quantity_events: 30,
    stock_balances: 30,
    asset_events: 30,
    site_configuration_events: 8,
  };
  const result = measuredFixtureCounts('populated', observed);
  assert.deepEqual(
    [result.quantityItems, result.assets, result.sites],
    [30, 30, 8],
  );
  assert.deepEqual(result.tableCounts, observed);
  assert.notEqual(result.tableCounts, observed);
  for (const key of ['quantity_items', 'serialized_assets', 'sites']) {
    assert.throws(
      () =>
        measuredFixtureCounts('populated', {
          ...observed,
          [key]: observed[key] - 1,
        }),
      /density differs/,
    );
    assert.throws(
      () =>
        measuredFixtureCounts('populated', {
          ...observed,
          [key]: observed[key] + 1,
        }),
      /density differs/,
    );
  }
  assert.deepEqual(
    measuredFixtureCounts('empty', empty()).tableCounts,
    empty(),
  );
  assert.throws(
    () => measuredFixtureCounts('other', empty()),
    /Unknown dataset/,
  );
});
test('source checkpoint guard rejects staged, unstaged and untracked implementation files', () => {
  assert.doesNotThrow(() => assertCommittedPerformanceSource(''));
  for (const state of [
    ' M src/page.tsx\n',
    'M  src/page.tsx\n',
    '?? src/app/(protected)/loading.tsx\n',
    '?? scripts/new-harness.mjs\n',
  ]) {
    assert.throws(
      () => assertCommittedPerformanceSource(state),
      /including untracked source files/,
    );
  }
});
