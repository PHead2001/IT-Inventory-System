import { describe, expect, it, vi } from 'vitest';
import type { Page, Route } from '@playwright/test';
import { holdHydrationScripts } from '../e2e/deferred-hydration';

async function barrier() {
  let intercept!: (route: Route) => Promise<void>;
  const route = vi.fn(async (_pattern: string, handler: typeof intercept) => {
    intercept = handler;
  });
  const gate = await holdHydrationScripts(
    { route } as unknown as Page,
    'https://inventory.example/settings',
  );
  return { ...gate, intercept, route };
}
function request(url: string, resourceType = 'script') {
  const continued = vi.fn(async () => {});
  return {
    route: {
      request: () => ({ url: () => url, resourceType: () => resourceType }),
      continue: continued,
    } as unknown as Route,
    continued,
  };
}
describe('deferred hydration parser boundary', () => {
  it('allows the exact same-origin bootstrap while retaining the script barrier', async () => {
    const gate = await barrier();
    const bootstrap = request(
      'https://inventory.example/theme-bootstrap.v1.js',
    );
    await gate.intercept(bootstrap.route);
    expect(bootstrap.continued).toHaveBeenCalledOnce();
    expect(gate.heldScriptCount()).toBe(0);
    expect(gate.route).toHaveBeenCalledWith('**/*', expect.any(Function));
  });
  it.each([
    'https://inventory.example/_next/static/chunks/app.js',
    'https://foreign.example/theme-bootstrap.v1.js',
    'https://inventory.example/theme-bootstrap.v1.js?different=1',
    'https://inventory.example/other-script.js',
  ])('holds %s until explicit release', async (url) => {
    const gate = await barrier();
    const script = request(url);
    const pending = gate.intercept(script.route);
    await Promise.resolve();
    expect(gate.heldScriptCount()).toBe(1);
    expect(script.continued).not.toHaveBeenCalled();
    gate.release();
    gate.release();
    await pending;
    expect(script.continued).toHaveBeenCalledOnce();
  });
  it.each(['stylesheet', 'document', 'fetch'])(
    'leaves %s requests unchanged',
    async (resourceType) => {
      const gate = await barrier();
      const other = request('https://inventory.example/resource', resourceType);
      await gate.intercept(other.route);
      expect(other.continued).toHaveBeenCalledOnce();
      expect(gate.heldScriptCount()).toBe(0);
    },
  );
});
