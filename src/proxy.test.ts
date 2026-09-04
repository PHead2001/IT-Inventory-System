// @vitest-environment node
import { expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import type { CookieMethodsServer } from '@supabase/ssr';
const sdk = vi.hoisted(() => ({ createServerClient: vi.fn() }));
vi.mock('@supabase/ssr', () => sdk);
vi.mock('./lib/supabase/config', () => ({
  supabaseConfig: () => ({
    url: 'http://localhost:54321',
    key: 'public-test-key',
  }),
}));
import { proxy } from './proxy';
it('preserves refreshed cookie chunks and cache headers across writes', async () => {
  sdk.createServerClient.mockImplementation(
    (_url, _key, options: { cookies: CookieMethodsServer }) => ({
      auth: {
        getClaims: async () => {
          await options.cookies.setAll!(
            [
              {
                name: 'session.0',
                value: 'first',
                options: { httpOnly: true },
              },
            ],
            { 'Cache-Control': 'private, no-store', Expires: '0' },
          );
          await options.cookies.setAll!(
            [
              {
                name: 'session.1',
                value: 'second',
                options: { httpOnly: true },
              },
            ],
            {},
          );
          return { data: null, error: null };
        },
      },
    }),
  );
  const request = new NextRequest('http://localhost:3000/inventory', {
    headers: { cookie: 'session.0=old' },
  });
  const response = await proxy(request);
  expect(response.cookies.get('session.0')?.value).toBe('first');
  expect(response.cookies.get('session.1')?.value).toBe('second');
  expect(request.cookies.get('session.1')?.value).toBe('second');
  expect(response.headers.get('cache-control')).toContain('no-store');
  expect(response.headers.get('expires')).toBe('0');
  expect(response.headers.get('x-middleware-request-cookie')).toContain(
    'session.0=first',
  );
  expect(response.headers.get('x-middleware-request-cookie')).toContain(
    'session.1=second',
  );
  expect(response.headers.get('x-middleware-request-cookie')).not.toContain(
    'old',
  );
});
