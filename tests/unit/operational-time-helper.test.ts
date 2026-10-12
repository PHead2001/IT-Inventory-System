// @vitest-environment node
import type { Locator } from '@playwright/test';
import { expect, it, vi } from 'vitest';
import { exactOperationalTime } from '../helpers/operational-time';

type Observed = {
  waitFor: (options: { state: string }) => Promise<void>;
  getAttribute?: (name: string) => Promise<string | null>;
  textContent?: () => Promise<string>;
};
vi.mock('@playwright/test', () => {
  const observedExpect = Object.assign(
    (value: unknown) =>
      value === null || typeof value !== 'object'
        ? expect(value)
        : {
            toBeVisible: () =>
              (value as Observed).waitFor({ state: 'visible' }),
            toHaveAttribute: async (name: string, expected: string) =>
              expect(await (value as Observed).getAttribute!(name)).toBe(
                expected,
              ),
            not: {
              toContainText: async (text: string) =>
                expect(await (value as Observed).textContent!()).not.toContain(
                  text,
                ),
            },
          },
    {
      poll: (read: () => Promise<string>) => ({
        toBe: async (expected: string) => expect(await read()).toBe(expected),
      }),
    },
  );
  return { expect: observedExpect };
});

/** A deferred history row appears only when its visible locator settles. */
function historyTime(relative: boolean) {
  let mounted = false;
  let opened = false;
  let clipboard = '';
  const instant = '2026-10-11T08:19:45.196996+00:00';
  const page = {
    context: () => ({ grantPermissions: vi.fn(async () => {}) }),
    evaluate: async (callback: () => unknown) => {
      if (callback.toString().includes('writeText')) clipboard = '';
      return clipboard;
    },
  };
  const exact = {
    waitFor: vi.fn(async () => {
      expect(opened).toBe(true);
    }),
    textContent: async () =>
      '11 Oct 2026, 01:19:45 UTC-07:00 (America/Los_Angeles)',
  };
  const disclosure = {
    page: () => page,
    evaluate: async () => opened,
    getAttribute: async () => (opened ? '' : null),
    textContent: exact.textContent,
    locator: () => ({ first: () => exact }),
    getByRole: () => ({
      click: vi.fn(async () => {
        clipboard = `Recorded instant: ${instant}`;
      }),
    }),
  };
  const summary = {
    count: vi.fn(async () => (mounted && relative ? 1 : 0)),
    locator: () => disclosure,
    focus: vi.fn(async () => {}),
    press: vi.fn(async () => {
      opened = true;
    }),
  };
  const time = {
    waitFor: vi.fn(async () => {
      mounted = true;
    }),
    locator: () => summary,
    getAttribute: async () => instant,
    page: () => page,
  };
  return { time, summary, exact };
}

it('waits for a deferred relative history row before opening its exact timestamp and checking the original instant copy', async () => {
  const fixture = historyTime(true);
  await expect(
    exactOperationalTime(fixture.time as unknown as Locator),
  ).resolves.toBe(fixture.exact);
  expect(fixture.summary.press).toHaveBeenCalledExactlyOnceWith('Enter');
});

it('returns an ordinary exact timestamp after it becomes visible without inventing a disclosure', async () => {
  const fixture = historyTime(false);
  await expect(
    exactOperationalTime(fixture.time as unknown as Locator),
  ).resolves.toBe(fixture.time);
  expect(fixture.time.waitFor).toHaveBeenCalledOnce();
  expect(fixture.summary.press).not.toHaveBeenCalled();
});
