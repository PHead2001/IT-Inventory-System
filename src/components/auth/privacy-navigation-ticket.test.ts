import { expect, it } from 'vitest';
import {
  createPrivacyNavigationTickets,
  type PrivacyNavigationCapture,
} from './privacy-navigation-ticket';

const capture = (provider = Symbol()): PrivacyNavigationCapture => ({
  provider,
  destination: '/inventory?a=1&a=2',
  source: '/inventory',
  binding: 'original-server-binding',
  generation: 'absent',
  serverRevision: 'absent',
  revision: 0,
  revocation: 1,
  callbacks: 2,
  request: 3,
});
it('settles superseded, cancelled and completed waits once and never verifies a retired target', async () => {
  const store = createPrivacyNavigationTickets();
  const first = store.begin(capture());
  const second = store.begin(capture());
  await first.promise;
  expect(first.status).toBe('retired');
  expect(store.markVerified(first)).toBe(false);
  expect(store.snapshot()).toBe(second);
  expect(store.markVerified(second)).toBe(true);
  let settled = false;
  void second.promise.then(() => {
    settled = true;
  });
  await Promise.resolve();
  expect(settled).toBe(false);
  expect(store.settleVerified(second)).toBe(true);
  await second.promise;
  expect(store.markVerified(second)).toBe(false);
  expect(store.settleVerified(second)).toBe(false);
  store.retire();
  expect(store.snapshot()).toBeNull();
  expect(second.status).toBe('retired');
});
it('captures immutable authority and retired provider cleanup cannot settle its replacement', async () => {
  const store = createPrivacyNavigationTickets();
  const original = capture();
  const first = store.begin(original);
  original.binding = 'changed';
  expect(first.capture.binding).toBe('original-server-binding');
  const replacement = store.begin(capture());
  store.retire(first.capture.provider);
  expect(store.snapshot()).toBe(replacement);
  expect(replacement.status).toBe('pending');
  store.retire(replacement.capture.provider);
  await replacement.promise;
  expect(store.snapshot()).toBeNull();
});
