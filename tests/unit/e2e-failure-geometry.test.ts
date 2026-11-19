import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Page } from '@playwright/test';
import {
  readFailureGeometry,
  withFailureGeometry,
} from '../e2e/failure-geometry';

afterEach(() => {
  document.body.replaceChildren();
  delete document.documentElement.dataset.routeMotionPrivate;
  window.history.replaceState(null, '', '/');
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('bounded E2E failure geometry', () => {
  // jsdom has no native media query evaluator; each test controls only matches.
  beforeEach(() => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => ({ matches: false })),
    );
  });
  it('reports fixed identities and geometry without DOM text, URL values or state', () => {
    window.history.replaceState(
      { secretState: 'do-not-log-state' },
      '',
      '/inventory/assets/private-record-id?task=asset_move&returnTo=%2Finventory&secret=do-not-log-query#tasks',
    );
    document.body.innerHTML = `
      <header class="experience-header">do-not-log-text
        <div class="experience-account"><button aria-label="Search and commands" disabled>secret user</button></div>
      </header>
      <main id="main-content"><input value="do-not-log-input">
        <section aria-label="Record tasks" hidden><h2>private title</h2></section>
      </main>`;
    document.querySelector('input')!.focus();
    document.documentElement.dataset.routeMotionPrivate = 'true';
    const result = readFailureGeometry();
    expect(result).toMatchObject({
      route: 'asset-detail',
      taskCount: 1,
      task: 'asset_move',
      returnToCount: 1,
      returnToInventory: true,
      tasksHash: true,
      privatePresentation: true,
      activeTag: 'INPUT',
      activeOwner: 'main',
    });
    expect(
      result.elements.find((entry) => entry.owner === 'command-launcher'),
    ).toMatchObject({ present: true, disabled: true, tag: 'BUTTON' });
    expect(
      result.elements.find((entry) => entry.owner === 'record-tasks'),
    ).toMatchObject({ present: true, hidden: true });
    const serialized = JSON.stringify(result);
    for (const secret of [
      'do-not-log',
      'private-record-id',
      'private title',
      'secret user',
      'secretState',
    ])
      expect(serialized).not.toContain(secret);
  });

  it('bounds repeated query counts and classifies unknown values and custom tags', () => {
    window.history.replaceState(
      null,
      '',
      '/inventory/quantity/private-id?' +
        new URLSearchParams([
          ...Array.from({ length: 20 }, () => ['task', 'private-task']),
          ['returnTo', '/private-return'],
        ]).toString(),
    );
    document.body.innerHTML =
      '<private-component tabindex="0"></private-component>';
    (document.body.firstElementChild as HTMLElement).focus();
    expect(readFailureGeometry()).toMatchObject({
      route: 'quantity-detail',
      taskCount: 10,
      task: 'other',
      returnToInventory: false,
      activeTag: 'OTHER',
      activeOwner: 'other',
    });
  });

  it('bounds overflow metrics and emits only fixed owners, numeric spacing and media booleans', () => {
    document.body.innerHTML = `
      <div class="experience-header-inner" data-secret="private-attribute">private header</div>
      <form aria-label="Search inventory"><input value="private-search"></form>
      <a class="experience-filter-chip" href="/private-url">private chip</a>
      <div class="experience-inventory-results">private results</div>
      <ul class="experience-surface"><li id="inventory-row-private-id">private row</li></ul>
      <div class="private-unselected">private unrelated element</div>`;
    const fonts = Object.getOwnPropertyDescriptor(document, 'fonts');
    try {
      Object.defineProperty(document, 'fonts', {
        configurable: true,
        value: { status: 'loading' },
      });
      vi.stubGlobal(
        'matchMedia',
        vi.fn((query: string) => ({ matches: query === '(max-width: 640px)' })),
      );
      vi.spyOn(Element.prototype, 'scrollWidth', 'get').mockReturnValue(
        Infinity,
      );
      vi.spyOn(Element.prototype, 'clientWidth', 'get').mockReturnValue(200000);
      vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
        x: -200000,
        y: NaN,
        width: 12.3456,
        height: Infinity,
      } as DOMRect);
      vi.spyOn(window, 'getComputedStyle').mockReturnValue({
        columnGap: '12.3456px',
        rowGap: 'normal',
        paddingTop: '200000px',
        paddingRight: '-200000px',
        paddingBottom: 'NaN',
        paddingLeft: '4px',
        fontFamily: 'private-font',
      } as CSSStyleDeclaration);
      const result = readFailureGeometry();
      expect(result).toMatchObject({
        root: { clientWidth: 100000, scrollWidth: null },
        fontStatus: 'loading',
        narrowMedia: {
          maxWidth640: true,
          maxWidth360: false,
          maxWidth320: false,
        },
      });
      for (const owner of [
        'header-inner',
        'inventory-search',
        'filter-chip',
        'inventory-results',
        'inventory-list',
        'inventory-first-row',
      ]) {
        expect(
          result.elements.find((entry) => entry.owner === owner),
        ).toMatchObject({
          present: true,
          scrollWidth: null,
          clientWidth: 100000,
          rect: { x: -100000, y: null, width: 12.35, height: null },
          spacing: {
            columnGap: 12.35,
            rowGap: null,
            paddingTop: 100000,
            paddingRight: -100000,
            paddingBottom: null,
            paddingLeft: 4,
          },
        });
      }
      const serialized = JSON.stringify(result);
      expect(serialized).not.toContain('private-');
      expect(serialized).not.toContain('private ');
      expect(result.elements).toHaveLength(14);
      Object.defineProperty(document, 'fonts', {
        configurable: true,
        value: { status: 'private-font-status' },
      });
      expect(readFailureGeometry().fontStatus).toBe('other');
      Object.defineProperty(document, 'fonts', {
        configurable: true,
        value: { status: 'loaded' },
      });
      expect(readFailureGeometry().fontStatus).toBe('loaded');
      Object.defineProperty(document, 'fonts', {
        configurable: true,
        value: undefined,
      });
      expect(readFailureGeometry().fontStatus).toBe('unavailable');
    } finally {
      if (fonts) Object.defineProperty(document, 'fonts', fonts);
      else Reflect.deleteProperty(document, 'fonts');
    }
  });

  it('logs only after failure and rethrows the original assertion object', async () => {
    const error = new Error('original assertion');
    const evaluate = vi.fn(async (read: typeof readFailureGeometry) => read());
    const page = { evaluate } as unknown as Page;
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(
      withFailureGeometry(page, 'inventory-horizontal-overflow', async () => {
        throw error;
      }),
    ).rejects.toBe(error);
    expect(evaluate).toHaveBeenCalledExactlyOnceWith(readFailureGeometry);
    expect(log).toHaveBeenCalledTimes(1);
    expect(log.mock.calls[0][0]).toBe('bounded-failure-geometry');
    expect(JSON.parse(log.mock.calls[0][1] as string).scenario).toBe(
      'inventory-horizontal-overflow',
    );
    expect(log.mock.calls[0].join(' ')).not.toContain(error.message);
  });

  it('preserves the assertion failure when the browser diagnostics fail', async () => {
    const error = new Error('original assertion');
    const evaluate = vi
      .fn()
      .mockRejectedValue(new Error('private browser detail'));
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(
      withFailureGeometry(
        { evaluate } as unknown as Page,
        'inventory-first-row',
        async () => {
          throw error;
        },
      ),
    ).rejects.toBe(error);
    expect(log).toHaveBeenCalledExactlyOnceWith(
      'bounded-failure-geometry unavailable',
      'inventory-first-row',
    );
  });

  it('does not inspect or log a successful assertion', async () => {
    const evaluate = vi.fn();
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    await withFailureGeometry(
      { evaluate } as unknown as Page,
      'cold-title-admission',
      async () => {},
    );
    expect(evaluate).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();
  });
});
