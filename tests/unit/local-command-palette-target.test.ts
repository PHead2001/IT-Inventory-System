import { afterEach, expect, it, vi } from 'vitest';
import { localCommandPaletteTarget } from '../helpers/local-command-palette-target';
const constructors = vi.hoisted(() => ({
  postgres: vi.fn(),
  supabase: vi.fn(),
}));
vi.mock('pg', () => ({
  Client: class {
    constructor() {
      constructors.postgres();
    }
  },
}));
vi.mock('@supabase/supabase-js', () => ({
  createClient: constructors.supabase,
}));
afterEach(() => vi.unstubAllEnvs());
it.each([
  ['http://localhost:54321', 'api'],
  ['https://127.0.0.1:54321', 'api'],
  ['postgresql://fixture:fixture@[::1]:54322/postgres', 'database'],
  ['postgres://fixture:fixture@127.0.0.1:54322/postgres', 'database'],
] as const)('accepts only the expected local target %s', (value, kind) => {
  expect(localCommandPaletteTarget(value, kind)).toBe(value);
});
it.each([
  [
    'postgresql://fixture:fixture@127.0.0.1:54322/postgres?host=remote&port=5432',
    'database',
  ],
  [
    'postgresql://fixture:fixture@127.0.0.1:54322/postgres?hostaddr=192.0.2.1',
    'database',
  ],
  [
    'postgresql://fixture:fixture@localhost:54322/postgres#fragment',
    'database',
  ],
  ['postgresql://fixture:fixture@remote:54322/postgres', 'database'],
  ['postgresql://fixture:fixture@localhost:5432/postgres', 'database'],
  ['https://localhost:54322/postgres', 'database'],
  ['http://localhost:54321?redirect=remote', 'api'],
  ['http://localhost:54321#fragment', 'api'],
  ['http://localhost:54321?', 'api'],
  ['postgresql://fixture:fixture@localhost:54322/postgres#', 'database'],
  ['file://localhost:54321', 'api'],
  ['http://remote:54321', 'api'],
] as const)(
  'refuses override, protocol or nonlocal target %s',
  (value, kind) => {
    expect(() => localCommandPaletteTarget(value, kind)).toThrow();
  },
);
it('rejects the pg host query override before any integration client is constructed', async () => {
  vi.resetModules();
  vi.stubEnv('LOCAL_API_URL', 'http://127.0.0.1:54321');
  vi.stubEnv(
    'LOCAL_DB_URL',
    'postgresql://fixture:fixture@127.0.0.1:54322/postgres?host=remote&port=5432',
  );
  vi.stubEnv('LOCAL_ANON_KEY', 'fixture-public-key');
  vi.stubEnv('LOCAL_SERVICE_ROLE_KEY', 'fixture-private-key');
  await expect(
    import('../integration/command-palette-timeout'),
  ).rejects.toThrow('refuses URL parameters and fragments');
  expect(constructors.postgres).not.toHaveBeenCalled();
  expect(constructors.supabase).not.toHaveBeenCalled();
});
