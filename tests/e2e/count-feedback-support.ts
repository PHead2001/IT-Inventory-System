import type { Locator, Page } from '@playwright/test';

export function countFeedback(scope: Page | Locator, phrase: string) {
  const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return scope
    .locator('[data-count-visual]')
    .filter({ hasText: new RegExp(`^${escaped}$`) });
}
