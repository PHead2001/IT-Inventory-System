import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  editBaseline,
  parseEdit,
  readEdit,
  writeEdit,
  openEditSession,
  removeEdit,
  type EditEnvelope,
} from './edit-recovery';
import { initialCore } from './reconciliation';
const id = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const baseline = {
  id: id(1),
  categoryId: id(2),
  categoryName: 'Parts',
  name: 'Cable',
  description: null,
  manufacturer: null,
  model: null,
  version: 1,
  archived: false,
  itemCode: null,
  reorderThreshold: null,
};
const draft = (): EditEnvelope => ({
  version: 1,
  scope: {
    origin: 'https://inventory.test',
    backend: 'https://backend.test',
    actor: id(3),
    kind: 'quantity',
    entity: id(1),
    task: 'metadata',
  },
  instance: id(4),
  sequence: 0,
  status: 'editing',
  baseline,
  command: null,
  completedRequestId: null,
  inputs: {
    core: { ...initialCore(baseline, []), name: 'Edited' },
    cleanCore: initialCore(baseline, []),
    custom: { [id(5)]: false, [id(6)]: 0, [id(7)]: '' },
    touched: [id(5), id(6), id(7), id(8)],
    reviewedForms: {},
    priorForms: {},
    dateTimes: {},
    openingQuantity: '1',
    openingReason: '',
    openingReference: '',
  },
});
const submitted = (previous: EditEnvelope): EditEnvelope => ({
  ...previous,
  sequence: previous.sequence + 1,
  status: 'submitted',
  command: {
    operation: 'quantity_update_v2',
    requestId: id(9),
    expectedActorId: id(3),
    payload: {
      item_id: previous.scope.entity,
      expected_version: 1,
      category_id: id(2),
      name: 'Edited',
      expected_published_revision_id: id(10),
      custom_patch: { set: {}, unset: [] },
    },
  },
});
describe('existing metadata recovery', () => {
  beforeEach(() => sessionStorage.clear());
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });
  it('round trips exact false, zero, empty, cleared input and original baseline', () => {
    const envelope = draft();
    expect(writeEdit(envelope, null)).toBe(true);
    expect(readEdit(envelope.scope).envelope).toEqual(envelope);
    expect(readEdit({ ...envelope.scope, actor: id(11) }).envelope).toBeNull();
    expect(
      readEdit({ ...envelope.scope, backend: 'https://other.test' }).envelope,
    ).toBeNull();
    expect(readEdit({ ...envelope.scope, entity: id(11) }).envelope).toBeNull();
  });
  it('whitelists reconciliation metadata and removes unrelated record and answer attributes', () => {
    expect(
      editBaseline({
        ...baseline,
        customValues: {
          [id(5)]: {
            value: false,
            validated_revision_id: id(10),
            secret: 'excluded',
          },
        },
        signedUrl: 'excluded',
      } as typeof baseline),
    ).toEqual({
      ...baseline,
      customValues: {
        [id(5)]: { value: false, validated_revision_id: id(10) },
      },
    });
  });
  it('retains submitted identity through navigation and rejects stale edits/discard', () => {
    const editing = draft(),
      pending = submitted(editing);
    expect(writeEdit(editing, null)).toBe(true);
    expect(writeEdit(pending, editing)).toBe(true);
    expect(readEdit(editing.scope).envelope?.command).toEqual(pending.command);
    expect(writeEdit({ ...editing, sequence: 1 }, editing)).toBe(false);
    expect(
      writeEdit(
        {
          ...pending,
          status: 'discarded',
          sequence: 2,
          inputs: null,
          command: null,
        },
        pending,
      ),
    ).toBe(false);
    expect(writeEdit({ ...editing, sequence: 2 }, pending, id(11))).toBe(false);
    expect(writeEdit({ ...editing, sequence: 2 }, pending, id(9))).toBe(true);
  });
  it('requires matching acknowledged receipt and makes old writers unable to replace terminal or newer instances', () => {
    const editing = draft(),
      pending = submitted(editing);
    writeEdit(editing, null);
    writeEdit(pending, editing);
    const saved: EditEnvelope = {
      ...pending,
      sequence: 2,
      status: 'saved',
      inputs: null,
      command: null,
      completedRequestId: id(9),
    };
    expect(writeEdit(saved, pending, id(11))).toBe(false);
    expect(writeEdit(saved, pending, id(9))).toBe(true);
    expect(writeEdit(saved, pending, id(9))).toBe(true);
    expect(writeEdit(saved, pending, id(11))).toBe(false);
    expect(writeEdit({ ...editing, sequence: 3 }, saved)).toBe(false);
    const fresh = { ...draft(), instance: id(11) };
    expect(writeEdit(fresh, saved)).toBe(true);
    expect(writeEdit({ ...editing, sequence: 1 }, editing)).toBe(false);
  });
  it('reclaims only verified terminal tasks after more than 32 completed edits, and invalidates stale pristine and terminal mounts', () => {
    const pristine = draft();
    const stalePristine = openEditSession(pristine.scope);
    const owner = openEditSession(pristine.scope);
    expect(writeEdit(pristine, null, undefined, owner)).toBe(true);
    const pending = submitted(pristine);
    expect(writeEdit(pending, pristine, undefined, owner)).toBe(true);
    const saved: EditEnvelope = {
      ...pending,
      sequence: 2,
      status: 'saved',
      inputs: null,
      command: null,
      completedRequestId: id(9),
    };
    expect(writeEdit(saved, pending, id(9), owner)).toBe(true);
    const staleTerminal = openEditSession(saved.scope);
    for (let n = 20; n < 65; n++) {
      const editing: EditEnvelope = {
        ...draft(),
        scope: { ...pristine.scope, entity: id(n) },
        baseline: { ...baseline, id: id(n) },
        instance: id(n + 100),
      };
      expect(writeEdit(editing, null)).toBe(true);
      expect(
        writeEdit(
          { ...editing, sequence: 1, status: 'discarded', inputs: null },
          editing,
        ),
      ).toBe(true);
      expect(sessionStorage.length).toBeLessThanOrEqual(32);
    }
    expect(readEdit(pristine.scope).envelope).toBeNull();
    expect(writeEdit(pristine, null, undefined, stalePristine)).toBe(false);
    expect(
      writeEdit(
        { ...pristine, instance: id(999) },
        saved,
        undefined,
        staleTerminal,
      ),
    ).toBe(false);
    const fresh = openEditSession(pristine.scope);
    expect(
      writeEdit({ ...pristine, instance: id(998) }, null, undefined, fresh),
    ).toBe(true);
  });
  it('never evicts editing, submitted, invalid or mis-keyed data to gain a slot', () => {
    const editing = draft(),
      pending = submitted(editing);
    writeEdit(editing, null);
    writeEdit(pending, editing);
    const pendingRaw = sessionStorage.getItem(sessionStorage.key(0)!);
    for (let n = 20; n < 49; n++) {
      const next = {
        ...draft(),
        scope: { ...editing.scope, entity: id(n) },
        baseline: { ...baseline, id: id(n) },
      };
      expect(writeEdit(next, null)).toBe(true);
    }
    sessionStorage.setItem('inventory-metadata-edit-v1:invalid', '{');
    sessionStorage.setItem(
      'inventory-metadata-edit-v1:wrong-key',
      JSON.stringify({ ...editing, status: 'discarded', inputs: null }),
    );
    const next = {
      ...draft(),
      scope: { ...editing.scope, entity: id(99) },
      baseline: { ...baseline, id: id(99) },
    };
    expect(sessionStorage.length).toBe(32);
    expect(writeEdit(next, null)).toBe(false);
    expect(readEdit(editing.scope).envelope?.status).toBe('submitted');
    expect(sessionStorage.getItem(sessionStorage.key(0)!)).toBe(pendingRaw);
    expect(sessionStorage.getItem('inventory-metadata-edit-v1:invalid')).toBe(
      '{',
    );
  });
  it.each([4, 16])(
    'reclaims terminal bytes below the instance limit and respects a %s MiB browser quota without deleting drafts',
    (quotaMiB) => {
      const values = new Map<string, string>();
      const quota = quotaMiB * 1024 * 1024;
      vi.stubGlobal('sessionStorage', {
        get length() {
          return values.size;
        },
        key: (index: number) => [...values.keys()][index] ?? null,
        getItem: (key: string) => values.get(key) ?? null,
        removeItem: (key: string) => values.delete(key),
        setItem: (key: string, value: string) => {
          const total = [...values].reduce(
            (sum, [entryKey, raw]) =>
              sum +
              (entryKey === key ? 0 : new TextEncoder().encode(raw).length),
            new TextEncoder().encode(value).length,
          );
          if (total > quota) throw new DOMException('Quota exceeded');
          values.set(key, value);
        },
      });
      const protectedDraft = draft();
      expect(writeEdit(protectedDraft, null)).toBe(true);
      for (let n = 20; n < 30; n++) {
        const next: EditEnvelope = {
          ...draft(),
          scope: { ...protectedDraft.scope, entity: id(n) },
          baseline: {
            ...baseline,
            id: id(n),
            customValues: Object.fromEntries(
              Array.from({ length: 6 }, (_, i) => [
                id(200 + i),
                { value: 'x'.repeat(250000), validated_revision_id: id(10) },
              ]),
            ),
          },
        };
        expect(writeEdit(next, null)).toBe(true);
        expect(
          writeEdit(
            { ...next, sequence: 1, status: 'discarded', inputs: null },
            next,
          ),
        ).toBe(true);
      }
      expect(values.size).toBeLessThan(10);
      expect(readEdit(protectedDraft.scope).envelope).toEqual(protectedDraft);
      expect(
        [...values.values()].reduce(
          (sum, raw) => sum + new TextEncoder().encode(raw).length,
          0,
        ),
      ).toBeLessThanOrEqual(Math.min(quota, 8 * 1024 * 1024));
    },
  );
  it('refuses to discard unknown requests or a stale editing snapshot', () => {
    const editing = draft();
    const session = openEditSession(editing.scope);
    expect(writeEdit(editing, null, undefined, session)).toBe(true);
    const pending = submitted(editing);
    expect(writeEdit(pending, editing, undefined, session)).toBe(true);
    expect(removeEdit(pending, session)).toBe(false);
    expect(removeEdit(editing, session)).toBe(false);
    expect(readEdit(editing.scope).envelope).toEqual(pending);
  });
  it('compares terminal raw data again before reclamation and protects a newer submitted writer', () => {
    const editing = draft();
    writeEdit(editing, null);
    writeEdit(
      { ...editing, sequence: 1, status: 'discarded', inputs: null },
      editing,
    );
    const terminalKey = sessionStorage.key(0)!;
    for (let n = 20; n < 51; n++) {
      const next = {
        ...draft(),
        scope: { ...editing.scope, entity: id(n) },
        baseline: { ...baseline, id: id(n) },
      };
      expect(writeEdit(next, null)).toBe(true);
    }
    const originalGet = Storage.prototype.getItem;
    const originalSet = Storage.prototype.setItem;
    const pending = submitted({ ...editing, instance: id(999) });
    let reads = 0;
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(function (
      this: Storage,
      key: string,
    ) {
      if (key === terminalKey && ++reads === 2)
        originalSet.call(this, key, JSON.stringify(pending));
      return originalGet.call(this, key);
    });
    const next = {
      ...draft(),
      scope: { ...editing.scope, entity: id(99) },
      baseline: { ...baseline, id: id(99) },
    };
    expect(writeEdit(next, null)).toBe(false);
    expect(readEdit(editing.scope).envelope).toEqual(pending);
    expect(sessionStorage.length).toBe(32);
  });
  it.each(['actor', 'entity', 'kind'] as const)(
    'rejects mismatched %s and invalid/oversized envelopes',
    (key) => {
      const envelope = draft();
      expect(
        parseEdit(JSON.stringify(envelope), {
          ...envelope.scope,
          [key]: key === 'kind' ? 'asset' : id(11),
        }),
      ).toBeNull();
      expect(parseEdit('{', envelope.scope)).toBeNull();
      expect(
        parseEdit(
          JSON.stringify({ ...envelope, unexpected: true }),
          envelope.scope,
        ),
      ).toBeNull();
      expect(
        parseEdit(
          JSON.stringify({
            ...submitted(envelope),
            baseline: { ...baseline, version: 2 },
          }),
          envelope.scope,
        ),
      ).toBeNull();
      expect(
        parseEdit(' '.repeat(2 * 1024 * 1024 + 1), envelope.scope),
      ).toBeNull();
    },
  );
});
