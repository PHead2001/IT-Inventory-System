import type { Request } from '@playwright/test';

/** Defer the canonical generation read without intercepting business actions. */
export function isPrivacyGenerationRead(
  request: Pick<Request, 'url' | 'method' | 'postDataJSON'>,
) {
  if (
    request.method() !== 'POST' ||
    new URL(request.url()).pathname !== '/api/auth/privacy-read'
  )
    return false;
  try {
    const body: unknown = request.postDataJSON();
    return (
      body !== null &&
      typeof body === 'object' &&
      !Array.isArray(body) &&
      Object.keys(body).length === 1 &&
      'operation' in body &&
      body.operation === 'read-generation'
    );
  } catch {
    return false;
  }
}
