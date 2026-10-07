import { describe, expect, it, vi } from 'vitest';
import {
  browserCacheMatches,
  installCiBrowser,
} from '../../scripts/install-ci-browser.mjs';

function fixture() {
  const browsers = [
    {
      name: 'chromium-headless-shell',
      revision: '1234',
      path: '/home/runner/.cache/ms-playwright/shell',
    },
    {
      name: 'ffmpeg',
      revision: '1011',
      path: '/home/runner/.cache/ms-playwright/ffmpeg',
    },
  ];
  return {
    version: '1.62.1',
    lockHash: 'A'.repeat(64),
    osHash: 'B'.repeat(64),
    browsers,
    hashFile: () => 'C'.repeat(64),
    receipt: {
      schema: 1,
      scrubbed: true,
      platform: 'ubuntu24.04-x64',
      recipeId: 'D'.repeat(64),
      capabilities: ['playwright'],
      playwrightVersion: '1.62.1',
      packageLockSha256: 'A'.repeat(64),
      osPackagesSha256: 'B'.repeat(64),
      browsers: browsers.map((b) => ({ ...b, sha256: 'C'.repeat(64) })),
    },
  };
}

describe('prepared Chromium compatibility and cold fallback', () => {
  it('accepts exact browser, executable and OS dependency identity', () => {
    expect(browserCacheMatches(fixture())).toBe(true);
    const run = vi.fn();
    expect(installCiBrowser({ available: () => true, run, log: vi.fn() })).toBe(
      0,
    );
    expect(run).not.toHaveBeenCalled();
  });

  it.each([
    'version',
    'revision',
    'path',
    'bytes',
    'os',
    'receipt',
    'capability',
  ])('rejects changed or missing %s data', (kind) => {
    const data = fixture();
    if (kind === 'version') data.version = '1.63.0';
    if (kind === 'revision') data.browsers[0].revision = '1235';
    if (kind === 'path') data.browsers[0].path = '/different/browser';
    if (kind === 'bytes') data.hashFile = () => 'F'.repeat(64);
    if (kind === 'os') data.osHash = 'E'.repeat(64);
    if (kind === 'receipt') data.receipt = undefined;
    if (kind === 'capability') data.receipt.capabilities = [];
    expect(browserCacheMatches(data)).toBe(false);
  });

  it('reuses matching browsers when unrelated lockfile dependencies change', () => {
    const data = fixture();
    data.lockHash = 'E'.repeat(64);
    expect(browserCacheMatches(data)).toBe(true);
  });

  it('uses the installed pinned CLI with shell-only and OS dependencies on a miss', () => {
    const run = vi.fn(() => ({ status: 0 }));
    expect(
      installCiBrowser({ available: () => false, run, log: vi.fn() }),
    ).toBe(0);
    expect(run.mock.calls[0][0]).toBe(process.execPath);
    expect(run.mock.calls[0][1].slice(1)).toEqual([
      'install',
      '--with-deps',
      '--only-shell',
      'chromium',
    ]);
  });

  it('propagates installer and spawn failure instead of reporting successful preparation', () => {
    expect(
      installCiBrowser({
        available: () => false,
        run: () => ({ status: 23 }),
        log: vi.fn(),
      }),
    ).toBe(23);
    expect(() =>
      installCiBrowser({
        available: () => false,
        run: () => ({ error: Error('fixture failure') }),
        log: vi.fn(),
      }),
    ).toThrow('fixture failure');
  });
});
