import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import {
  createImageInputs,
  writeImageInputs,
  sha256,
} from '../../scripts/runner-image-inputs.mjs';

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'itir-image-inputs-'));
  for (const name of [
    '.nvmrc',
    'package.json',
    'package-lock.json',
    'supabase/config.toml',
    'scripts/local-runner/Image.Prepare.sh',
    'scripts/runner-image-inputs.mjs',
    'scripts/install-ci-browser.mjs',
    'scripts/local-storage-version.mjs',
    '.github/workflows/local-runner-pilot.yml',
    'node_modules/playwright-core/browsers.json',
    'node_modules/playwright-core/package.json',
  ]) {
    const path = join(root, name);
    mkdirSync(join(path, '..'), { recursive: true });
    writeFileSync(path, readFileSync(name));
  }
  return root;
}

describe('owner-reviewed runner image inputs', () => {
  it('generates deterministic snapshots and checks complete exact inputs', () => {
    const root = fixture();
    try {
      const id = writeImageInputs(root);
      expect(writeImageInputs(root, true)).toBe(id);
      const { inputs } = createImageInputs(root);
      expect(id).toMatch(/^[A-F0-9]{64}$/);
      expect(inputs.files['Image.PackageLock.json']).toBe(
        inputs.packageLockSha256,
      );
      expect(inputs.playwright.browsers.map((entry) => entry.name)).toEqual([
        'chromium-headless-shell',
        'ffmpeg',
      ]);
      expect(inputs.images).toHaveLength(11);
      expect(
        inputs.images.some(
          (entry) => entry.source === 'supabase/storage-api:v1.77.9',
        ),
      ).toBe(true);
      expect(
        inputs.images.some(
          (entry) => entry.source === 'supabase/pg_prove:3.36',
        ),
      ).toBe(true);
      expect(JSON.stringify(inputs.images)).not.toMatch(
        /:latest|realtime|logflare|imgproxy|supavisor|vector/,
      );
      writeFileSync(
        join(root, 'scripts/local-runner/Image.Package.json'),
        '{}',
      );
      expect(() => writeImageInputs(root, true)).toThrow('stale');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('invalidates changed lockfiles and preparation scripts without selecting newer tooling', () => {
    const root = fixture();
    try {
      const initial = writeImageInputs(root);
      const lock = JSON.parse(readFileSync(join(root, 'package-lock.json')));
      lock.imageFixture = true;
      writeFileSync(join(root, 'package-lock.json'), JSON.stringify(lock));
      const changedLock = writeImageInputs(root);
      expect(changedLock).not.toBe(initial);
      const path = join(root, 'scripts/local-runner/Image.Prepare.sh');
      writeFileSync(
        path,
        readFileSync(path, 'utf8') + '\n# reviewed recipe change\n',
      );
      expect(writeImageInputs(root)).not.toBe(changedLock);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it.each(['node', 'supabase', 'browser', 'services'])(
    'refuses an unreviewed %s pin or service selection',
    (kind) => {
      const root = fixture();
      try {
        if (kind === 'node') writeFileSync(join(root, '.nvmrc'), '24.20.0');
        if (kind === 'supabase' || kind === 'browser') {
          const path = join(root, 'package.json');
          const pkg = JSON.parse(readFileSync(path));
          pkg.devDependencies[
            kind === 'supabase' ? 'supabase' : '@playwright/test'
          ] = '9.0.0';
          writeFileSync(path, JSON.stringify(pkg));
        }
        if (kind === 'services') {
          const path = join(root, 'supabase/config.toml');
          writeFileSync(
            path,
            readFileSync(path, 'utf8').replace(
              '[realtime]\nenabled = false',
              '[realtime]\nenabled = true',
            ),
          );
        }
        expect(() => createImageInputs(root)).toThrow(/review|pins changed/);
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    },
  );

  it('uses valid shell syntax and verifies snapshots against the published manifest', () => {
    const bash =
      process.platform === 'win32'
        ? join(process.env.ProgramFiles, 'Git/bin/bash.exe')
        : 'bash';
    const result = spawnSync(
      bash,
      ['-n', 'scripts/local-runner/Image.Prepare.sh'],
      { encoding: 'utf8' },
    );
    expect(result.error).toBeUndefined();
    expect(result.status, result.stderr).toBe(0);
    const recipe = readFileSync(
      'scripts/local-runner/Image.Prepare.sh',
      'utf8',
    );
    expect(recipe).toContain('chown -R runner:runner /home/runner/.cache');
    expect(recipe).toMatch(
      /runuser -u runner -- env[^\n]+node --input-type=module/,
    );
    expect(recipe).toContain('>/dev/null 2>&1 3>&- &');
    const { inputs } = createImageInputs();
    for (const [name, digest] of Object.entries(inputs.files)) {
      expect(sha256(readFileSync(`scripts/local-runner/${name}`))).toBe(digest);
    }
    expect(writeImageInputs(process.cwd(), true)).toMatch(/^[A-F0-9]{64}$/);
  });
});
