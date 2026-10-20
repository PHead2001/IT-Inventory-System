// @vitest-environment node
import { expect, it, vi } from 'vitest';
import { JSDOM, VirtualConsole } from 'jsdom';
import { routePrimaryFixture } from '../helpers/route-primary-fixture';

it.each(['primary', 'paired', 'history', 'location'] as const)(
  'bundles the actual %s region topology and installed Next React without a fixture body boundary',
  async (kind) => {
    const fixture = await routePrimaryFixture(kind);
    for (const source of [
      'route-ready.tsx',
      'inventory-capture-region.tsx',
      'paired-inventory-content.tsx',
      'auxiliary-route-capture.ts',
    ])
      expect(fixture.inputs.some((input) => input.endsWith('/' + source))).toBe(
        true,
      );
    expect(
      fixture.inputs.some((input) =>
        input.includes('next/dist/compiled/react-dom/'),
      ),
    ).toBe(true);
    expect(
      fixture.inputs.some((input) =>
        input.endsWith('loading-skeleton.module.css'),
      ),
    ).toBe(true);
    expect(fixture.styles.length).toBeGreaterThan(0);
    expect(fixture.script).toContain('startTransition');
    expect(fixture.script).not.toContain('geometry-body');
    // Execute the actual browser bundle without Node's global process. A
    // successful compile alone cannot detect missing Next build-time defines.
    const errors: string[] = [];
    const virtualConsole = new VirtualConsole();
    virtualConsole.on('jsdomError', (error) => errors.push(error.message));
    const dom = new JSDOM('<div id="root"></div>', {
      url: 'https://fictional.invalid/inventory',
      runScripts: 'outside-only',
      pretendToBeVisual: true,
      virtualConsole,
    });
    try {
      expect(() => dom.window.eval(fixture.script)).not.toThrow();
      await vi.waitFor(() => {
        expect(dom.window.document.querySelector('h1')?.textContent).toBe(
          fixture.sourceRoute,
        );
      });
      expect(errors).toEqual([]);
    } finally {
      dom.window.close();
    }
  },
);
