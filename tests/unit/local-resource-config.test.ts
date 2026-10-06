// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@vitejs/plugin-react', () => ({
  default: () => ({ name: 'react-config-test' }),
}));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

async function configurations(
  platform: NodeJS.Platform,
  env: { CI?: string; VERCEL?: string } = {},
) {
  vi.stubGlobal('process', {
    ...process,
    platform,
    env: { ...process.env, CI: undefined, VERCEL: undefined, ...env },
  });
  const { default: vitest } = await import('../../vitest.config');
  const { default: next } = await import('../../next.config');
  return { vitest, next };
}

describe('local Windows resource limits', () => {
  it('caps unit-test and page-generation concurrency without changing other configuration', async () => {
    const local = await configurations('win32');
    vi.unstubAllGlobals();
    vi.resetModules();
    const baseline = await configurations('linux');

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
    async (platform, env) => {
      const { vitest, next } = await configurations(platform, env);
      expect(vitest.test).not.toHaveProperty('maxWorkers');
      expect(next).not.toHaveProperty('experimental');
    },
  );
});
