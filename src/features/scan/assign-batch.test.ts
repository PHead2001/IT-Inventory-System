import { beforeEach, expect, it, vi } from 'vitest';
import {
  batchKey,
  batchTotals,
  BATCH_BYTES,
  emptyBatch,
  parseBatch,
  readBatch,
  storeBatch,
  clearBatch,
  terminalFits,
  assignmentEpoch,
  adoptAssignmentScope,
  invalidateAssignmentPrivacy,
  reconcileInterruptedLookups,
  type BatchEntry,
} from './assign-batch';
const id = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const scope = {
  actor: id(1),
  origin: 'https://preview.example',
  backend: 'https://isolated.supabase.co',
};
const context = {
  siteId: id(2),
  siteName: 'HQ',
  reference: 'TICKET',
  sourceId: '',
};
const entry: BatchEntry = {
  id: id(3),
  status: 'success',
  name: 'Adapters',
  kind: 'quantity',
  entityId: id(4),
  identifier: 'SKU',
  units: 2,
  source: 'Red',
  context,
  requestId: id(5),
  eventId: id(6),
  message: '',
};
beforeEach(() => {
  sessionStorage.clear();
  vi.restoreAllMocks();
});
it('CAS retains exact scoped snapshots, rejects intervening writes, and verifies End clearing', () => {
  const value = { ...emptyBatch(scope), context, entries: [entry] };
  const raw = storeBatch(value, null);
  expect(raw).not.toBeNull();
  expect(readBatch(scope).value).toEqual(value);
  expect(readBatch({ ...scope, actor: id(9) }).value).toBeNull();
  expect(
    parseBatch(raw!, { ...scope, backend: 'https://other.example' }),
  ).toBeNull();
  expect(storeBatch({ ...value, finished: true }, null)).toBeNull();
  expect(clearBatch(scope, null)).toBe(false);
  expect(clearBatch(scope, raw)).toBe(true);
});
it('counts server confirmed asset identities separately from quantity assignments and units', () => {
  const assets = {
    ...entry,
    id: id(10),
    requestId: id(11),
    eventId: id(12),
    kind: 'asset' as const,
    units: 1,
  };
  const pending = {
    ...entry,
    id: id(13),
    requestId: null,
    eventId: null,
    status: 'pending' as const,
  };
  const uncertain = {
    ...entry,
    id: id(14),
    requestId: id(15),
    eventId: null,
    status: 'uncertain' as const,
  };
  expect(batchTotals([entry, assets, pending, uncertain])).toEqual({
    assets: 1,
    assetAssignments: 1,
    quantityAssignments: 1,
    units: 2,
    failed: 0,
    skipped: 0,
    pending: 1,
    uncertain: 1,
  });
});
it('reconciles only requestless orphaned reads while retaining historical, submitted and terminal identities', () => {
  const orphan = {
    ...entry,
    id: id(20),
    requestId: null,
    eventId: null,
    status: 'pending' as const,
  };
  const retained = { ...orphan, id: id(21) };
  const submitted = { ...orphan, id: id(22), requestId: id(23) };
  const uncertain = {
    ...submitted,
    id: id(24),
    requestId: id(25),
    status: 'uncertain' as const,
  };
  const failed = { ...orphan, id: id(26), status: 'failed' as const };
  const historical = {
    candidate: {
      kind: 'quantity' as const,
      id: entry.entityId!,
      path: '/inventory/quantity/' + entry.entityId,
      name: entry.name,
      identifier: entry.identifier,
      version: '1',
      status: 'active' as const,
      currentSite: null,
      sources: [],
    },
    sourceId: '',
    units: '1',
    entryId: retained.id,
  };
  const batch = {
    ...emptyBatch(scope),
    context,
    entries: [orphan, retained, submitted, uncertain, failed, entry],
    historical,
  };
  const reconciled = reconcileInterruptedLookups(batch);
  expect(reconciled.entries[0]).toMatchObject({
    id: orphan.id,
    status: 'skipped',
    requestId: null,
    eventId: null,
    message:
      'Inspection interrupted before confirmation. Nothing was submitted.',
  });
  expect(reconciled.historical).toBe(historical);
  for (let index = 1; index < batch.entries.length; index++)
    expect(reconciled.entries[index]).toBe(batch.entries[index]);
  expect(batch.entries[0]).toBe(orphan);
  expect(reconcileInterruptedLookups(reconciled)).toBe(reconciled);
});
it('counts two legitimate asset events for one asset without conflating event replay or asset identity', () => {
  const first = { ...entry, kind: 'asset' as const, units: 1 };
  const second = { ...first, id: id(20), requestId: id(21), eventId: id(22) };
  expect(batchTotals([first, second])).toMatchObject({
    assetAssignments: 2,
    assets: 1,
    units: 0,
    quantityAssignments: 0,
  });
  expect(
    parseBatch(
      JSON.stringify({
        ...emptyBatch(scope),
        entries: [first, { ...first, id: id(20) }],
      }),
      scope,
    ),
  ).toBeNull();
});
it('rejects corrupt, unsupported, overcapacity, duplicated request/event and oversized UTF8 envelopes without eviction', () => {
  const value = { ...emptyBatch(scope), context, entries: [entry] };
  for (const bad of [
    { ...value, version: 2 },
    { ...value, extra: true },
    { ...value, entries: [entry, { ...entry, id: id(9) }] },
    {
      ...value,
      entries: Array.from({ length: 201 }, (_, n) => ({
        ...entry,
        id: id(n + 100),
      })),
    },
    { ...value, entries: [{ ...entry, status: 'success', eventId: null }] },
  ])
    expect(parseBatch(JSON.stringify(bad), scope)).toBeNull();
  const oversized = JSON.stringify({
    ...value,
    context: { ...context, reference: '😀'.repeat(BATCH_BYTES / 4) },
  });
  expect(parseBatch(oversized, scope)).toBeNull();
  sessionStorage.setItem(batchKey(scope), oversized);
  expect(readBatch(scope).blocked).toBe(true);
  expect(sessionStorage.getItem(batchKey(scope))).toBe(oversized);
  expect(
    terminalFits({
      ...value,
      historical: {
        candidate: {
          kind: 'quantity',
          id: id(4),
          path: '/inventory/quantity/' + id(4),
          name: 'Adapter',
          identifier: null,
          version: '1',
          status: 'active',
          currentSite: null,
          sources: Array.from({ length: 4000 }, () => ({
            id: id(7),
            name: '😀'.repeat(200),
            active: true,
            quantity: 1,
          })),
        },
        sourceId: id(7),
        units: '1',
        entryId: id(3),
      },
    }),
  ).toBe(false);
});
it('invalidation works without a mounted scan screen and preserves uncertainty until authoritative logout', () => {
  adoptAssignmentScope(scope);
  const captured = assignmentEpoch();
  storeBatch({ ...emptyBatch(scope), context, entries: [entry] }, null);
  sessionStorage.setItem('inventory-assign-v1:old', 'exact unresolved command');
  adoptAssignmentScope({ ...scope, actor: id(8) });
  expect(assignmentEpoch()).toBeGreaterThan(captured);
  expect(readBatch(scope).value).toBeNull();
  expect(sessionStorage.getItem('inventory-assign-v1:old')).toBe(
    'exact unresolved command',
  );
  invalidateAssignmentPrivacy(true);
  expect(sessionStorage.getItem('inventory-assign-v1:old')).toBeNull();
});
it('handles unavailable storage without crashing or claiming persistence', () => {
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
    throw new Error('blocked');
  });
  expect(readBatch(scope).blocked).toBe(true);
  expect(storeBatch(emptyBatch(scope), null)).toBeNull();
  expect(clearBatch(scope, null)).toBe(false);
  expect(() => invalidateAssignmentPrivacy(false)).not.toThrow();
});
it('retains a cleanup tombstone across transient logout removal failure and cannot read old context on same-scope adoption', () => {
  adoptAssignmentScope(scope);
  storeBatch({ ...emptyBatch(scope), context, entries: [entry] }, null);
  sessionStorage.setItem('inventory-assign-v1:old', 'original');
  const nativeRemove = Storage.prototype.removeItem;
  let failed = false;
  vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(function (
    this: Storage,
    key,
  ) {
    if (!failed && key === batchKey(scope)) {
      failed = true;
      throw new Error('transient');
    }
    nativeRemove.call(this, key);
  });
  expect(invalidateAssignmentPrivacy(true)).toBe(false);
  expect(sessionStorage.getItem('inventory-assign-cleanup-v1')).toBe('all');
  adoptAssignmentScope(scope);
  expect(readBatch(scope).value).toBeNull();
  expect(sessionStorage.getItem('inventory-assign-v1:old')).toBeNull();
  expect(sessionStorage.getItem('inventory-assign-cleanup-v1')).toBeNull();
});

