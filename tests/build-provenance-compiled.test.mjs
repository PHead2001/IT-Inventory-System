import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

// Deliberately execute the built Settings page, not the source generator. This
// checks compiled literals without a database, authentication fixture or HTTP bypass.
const probe = `
globalThis.AsyncLocalStorage = require('node:async_hooks').AsyncLocalStorage;
const { routeModule } = require('./.next/server/app/(protected)/settings/page.js');
async function pageModule(tree) {
  if (tree[2].page) return tree[2].page[0]();
  for (const child of Object.values(tree[1])) {
    const found = await pageModule(child);
    if (found) return found;
  }
}
function find(node) {
  if (!node || typeof node !== 'object') return;
  if (node.props?.provenance) return node.props.provenance;
  for (const child of [node.props?.children].flat(Infinity)) {
    const value = find(child);
    if (value) return value;
  }
}
(async () => {
  const module = await pageModule(routeModule.userland.loaderTree);
  const first = find(await module.default({}));
  process.env.APP_ENV = 'production';
  process.env.VERCEL_GIT_COMMIT_SHA = 'b'.repeat(40);
  process.env.APP_BUILD_PROVENANCE = JSON.stringify({environment:'forged'});
  const second = find(await module.default({}));
  console.log(JSON.stringify({first, second, frozen:Object.isFrozen(first)}));
})().catch(error => { console.error(error); process.exitCode=1; });
`;

test('compiled Settings retains the build snapshot across requests and fresh processes', () => {
  const manifest = JSON.parse(
    readFileSync('.next/required-server-files.json', 'utf8'),
  );
  const expected = JSON.parse(manifest.config.env.APP_BUILD_PROVENANCE);
  assert.deepEqual(Object.keys(expected), [
    'environment',
    'version',
    'commit',
    'buildStarted',
  ]);
  assert.ok(expected.buildStarted, 'requires an actual production build');
  for (const label of ['preview', 'production']) {
    const result = spawnSync(process.execPath, ['-e', probe], {
      cwd: process.cwd(),
      encoding: 'utf8',
      timeout: 30_000,
      env: {
        ...process.env,
        APP_ENV: label,
        VERCEL_GIT_COMMIT_SHA: 'c'.repeat(40),
        APP_BUILD_PROVENANCE: '{"environment":"runtime forgery"}',
      },
    });
    assert.equal(result.status, 0, result.stderr);
    const actual = JSON.parse(result.stdout.trim());
    assert.deepEqual(actual.first, expected);
    assert.deepEqual(actual.second, expected);
    assert.equal(actual.frozen, true);
  }
  console.log('Frozen allowlisted snapshot:', JSON.stringify(expected));
});
