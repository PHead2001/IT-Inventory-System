// Deterministic source-authoring helper. Never installs, downloads or publishes an image.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { LOCAL_STORAGE_VERSION } from './local-storage-version.mjs';

export const imageInputNames = [
  'Image.Prepare.sh',
  'Image.Package.json',
  'Image.PackageLock.json',
  'Image.Supabase.toml',
];
export const sha256 = (bytes) =>
  createHash('sha256').update(bytes).digest('hex').toUpperCase();

// Reviewed against CLI v2.116.0 legacy start gates, its Dockerfile and test-db handler.
// No hosted commands or dynamic PR inputs are used to populate the trusted image.
const serviceImages = [
  'supabase/postgres:17.6.1.165',
  'library/kong:2.8.1',
  'supabase/gotrue:v2.196.0',
  'axllent/mailpit:v1.30.2',
  'postgrest/postgrest:v16.1',
  'supabase/storage-api:v1.77.9',
  'supabase/edge-runtime:v1.74.3',
  'supabase/postgres-meta:v0.98.0',
  'supabase/studio:2026.08.17-sha-0c1da8f',
  'supabase/pg_prove:3.36',
];

export function createImageInputs(root = process.cwd()) {
  const bytes = (name) => readFileSync(resolve(root, name));
  const pkg = JSON.parse(bytes('package.json'));
  const lock = JSON.parse(bytes('package-lock.json'));
  const nodeVersion = bytes('.nvmrc').toString().trim();
  const browserData = JSON.parse(
    bytes('node_modules/playwright-core/browsers.json'),
  );
  const config = bytes('supabase/config.toml').toString();
  const pilot = bytes('.github/workflows/local-runner-pilot.yml').toString();
  const pilotImage = pilot.match(/image='(alpine@sha256:[a-f0-9]{64})'/)?.[1];
  if (!pilotImage)
    throw new Error('Pilot image pin is missing or not an exact digest.');
  const configured = (section, key) => {
    const block = config.split(`[${section}]`)[1]?.split(/^\[/m)[0];
    return block
      ?.match(new RegExp(`^${key}\\s*=\\s*([^#\\r\\n]+)`, 'm'))?.[1]
      .trim();
  };
  for (const [section, expected] of [
    ['api', 'true'],
    ['auth', 'true'],
    ['local_smtp', 'true'],
    ['storage', 'true'],
    ['studio', 'true'],
    ['realtime', 'false'],
    ['analytics', 'false'],
  ]) {
    if (configured(section, 'enabled') !== expected)
      throw new Error(
        'Supabase service selection changed; review the prepared image inventory.',
      );
  }
  if (
    configured('db', 'major_version') !== '17' ||
    (configured('edge_runtime', 'enabled') ?? 'true') !== 'true' ||
    (configured('db.pooler', 'enabled') ?? 'false') !== 'false' ||
    (configured('storage.image_transformation', 'enabled') ?? 'false') !==
      'false'
  )
    throw new Error(
      'Supabase service selection changed; review the prepared image inventory.',
    );
  const playwrightVersion = JSON.parse(
    bytes('node_modules/playwright-core/package.json'),
  ).version;
  if (
    nodeVersion !== '24.19.0' ||
    pkg.packageManager !== 'npm@11.11.0' ||
    pkg.devDependencies.supabase !== '2.116.0' ||
    pkg.devDependencies['@playwright/test'] !== '1.62.1' ||
    playwrightVersion !== '1.62.1' ||
    LOCAL_STORAGE_VERSION !== 'v1.77.9' ||
    lock.packages['node_modules/playwright-core'].version !==
      playwrightVersion ||
    lock.packages['node_modules/supabase'].version !== '2.116.0'
  )
    throw new Error(
      'Image tooling pins changed; review the recipe and upstream artifacts first.',
    );

  const snapshots = {
    'Image.Package.json': bytes('package.json'),
    'Image.PackageLock.json': bytes('package-lock.json'),
    'Image.Supabase.toml': bytes('supabase/config.toml'),
  };
  const files = Object.fromEntries(
    imageInputNames.map((name) => [
      name,
      sha256(snapshots[name] ?? bytes(`scripts/local-runner/${name}`)),
    ]),
  );
  const inputs = {
    schema: 1,
    platform: 'ubuntu24.04-x64',
    osRecipeRevision: '2026-10-06.1',
    node: {
      version: nodeVersion,
      url: 'https://nodejs.org/dist/v24.19.0/node-v24.19.0-linux-x64.tar.xz',
      sha256:
        '14B342E71204F811BDE6153BE8E04B62AEF63C236FEF92B55F9C83154B409647',
    },
    npmVersion: '11.11.0',
    playwright: {
      version: playwrightVersion,
      browsers: ['chromium-headless-shell', 'ffmpeg'].map((name) => {
        const browser = browserData.browsers.find(
          (entry) => entry.name === name,
        );
        if (!browser || !/^\d+$/.test(browser.revision))
          throw new Error('Pinned Playwright browser metadata is incomplete.');
        return { name, revision: browser.revision };
      }),
    },
    supabaseVersion: '2.116.0',
    storageVersion: LOCAL_STORAGE_VERSION,
    packageSha256: sha256(bytes('package.json')),
    packageLockSha256: sha256(bytes('package-lock.json')),
    supabaseConfigSha256: sha256(bytes('supabase/config.toml')),
    sources: Object.fromEntries(
      [
        '.nvmrc',
        'scripts/runner-image-inputs.mjs',
        'scripts/install-ci-browser.mjs',
        'scripts/local-storage-version.mjs',
        '.github/workflows/local-runner-pilot.yml',
      ].map((name) => [name, sha256(bytes(name))]),
    ),
    files,
    images: [
      ...serviceImages.map((source) => {
        const suffix = source.split('/').at(-1);
        return {
          source,
          candidates: [
            `public.ecr.aws/supabase/${suffix}`,
            `ghcr.io/supabase/${suffix}`,
            source,
          ],
        };
      }),
      { source: pilotImage, candidates: [pilotImage] },
    ],
  };
  return { inputs, snapshots };
}

export function writeImageInputs(root = process.cwd(), check = false) {
  const { inputs, snapshots } = createImageInputs(root);
  const outputs = {
    ...snapshots,
    'Image.Inputs.json': Buffer.from(JSON.stringify(inputs, null, 2) + '\n'),
  };
  for (const [name, content] of Object.entries(outputs)) {
    const path = resolve(root, 'scripts/local-runner', name);
    if (check) {
      if (!readFileSync(path).equals(content))
        throw new Error(`Trusted image input is stale: ${name}`);
    } else writeFileSync(path, content);
  }
  return sha256(outputs['Image.Inputs.json']);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  if (process.argv.slice(2).some((arg) => arg !== '--check'))
    throw new Error('Usage: node scripts/runner-image-inputs.mjs [--check]');
  console.log(
    writeImageInputs(process.cwd(), process.argv.includes('--check')),
  );
}
