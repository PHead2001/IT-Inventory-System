import { describe, expect, it } from 'vitest';
import {
  compatibleSchema,
  initialCore,
  initialCustom,
  reconcileMetadata,
} from './reconciliation';
import type { QuantityItem } from '@/features/inventory/contracts-ui';
import type { MetadataDefinition } from './contracts';

const definition: MetadataDefinition = {
  fields: [
    {
      id: 'flag',
      label: 'Inspected',
      type: 'boolean',
      required: false,
      applies_to: ['quantity'],
      options: [],
      rules: {},
    },
  ],
  layout: [],
};
const item: QuantityItem = {
  id: 'item',
  name: 'Cable',
  categoryId: 'parts',
  categoryName: 'Parts',
  description: null,
  manufacturer: null,
  model: null,
  version: 1,
  archived: false,
  itemCode: null,
  reorderThreshold: null,
  customValues: {
    flag: { value: false, validated_revision_id: 'form' },
    legacy: { value: 0, validated_revision_id: 'old' },
  },
};
const draft = initialCore(item, []),
  custom = initialCustom(item.customValues);
describe('metadata three-way intent reconciliation', () => {
  it('preserves latest untouched fields, legacy values, and independent custom edits', () => {
    const latest = {
      ...item,
      manufacturer: 'Latest maker',
      version: 2,
      customValues: {
        ...item.customValues,
        legacy: { value: '', validated_revision_id: 'old' },
      },
    };
    const result = reconcileMetadata(
      item,
      { ...draft, name: 'My cable' },
      { ...custom, flag: true },
      latest,
      definition,
    );
    expect(result.core).toMatchObject({
      name: 'My cable',
      manufacturer: 'Latest maker',
    });
    expect(result.custom).toEqual({ flag: true, legacy: '' });
    expect(result.touched).toEqual(['flag']);
    expect(result.conflicts).toEqual([]);
  });
  it('ignores fields edited then reverted and converged edits', () => {
    const latest = { ...item, name: 'New name', version: 2 };
    expect(
      reconcileMetadata(item, draft, custom, latest, definition).core.name,
    ).toBe('New name');
    expect(
      reconcileMetadata(
        item,
        { ...draft, name: 'New name' },
        custom,
        latest,
        definition,
      ).conflicts,
    ).toEqual([]);
  });
  it('requires a per-field decision for overlapping core values', () => {
    const latest = { ...item, name: 'Other name', version: 2 };
    expect(
      reconcileMetadata(
        item,
        { ...draft, name: 'Mine' },
        custom,
        latest,
        definition,
      ).conflicts,
    ).toEqual([
      expect.objectContaining({
        key: 'name',
        label: 'Name',
        latest: 'Other name',
        mine: 'Mine',
      }),
    ]);
    expect(
      reconcileMetadata(
        item,
        { ...draft, name: 'Mine' },
        custom,
        latest,
        definition,
        { name: 'latest' },
      ).core.name,
    ).toBe('Other name');
    expect(
      reconcileMetadata(
        item,
        { ...draft, name: 'Mine' },
        custom,
        latest,
        definition,
        { name: 'mine' },
      ).core.name,
    ).toBe('Mine');
  });
  it.each([false, 0, '', []])(
    'distinguishes explicit clearing from a concurrent set to %j',
    (value) => {
      const latest = {
        ...item,
        version: 2,
        customValues: {
          ...item.customValues,
          flag: { value, validated_revision_id: 'form' },
        },
      };
      const result = reconcileMetadata(
        { ...item, customValues: {} },
        draft,
        {},
        latest,
        definition,
      );
      expect(result.custom.flag).toEqual(value);
      expect(result.touched).toEqual([]);
      const cleared = reconcileMetadata(
        item,
        draft,
        { legacy: 0 },
        latest,
        definition,
      );
      expect(Object.hasOwn(cleared.custom, 'flag')).toBe(false);
      expect(cleared.touched).toContain('flag');
      expect(cleared.conflicts.length).toBe(value === false ? 0 : 1);
    },
  );
  it('treats choice arrays atomically and retains immutable field IDs despite identical labels', () => {
    const baseline = {
      ...item,
      customValues: { flag: { value: ['a'], validated_revision_id: 'form' } },
    };
    const latest = {
      ...baseline,
      version: 2,
      customValues: {
        flag: { value: ['a', 'c'], validated_revision_id: 'form' },
      },
    };
    const result = reconcileMetadata(
      baseline,
      draft,
      { flag: ['a', 'b'] },
      latest,
      definition,
    );
    expect(result.conflicts[0].key).toBe('custom:flag');
    expect(result.custom.flag).toEqual(['a', 'b']);
  });
  it('adopts an untouched complete category snapshot but groups category and custom intent when dirty', () => {
    const latest = { ...item, categoryId: 'other', version: 2 };
    expect(
      reconcileMetadata(item, draft, custom, latest, definition).conflicts,
    ).toEqual([]);
    const dirty = reconcileMetadata(
      item,
      { ...draft, name: 'Mine' },
      custom,
      latest,
      definition,
    );
    expect(dirty.conflicts).toEqual([
      expect.objectContaining({ key: 'category_id', dependency: true }),
    ]);
    const changedAnswers = {
      ...item,
      version: 2,
      customValues: {
        ...item.customValues,
        flag: { value: true, validated_revision_id: 'form' },
      },
    };
    expect(
      reconcileMetadata(
        item,
        { ...draft, category_id: 'other' },
        custom,
        changedAnswers,
        definition,
      ).conflicts[0].dependency,
    ).toBe(true);
  });
  it('blocks lifecycle transitions and archived quantity edits while permitting stable retired metadata', () => {
    expect(
      reconcileMetadata(
        item,
        draft,
        custom,
        { ...item, archived: true },
        definition,
      ).lifecycleChanged,
    ).toBe(true);
  });
  it('recognizes converged datetime instants while retaining microsecond precision', () => {
    const schema = {
      ...definition,
      fields: [{ ...definition.fields[0], type: 'datetime' as const }],
    };
    const baseline = {
      ...item,
      customValues: {
        flag: {
          value: '2026-10-01T12:00:00.123456Z',
          validated_revision_id: 'form',
        },
      },
    };
    const latest = {
      ...baseline,
      version: 2,
      customValues: {
        flag: {
          value: '2026-10-01T13:00:00.123456Z',
          validated_revision_id: 'form',
        },
      },
    };
    const result = reconcileMetadata(
      baseline,
      draft,
      { flag: '2026-10-01T08:00:00.123456-05:00' },
      latest,
      schema,
    );
    expect(result.conflicts).toEqual([]);
    expect(result.touched).toEqual([]);
    expect(result.custom.flag).toBe('2026-10-01T13:00:00.123456Z');
    expect(
      reconcileMetadata(
        baseline,
        draft,
        { flag: '2026-10-01T08:00:00.123457-05:00' },
        latest,
        schema,
      ).conflicts,
    ).toHaveLength(1);
  });
  it('accepts layout/label changes but rejects rules, required, option identity, type, default or applicability changes', () => {
    expect(
      compatibleSchema(definition, {
        ...definition,
        layout: [{ id: 'section', label: 'New layout', controls: [] }],
        fields: [{ ...definition.fields[0], label: 'Reviewed' }],
      }),
    ).toBe(true);
    for (const change of [
      { required: true },
      { type: 'integer' as const },
      { default: false },
      { applies_to: ['asset'] as ('asset' | 'quantity')[] },
      { rules: { min: 0 } },
      { options: [{ id: 'option', label: 'Choice', active: true }] },
    ])
      expect(
        compatibleSchema(definition, {
          ...definition,
          fields: [{ ...definition.fields[0], ...change }],
        }),
      ).toBe(false);
  });
});
