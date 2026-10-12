import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

/** Fail closed on version or byte drift; validate every output before writing any file. */
export function applyPostprocessingPatch(root = process.cwd()) {
  const payloadRoot = resolve(root, 'patches/react-three-postprocessing-3.1.3');
  const manifest = JSON.parse(
    readFileSync(resolve(payloadRoot, 'manifest.json'), 'utf8'),
  );
  const packageRoot = resolve(root, 'node_modules/@react-three/postprocessing');
  const installed = JSON.parse(
    readFileSync(resolve(packageRoot, 'package.json'), 'utf8'),
  );
  if (
    installed.name !== manifest.package ||
    installed.version !== manifest.version
  )
    throw new Error(
      'Unsupported postprocessing package version; review the pinned patch first.',
    );
  const plans = manifest.files.map((entry) => {
    const path = resolve(packageRoot, entry.path);
    for (const edit of entry.edits) {
      if (
        sha256(readFileSync(resolve(payloadRoot, edit.payload))) !==
        edit.payloadSha256
      )
        throw new Error(`Changed postprocessing payload: ${edit.payload}`);
    }
    const before = readFileSync(path);
    const digest = sha256(before);
    if (digest === entry.patchedSha256) return { path, status: 'verified' };
    if (digest !== entry.upstreamSha256)
      throw new Error(`Unknown postprocessing bytes: ${entry.path}`);
    let source = before.toString('utf8');
    for (const edit of entry.edits) {
      const start = source.indexOf(edit.start);
      const end = edit.end
        ? source.indexOf(edit.end, start + edit.start.length)
        : source.length;
      if (
        start < 0 ||
        end < 0 ||
        source.indexOf(edit.start, start + edit.start.length) >= 0
      )
        throw new Error(`Ambiguous postprocessing patch region: ${entry.path}`);
      const original = source.slice(start, end);
      if (sha256(Buffer.from(original)) !== edit.upstreamSha256)
        throw new Error(`Unknown postprocessing region: ${entry.path}`);
      const replacement = readFileSync(resolve(payloadRoot, edit.payload));
      if (sha256(replacement) !== edit.payloadSha256)
        throw new Error(`Changed postprocessing payload: ${edit.payload}`);
      source =
        source.slice(0, start) +
        replacement.toString('utf8') +
        source.slice(end);
    }
    const output = Buffer.from(source);
    if (sha256(output) !== entry.patchedSha256)
      throw new Error(`Postprocessing output hash mismatch: ${entry.path}`);
    return { path, output, status: 'patched' };
  });
  for (const plan of plans)
    if (plan.output) writeFileSync(plan.path, plan.output);
  return plans.map(({ path, status }) => ({ path, status }));
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const results = applyPostprocessingPatch();
  console.log(
    `Pinned postprocessing lifetime patch: ${results.map(({ status }) => status).join(', ')}.`,
  );
}
