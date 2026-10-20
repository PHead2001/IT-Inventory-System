import { afterEach, describe, expect, it, vi } from 'vitest';
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
});

describe('bounded E2E failure geometry', () => {
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

  it('logs only after failure and rethrows the original assertion object', async () => {
    const error = new Error('original assertion');
    const evaluate = vi.fn(async (read: typeof readFailureGeometry) => read());
    const page = { evaluate } as unknown as Page;
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(
      withFailureGeometry(page, 'native-task-reentry', async () => {
        throw error;
      }),
    ).rejects.toBe(error);
    expect(evaluate).toHaveBeenCalledExactlyOnceWith(readFailureGeometry);
    expect(log).toHaveBeenCalledTimes(1);
    expect(log.mock.calls[0][0]).toBe('bounded-failure-geometry');
    expect(JSON.parse(log.mock.calls[0][1] as string).scenario).toBe(
      'native-task-reentry',
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
