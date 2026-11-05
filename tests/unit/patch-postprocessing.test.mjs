import { createHash } from 'node:crypto';
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { expect, it } from 'vitest';
import { applyPostprocessingPatch } from '../../scripts/patch-postprocessing.mjs';

const payloadRoot = 'patches/react-three-postprocessing-3.1.3';
const manifest = JSON.parse(
  readFileSync(join(payloadRoot, 'manifest.json'), 'utf8'),
);
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'itir-pinned-postprocessing-'));
  cpSync(payloadRoot, join(root, payloadRoot), { recursive: true });
  const packageRoot = join(root, 'node_modules/@react-three/postprocessing');
  mkdirSync(packageRoot, { recursive: true });
  writeFileSync(
    join(packageRoot, 'package.json'),
    JSON.stringify({ name: manifest.package, version: manifest.version }),
  );
  for (const entry of manifest.files) {
    const installed = readFileSync(
      join('node_modules/@react-three/postprocessing', entry.path),
    );
    let source = installed.toString('utf8');
    if (digest(installed) === entry.patchedSha256) {
      for (const edit of entry.edits) {
        const patched = readFileSync(join(payloadRoot, edit.payload), 'utf8');
        const original = readFileSync(
          join(payloadRoot, edit.upstreamPayload),
          'utf8',
        );
        expect(digest(Buffer.from(original))).toBe(edit.upstreamSha256);
        expect(source.split(patched)).toHaveLength(2);
        source = source.split(patched).join(original);
      }
    }
    expect(digest(Buffer.from(source))).toBe(entry.upstreamSha256);
    const target = join(packageRoot, entry.path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, source);
  }
  return { root, packageRoot };
}

it('applies the exact pinned upstream patch and verifies an already-patched installation without rewriting', async () => {
  const { root, packageRoot } = fixture();
  try {
    expect(applyPostprocessingPatch(root).map(({ status }) => status)).toEqual([
      'patched',
      'patched',
      'patched',
    ]);
    for (const entry of manifest.files)
      expect(digest(readFileSync(join(packageRoot, entry.path)))).toBe(
        entry.patchedSha256,
      );
    expect(applyPostprocessingPatch(root).map(({ status }) => status)).toEqual([
      'verified',
      'verified',
      'verified',
    ]);
  } finally {
    await rm(root, {
      recursive: true,
      force: true,
      maxRetries: 3,
      retryDelay: 100,
    });
  }
});

it.each(['bytes', 'version', 'payload'])(
  'refuses unknown %s before changing any other target',
  async (kind) => {
    const { root, packageRoot } = fixture();
    try {
      if (kind === 'bytes') {
        const path = join(packageRoot, manifest.files[2].path);
        writeFileSync(path, readFileSync(path, 'utf8') + '\nunknown bytes\n');
      } else if (kind === 'version') {
        writeFileSync(
          join(packageRoot, 'package.json'),
          JSON.stringify({ name: manifest.package, version: '3.1.4' }),
        );
      } else {
        const path = join(
          root,
          payloadRoot,
          manifest.files[2].edits[0].payload,
        );
        writeFileSync(path, readFileSync(path, 'utf8') + '\nunknown payload\n');
      }
      const before = manifest.files.map((entry) =>
        readFileSync(join(packageRoot, entry.path)),
      );
      expect(() => applyPostprocessingPatch(root)).toThrow(
        /Unknown postprocessing bytes|Unsupported postprocessing package version|Changed postprocessing payload/,
      );
      for (let index = 0; index < manifest.files.length; index++)
        expect(
          readFileSync(join(packageRoot, manifest.files[index].path)),
        ).toEqual(before[index]);
    } finally {
      await rm(root, {
        recursive: true,
        force: true,
        maxRetries: 3,
        retryDelay: 100,
      });
    }
  },
);
