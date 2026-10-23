import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Next #96714/#96737: every learned route shares its cache entry across hashes.
// Keep the document/router URL intact; normalize only the cache insertion input.
const declaration =
  'function discoverKnownRoute(now, pathname, search, nextUrl, pendingEntry, routeTree, metadataVaryPath, couldBeIntercepted, canonicalUrl, supportsPerSegmentPrefetching, hasDynamicRewrite) {';
const correctedDeclaration =
  declaration + "\n    canonicalUrl = canonicalUrl.split('#', 1)[0];";
export const nextRouteCacheCorrection = Object.freeze({
  version: '16.3.6',
  files: Object.freeze([
    Object.freeze({
      path: 'dist/client/components/segment-cache/optimistic-routes.js',
      original:
        '8f97399f7df417fc086919388dab380eddd0d459e841254f7279331707db7235',
      corrected:
        '77a54f6ff5006d218fef4eab741438a44d0d7021a5b96517dd0122483f6a141c',
    }),
    Object.freeze({
      path: 'dist/esm/client/components/segment-cache/optimistic-routes.js',
      original:
        '66dec328d6b9e8a92086347dc4d192b750b9d761fc16b33199c7f93121d74c99',
      corrected:
        '87b56daf93aac4b74257ba0c338c8876040859d932c866efda3b5965172207e7',
    }),
  ]),
});
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');

export function patchNextRouteCache({
  nextRoot = resolve(import.meta.dirname, '../node_modules/next'),
  check = false,
  read = readFileSync,
  write = writeFileSync,
} = {}) {
  const installed = JSON.parse(read(resolve(nextRoot, 'package.json'), 'utf8'));
  if (installed.version !== nextRouteCacheCorrection.version)
    throw new Error(
      'Next route-cache correction requires reviewed Next 16.3.6.',
    );
  // Read and validate both module formats before the first write. A changed or
  // upgraded dependency must be reviewed, never silently patched or accepted.
  const changes = nextRouteCacheCorrection.files.map((file) => {
    const path = resolve(nextRoot, file.path);
    const bytes = read(path);
    const hash = digest(bytes);
    if (hash === file.corrected) return null;
    if (hash !== file.original)
      throw new Error(`Unrecognized Next route-cache source: ${file.path}`);
    if (check)
      throw new Error('Next route-cache correction is missing; run npm ci.');
    const source = bytes.toString('utf8');
    if (source.split(declaration).length !== 2)
      throw new Error(`Unexpected Next route-cache declaration: ${file.path}`);
    const corrected = Buffer.from(
      source.replace(declaration, correctedDeclaration),
    );
    if (digest(corrected) !== file.corrected)
      throw new Error(
        `Next route-cache correction digest mismatch: ${file.path}`,
      );
    return { path, corrected };
  });
  for (const change of changes) {
    if (!change) continue;
    write(change.path, change.corrected);
    if (digest(read(change.path)) !== digest(change.corrected))
      throw new Error('Next route-cache correction failed verification.');
  }
  return { changed: changes.filter(Boolean).length };
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const args = process.argv.slice(2);
  if (args.length > 1 || (args.length === 1 && args[0] !== '--check'))
    throw new Error('Usage: node scripts/patch-next-route-cache.mjs [--check]');
  patchNextRouteCache({ check: args[0] === '--check' });
}
