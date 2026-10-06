// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import defaultVitest, { createVitestConfig } from '../../vitest.config';
import defaultNext, { createNextConfig } from '../../next.config';

vi.mock('@vitejs/plugin-react', () => ({
  default: () => ({ name: 'react-config-test' }),
}));

function configurations(
  platform: NodeJS.Platform,
  env: { CI?: string; VERCEL?: string } = {},
) {
  return {
    vitest: createVitestConfig(platform, env),
    next: createNextConfig(platform, env),
  };
}

describe('local Windows resource limits', () => {
  it('evaluates a foreign platform without loading that platform native tooling', async () => {
    const hostProcess = process;
    const hostPlatform = process.platform;
    const hostEnvironment = process.env;
    const foreignPlatform = process.platform === 'win32' ? 'linux' : 'win32';
    const { vitest, next } = configurations(foreignPlatform);
    if (foreignPlatform === 'win32') {
      expect(vitest.test?.maxWorkers).toBe(2);
      expect(next.experimental?.cpus).toBe(2);
    } else {
      expect(vitest.test).not.toHaveProperty('maxWorkers');
      expect(next).not.toHaveProperty('experimental');
    }
    expect(process).toBe(hostProcess);
    expect(process.platform).toBe(hostPlatform);
    expect(process.env).toBe(hostEnvironment);
  });

  it('uses the real host inputs for the default config exports', () => {
    const expected = configurations(process.platform, {
      CI: process.env.CI,
      VERCEL: process.env.VERCEL,
    });
    expect(defaultVitest).toEqual(expected.vitest);
    expect(defaultNext.experimental).toEqual(expected.next.experimental);
    expect(Object.keys(defaultNext)).toEqual(Object.keys(expected.next));
  });

  it('caps unit-test and page-generation concurrency without changing other configuration', async () => {
    const local = configurations('win32');
    const baseline = configurations('linux');

    expect(local.vitest.test?.maxWorkers).toBe(2);
    expect(local.next.experimental?.cpus).toBe(2);
    expect({ ...local.vitest.test, maxWorkers: undefined }).toEqual({
      ...baseline.vitest.test,
      maxWorkers: undefined,
    });
    expect({
      ...local.next,
      experimental: undefined,
      headers: undefined,
    }).toEqual({
      ...baseline.next,
      experimental: undefined,
      headers: undefined,
    });
    expect(await local.next.headers?.()).toEqual(
      await baseline.next.headers?.(),
    );
  });

  it.each([
    ['linux', {}],
    ['darwin', {}],
    ['win32', { CI: '1' }],
    ['win32', { CI: 'true' }],
    ['win32', { VERCEL: '1' }],
    ['linux', { CI: '1', VERCEL: '1' }],
  ] as const)(
    'preserves default concurrency on %s with %j',
    (platform, env) => {
      const { vitest, next } = configurations(platform, env);
      expect(vitest.test).not.toHaveProperty('maxWorkers');
      expect(next).not.toHaveProperty('experimental');
    },
  );
});
