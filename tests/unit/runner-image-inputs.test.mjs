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
import { LOCAL_STORAGE_IMAGES } from '../../scripts/local-storage-version.mjs';

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

function removeFixture(root) {
  // Windows may briefly retain fixture handles after synchronous file operations.
  // Retry only these owned test trees; persistent cleanup failures still throw.
  rmSync(root, {
    recursive: true,
    force: true,
    maxRetries: 3,
    retryDelay: 100,
  });
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
      const storage = inputs.images.find(
        (entry) => entry.source === 'supabase/storage-api:v1.77.9',
      );
      expect(storage.aliases).toEqual([...LOCAL_STORAGE_IMAGES]);
      expect(inputs.images.filter((entry) => entry.aliases?.length)).toEqual([
        storage,
      ]);
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
      removeFixture(root);
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
      removeFixture(root);
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
        removeFixture(root);
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

    const bundle = JSON.parse(
      readFileSync('scripts/local-runner/Bundle.json', 'utf8'),
    );
    const bundleNames = [
      'Common.ps1',
      'Runner.ps1',
      'Guest.Network.ps1',
      'Network.Recovery.ps1',
      'Network.Recovery.Probe.ps1',
      'Probe.Job.ps1',
      'PreparedImage.ps1',
      'Image.Prepare.sh',
      'Image.Inputs.json',
      'Image.Package.json',
      'Image.PackageLock.json',
      'Image.Supabase.toml',
      'SetupMenu.ps1',
      'Setup.ps1',
      'Setup.Download.ps1',
      'Update.ps1',
      'Setup.cmd',
      'Start.cmd',
      'Restart.cmd',
      'Stop.cmd',
      'Status.cmd',
    ];
    expect(bundle).toMatchObject({
      schema: 1,
      tag: 'it-inventory-local-runner-v1',
      version: expect.stringMatching(/^\d{4}-\d{2}-\d{2}\.\d+$/),
    });
    expect(bundle.files.map(({ name }) => name)).toEqual(bundleNames);
    for (const { name, hash } of bundle.files) {
      expect(hash).toMatch(/^[A-F0-9]{64}$/);
      expect(sha256(readFileSync(`scripts/local-runner/${name}`))).toBe(hash);
    }
  });

  it.each([...LOCAL_STORAGE_IMAGES].slice(0, 3))(
    'caches every runtime Storage mirror from the one pulled %s image',
    (resolved) => {
      const result = aliasFixture(resolved);
      expect(result.status, result.stderr).toBe(0);
      const aliases = JSON.parse(result.stdout);
      expect(aliases.map((entry) => entry.reference)).toEqual([
        ...LOCAL_STORAGE_IMAGES,
      ]);
      expect(new Set(aliases.map((entry) => entry.id))).toEqual(
        new Set(['sha256:' + 'a'.repeat(64)]),
      );
      expect(result.calls).toHaveLength(4);
      expect(result.calls.every((line) => line.startsWith('tag '))).toBe(true);
    },
  );

  it.each(['tag-failure', 'wrong-id', 'inspect-failure', 'missing-source'])(
    'refuses Storage alias publication after %s',
    (mode) => {
      const result = aliasFixture([...LOCAL_STORAGE_IMAGES][0], mode);
      expect(result.status).not.toBe(0);
    },
  );

  it('scrubs the builder network and leaves systemd identity uninitialized', () => {
    const result = scrubFixture();
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toBe('scrub-verified\n');
  });

  it.each([
    'clean-failure',
    'retained-netplan',
    'blank-machine-id',
    'old-machine-id',
    'missing-machine-id',
    'oversized-machine-id',
  ])('refuses scrub proof after %s', (mode) => {
    const result = scrubFixture(mode);
    expect(result.status).toBe(1);
    expect(result.stdout).not.toContain('scrub-verified');
  });
});

