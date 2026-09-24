import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { injectSpeedInsights } from '@vercel/speed-insights';
import {
  beforeSendPrivateVitals,
  speedInsightsEnabled,
} from './speed-insights';

const origin = window.location.origin;
const initialUrl = window.location.href;
const vital = (url: string, route?: string) => ({
  type: 'vital' as const,
  url,
  route,
});

describe('private Speed Insights policy', () => {
  beforeEach(() => window.history.replaceState(null, '', '/inventory'));
  afterEach(() => window.history.replaceState(null, '', initialUrl));
  it('is explicitly enabled only in Vercel Preview or Production', () => {
    for (const env of [
      {},
      { VERCEL_ENV: 'development', SPEED_INSIGHTS_ENABLED: 'true' },
      { VERCEL_ENV: 'preview', SPEED_INSIGHTS_ENABLED: 'TRUE' },
      { VERCEL_ENV: 'production' },
    ])
      expect(speedInsightsEnabled(env)).toBe(false);
    expect(
      speedInsightsEnabled({
        VERCEL_ENV: 'preview',
        SPEED_INSIGHTS_ENABLED: 'true',
      }),
    ).toBe(true);
    expect(
      speedInsightsEnabled({
        VERCEL_ENV: 'production',
        SPEED_INSIGHTS_ENABLED: 'true',
      }),
    ).toBe(true);
  });

  it.each(['/dashboard', '/inventory', '/locations', '/room', '/labels'])(
    'keeps only static %s without query or fragment',
    (path) => {
      expect(
        beforeSendPrivateVitals(
          vital(`${origin}${path}?q=ordinary%20search#section`, path),
        ),
      ).toEqual(vital(`${origin}${path}`, path));
    },
  );

  it.each([
    '?token=secret',
    '?ToKeN_HaSh=secret',
    '?code=secret',
    '?access_token=secret',
    '?refresh-token=secret',
    '?id.token=secret',
    '?code_verifier=secret',
    '#ACCESS_TOKEN=secret',
    '#/callback?refresh_token=secret',
    '#token_hash=secret',
  ])('drops the entire event for auth parameter %s', (suffix) => {
    expect(
      beforeSendPrivateVitals(
        vital(`${origin}/inventory${suffix}`, '/inventory'),
      ),
    ).toBeNull();
  });

  it.each([
    '/login',
    '/auth/confirm?token=secret',
    '/inventory?ACCESS_TOKEN=secret',
    '/inventory#id_token=secret',
  ])('drops queued metrics after the browser reaches %s', (currentPath) => {
    window.history.replaceState(null, '', currentPath);
    expect(
      beforeSendPrivateVitals(vital(`${origin}/inventory`, '/inventory')),
    ).toBeNull();
  });

  it.each([
    ['/login?next=%2Finventory', '/login'],
    ['/scan', '/scan'],
    [
      '/inventory/assets/00000000-0000-4000-8000-000000000001',
      '/inventory/assets/[id]',
    ],
    ['/locations/ITC-D07', '/locations/[code]'],
    ['/api/exports/inventory', '/api/exports/inventory'],
    ['/auth/confirm?token=secret', '/auth/confirm'],
    ['/inventory?token=secret', '/inventory'],
    ['/unknown', '/inventory'],
  ])('drops sensitive or mismatched %s', (path, route) => {
    expect(
      beforeSendPrivateVitals(vital(`${origin}${path}`, route)),
    ).toBeNull();
  });

  it('requires the original route and same application origin', () => {
    expect(beforeSendPrivateVitals(vital(`${origin}/inventory`))).toBeNull();
    expect(
      beforeSendPrivateVitals(
        vital('https://other.example/inventory', '/inventory'),
      ),
    ).toBeNull();
    expect(
      beforeSendPrivateVitals(vital('javascript:alert(1)', '/inventory')),
    ).toBeNull();
  });

  it('drops an allowed route paired with a different allowed URL path', () => {
    expect(
      beforeSendPrivateVitals(vital(`${origin}/labels`, '/inventory')),
    ).toBeNull();
  });

  it('keeps the application usable when the official provider script fails to load', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const main = document.createElement('main');
    main.textContent = 'Inventory remains usable';
    document.body.appendChild(main);
    const injected = injectSpeedInsights({
      route: '/inventory',
      beforeSend: beforeSendPrivateVitals,
      debug: false,
    });
    expect(injected).not.toBeNull();
    const script = document.head.querySelector<HTMLScriptElement>(
      'script[data-sdkn^="@vercel/speed-insights"]',
    );
    expect(script).not.toBeNull();
    script!.dispatchEvent(new Event('error'));
    expect(main.textContent).toBe('Inventory remains usable');
    expect(log).toHaveBeenCalledWith(
      expect.stringContaining('Failed to load script'),
    );
    main.remove();
    script!.remove();
    log.mockRestore();
  });
});
