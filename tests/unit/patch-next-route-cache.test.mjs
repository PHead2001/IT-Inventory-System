// @vitest-environment node
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import {
  nextRouteCacheCorrection,
  patchNextRouteCache,
} from '../../scripts/patch-next-route-cache.mjs';

const require = createRequire(import.meta.url);
const installedNext = dirname(require.resolve('next/package.json'));
const temporary = [];
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
afterEach(async () => {
  for (const path of temporary.splice(0))
    await rm(path, {
      recursive: true,
      force: true,
      maxRetries: 3,
      retryDelay: 100,
    });
});
function fixture() {
  const nextRoot = mkdtempSync(join(tmpdir(), 'next-route-cache-'));
  temporary.push(nextRoot);
  writeFileSync(
    join(nextRoot, 'package.json'),
    JSON.stringify({ version: '16.4.1' }),
  );
  for (const file of nextRouteCacheCorrection.files) {
    const installed = readFileSync(join(installedNext, file.path));
    expect([file.original, file.corrected]).toContain(hash(installed));
    // Keep fixtures valid before and after npm's postinstall runs.
    const original = installed
      .toString('utf8')
      .replace("\n    canonicalUrl = canonicalUrl.split('#', 1)[0];", '');
    expect(hash(original)).toBe(file.original);
    mkdirSync(dirname(join(nextRoot, file.path)), { recursive: true });
    writeFileSync(join(nextRoot, file.path), original);
  }
  return {
    nextRoot,
    hashes: () =>
      nextRouteCacheCorrection.files.map((file) =>
        hash(readFileSync(join(nextRoot, file.path))),
      ),
  };
}

it('corrects both shipped formats, verifies exact bytes and is idempotent', () => {
  const f = fixture();
  expect(patchNextRouteCache(f)).toEqual({ changed: 2 });
  expect(f.hashes()).toEqual(
    nextRouteCacheCorrection.files.map((file) => file.corrected),
  );
  expect(patchNextRouteCache(f)).toEqual({ changed: 0 });
  expect(patchNextRouteCache({ ...f, check: true })).toEqual({ changed: 0 });
});

it('prebuild verification rejects an omitted install correction without writing', () => {
  const f = fixture();
  const before = f.hashes();
  expect(() => patchNextRouteCache({ ...f, check: true })).toThrow(
    'correction is missing',
  );
  expect(f.hashes()).toEqual(before);
});

it('rejects a dependency version change before touching either module', () => {
  const f = fixture();
  const before = f.hashes();
  writeFileSync(
    join(f.nextRoot, 'package.json'),
    JSON.stringify({ version: '16.4.2' }),
  );
  expect(() => patchNextRouteCache(f)).toThrow('requires reviewed Next 16.4.1');
  expect(f.hashes()).toEqual(before);
});

it.each(['original', 'corrected'])(
  'rejects unknown %s bytes in the second format before any write',
  (kind) => {
    const f = fixture();
    if (kind === 'corrected') patchNextRouteCache(f);
    const file = join(f.nextRoot, nextRouteCacheCorrection.files[1].path);
    writeFileSync(file, readFileSync(file, 'utf8') + '\n// unexpected bytes\n');
    const before = f.hashes();
    let writes = 0;
    expect(() =>
      patchNextRouteCache({
        ...f,
        write: () => {
          writes += 1;
        },
      }),
    ).toThrow('Unrecognized Next route-cache source');
    expect(writes).toBe(0);
    expect(f.hashes()).toEqual(before);
  },
);

it('resumes safely after a filesystem failure between the two known corrections', () => {
  const f = fixture();
  let writes = 0;
  expect(() =>
    patchNextRouteCache({
      ...f,
      write: (path, bytes) => {
        writes += 1;
        if (writes === 2) throw new Error('injected write failure');
        writeFileSync(path, bytes);
      },
    }),
  ).toThrow('injected write failure');
  expect(f.hashes()).toEqual([
    nextRouteCacheCorrection.files[0].corrected,
    nextRouteCacheCorrection.files[1].original,
  ]);
  expect(() => patchNextRouteCache({ ...f, check: true })).toThrow(
    'correction is missing',
  );
  expect(patchNextRouteCache(f)).toEqual({ changed: 1 });
  expect(patchNextRouteCache({ ...f, check: true })).toEqual({ changed: 0 });
});

it('rejects unsuccessful write verification', () => {
  const f = fixture();
  expect(() => patchNextRouteCache({ ...f, write: () => {} })).toThrow(
    'failed verification',
  );
});

it('keeps installation automatic and verifies the correction before production compilation', () => {
  const packageJson = JSON.parse(
    readFileSync(new URL('../../package.json', import.meta.url), 'utf8'),
  );
  expect(packageJson.scripts.postinstall).toBe(
    'node scripts/patch-postprocessing.mjs && node scripts/patch-next-route-cache.mjs',
  );
  expect(packageJson.scripts.prebuild).toBe(
    'node scripts/patch-next-route-cache.mjs --check',
  );
});