function scrubFixture(mode = 'success') {
  const root = mkdtempSync(join(tmpdir(), 'itir-image-scrub-'));
  try {
    const recipe = readFileSync(
      'scripts/local-runner/Image.Prepare.sh',
      'utf8',
    );
    const helper = recipe.match(/scrub_cloud_init\(\) \{[\s\S]*?\n\}/)?.[0];
    expect(helper).toBeTruthy();
    const bash =
      process.platform === 'win32'
        ? join(process.env.ProgramFiles, 'Git/bin/bash.exe')
        : 'bash';
    // Execute the production helper with only its filesystem prefix relocated.
    // cloud-init is mocked so no host network/identity files can be modified.
    const script = `set -euo pipefail
root=$1; mode=$2
if command -v cygpath >/dev/null; then root=$(cygpath -u "$root"); fi
mkdir -p "$root/etc/netplan"
printf 'network: builder-mac\\n' > "$root/etc/netplan/50-cloud-init.yaml"
printf '0123456789abcdef0123456789abcdef\\n' > "$root/etc/machine-id"
cloud-init() {
  [[ "$*" == 'clean --logs --seed --machine-id --configs network' ]] || return 90
  [[ $mode != clean-failure ]] || return 1
  if [[ $mode != retained-netplan ]]; then rm -- "$root/etc/netplan/50-cloud-init.yaml"; fi
  case $mode in
    blank-machine-id) : > "$root/etc/machine-id";;
    old-machine-id) ;;
    missing-machine-id) rm -- "$root/etc/machine-id";;
    oversized-machine-id) printf '%100s' x > "$root/etc/machine-id";;
    *) printf 'uninitialized\\n' > "$root/etc/machine-id";;
  esac
}
${helper.replaceAll('/etc/', '"$root"/etc/')}
scrub_cloud_init
printf 'scrub-verified\\n'
`;
    const result = spawnSync(bash, ['-s', '--', root, mode], {
      input: script,
      encoding: 'utf8',
    });
    expect(result.error).toBeUndefined();
    return result;
  } finally {
    removeFixture(root);
  }
}

function aliasFixture(resolved, mode = 'success') {
  const root = mkdtempSync(join(tmpdir(), 'itir-image-alias-'));
  try {
    const recipe = readFileSync(
      'scripts/local-runner/Image.Prepare.sh',
      'utf8',
    );
    const helper = recipe.match(/cache_image_aliases\(\) \{[\s\S]*?\n\}/)?.[0];
    expect(helper).toBeTruthy();
    const bash =
      process.platform === 'win32'
        ? join(process.env.ProgramFiles, 'Git/bin/bash.exe')
        : 'bash';
    const calls = join(root, 'calls');
    writeFileSync(calls, '');
    const script = `set -euo pipefail
resolved=$1; mode=$2; calls=$3; shift 3
declare -A known_ids
known_ids["$resolved"]="sha256:$(printf 'a%.0s' {1..64})"
docker() {
  [[ $1 == image ]] || return 90
  case $2 in
    tag)
      printf 'tag %s %s\\n' "$3" "$4" >> "$calls"
      [[ $mode != tag-failure ]] || return 1
      known_ids["$4"]=$3
      if [[ $mode == wrong-id ]]; then known_ids["$4"]="sha256:$(printf 'b%.0s' {1..64})"; fi
      ;;
    inspect)
      local reference=$5
      [[ $mode != inspect-failure || $reference == "$resolved" ]] || return 1
      [[ $mode != missing-source ]] || return 1
      [[ -n \${known_ids[$reference]-} ]] || return 1
      printf '%s\\n' "\${known_ids[$reference]}"
      ;;
    *) return 91;;
  esac
}
${helper}
aliases=$(cache_image_aliases "$resolved" "$@")
printf '%s' "$aliases"
`;
    const result = spawnSync(
      bash,
      ['-s', '--', resolved, mode, calls, ...LOCAL_STORAGE_IMAGES],
      { input: script, encoding: 'utf8' },
    );
    expect(result.error).toBeUndefined();
    return {
      ...result,
      calls: readFileSync(calls, 'utf8').split('\n').filter(Boolean),
    };
  } finally {
    removeFixture(root);
  }
}
