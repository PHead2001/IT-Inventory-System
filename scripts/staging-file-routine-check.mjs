// Local diagnostics preserve reviewed expectations and never turn drift into a pass.
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { format } from 'prettier';
import { assertLocalUrl } from './runtime.mjs';
import { assertStagingRoutineManifest } from './staging-file-routines.mjs';

export const STAGING_ROUTINE_CANDIDATE =
  'test-results/staging-file-routines.candidate.json';

export async function compareLocalStagingRoutineManifest(
  observed,
  expected,
  databaseUrl,
  artifactPath = STAGING_ROUTINE_CANDIDATE,
) {
  assertLocalUrl(databaseUrl, 45322);
  assert.equal(new URL(databaseUrl).pathname, '/postgres');
  assertStagingRoutineManifest(observed);
  assertStagingRoutineManifest(expected);
  // Only the finite catalog projection is eligible for an artifact. Unexpected
  // fields must not introduce credentials, row identities or raw routine bodies.
  const fields = (actual, reference) =>
    assert.deepEqual(Object.keys(actual).sort(), Object.keys(reference).sort());
  fields(observed, expected);
  const expectedRows = new Map(
    expected.routines.map((row) => [row.signature, row]),
  );
  for (const row of observed.routines)
    fields(row, expectedRows.get(row.signature));
  fields(observed.storage, expected.storage);
  if (isDeepStrictEqual(observed, expected)) return;
  mkdirSync(dirname(artifactPath), { recursive: true });
  writeFileSync(
    artifactPath,
    await format(JSON.stringify(observed), { parser: 'json' }),
  );
  throw new Error(
    `Canonical staging routine manifest drift; review candidate ${artifactPath}. Checked-in expectations remain unchanged.`,
  );
}
