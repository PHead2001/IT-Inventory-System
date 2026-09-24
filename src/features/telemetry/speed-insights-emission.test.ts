import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';
import { beforeSendPrivateVitals } from './speed-insights';

// Official Vercel browser intake script captured from
// https://va.vercel-scripts.com/v1/speed-insights/script.js on 2026-09-24.
// SHA-256: C703720710415599D2F0B3F31FBFDA63E34D6D19E730BADA78B9B92197564F5B
const officialScript = readFileSync(
  resolve('tests/fixtures/speed-insights-script.js'),
  'utf8',
);

async function blobText(window: JSDOM['window'], blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new window.FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(blob);
  });
}

async function emitFromOfficialScript(
  path: string,
  route: string,
  lcpElementId?: string,
  flushPath?: string,
) {
  const previousHref = window.location.href;
  // The installed callback closes over Vitest's DOM global; keep it aligned
  // with the official script's separate JSDOM window during this exercise.
  window.history.replaceState(null, '', path);
  const dom = new JSDOM(
    '<!doctype html><html><head></head><body></body></html>',
    {
      url: window.location.origin + path,
      runScripts: 'outside-only',
    },
  );
  const browser = dom.window;
  const sent: Blob[] = [];
  if (lcpElementId) {
    const element = browser.document.createElement('div');
    element.id = lcpElementId;
    browser.document.body.appendChild(element);
    Object.defineProperty(browser, 'PerformanceObserver', {
      configurable: true,
      value: class {
        static supportedEntryTypes = ['largest-contentful-paint'];
        private callback: (list: { getEntries: () => unknown[] }) => void;
        constructor(callback: (list: { getEntries: () => unknown[] }) => void) {
          this.callback = callback;
        }
        observe(options: { type: string }) {
          if (options.type === 'largest-contentful-paint')
            queueMicrotask(() =>
              this.callback({
                getEntries: () => [
                  { startTime: 20, size: 100, element, url: '', id: 'lcp-1' },
                ],
              }),
            );
        }
        disconnect() {}
        takeRecords() {
          return [];
        }
      },
    });
  }
  const script = browser.document.createElement('script');
  script.dataset.route = route;
  script.dataset.sdkn = '@vercel/speed-insights/next';
  script.dataset.sdkv = '2.0.0';
  browser.document.head.appendChild(script);
  Object.defineProperty(browser.document, 'currentScript', {
    configurable: true,
    value: script,
  });
  Object.defineProperty(browser.document, 'readyState', {
    configurable: true,
    value: 'complete',
  });
  browser.performance.getEntriesByType = ((type: string) =>
    type === 'navigation'
      ? [
          {
            responseStart: 1,
            domainLookupStart: 0,
            connectStart: 0,
            requestStart: 0,
            activationStart: 0,
            type: 'navigate',
          },
        ]
      : []) as unknown as typeof browser.performance.getEntriesByType;
  (browser as typeof browser & { Request: typeof Request }).Request = Request;
  browser.fetch = ((_: string, options: { body: Blob }) => {
    sent.push(options.body);
    return Promise.resolve({ ok: true });
  }) as typeof browser.fetch;
  browser.navigator.sendBeacon = ((_: string, blob: Blob) => {
    sent.push(blob);
    return true;
  }) as typeof browser.navigator.sendBeacon;
  browser.siq = [['beforeSend', beforeSendPrivateVitals]];
  try {
    browser.eval(officialScript);
    await new Promise((resolve) => setTimeout(resolve, 15));
    if (flushPath) {
      browser.history.replaceState(null, '', flushPath);
      window.history.replaceState(null, '', flushPath);
    }
    browser.dispatchEvent(new browser.Event('pagehide'));
    await new Promise((resolve) => setTimeout(resolve, 5));
    return await Promise.all(sent.map((blob) => blobText(browser, blob)));
  } finally {
    dom.window.close();
    window.history.replaceState(null, '', previousHref);
  }
}

describe('official Speed Insights emitted payload', () => {
  it('pins the official script fixture used for payload tests', () => {
    expect(
      createHash('sha256').update(officialScript).digest('hex').toUpperCase(),
    ).toBe('C703720710415599D2F0B3F31FBFDA63E34D6D19E730BADA78B9B92197564F5B');
  });
  it('emits only a normalized static URL and route', async () => {
    const payloads = await emitFromOfficialScript(
      '/inventory?q=ordinary%20search#section',
      '/inventory',
    );
    expect(payloads).toHaveLength(1);
    const payload = JSON.parse(payloads[0]);
    expect(payload.metrics.length).toBeGreaterThan(0);
    expect(
      payload.metrics.every(
        (metric: { href: string; route: string }) =>
          metric.href === window.location.origin + '/inventory' &&
          metric.route === '/inventory',
      ),
    ).toBe(true);
    expect(payloads[0]).not.toMatch(/ordinary|search|section/);
  });

  it.each([
    '/inventory?token=secret',
    '/inventory?CoDe=secret',
    '/inventory#access_token=secret',
    '/inventory#/auth?refresh_token=secret',
  ])('emits no metric for a token-bearing URL %s', async (path) => {
    expect(await emitFromOfficialScript(path, '/inventory')).toEqual([]);
  });

  it('drops an inventory metric queued before logout when it flushes on login', async () => {
    expect(
      await emitFromOfficialScript(
        '/inventory?q=ordinary',
        '/inventory',
        undefined,
        '/login?token=secret',
      ),
    ).toEqual([]);
  });

  it('drops dynamic asset metrics even when a static route is falsely supplied', async () => {
    expect(
      await emitFromOfficialScript(
        '/inventory/assets/00000000-0000-4000-8000-000000000001',
        '/inventory',
      ),
    ).toEqual([]);
  });

  it('drops static URLs with an original dynamic route because the script retains that route', async () => {
    expect(
      await emitFromOfficialScript(
        '/inventory?token=secret',
        '/inventory/assets/[id]',
      ),
    ).toEqual([]);
  });

  it('emits nothing when the official script retains /inventory for a /labels URL', async () => {
    expect(await emitFromOfficialScript('/labels', '/inventory')).toEqual([]);
  });

  it('emits only opaque DOM selectors in actual LCP attribution', async () => {
    const payloads = await emitFromOfficialScript(
      '/inventory',
      '/inventory',
      'inventory-location-results-tree-1',
    );
    expect(payloads).toHaveLength(1);
    const metrics = JSON.parse(payloads[0]).metrics as {
      type: string;
      attribution?: { eventTarget?: string };
    }[];
    const lcp = metrics.find((metric) => metric.type === 'LCP');
    expect(lcp?.attribution?.eventTarget).toContain(
      '#inventory-location-results-tree-1',
    );
    expect(payloads[0]).not.toContain('00000000-0000-4000-8000-000000000001');
  });
});
