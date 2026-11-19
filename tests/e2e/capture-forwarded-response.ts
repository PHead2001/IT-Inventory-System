import type { Route } from '@playwright/test';

/** Read the real upstream bytes before delivery can retire their document.
 * Fulfil the unchanged server response, including its headers and cookies. */
export async function captureForwardedResponse(
  route: Pick<Route, 'fetch' | 'fulfill'>,
) {
  const response = await route.fetch();
  const body = await response.body();
  const status = response.status();
  await route.fulfill({ response, body });
  return { status, body };
}