it('clears all private data despite new-marker quota failure, including after a module reset', async () => {
  adoptAssignmentScope(scope);
  storeBatch({ ...emptyBatch(scope), context, entries: [entry] }, null);
  sessionStorage.setItem('inventory-assign-v1:old', 'original');
  const nativeSet = Storage.prototype.setItem;
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (
    this: Storage,
    key,
    value,
  ) {
    if (key === 'inventory-assign-cleanup-v1')
      throw new DOMException('full', 'QuotaExceededError');
    nativeSet.call(this, key, value);
  });
  expect(invalidateAssignmentPrivacy(true)).toBe(true);
  vi.restoreAllMocks();
  vi.resetModules();
  const fresh = await import('./assign-batch');
  fresh.adoptAssignmentScope(scope);
  expect(fresh.readBatch(scope).value).toBeNull();
  expect(sessionStorage.getItem('inventory-assign-v1:old')).toBeNull();
});
it('persists strongest cleanup in existing scope when quota and one removal fail across reload', async () => {
  adoptAssignmentScope(scope);
  storeBatch({ ...emptyBatch(scope), context, entries: [entry] }, null);
  sessionStorage.setItem('inventory-assign-v1:old', 'original');
  const nativeSet = Storage.prototype.setItem;
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (
    this: Storage,
    key,
    value,
  ) {
    if (key === 'inventory-assign-cleanup-v1')
      throw new DOMException('full', 'QuotaExceededError');
    nativeSet.call(this, key, value);
  });
  const nativeRemove = Storage.prototype.removeItem;
  vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(function (
    this: Storage,
    key,
  ) {
    if (key === batchKey(scope)) throw new Error('transient');
    nativeRemove.call(this, key);
  });
  expect(invalidateAssignmentPrivacy(true)).toBe(false);
  expect(sessionStorage.getItem('inventory-assign-scope-v1')).toBe(
    'cleanup:all',
  );
  expect(sessionStorage.getItem('inventory-assign-v1:old')).toBeNull();
  // Even a later weaker request cannot downgrade the retained all-cleanup mode.
  expect(invalidateAssignmentPrivacy(false)).toBe(false);
  expect(sessionStorage.getItem('inventory-assign-scope-v1')).toBe(
    'cleanup:all',
  );
  vi.restoreAllMocks();
  vi.resetModules();
  const fresh = await import('./assign-batch');
  fresh.adoptAssignmentScope(scope);
  expect(fresh.readBatch(scope).value).toBeNull();
  expect(sessionStorage.getItem('inventory-assign-cleanup-v1')).toBeNull();
});
