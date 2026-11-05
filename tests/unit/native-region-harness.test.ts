// @vitest-environment node
import { expect, it, vi } from 'vitest';
import { JSDOM, VirtualConsole } from 'jsdom';
import { stableRegionHarness } from '../e2e/native-region-harness';

it('mounts the native PageArrival harness in the opaque document used by setContent', async () => {
  const script = await stableRegionHarness('keyed template', false);
  const errors: string[] = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', (error) => errors.push(error.message));
  const dom = new JSDOM('<div id="root"></div>', {
    runScripts: 'outside-only',
    pretendToBeVisual: true,
    virtualConsole,
  });
  dom.window.addEventListener('error', (error) => errors.push(error.message));
  Object.assign(dom.window.document, {
    startViewTransition: () => ({
      ready: Promise.resolve(),
      finished: Promise.resolve(),
      updateCallbackDone: Promise.resolve(),
      skipTransition() {},
    }),
  });
  Object.assign(dom.window, {
    matchMedia: () => ({
      matches: false,
      addEventListener() {},
      removeEventListener() {},
    }),
  });
  try {
    expect(dom.window.location.origin).toBe('null');
    dom.window.eval(script);
    await vi.waitFor(() => {
      expect(dom.window.document.querySelector('h1')?.textContent).toBe(
        'Inventory',
      );
    });
    expect(errors).toEqual([]);
  } finally {
    dom.window.close();
  }
});
