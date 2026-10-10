// @vitest-environment node
import type { Page } from '@playwright/test';
import { describe, expect, it, vi } from 'vitest';
import { openRecordTask } from '../e2e/record-task-controls';

vi.mock('@playwright/test', () => ({
  expect: (locator: { isVisible: () => Promise<boolean> }) => ({
    toBeVisible: async () => expect(await locator.isVisible()).toBe(true),
  }),
}));

/** Model locator readiness and disclosure semantics, not browser rendering. */
function taskPage({
  deferred = false,
  group = 'none',
  formOpen = false,
  missing = false,
}: {
  deferred?: boolean;
  group?: 'none' | 'closed' | 'open';
  formOpen?: boolean;
  missing?: boolean;
} = {}) {
  let attached = !deferred && !missing;
  let ready = !deferred;
  let expanded = group === 'open';
  let mounted = formOpen;
  const summary = {
    click: vi.fn(async () => {
      if (group === 'none' || !attached) throw new Error('No summary');
      // An ordinary click waits for the parent privacy gate to release.
      ready = true;
      expanded = !expanded;
    }),
  };
  const section = {
    count: vi.fn(async () => (attached && group !== 'none' ? 1 : 0)),
    getAttribute: vi.fn(async (name: string) => {
      expect(name).toBe('open');
      return expanded ? '' : null;
    }),
    locator: vi.fn((selector: string) => {
      expect(selector).toBe('summary');
      return summary;
    }),
  };
  const launcher = {
    isVisible: vi.fn(
      async () => attached && ready && (group === 'none' || expanded),
    ),
    waitFor: vi.fn(async (options: { state: string }) => {
      expect(options).toEqual({ state: 'attached' });
      if (missing) throw new Error('Launcher never attached');
      attached = true;
    }),
    locator: vi.fn((selector: string) => {
      expect(selector).toBe('xpath=ancestor::details[1]');
      return section;
    }),
    click: vi.fn(async (...options: unknown[]) => {
      expect(options).toEqual([]);
      if (!attached) throw new Error('Launcher never attached');
      if (group !== 'none' && !expanded)
        throw new Error('Launcher is collapsed');
      // Playwright's ordinary click waits for actionability after attachment.
      ready = true;
      mounted = true;
    }),
  };
  const form = { isVisible: vi.fn(async () => mounted) };
  const task = {
    getByRole: vi.fn((role: string, options: object) => {
      expect(role).toBe('button');
      expect(options).toEqual({
        name: 'Edit details',
        exact: true,
        includeHidden: true,
      });
      return launcher;
    }),
  };
  const page = {
    getByRole: vi.fn((role: string, options: { includeHidden?: boolean }) => {
      if (role === 'form') return form;
      expect(role).toBe('region');
      // A privacy-hidden region must remain addressable while it is withheld.
      if (deferred && !options.includeHidden) {
        attached = false;
        launcher.waitFor.mockImplementation(async () => {
          throw new Error('Hidden region excluded');
        });
      }
      return task;
    }),
  } as unknown as Page;
  return { page, launcher, section, summary, form };
}

describe('openRecordTask locator contract', () => {
  it('waits for a deferred primary launcher without inventing a disclosure', async () => {
    const fixture = taskPage({ deferred: true });
    await expect(
      openRecordTask(fixture.page, 'Edit quantity metadata'),
    ).resolves.toBe(fixture.form);
    expect(fixture.launcher.waitFor).toHaveBeenCalledWith({
      state: 'attached',
    });
    expect(fixture.summary.click).not.toHaveBeenCalled();
    expect(fixture.launcher.click).toHaveBeenCalledExactlyOnceWith();
  });

  it('opens a genuinely closed secondary group with an ordinary summary click', async () => {
    const fixture = taskPage({ group: 'closed' });
    await openRecordTask(fixture.page, 'Edit asset metadata');
    expect(fixture.summary.click).toHaveBeenCalledExactlyOnceWith();
    expect(fixture.launcher.click).toHaveBeenCalledExactlyOnceWith();
  });

  it('does not collapse a group that is already open', async () => {
    const fixture = taskPage({ group: 'open' });
    await openRecordTask(fixture.page, 'Edit asset metadata');
    expect(fixture.summary.click).not.toHaveBeenCalled();
    expect(fixture.launcher.click).toHaveBeenCalledExactlyOnceWith();
  });

  it('keeps an open group expanded while its parent waits for readiness', async () => {
    const fixture = taskPage({ deferred: true, group: 'open' });
    await openRecordTask(fixture.page, 'Edit asset metadata');
    expect(fixture.summary.click).not.toHaveBeenCalled();
    expect(fixture.launcher.click).toHaveBeenCalledExactlyOnceWith();
  });

  it('returns an already visible form without reopening its launcher', async () => {
    const fixture = taskPage({ formOpen: true });
    await expect(
      openRecordTask(fixture.page, 'Edit asset metadata'),
    ).resolves.toBe(fixture.form);
    expect(fixture.launcher.waitFor).not.toHaveBeenCalled();
    expect(fixture.launcher.click).not.toHaveBeenCalled();
    expect(fixture.summary.click).not.toHaveBeenCalled();
  });

  it('fails for a missing launcher without trying an unrelated summary', async () => {
    const fixture = taskPage({ missing: true });
    await expect(
      openRecordTask(fixture.page, 'Edit asset metadata'),
    ).rejects.toThrow('Launcher never attached');
    expect(fixture.summary.click).not.toHaveBeenCalled();
    expect(fixture.launcher.click).not.toHaveBeenCalled();
  });
});
