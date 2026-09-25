import assert from 'node:assert/strict';
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  LOCAL_STORAGE_IMAGE,
  LOCAL_STORAGE_VERSION,
  assertLocalStorageImage,
  assertLocalStorageVersion,
  installLocalStorageVersion,
  localStorageVersionPath,
  verifyLocalStorageRuntime,
} from '../scripts/local-storage-version.mjs';

function fixture(callback) {
  const cwd = mkdtempSync(join(tmpdir(), 'inventory-storage-pin-'));
  try {
    mkdirSync(join(cwd, 'supabase'));
    callback(cwd);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
}

test('fresh checkout gets the pinned local Storage version; repeat start is idempotent', () => {
  fixture((cwd) => {
    assert.equal(installLocalStorageVersion(cwd), 'pinned');
    assert.equal(
      readFileSync(localStorageVersionPath(cwd), 'utf8'),
      `${LOCAL_STORAGE_VERSION}\n`,
    );
    assert.equal(installLocalStorageVersion(cwd), 'already-pinned');
    assertLocalStorageVersion(cwd);
  });
});

test('a linked project cache is preserved while the local version is restored', () => {
  fixture((cwd) => {
    const temp = join(cwd, 'supabase/.temp');
    mkdirSync(temp);
    writeFileSync(join(temp, 'project-ref'), 'fictional-remote-ref\n');
    writeFileSync(join(temp, 'storage-version'), 'v1.77.0\n');
    assert.equal(installLocalStorageVersion(cwd), 'pinned');
    assert.equal(
      readFileSync(join(temp, 'project-ref'), 'utf8'),
      'fictional-remote-ref\n',
    );
    assert.equal(
      readFileSync(join(temp, 'storage-version'), 'utf8'),
      `${LOCAL_STORAGE_VERSION}\n`,
    );
  });
});

test('reset/test verification rejects a missing or changed pin', () => {
  fixture((cwd) => {
    assert.throws(
      () => assertLocalStorageVersion(cwd),
      /version pin is missing/,
    );
    installLocalStorageVersion(cwd);
    writeFileSync(localStorageVersionPath(cwd), 'v1.77.0\n');
    assert.throws(
      () => assertLocalStorageVersion(cwd),
      /version pin is missing/,
    );
  });
});

test('runtime verification requires the exact local Storage image, not only a pin file', () => {
  fixture((cwd) => {
    installLocalStorageVersion(cwd);
    let command;
    let args;
    verifyLocalStorageRuntime({
      cwd,
      inspect: (name, passed) => {
        command = name;
        args = passed;
        return { status: 0, stdout: `${LOCAL_STORAGE_IMAGE}\n` };
      },
    });
    assert.equal(command, 'docker');
    assert.deepEqual(args, [
      'inspect',
      '--format',
      '{{.Config.Image}}',
      'supabase_storage_it-inventory',
    ]);
    assertLocalStorageImage(LOCAL_STORAGE_IMAGE);
    for (const image of [
      'ghcr.io/supabase/storage-api:v1.77.9',
      'supabase/storage-api:v1.77.9',
      'docker.io/supabase/storage-api:v1.77.9',
    ])
      assertLocalStorageImage(image);
    for (const image of [
      'public.ecr.aws/supabase/storage-api:v1.77.0',
      'ghcr.io/other/storage-api:v1.77.9',
      'other.example/supabase/storage-api:v1.77.9',
      'supabase/storage-api:latest',
      'supabase/storage-api@sha256:abcdef',
    ])
      assert.throws(
        () => assertLocalStorageImage(image),
        /not using the pinned image/,
      );
    assert.throws(
      () => assertLocalStorageImage('secret\nvalue'),
      /found \(unrecognized image reference\)/,
    );
    assert.throws(
      () =>
        verifyLocalStorageRuntime({
          cwd,
          inspect: () => ({ status: 1, stdout: '' }),
        }),
      /Could not inspect/,
    );
  });
});
