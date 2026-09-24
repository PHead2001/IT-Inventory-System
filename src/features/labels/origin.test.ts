import { afterEach, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { getLabelOrigin } from './origin.server';
afterEach(() => vi.unstubAllEnvs());
it('requires an explicit stable HTTPS origin for production labels', () => {
  vi.stubEnv('VERCEL_ENV', 'production');
  vi.stubEnv('APP_ENV', 'production');
  vi.stubEnv('APP_ORIGIN', undefined);
  vi.stubEnv('VERCEL_BRANCH_URL', 'inventory-git-main-team.vercel.app');
  expect(() => getLabelOrigin()).toThrow('APP_ORIGIN');
  vi.stubEnv('APP_ORIGIN', 'http://inventory.example.test');
  expect(() => getLabelOrigin()).toThrow('HTTPS');
  vi.stubEnv('APP_ORIGIN', 'https://inventory.example.test');
  expect(getLabelOrigin()).toEqual({
    origin: 'https://inventory.example.test',
    preview: false,
  });
});
it('uses stable branch preview origin, never a commit URL', () => {
  vi.stubEnv('VERCEL_ENV', 'preview');
  vi.stubEnv('APP_ENV', 'preview');
  vi.stubEnv('APP_ORIGIN', undefined);
  vi.stubEnv('VERCEL_BRANCH_URL', 'inventory-git-feature-team.vercel.app');
  vi.stubEnv('VERCEL_URL', 'inventory-commit123-team.vercel.app');
  expect(getLabelOrigin()).toEqual({
    origin: 'https://inventory-git-feature-team.vercel.app',
    preview: true,
  });
});
