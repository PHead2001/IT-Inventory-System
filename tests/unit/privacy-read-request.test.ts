// @vitest-environment node
import { expect, it } from 'vitest';
import { isPrivacyGenerationRead } from '../e2e/privacy-read-request';

const request = (
  path = '/api/auth/privacy-read',
  body: unknown = { operation: 'read-generation' },
  method = 'POST',
) => ({
  url: () => `https://app.example${path}`,
  method: () => method,
  postDataJSON: () => body,
});
it('selects the independent HTTP generation read used by route-entry and focus verification', () => {
  expect(isPrivacyGenerationRead(request())).toBe(true);
});
it.each([
  request('/scan?mode=assign', []),
  request('/inventory/assets/id', []),
  request('/api/auth/privacy-read', {
    operation: 'verify-identity',
    expected: { actorId: 'original' },
  }),
  request('/api/auth/privacy-read', {
    operation: 'read-generation',
    business: 'inspection',
  }),
  request('/api/auth/privacy-read', []),
  request('/api/auth/privacy-read', null),
  request('/api/auth/privacy-read', {}, 'GET'),
])(
  'passes unrelated, legacy, identity and malformed requests through',
  (value) => {
    expect(isPrivacyGenerationRead(value)).toBe(false);
  },
);
it('passes invalid JSON through for ordinary endpoint rejection', () => {
  expect(
    isPrivacyGenerationRead({
      ...request(),
      postDataJSON: () => {
        throw new Error('Invalid JSON');
      },
    }),
  ).toBe(false);
});
