import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
  getAll: vi.fn(),
  set: vi.fn(),
  createServerClient: vi.fn(),
}));
vi.mock('server-only', () => ({}));
vi.mock('next/headers', () => ({
  cookies: async () => ({ getAll: mocks.getAll, set: mocks.set }),
}));
vi.mock('@supabase/ssr', () => ({
  createServerClient: mocks.createServerClient,
}));
vi.mock('./config', () => ({
  supabaseConfig: () => ({
    url: 'http://127.0.0.1:54321',
    key: 'public-test-key',
  }),
}));
import { createAuthDiagnostic } from '@/lib/auth/diagnostic.server';
import { createSupabaseServerClient } from './server';
type Adapter = {
  getAll(): unknown;
  setAll(
    values: {
      name: string;
      value: string;
      options: { path?: string; sameSite?: 'lax' };
    }[],
  ): void;
};

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv('AUTH_DIAGNOSTICS', '1');
  vi.stubEnv('APP_ENV', 'local');
  vi.stubEnv('VERCEL_ENV', undefined);
  vi.stubEnv('VERCEL', undefined);
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'http://127.0.0.1:54321');
  mocks.getAll.mockReturnValue([{ name: 'session', value: 'private-cookie' }]);
  mocks.createServerClient.mockImplementation(
    (_url, _key, options) => options.cookies,
  );
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

it('preserves exact cookie values/options and suppresses writes in read-only server rendering', async () => {
  const info = vi.spyOn(console, 'info').mockImplementation(() => {});
  const diagnostic = createAuthDiagnostic();
  const readOnly = (await createSupabaseServerClient(
    false,
    diagnostic,
  )) as unknown as Adapter;
  expect(readOnly.getAll()).toEqual([
    { name: 'session', value: 'private-cookie' },
  ]);
  readOnly.setAll([
    {
      name: 'session',
      value: 'new-private-cookie',
      options: { path: '/', sameSite: 'lax' },
    },
  ]);
  expect(mocks.set).not.toHaveBeenCalled();
  const writable = (await createSupabaseServerClient(
    true,
    diagnostic,
  )) as unknown as Adapter;
  const update = {
    name: 'session',
    value: 'new-private-cookie',
    options: { path: '/', sameSite: 'lax' as const },
  };
  writable.setAll([update]);
  expect(mocks.set).toHaveBeenCalledExactlyOnceWith(
    update.name,
    update.value,
    update.options,
  );
  expect(info.mock.calls.map(([line]) => String(line)).join(' ')).not.toContain(
    'private-cookie',
  );
});

it('does not swallow a genuine cookie write failure when the observer fails', async () => {
  vi.spyOn(console, 'info').mockImplementation(() => {
    throw new Error('observer failed');
  });
  const original = new Error('cookie write failed');
  mocks.set.mockImplementation(() => {
    throw original;
  });
  const writable = (await createSupabaseServerClient(
    true,
    createAuthDiagnostic(),
  )) as unknown as Adapter;
  expect(() =>
    writable.setAll([{ name: 'session', value: 'x', options: {} }]),
  ).toThrow(original);
});
