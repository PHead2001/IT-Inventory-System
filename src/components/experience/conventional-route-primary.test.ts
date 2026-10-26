import { expect, it } from 'vitest';
import { supportsConventionalRoutePrimary } from './conventional-route-primary';
it.each([
  '/inventory',
  '/history',
  '/locations',
  '/locations/ITC-S1A',
  '/inventory/quantity/e8a80571-5e19-4455-9ba4-5cc2b8186a60',
  '/inventory/assets/e8a80571-5e19-4455-9ba4-5cc2b8186a60',
])('allows successful conventional family %s', (path) =>
  expect(supportsConventionalRoutePrimary(path)).toBe(true),
);
it.each([
  '/room',
  '/dashboard',
  '/inventory/quantity/new',
  '/inventory/assets/new',
  '/inventory/quantity/not-uuid',
  '/history/events/quantity/one',
  '/locations/a/b',
  '/locations/%2f',
  '/locations/%',
  '/locations/%2E%2E',
  '/locations/%49TC-S1A',
])('rejects unsupported or noncanonical family %s', (path) =>
  expect(supportsConventionalRoutePrimary(path)).toBe(false),
);
