import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearAllDesignerRecovery,
  clearDesignerRecovery,
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
});
