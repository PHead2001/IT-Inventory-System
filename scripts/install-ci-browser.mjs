import { createHash } from 'node:crypto';
import { lstatSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve, dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const receiptPath = '/opt/it-inventory-image/receipt.json';
const hash = (data) =>
  createHash('sha256').update(data).digest('hex').toUpperCase();
const require = createRequire(import.meta.url);

// A miss uses the standard installer; it can never publish changes to the host image.
export function browserCacheMatches({
  receipt,
  version,
  browsers,
  osHash,
  hashFile,
}) {
  return (
    receipt?.schema === 1 &&
    receipt.scrubbed === true &&
    receipt.platform === 'ubuntu24.04-x64' &&
    /^[A-F0-9]{64}$/.test(receipt.recipeId ?? '') &&
    receipt.playwrightVersion === version &&
    receipt.osPackagesSha256 === osHash &&
    Array.isArray(receipt.capabilities) &&
    receipt.capabilities.includes('playwright') &&
    Array.isArray(receipt.browsers) &&
    receipt.browsers.length === 2 &&
    browsers.length === 2 &&
    browsers.every((browser) => {
      const cached = receipt.browsers.find(
        (entry) => entry.name === browser.name,
      );
      return (
        cached?.revision === browser.revision &&
        cached.path === browser.path &&
        /^[A-F0-9]{64}$/.test(cached.sha256) &&
        hashFile(browser.path) === cached.sha256
      );
    })
  );
}

export function preparedBrowserAvailable() {
  if (process.platform !== 'linux' || process.arch !== 'x64') return false;
  try {
    for (const path of ['/opt/it-inventory-image', receiptPath]) {
      const stat = lstatSync(path);
      if (stat.isSymbolicLink() || stat.uid !== 0 || (stat.mode & 0o022) !== 0)
        return false;
    }
    if (lstatSync(receiptPath).size > 16 * 1024) return false;
    const receipt = JSON.parse(readFileSync(receiptPath));
    const metadata = JSON.parse(
      readFileSync(require.resolve('playwright-core/package.json')),
    );
    const browserData = JSON.parse(
      readFileSync(
        join(
          dirname(require.resolve('playwright-core/package.json')),
          'browsers.json',
        ),
      ),
    );
    const registry = require('playwright-core/lib/coreBundle').registry
      .registry;
    const browsers = ['chromium-headless-shell', 'ffmpeg'].map((name) => ({
      name,
      revision: browserData.browsers.find((entry) => entry.name === name)
        .revision,
      path: registry.findExecutable(name).executablePath(),
    }));
    const packages = spawnSync(
      'dpkg-query',
      ['-W', '-f=${Package}=${Version}\n'],
      {
        encoding: 'utf8',
        timeout: 10_000,
        maxBuffer: 1024 * 1024,
      },
    );
    if (packages.status !== 0) return false;
    const osHash = hash(
      packages.stdout.trimEnd().split('\n').sort().join('\n') + '\n',
    );
    return browserCacheMatches({
      receipt,
      version: metadata.version,
      browsers,
      osHash,
      hashFile: (path) => hash(readFileSync(path)),
    });
  } catch {
    return false;
  }
}

export function browserInstallArgs(warm) {
  return warm ? [] : ['install', '--with-deps', '--only-shell', 'chromium'];
}

export function installCiBrowser({
  available = preparedBrowserAvailable,
  run = spawnSync,
  log = console.log,
  env = process.env,
} = {}) {
  if (available()) {
    log(
      'Verified prepared Chromium shell, FFmpeg and OS dependencies; no install required.',
    );
    return 0;
  }
  log(
    'Prepared browser cache miss; installing the pinned Chromium shell and dependencies.',
  );
  const result = run(
    process.execPath,
    [
      join(dirname(require.resolve('playwright/package.json')), 'cli.js'),
      ...browserInstallArgs(false),
    ],
    {
      stdio: 'inherit',
      env: { ...env, PLAYWRIGHT_DOWNLOAD_CONNECTION_TIMEOUT: '120000' },
    },
  );
  if (result.error) throw result.error;
  return result.status ?? 1;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
)
  process.exitCode = installCiBrowser();
