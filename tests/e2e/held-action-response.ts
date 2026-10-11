import type { Page, Request } from '@playwright/test';

/** Observe the held action itself; equal business arguments are not identity. */
export async function waitForHeldActionResponse(page: Page, request: Request) {
  const response = await page.waitForResponse(
    (candidate) => candidate.request() === request,
    { timeout: 10_000 },
  );
  if (!response.ok())
    throw new Error(`Held action returned HTTP ${response.status()}`);
  // Next can deliver the action result before the Flight stream reaches EOF.
  // The caller must assert the resulting business state, not transport closure.
  return response;
}
