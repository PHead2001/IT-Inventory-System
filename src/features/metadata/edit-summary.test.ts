import { describe, expect, it } from 'vitest';
import { editSummary, normalizeEditIntent } from './edit-summary';
import type { MetadataDefinition } from './contracts';
const id = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const baseline = {
  id: id(1),
  categoryId: id(2),
  categoryName: 'Parts',
  name: 'Cable',
  description: null,
  manufacturer: 'Maker',
  model: null,
  version: 1,
  archived: false,
  itemCode: null,
  reorderThreshold: null,
  customValues: {
    [id(4)]: { value: false, validated_revision_id: id(3) },
    [id(5)]: { value: 5, validated_revision_id: id(3) },
    [id(6)]: { value: 'Retained hidden answer', validated_revision_id: id(3) },
  },
};
const definition: MetadataDefinition = {
  fields: [
    {
      id: id(4),
      type: 'boolean',
      label: 'Checked',
      applies_to: ['quantity'],
      required: false,
      rules: {},
      options: [],
    },
    {
      id: id(5),
      type: 'integer',
      label: 'Count',
      applies_to: ['quantity'],
      required: false,
      rules: {},
      options: [],
    },
    {
      id: id(6),
      type: 'short_text',
      label: 'Hidden',
      applies_to: ['quantity'],
      required: false,
      rules: {},
      options: [],
    },
  ],
  layout: [],
};
describe('metadata changed-value summary', () => {
  it('treats a case-only asset tag correction as a real display edit', () => {
    const shared = {
      id: baseline.id,
      name: baseline.name,
      categoryId: baseline.categoryId,
      categoryName: baseline.categoryName,
      description: baseline.description,
      manufacturer: baseline.manufacturer,
      model: baseline.model,
      version: baseline.version,
    };
    const asset = {
      ...shared,
      status: 'active' as const,
      assetTag: '000Ab/C.02',
      serialNumber: null,
    };
    const intent = normalizeEditIntent('asset', {
      asset_id: id(1),
      expected_version: 1,
      category_id: id(2),
      expected_published_revision_id: id(3),
      name: baseline.name,
      manufacturer: baseline.manufacturer,
      asset_tag: '  000aB/C.02  ',
      custom_patch: { set: {}, unset: [] },
    })!;
    expect(intent.asset_tag).toBe('000aB/C.02');
    expect(
      editSummary({
        baseline: asset,
        intent,
        definition,
        categories: [],
        timeZone: { timeZone: 'UTC', fallback: false },
      }),
    ).toContainEqual({
      key: 'asset_tag',
      label: 'Asset tag',
      before: '000Ab/C.02',
      after: '000aB/C.02',
    });
  });
  it('shows only normalized changed core and custom values including No, zero and explicit clearing', () => {
    const intent = normalizeEditIntent('quantity', {
      item_id: id(1),
      expected_version: 1,
      category_id: id(2),
      expected_published_revision_id: id(3),
      name: ' Cable ',
      manufacturer: '',
      custom_patch: { set: { [id(4)]: true, [id(5)]: 0 }, unset: [] },
    })!;
    const rows = editSummary({
      baseline,
      intent,
      definition,
      categories: [],
      timeZone: { timeZone: 'UTC', fallback: false },
    });
    expect(rows.map((row) => [row.label, row.before, row.after])).toEqual([
      ['Manufacturer', 'Maker', 'Cleared (unanswered)'],
      ['Checked', 'No', 'Yes'],
      ['Count', '5', '0'],
    ]);
    const cleared = editSummary({
      baseline,
      intent: { ...intent, custom_patch: { set: {}, unset: [id(4)] } },
      definition,
      categories: [],
      timeZone: { timeZone: 'UTC', fallback: false },
    });
    expect(cleared.find((row) => row.key === id(4))?.after).toBe(
      'Cleared (unanswered)',
    );
    expect(rows.find((row) => row.label === 'Hidden')).toBeUndefined();
  });
  it('preserves historical paths and distinguishes empty text/unanswered and long complete data', () => {
    const tree = {
      ...definition,
      fields: [
        {
          ...definition.fields[2],
          type: 'hierarchical_select' as const,
          options: [
            { id: id(7), label: 'Parent', parent_id: null, active: true },
            { id: id(8), label: 'Child', parent_id: id(7), active: true },
          ],
        },
      ],
    };
    const old = {
      ...baseline,
      customValues: { [id(6)]: { value: id(8), validated_revision_id: id(3) } },
      customDisplay: {
        [id(6)]: {
          value: id(8),
          validated_revision_id: id(3),
          label: 'Original',
          field_type: 'hierarchical_select',
          option_paths: [['Old parent', 'Old child']],
          legacy: false,
        },
      },
    };
    const rows = editSummary({
      baseline: old,
      intent: { custom_patch: { set: { [id(6)]: id(7) }, unset: [] } },
      definition: tree,
      categories: [],
      timeZone: { timeZone: 'UTC', fallback: false },
    });
    expect(rows[0]).toMatchObject({
      before: 'Old parent / Old child',
      after: 'Parent',
    });
    const long = 'long '.repeat(1000);
    expect(
      editSummary({
        baseline,
        intent: {
          description: long,
          custom_patch: { set: { [id(6)]: '' }, unset: [] },
        },
        definition,
        categories: [],
        timeZone: { timeZone: 'UTC', fallback: false },
      })[0].after,
    ).toBe(long);
  });
  it('keeps calendar dates unchanged and renders changed instants with established zone and retained microseconds', () => {
    const dateDefinition = {
      ...definition,
      fields: [{ ...definition.fields[2], type: 'datetime' as const }],
    };
    const original = {
      ...baseline,
      customValues: {
        [id(6)]: {
          value: '2026-11-01T06:30:00.000001Z',
          validated_revision_id: id(3),
        },
      },
    };
    const rows = editSummary({
      baseline: original,
      intent: {
        custom_patch: {
          set: { [id(6)]: '2026-11-01T07:30:00.000002Z' },
          unset: [],
        },
      },
      definition: dateDefinition,
      categories: [],
      timeZone: { timeZone: 'America/Chicago', fallback: false },
    });
    expect(rows[0].before).toContain(
      '01:30:00.000001 UTC-05:00 (America/Chicago)',
    );
    expect(rows[0].after).toContain(
      '01:30:00.000002 UTC-06:00 (America/Chicago)',
    );
  });
});
