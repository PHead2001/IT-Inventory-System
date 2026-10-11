import { expect, it } from 'vitest';
import {
  createConfigSnapshotReader,
  PRIVATE_BUILD_BRIDGE,
} from './config-snapshot';
const version = '0.1.0';
const old = new Date('2026-10-09T10:00:00.125Z');
const later = new Date('2026-10-09T10:00:05.875Z');
it('shares exact parent bytes across worker config reloads with different clocks and environment', () => {
  const env: Record<string, string | undefined> = {
    APP_ENV: 'staging',
    VERCEL_GIT_COMMIT_SHA: 'a'.repeat(40),
    [PRIVATE_BUILD_BRIDGE]: 'untrusted external value',
  };
  const parent = createConfigSnapshotReader();
  const initial = parent(env, version, true, () => old);
  env.APP_ENV = 'production';
  expect(parent(env, version, true, () => later)).toBe(initial);
  const worker = createConfigSnapshotReader();
  expect(
    worker(
      { ...env, NEXT_PRIVATE_BUILD_WORKER: '1' },
      version,
      true,
      () => later,
    ),
  ).toBe(initial);
  expect(JSON.parse(initial).buildStarted).toBe(old.toISOString());
  expect(
    createConfigSnapshotReader()(env, version, true, () => later),
  ).not.toBe(initial);
  expect(JSON.parse(env[PRIVATE_BUILD_BRIDGE]!).buildStarted).toBe(
    later.toISOString(),
  );
});
it('development/type generation produces no stamp or private bridge', () => {
  const env: Record<string, string | undefined> = {};
  const result = createConfigSnapshotReader()(env, version, false, () => {
    throw new Error('must not read clock');
  });
  expect(JSON.parse(result).buildStarted).toBeNull();
  expect(env).not.toHaveProperty(PRIVATE_BUILD_BRIDGE);
});
it.each([
  undefined,
  '',
  '{}',
  '[]',
  'null',
  'bad json',
  JSON.stringify({
    environment: 'Local',
    version,
    commit: null,
    buildStarted: 'yesterday',
  }),
  JSON.stringify({
    environment: 'Local',
    version: 'bad',
    commit: null,
    buildStarted: old.toISOString(),
  }),
  JSON.stringify({
    environment: 'Local',
    version,
    commit: 'A'.repeat(40),
    buildStarted: old.toISOString(),
  }),
  JSON.stringify({
    environment: 'forged',
    version,
    commit: null,
    buildStarted: old.toISOString(),
  }),
  JSON.stringify({
    environment: 'Local',
    version,
    commit: null,
    buildStarted: old.toISOString(),
    SECRET: 'must not cross',
  }),
])('fails worker build on malformed/missing bridge %j', (raw) => {
  expect(() =>
    createConfigSnapshotReader()(
      { NEXT_PRIVATE_BUILD_WORKER: '1', [PRIVATE_BUILD_BRIDGE]: raw },
      version,
      true,
    ),
  ).toThrow();
});
