// Numeric-only fixture provenance. Audit tables also have to be empty so a
// previous integration run cannot silently change History/configuration work.
import { createHash } from 'node:crypto';
export const performanceTables = [
  'quantity_items',
  'serialized_assets',
  'sites',
  'stock_balances',
  'quantity_events',
  'quantity_event_lines',
  'asset_events',
  'assignment_events',
  'site_quantity_holdings',
  'site_quantity_event_lines',
  'site_configuration_events',
  'location_configuration_events',
  'configuration_events',
  'form_publication_events',
  'inventory_files',
  'inventory_file_events',
  'inventory_file_collections',
];

function assertCounts(counts) {
  for (const table of performanceTables) {
    if (!Number.isSafeInteger(counts[table]) || counts[table] < 0)
      throw new Error(`Performance fixture count unavailable: ${table}`);
  }
}

export function assertFreshPerformanceDataset(counts) {
  assertCounts(counts);
  if (performanceTables.some((table) => counts[table] !== 0))
    throw new Error(
      'Performance datasets require a fresh canonical disposable DB reset; existing or partial fixtures cannot be reused.',
    );
}

export function measuredFixtureCounts(dataset, counts) {
  if (!['empty', 'populated'].includes(dataset))
    throw new Error('Unknown dataset.');
  assertCounts(counts);
  const expected = dataset === 'empty' ? [0, 0, 0] : [30, 30, 8];
  if (
    ['quantity_items', 'serialized_assets', 'sites'].some(
      (table, index) => counts[table] !== expected[index],
    )
  )
    throw new Error(
      'Measured performance fixture density differs from the canonical dataset. Reset and recreate it before measuring.',
    );
  return {
    quantityItems: counts.quantity_items,
    assets: counts.serialized_assets,
    sites: counts.sites,
    tableCounts: Object.fromEntries(
      performanceTables.map((table) => [table, counts[table]]),
    ),
  };
}

export function assertCommittedPerformanceSource(porcelain) {
  if (porcelain.trim())
    throw new Error(
      'Performance source must be committed and unchanged, including untracked source files. Commit the checkpoint before measuring.',
    );
}

export function performanceBuildBinding({
  commit,
  env,
  envFileHashes,
  nodeVersion,
  frameworkVersion,
}) {
  // Store only a digest: env files can contain private server values. Include
  // every public build input plus the server flags that affect this harness.
  const names = new Set([
    'APP_ENV',
    'APP_ORIGIN',
    'AUTH_DIAGNOSTICS',
    'SPEED_INSIGHTS_ENABLED',
    'VERCEL',
    'VERCEL_ENV',
    'VERCEL_BRANCH_URL',
    'VERCEL_URL',
    'NODE_ENV',
  ]);
  for (const key of Object.keys(env))
    if (key.startsWith('NEXT_PUBLIC_')) names.add(key);
  const inputs = {
    env: Array.from(names)
      .sort()
      .map((name) => [name, env[name] ?? null]),
    envFileHashes,
    nodeVersion,
    frameworkVersion,
  };
  return {
    version: 1,
    commit,
    buildInputsSha256: createHash('sha256')
      .update(JSON.stringify(inputs))
      .digest('hex'),
  };
}

export function assertPerformanceBuildReuse(manifest, expected, actualBuildId) {
  if (
    !manifest ||
    manifest.version !== 1 ||
    !actualBuildId ||
    manifest.commit !== expected.commit ||
    manifest.buildInputsSha256 !== expected.buildInputsSha256 ||
    manifest.buildId !== actualBuildId
  ) {
    throw new Error(
      'Performance build provenance differs or is unavailable. Run a fresh performance build; unchecked .next reuse is refused.',
    );
  }
}
