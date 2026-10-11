import { afterEach, expect, it, vi } from 'vitest';
import { PHASE_PRODUCTION_BUILD } from 'next/constants';
import nextConfig, { createNextConfig } from '../../../next.config';
import { createBuildProvenance, type BuildInputs } from './provenance';
const started = new Date('2026-10-09T12:30:00.000Z');
const commit = 'a'.repeat(40);
const snapshot = (inputs: BuildInputs = {}) =>
  createBuildProvenance(inputs, '0.1.0', true, started);
afterEach(() => vi.unstubAllEnvs());
it.each(['typegen', 'start', undefined])(
  'does not mint production info for canonical CLI action %j',
  (action) => {
    const previous = process.argv;
    process.argv = [previous[0], previous[1], ...(action ? [action] : [])];
    vi.stubEnv('NEXT_PRIVATE_BUILD_WORKER', '');
    vi.stubEnv('APP_ENV', 'production');
    try {
      const result = nextConfig(PHASE_PRODUCTION_BUILD);
      expect(
        JSON.parse(result.env!.APP_BUILD_PROVENANCE as string),
      ).toMatchObject({
        environment: 'Development',
        commit: null,
        buildStarted: null,
      });
    } finally {
      process.argv = previous;
    }
  },
);
it.each([
  [{ APP_ENV: 'staging', VERCEL: '1', VERCEL_ENV: 'preview' }, 'Audit staging'],
  [{ APP_ENV: 'production', VERCEL: '1', VERCEL_ENV: 'preview' }, 'Preview'],
  [{ APP_ENV: 'staging', VERCEL: '1', VERCEL_ENV: 'production' }, 'Production'],
  [
    { APP_ENV: 'preview', VERCEL: '1', VERCEL_TARGET_ENV: 'production' },
    'Production',
  ],
  [{ APP_ENV: 'production', VERCEL: '1' }, 'Unknown'],
  [
    {
      APP_ENV: 'staging',
      VERCEL: '1',
      VERCEL_ENV: 'preview',
      VERCEL_TARGET_ENV: 'unexpected',
    },
    'Unknown',
  ],
  [{ APP_ENV: 'local' }, 'Local'],
  [{ APP_ENV: 'staging' }, 'Audit staging'],
  [{ APP_ENV: 'preview' }, 'Preview'],
  [{ APP_ENV: 'production' }, 'Production'],
  [{ APP_ENV: 'unexpected' }, 'Unknown'],
  [{ APP_ENV: '__proto__' }, 'Unknown'],
  [{ APP_ENV: 'toString' }, 'Unknown'],
  [{}, 'Unknown'],
] as const)('classifies verified metadata %j as %s', (inputs, label) => {
  expect(snapshot(inputs).environment).toBe(label);
});
it.each([
  undefined,
  '',
  'main',
  'a'.repeat(39),
  'a'.repeat(41),
  'g'.repeat(40),
  `${commit}\n`,
])('rejects missing or malformed commit %j', (sha) => {
  expect(snapshot({ VERCEL_GIT_COMMIT_SHA: sha }).commit).toBeNull();
});
it('keeps full deployment identity and the build-start instant immutable', () => {
  const value = snapshot({ VERCEL_GIT_COMMIT_SHA: commit.toUpperCase() });
  vi.stubEnv('VERCEL_GIT_COMMIT_SHA', 'b'.repeat(40));
  vi.stubEnv('APP_ENV', 'production');
  expect(value).toEqual({
    environment: 'Unknown',
    version: '0.1.0',
    commit,
    buildStarted: started.toISOString(),
  });
  expect(Object.isFrozen(value)).toBe(true);
});
it('development never invents production provenance from environment metadata', () => {
  expect(
    createBuildProvenance(
      {
        APP_ENV: 'production',
        VERCEL: '1',
        VERCEL_ENV: 'production',
        VERCEL_GIT_COMMIT_SHA: commit,
      },
      '0.1.0',
      false,
      started,
    ),
  ).toEqual({
    environment: 'Development',
    version: '0.1.0',
    commit: null,
    buildStarted: null,
  });
});
it('compiles only the allowlisted snapshot; config construction time is fixed across requests', async () => {
  const inputs = {
    APP_ENV: 'local',
    VERCEL_GIT_COMMIT_SHA: commit,
    SECRET_TOKEN: 'must-not-appear',
    VERCEL_URL: 'must-not-appear',
  };
  const first = createNextConfig('win32', inputs, PHASE_PRODUCTION_BUILD);
  const second = createNextConfig('win32', inputs, PHASE_PRODUCTION_BUILD);
  expect(first.env).toEqual(second.env);
  expect(Object.keys(first.env!)).toEqual(['APP_BUILD_PROVENANCE']);
  expect(JSON.stringify(first.env)).not.toContain('must-not-appear');
  expect(
    Object.keys(JSON.parse(first.env!.APP_BUILD_PROVENANCE as string)),
  ).toEqual(['environment', 'version', 'commit', 'buildStarted']);
  expect(first.experimental?.cpus).toBe(2);
  expect(await first.headers?.()).toEqual(await second.headers?.());
});
