import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const actions = vi.hoisted(() => ({
  acknowledgeLogoutPrivacyGeneration: vi.fn(),
}));
vi.mock('@/lib/auth/actions', () => actions);
vi.mock('@/lib/auth/logout-transport', () => actions);
import { verifyTabPrivacy } from './privacy-cleanup';
import { logoutAcknowledgementKey } from '@/lib/auth/privacy-barrier';
import {
  readAuthoritativeCleanupRevision,
  invalidateAssignmentPrivacy,
} from '@/features/scan/assign-batch';
const first = '00000000-0000-4000-8000-000000000001';
const second = '00000000-0000-4000-8000-000000000002';
const batch = 'inventory-assign-batch-v1:private';
const command = 'inventory-assign-v1:private';
const labels = 'it-inventory-label-queue:v1:private';
const designer = 'it-inventory:form-designer:v1:retired-owner';
const current = { status: 'valid', generation: first } as const;
function seed() {
  sessionStorage.setItem(batch, 'private ticket');
  sessionStorage.setItem(command, 'exact uncertain command');
  sessionStorage.setItem(labels, 'private label');
  sessionStorage.setItem(designer, 'exact uncertain designer request');
}
beforeEach(() => {
  sessionStorage.clear();
  vi.resetAllMocks();
  actions.acknowledgeLogoutPrivacyGeneration.mockResolvedValue({
    status: 'match',
  });
});
afterEach(() => vi.restoreAllMocks());
it('recovers after the first storage read throws before any tombstone can be written', async () => {
  seed();
  const get = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
    throw new Error('blocked');
  });
  expect((await verifyTabPrivacy(current, () => true, true)).ready).toBe(false);
  get.mockRestore();
  expect(sessionStorage.getItem('inventory-assign-cleanup-v1')).toBeNull();
  expect(sessionStorage.getItem(command)).toBe('exact uncertain command');
  // Re-import simulates loss of all module-local cleanup authority on a hard reload.
  vi.resetModules();
  const reloaded = await import('./privacy-cleanup');
  expect(await reloaded.verifyTabPrivacy(current, () => true)).toEqual({
    ready: true,
    generation: first,
  });
  // Cleanup remains authoritative after the original form owner was destroyed.
  for (const key of [batch, command, labels, designer])
    expect(sessionStorage.getItem(key)).toBeNull();
  expect(sessionStorage.getItem(logoutAcknowledgementKey)).toBe(first);
});
it('cleans each independent tab even after the first has acknowledged the retained generation', async () => {
  seed();
  expect((await verifyTabPrivacy(current, () => true)).ready).toBe(true);
  const tabOneAcknowledgement = sessionStorage.getItem(
    logoutAcknowledgementKey,
  );
  // A distinct tab has independent sessionStorage but reads the same retained server cookie.
  sessionStorage.clear();
  seed();
  expect((await verifyTabPrivacy(current, () => true)).ready).toBe(true);
  expect(tabOneAcknowledgement).toBe(first);
  expect(sessionStorage.getItem(command)).toBeNull();
  expect(actions.acknowledgeLogoutPrivacyGeneration).toHaveBeenCalledTimes(2);
});
it('restarts verified cleanup when a late acknowledgement sees a newer generation', async () => {
  seed();
  actions.acknowledgeLogoutPrivacyGeneration.mockImplementationOnce(
    async () => {
      sessionStorage.setItem(command, 'new generation private command');
      return { status: 'changed', generation: second };
    },
  );
  expect(await verifyTabPrivacy(current, () => true)).toEqual({
    ready: true,
    generation: second,
  });
  expect(sessionStorage.getItem(command)).toBeNull();
  expect(sessionStorage.getItem(logoutAcknowledgementKey)).toBe(second);
  expect(actions.acknowledgeLogoutPrivacyGeneration.mock.calls).toEqual([
    [first],
    [second],
  ]);
});
it('a matching tab acknowledgement cannot override a pending all-cleanup marker', async () => {
  seed();
  sessionStorage.setItem(logoutAcknowledgementKey, first);
  sessionStorage.setItem('inventory-assign-cleanup-v1', 'all');
  expect((await verifyTabPrivacy(current, () => true)).ready).toBe(true);
  expect(sessionStorage.getItem(command)).toBeNull();
});
it('reports only completed authoritative wipes, including a retry under the same generation', async () => {
  sessionStorage.setItem(logoutAcknowledgementKey, first);
  const before = readAuthoritativeCleanupRevision();
  await verifyTabPrivacy(current, () => true);
  expect(readAuthoritativeCleanupRevision()).toBe(before);
  expect(invalidateAssignmentPrivacy(false)).toBe(true);
  expect(readAuthoritativeCleanupRevision()).toBe(before);
  sessionStorage.setItem('inventory-assign-cleanup-v1', 'private');
  await verifyTabPrivacy(current, () => true);
  expect(readAuthoritativeCleanupRevision()).toBe(before);
  seed();
  sessionStorage.setItem('inventory-assign-cleanup-v1', 'all');
  const remove = Storage.prototype.removeItem;
  const denied = vi
    .spyOn(Storage.prototype, 'removeItem')
    .mockImplementation(function (this: Storage, key) {
      if (key === labels) return;
      remove.call(this, key);
    });
  expect((await verifyTabPrivacy(current, () => true)).ready).toBe(false);
  expect(readAuthoritativeCleanupRevision()).toBe(before);
  denied.mockRestore();
  expect((await verifyTabPrivacy(current, () => true)).ready).toBe(true);
  expect(readAuthoritativeCleanupRevision()).toBe(before + 1);
  await verifyTabPrivacy(current, () => true);
  expect(readAuthoritativeCleanupRevision()).toBe(before + 1);
});
it.each(['throw', 'silent', 'readback'] as const)(
  'keeps auth blocked after acknowledgement %s failure and only retries cleanup',
  async (mode) => {
    seed();
    const set = Storage.prototype.setItem;
    const get = Storage.prototype.getItem;
    let wrote = false;
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (
      this: Storage,
      key,
      value,
    ) {
      if (key === logoutAcknowledgementKey) {
        wrote = true;
        if (mode === 'throw') throw new Error('blocked');
        if (mode === 'silent') return;
      }
      set.call(this, key, value);
    });
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(function (
      this: Storage,
      key,
    ) {
      if (key === logoutAcknowledgementKey && wrote && mode === 'readback')
        throw new Error('blocked');
      return get.call(this, key);
    });
    expect((await verifyTabPrivacy(current, () => true)).ready).toBe(false);
    expect(sessionStorage.getItem(command)).toBeNull();
    vi.restoreAllMocks();
    expect((await verifyTabPrivacy(current, () => true)).ready).toBe(true);
  },
);
it.each(['invalid', 'unavailable'] as const)(
  'preserves all private recovery for %s server reminder',
  async (status) => {
    seed();
    expect((await verifyTabPrivacy({ status }, () => true)).ready).toBe(false);
    expect(sessionStorage.getItem(command)).toBe('exact uncertain command');
    expect(sessionStorage.getItem(designer)).toBe(
      'exact uncertain designer request',
    );
    expect(actions.acknowledgeLogoutPrivacyGeneration).not.toHaveBeenCalled();
  },
);
it('absence, a forged query and a private marker do not authorize uncertain recovery erasure', async () => {
  seed();
  window.history.replaceState(null, '', '/login?password=updated');
  sessionStorage.setItem('inventory-assign-cleanup-v1', 'private');
  expect(await verifyTabPrivacy({ status: 'absent' }, () => true)).toEqual({
    ready: true,
    generation: 'absent',
  });
  expect(sessionStorage.getItem(command)).toBe('exact uncertain command');
  expect(sessionStorage.getItem(designer)).toBe(
    'exact uncertain designer request',
  );
});
it.each(['ack', 'marker'] as const)(
  'fails closed for invalid %s storage without deleting private data',
  async (kind) => {
    seed();
    sessionStorage.setItem(
      kind === 'ack' ? logoutAcknowledgementKey : 'inventory-assign-cleanup-v1',
      'garbage',
    );
    expect((await verifyTabPrivacy(current, () => true)).ready).toBe(false);
    expect(sessionStorage.getItem(command)).toBe('exact uncertain command');
  },
);
it('ignores an asynchronous acknowledgement after unmount or a newer request', async () => {
  seed();
  let active = true;
  actions.acknowledgeLogoutPrivacyGeneration.mockImplementationOnce(
    async () => {
      active = false;
      return { status: 'match' };
    },
  );
  expect((await verifyTabPrivacy(current, () => active)).ready).toBe(false);
  expect(sessionStorage.getItem(logoutAcknowledgementKey)).toBeNull();
});
