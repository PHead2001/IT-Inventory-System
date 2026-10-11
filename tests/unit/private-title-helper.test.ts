// @vitest-environment node
import type { Page } from '@playwright/test';
import { expect, it, vi } from 'vitest';
import { expectPrivateTitleExcluded } from '../helpers/private-title';

vi.mock('@playwright/test', () => ({
  expect: {
    poll: (read: () => Promise<string>) => ({
      not: {
        toContain: async (privateValue: string) =>
          expect(await read()).not.toContain(privateValue),
      },
    }),
  },
}));

function titlePage(titles: string[]) {
  return {
    title: vi.fn(async () => titles[0]),
    locator: vi.fn((selector: string) => {
      expect(selector).toBe('head title');
      return { allTextContents: vi.fn(async () => titles) };
    }),
  } as unknown as Page;
}

it('accepts multiple title nodes when none contains the private value', async () => {
  await expect(
    expectPrivateTitleExcluded(
      titlePage(['Quantity item · IT Inventory', 'IT Inventory']),
      'Private record name',
    ),
  ).resolves.toBeUndefined();
});

it('rejects a private value in a second title even when the effective browser title is safe', async () => {
  const page = titlePage([
    'Quantity item · IT Inventory',
    'Private record name · IT Inventory',
  ]);
  expect(await page.title()).not.toContain('Private record name');
  await expect(
    expectPrivateTitleExcluded(page, 'Private record name'),
  ).rejects.toThrow();
});

it('rejects an effective title containing the private value', async () => {
  await expect(
    expectPrivateTitleExcluded(
      titlePage(['Private record name · IT Inventory', 'IT Inventory']),
      'Private record name',
    ),
  ).rejects.toThrow();
});
