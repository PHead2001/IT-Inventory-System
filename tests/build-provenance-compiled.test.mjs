import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fork } from 'node:child_process';
import { createServerClient } from '@supabase/ssr';
import fixture from './fixtures/auth.json' with { type: 'json' };
import { assertLocalUrl } from '../scripts/runtime.mjs';
import {
  localBackend,
  assertLocalBuildSnapshot,
} from './helpers/compiled-settings-contract.mjs';
import {
  probeFailureMarker,
  extractProbeFailure,
  classifyProbeFailure,
  childFailureDiagnostic,
} from './helpers/compiled-probe-diagnostic.mjs';

function probe(expected, cookie, api, label) {
  return new Promise((resolve, reject) => {
    // One existing-build server at a time. Secrets use only private child IPC.
    const child = fork(
      new URL('./helpers/compiled-settings-probe.mjs', import.meta.url),
      [],
      {
        execArgv: ['--max-old-space-size=512'],
        stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
        env: {
          ...process.env,
          NODE_OPTIONS: '--max-old-space-size=512',
          APP_ENV: label,
          VERCEL_GIT_COMMIT_SHA: 'c'.repeat(40),
          APP_BUILD_PROVENANCE: '{"environment":"runtime forgery"}',
        },
      },
    );
    let success = false;
    let diagnostic = probeFailureMarker('child', 'failure');
    let deadlineFired = false;
    const deadline = setTimeout(() => {
      deadlineFired = true;
      child.kill('SIGKILL');
    }, 30_000);
    child.on('message', (result) => {
      success = result?.passed === true;
      diagnostic = probeFailureMarker(result?.stage, result?.reason);
    });
    child.on('error', () => {
      clearTimeout(deadline);
      child.kill('SIGKILL');
      reject(new Error(probeFailureMarker('child', 'spawn')));
    });
    child.on('exit', (code, signal) => {
      clearTimeout(deadline);
      if (code === 0 && signal === null && success) resolve();
      else
        reject(
          new Error(childFailureDiagnostic(signal, deadlineFired, diagnostic)),
        );
    });
    child.send({ expected, cookie, api });
  });
}

test('compiled Settings retains the build snapshot across requests and fresh processes', async () => {
  let stage = 'build-input';
  try {
    const manifest = JSON.parse(
      readFileSync('.next/required-server-files.json', 'utf8'),
    );
    const expected = JSON.parse(manifest.config.env.APP_BUILD_PROVENANCE);
    assertLocalBuildSnapshot(expected);
    const api = assertLocalUrl(process.env.LOCAL_API_URL, 54321);
    localBackend(api);
    assert.equal(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      api,
      'local build inputs must match',
    );
    assert.ok(
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
      'requires caller-scoped key',
    );
    const jar = new Map();
    const viewer = createServerClient(
      api,
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
      {
        auth: { autoRefreshToken: false },
        global: {
          fetch: (url, options) => {
            assert.equal(
              new URL(String(url)).origin,
              new URL(api).origin,
              'refusing nonlocal Auth request',
            );
            const deadline = AbortSignal.timeout(5_000);
            return fetch(url, {
              ...options,
              redirect: 'error',
              signal: options?.signal
                ? AbortSignal.any([options.signal, deadline])
                : deadline,
            });
          },
        },
        cookies: {
          getAll: () => [...jar].map(([name, value]) => ({ name, value })),
          setAll: (cookies) =>
            cookies.forEach(({ name, value }) => jar.set(name, value)),
        },
      },
    );
    try {
      stage = 'auth-signin';
      const signed = await viewer.auth.signInWithPassword({
        email: fixture.emails.viewer,
        password: fixture.password,
      });
      assert.equal(
        signed.error === null,
        true,
        'local viewer authentication must succeed',
      );
      const cookie = [...jar]
        .map(([name, value]) => `${name}=${value}`)
        .join('; ');
      assert.ok(cookie, 'requires an authenticated caller cookie');
      stage = 'child';
      for (const label of ['preview', 'production'])
        await probe(expected, cookie, api, label);
    } finally {
      try {
        const result = await viewer.auth.signOut({ scope: 'local' });
        assert.equal(
          result.error === null,
          true,
          'probe session cleanup must succeed',
        );
      } catch {
        throw new Error(probeFailureMarker('auth-signout', 'cleanup'));
      } finally {
        jar.clear();
      }
    }
  } catch (error) {
    const marker = extractProbeFailure(error?.message);
    throw new Error(
      marker !== 'probe-failure:unknown.unknown'
        ? marker
        : probeFailureMarker(stage, classifyProbeFailure(error)),
    );
  }
});
