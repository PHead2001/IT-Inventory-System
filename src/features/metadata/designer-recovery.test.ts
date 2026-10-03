import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearAllDesignerRecovery,
  clearDesignerRecovery,
  completeDesignerNavigation,
  hasUnresolvedDesignerRecovery,
  readDesignerRecovery,
  writeDesignerRecovery,
} from './designer-recovery';

const id = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const entry = {
  memberId: id(1),
  categoryId: id(2),
  definition: { fields: [], layout: [] },
  savedDefinition: '{"fields":[],"layout":[]}',
  expectedDraftId: id(9),
  expectedDraftVersion: '3',
  expectedPublishedRevisionId: id(3),
};

describe('designer session recovery', () => {
  beforeEach(() => {
    clearAllDesignerRecovery();
    sessionStorage.clear();
  });
  it('scopes entries by member and category and keeps original version baselines', () => {
    expect(writeDesignerRecovery(entry)).toBe(true);
    expect(readDesignerRecovery(id(1), id(2)).item).toMatchObject(entry);
    expect(readDesignerRecovery(id(4), id(2)).item).toBeNull();
    expect(readDesignerRecovery(id(1), id(5)).item).toBeNull();
    clearDesignerRecovery(id(1), id(2));
    expect(readDesignerRecovery(id(1), id(2)).item).toBeNull();
  });
  it('completes an explicit discard only after the intended target mounts for the same actor', () => {
    writeDesignerRecovery({ ...entry, discardAfterCategoryId: id(8) });
    completeDesignerNavigation(id(4), id(8));
    completeDesignerNavigation(id(1), id(7));
    expect(readDesignerRecovery(id(1), id(2)).item).not.toBeNull();
    completeDesignerNavigation(id(1), id(8));
    expect(readDesignerRecovery(id(1), id(2)).item).toBeNull();
  });
  it('clears only designer keys on signout', () => {
    sessionStorage.setItem('unrelated', 'keep');
    writeDesignerRecovery(entry);
    clearAllDesignerRecovery();
    expect(readDesignerRecovery(id(1), id(2)).item).toBeNull();
    expect(sessionStorage.getItem('unrelated')).toBe('keep');
  });
  it('reports unavailable storage without throwing', () => {
    expect(writeDesignerRecovery(entry)).toBe(true);
    const write = vi
      .spyOn(Storage.prototype, 'setItem')
      .mockImplementation(() => {
        throw new Error('blocked');
      });
    expect(writeDesignerRecovery(entry)).toBe(false);
    write.mockRestore();
    expect(readDesignerRecovery(id(1), id(2)).item).toBeNull();
  });
  it('invalidates an older recovery snapshot when a newer edit exceeds the storage bound', () => {
    expect(writeDesignerRecovery(entry)).toBe(true);
    expect(
      writeDesignerRecovery({ ...entry, savedDefinition: 'x'.repeat(300_001) }),
    ).toBe(false);
    expect(readDesignerRecovery(id(1), id(2)).item).toBeNull();
  });
  it('retains the original draft identity when a replacement draft has the same version', () => {
    writeDesignerRecovery(entry);
    const recovered = readDesignerRecovery(id(1), id(2)).item;
    expect(recovered?.expectedDraftId).toBe(id(9));
    expect(recovered?.expectedDraftVersion).toBe('3');
  });
  it('retains staged additions and the immutable uncertain-save receipt in the scoped snapshot', () => {
    const staged = {
      ...entry,
      addition: {
        sectionId: id(8),
        tab: 'new' as const,
        datetimeDraft: { wall: '2026-03-08T02:30:00', zone: 'America/Chicago' },
        field: {
          id: id(7),
          type: 'datetime' as const,
          label: 'Unadded appointment',
          applies_to: ['asset' as const],
          required: false,
          rules: {},
          options: [],
          default: '2026-03-08T02:30:00',
        },
      },
      receipt: { key: 'original immutable payload', id: id(10) },
    };
    expect(writeDesignerRecovery(staged)).toBe(true);
    expect(readDesignerRecovery(id(1), id(2)).item).toEqual(staged);
    expect(readDesignerRecovery(id(4), id(2)).item).toBeNull();
  });
  it('preserves an already durable original command when redundant storage writes fail', () => {
    const pending = {
      ...entry,
      uncertainSave: true,
      receipt: { key: 'exact reviewed command', id: id(10) },
    };
    expect(writeDesignerRecovery(pending)).toBe(true);
    const write = vi
      .spyOn(Storage.prototype, 'setItem')
      .mockImplementation(() => {
        throw new Error('quota');
      });
    expect(
      writeDesignerRecovery({ ...pending, savedDefinition: 'changed' }),
    ).toBe(true);
    expect(
      writeDesignerRecovery({
        ...entry,
        savedDefinition: 'stale passive draft',
      }),
    ).toBe(true);
    expect(readDesignerRecovery(id(1), id(2))).toEqual({
      available: true,
      item: pending,
    });
    expect(hasUnresolvedDesignerRecovery()).toBe(true);
    write.mockRestore();
  });
  it('detects durable unknown commands before any designer mount even beside malformed recovery', () => {
    const snapshot = {
      ...entry,
      uncertainSave: true,
      receipt: { key: 'original command', id: id(10) },
    };
    writeDesignerRecovery(snapshot);
    const storageKey = sessionStorage.key(0)!;
    clearAllDesignerRecovery();
    sessionStorage.setItem('it-inventory:form-designer:v1:malformed', '{');
    sessionStorage.setItem(storageKey, JSON.stringify(snapshot));
    expect(hasUnresolvedDesignerRecovery()).toBe(true);
    clearAllDesignerRecovery();
    expect(hasUnresolvedDesignerRecovery()).toBe(false);
  });
  it('keeps a non-durable command immutable in memory and isolated by actor and environment', () => {
    const pending = {
      ...entry,
      uncertainSave: true,
      receipt: { key: 'exact payload including review_token', id: id(10) },
    };
    const write = vi
      .spyOn(Storage.prototype, 'setItem')
      .mockImplementation(() => {
        throw new Error('quota');
      });
    expect(writeDesignerRecovery(pending)).toBe(false);
    pending.receipt.key = 'caller changed its copy';
    expect(readDesignerRecovery(id(1), id(2))).toMatchObject({
      available: false,
      item: { receipt: { key: 'exact payload including review_token' } },
    });
    expect(readDesignerRecovery(id(4), id(2)).item).toBeNull();
    const oldEnvironment = process.env.NEXT_PUBLIC_SUPABASE_URL;
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://other-environment.example';
    expect(readDesignerRecovery(id(1), id(2)).item).toBeNull();
    if (oldEnvironment === undefined)
      delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    else process.env.NEXT_PUBLIC_SUPABASE_URL = oldEnvironment;
    expect(hasUnresolvedDesignerRecovery()).toBe(true);
    clearAllDesignerRecovery();
    expect(hasUnresolvedDesignerRecovery()).toBe(false);
    expect(readDesignerRecovery(id(1), id(2)).item).toBeNull();
    write.mockRestore();
  });
});
