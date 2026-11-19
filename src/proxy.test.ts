// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { unstable_doesMiddlewareMatch } from 'next/experimental/testing/server';
import type { CookieMethodsServer } from '@supabase/ssr';
vi.mock('server-only', () => ({}));
const sdk = vi.hoisted(() => ({
  createServerClient: vi.fn(),
  config: vi.fn(() => ({
    url: 'http://localhost:54321',
    key: 'public-test-key',
  })),
}));
vi.mock('@supabase/ssr', () => sdk);
vi.mock('./lib/supabase/config', () => ({
  supabaseConfig: sdk.config,
}));
import { proxy, config } from './proxy';
import { themeScopeHeader } from './components/experience/theme-scope';
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});
it.each([
  '/inventory/quantity/missing.jpg',
  '/inventory/assets/missing.svg',
  '/locations/missing.png',
  '/sites/missing.webp',
  '/settings/sites/missing.gif',
  '/settings/locations/missing.jpeg',
  '/settings/forms/missing.jpg',
  '/sites/missing.jpg/open/asset',
  '/inventory/quantity/missing.jpg/extra.svg',
])('matches and replaces spoofed document identity for %s', async (path) => {
  expect(
    unstable_doesMiddlewareMatch({ config, nextConfig: {}, url: path }),
  ).toBe(true);
  sdk.createServerClient.mockReturnValue({
    auth: { getClaims: async () => ({ data: null, error: null }) },
  });
  const response = await proxy(
    new NextRequest(`http://localhost:3000${path}?ignored=1`, {
      headers: { 'x-inventory-document-path': '/inventory/quantity/new' },
    }),
  );
  expect(
    response.headers.get('x-middleware-request-x-inventory-document-path'),
  ).toBe(path);
  expect(sdk.config).toHaveBeenCalledOnce();
  expect(sdk.createServerClient).toHaveBeenCalledOnce();
  expect(response.headers.get('cache-control')).toBe('private, no-store');
});
it.each([
  '/missing.jpg',
  '/missing.svg',
  '/images/missing.png',
  '/images/missing.jpeg',
  '/images/missing.gif',
  '/images/missing.webp',
  '/locations-archive/missing.png',
  '/_next/static/missing.js',
  '/_next/image?url=%2Fmissing.jpg&w=16&q=75',
  '/favicon.ico',
  '/theme-bootstrap.v1.js',
])(
  'normalizes public %s fallback identity without Auth or cache-policy changes',
  async (path) => {
    expect(
      unstable_doesMiddlewareMatch({ config, nextConfig: {}, url: path }),
    ).toBe(true);
    const request = new NextRequest(`http://localhost:3000${path}`, {
      headers: {
        'x-inventory-document-path': '/inventory/quantity/missing.jpg',
        'x-inventory-return': '/inventory/assets/missing.jpg',
        [themeScopeHeader]: '11111111-1111-4111-8111-111111111111',
        cookie: 'session.0=original',
      },
    });
    const read = vi.spyOn(request.cookies, 'getAll');
    const response = await proxy(request);
    expect(
      response.headers.get('x-middleware-request-x-inventory-document-path'),
    ).toBe(request.nextUrl.pathname);
    expect(
      response.headers.get('x-middleware-request-x-inventory-return'),
    ).toBe('');
    expect(sdk.config).not.toHaveBeenCalled();
    expect(sdk.createServerClient).not.toHaveBeenCalled();
    expect(request.headers.has(themeScopeHeader)).toBe(false);
    expect(
      response.headers.has(`x-middleware-request-${themeScopeHeader}`),
    ).toBe(false);
    expect(read).not.toHaveBeenCalled();
    expect(request.headers.get('cookie')).toBe('session.0=original');
    expect(response.headers.has('set-cookie')).toBe(false);
    expect(response.headers.has('cache-control')).toBe(false);
  },
);
it.each([
  '/api/auth/logout',
  '/api/auth/privacy-confirm',
  '/api/auth/privacy-read',
])(
  'defers every %s cookie/provider operation to admitted handler requests',
  async (path) => {
    for (const method of ['GET', 'POST']) {
      const request = new NextRequest(
        `https://actual-preview.example${path}?ignored=1`,
        {
          method,
          headers: {
            cookie: 'session.0=original',
            origin: 'https://evil.example',
            'sec-fetch-site': 'cross-site',
            [themeScopeHeader]: '11111111-1111-4111-8111-111111111111',
          },
        },
      );
      const read = vi.spyOn(request.cookies, 'getAll');
      const response = await proxy(request);
      expect(sdk.config).not.toHaveBeenCalled();
      expect(sdk.createServerClient).not.toHaveBeenCalled();
      expect(read).not.toHaveBeenCalled();
      expect(response.headers.has('set-cookie')).toBe(false);
      expect(
        response.headers.has(`x-middleware-request-${themeScopeHeader}`),
      ).toBe(false);
      expect(request.headers.get('cookie')).toBe('session.0=original');
      expect(response.headers.get('cache-control')).toBe('private, no-store');
    }
  },
);
it.each([
  '/api/auth/logout/extra',
  '/api/auth/privacy-confirmation',
  '/api/auth/privacy-read/extra',
  '/api/auth/privacy-reader',
  '/auth/confirm',
  '/api/room/contents',
  '/inventory/quantity/theme-bootstrap.v1.js',
  '/theme-bootstrap.v1.js/private',
  '/theme-bootstrap.v2.js',
])('retains claims refresh for other routes including %s', async (path) => {
  const claims = vi.fn().mockResolvedValue({ data: null, error: null });
  sdk.createServerClient.mockReturnValue({ auth: { getClaims: claims } });
  await proxy(new NextRequest(`https://actual-preview.example${path}`));
  expect(sdk.config).toHaveBeenCalledOnce();
  expect(sdk.createServerClient).toHaveBeenCalledOnce();
  expect(claims).toHaveBeenCalledOnce();
});
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
                options: {
                  httpOnly: true,
                  sameSite: 'strict',
                  secure: true,
                  path: '/',
                  maxAge: 100,
                },
              },
            ],
            { 'Cache-Control': 'private, no-store', Expires: '0' },
          );
          await options.cookies.setAll!(
            [
              {
                name: 'session.1',
                value: 'second',
                options: {
                  httpOnly: true,
                  sameSite: 'lax',
                  secure: true,
                  path: '/',
                  maxAge: 200,
                },
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
  expect(response.cookies.get('session.0')).toMatchObject({
    httpOnly: true,
    sameSite: 'strict',
    secure: true,
    path: '/',
    maxAge: 100,
  });
  expect(response.cookies.get('session.1')).toMatchObject({
    httpOnly: true,
    sameSite: 'lax',
    secure: true,
    path: '/',
    maxAge: 200,
  });
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
it('overwrites a caller-supplied return header with a canonical matched path', async () => {
  sdk.createServerClient.mockReturnValue({
    auth: { getClaims: async () => ({ data: null, error: null }) },
  });
  const valid = new NextRequest('http://localhost:3000/locations/ITC', {
    headers: { 'x-inventory-return': 'https://evil.test' },
  });
  const validResponse = await proxy(valid);
  expect(
    validResponse.headers.get('x-middleware-request-x-inventory-return'),
  ).toBe('/locations/ITC');
  const overview = new NextRequest('http://localhost:3000/dashboard', {
    headers: { 'x-inventory-return': 'https://evil.test' },
  });
  expect(
    (await proxy(overview)).headers.get(
      'x-middleware-request-x-inventory-return',
    ),
  ).toBe('/dashboard');
  const invalid = new NextRequest('http://localhost:3000/inventory', {
    headers: { 'x-inventory-return': '/locations/ITC' },
  });
  const invalidResponse = await proxy(invalid);
  expect(
    invalidResponse.headers.get('x-middleware-request-x-inventory-return'),
  ).toBe('');
});
it('times claims with a fixed stage while preserving results and original failures', async () => {
  vi.stubEnv('AUTH_DIAGNOSTICS', '1');
  vi.stubEnv('VERCEL_ENV', 'preview');
  const info = vi.spyOn(console, 'info').mockImplementation(() => {});
  const getClaims = vi.fn().mockResolvedValue({ data: null, error: null });
  sdk.createServerClient.mockReturnValue({ auth: { getClaims } });
  const request = new NextRequest('http://localhost:3000/inventory');
  const response = await proxy(request);
  expect(response.headers.get('cache-control')).toContain('no-store');
  expect(getClaims).toHaveBeenCalledOnce();
  const event = JSON.parse(
    String(info.mock.calls[0][0]).slice('AUTH_DIAGNOSTIC '.length),
  );
  expect(event.stage).toBe('proxy.getClaims');
  expect(Object.keys(event).sort()).toEqual([
    'correlation',
    'durationMs',
    'stage',
  ]);
  expect(info.mock.calls.flat().join(' ')).not.toContain('/inventory');
  const original = new Error('original claims failure');
  getClaims.mockRejectedValue(original);
  info.mockImplementation(() => {
    throw new Error('observer failed');
  });
  await expect(
    proxy(new NextRequest('http://localhost:3000/inventory')),
  ).rejects.toBe(original);
});
it('overwrites spoofed presentation actors only after verified claims and preserves late refresh cookies', async () => {
  const actor = '11111111-1111-4111-8111-111111111111';
  sdk.createServerClient.mockImplementation(
    (_url, _key, options: { cookies: CookieMethodsServer }) => ({
      auth: {
        getClaims: async () => {
          await options.cookies.setAll!(
            [
              {
                name: 'session.1',
                value: 'fresh',
                options: { httpOnly: true, sameSite: 'lax' },
              },
            ],
            { Expires: '0' },
          );
          return { data: { claims: { sub: actor } }, error: null };
        },
      },
    }),
  );
  const request = new NextRequest('http://localhost:3000/settings', {
    headers: { [themeScopeHeader]: '22222222-2222-4222-8222-222222222222' },
  });
  const response = await proxy(request);
  expect(response.headers.get(`x-middleware-request-${themeScopeHeader}`)).toBe(
    actor,
  );
  expect(response.cookies.get('session.1')).toMatchObject({
    value: 'fresh',
    httpOnly: true,
    sameSite: 'lax',
  });
  expect(response.headers.get('x-middleware-request-cookie')).toContain(
    'session.1=fresh',
  );
  expect(response.headers.get('cache-control')).toBe('private, no-store');
  expect(response.headers.get('expires')).toBe('0');
});
it.each([
  { data: null, error: null },
  { data: { claims: { sub: 'not-a-canonical-actor' } }, error: null },
  {
    data: { claims: { sub: '11111111-1111-4111-8111-111111111111' } },
    error: { message: 'Expired claims' },
  },
])(
  'drops caller presentation headers for anonymous/invalid/errored claims',
  async (result) => {
    sdk.createServerClient.mockReturnValue({
      auth: { getClaims: async () => result },
    });
    const request = new NextRequest('http://localhost:3000/login', {
      headers: { [themeScopeHeader]: '11111111-1111-4111-8111-111111111111' },
    });
    const response = await proxy(request);
    expect(request.headers.has(themeScopeHeader)).toBe(false);
    expect(
      response.headers.get(`x-middleware-request-${themeScopeHeader}`),
    ).toBeNull();
  },
);
