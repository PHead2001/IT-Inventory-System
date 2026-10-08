import type { Locator } from '@playwright/test';

/** Creation and editing intentionally use different decision/action wording. */
export function metadataReviewButton(scope: Locator) {
  return scope.getByRole('button', {
    name: /^(Review quantity item|Review individual asset|Review details)$/,
  });
}

export function metadataSaveButton(scope: Locator) {
  return scope.getByRole('button', {
    name: /^(Add quantity item|Add individual asset|Confirm save)$/,
  });
}
