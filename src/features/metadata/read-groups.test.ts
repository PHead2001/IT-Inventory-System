import { expect, it } from 'vitest';
import { metadataReadGroups } from './read-groups';
import type { MetadataDefinition } from './contracts';
it('follows current section/field order once and retains hidden, retired, excluded and source-category answers', () => {
  const values = Object.fromEntries(
    ['hidden', 'old', 'b', 'a', 'asset'].map((id) => [
      id,
      {
        value: id === 'a' ? false : id,
        validated_revision_id: 'old',
        label: `Historical ${id}`,
        field_type: 'short_text',
        option_paths: [],
        legacy: true,
      },
    ]),
  );
  const definition: MetadataDefinition = {
    fields: ['a', 'b', 'hidden', 'asset', 'new'].map((id) => ({
      id,
      label: `Current ${id}`,
      type: 'short_text',
      applies_to: id === 'asset' ? ['asset'] : ['quantity'],
      required: false,
      rules: {},
      options: [],
      default: 'new default',
    })),
    layout: [
      {
        id: 'first',
        label: 'First',
        controls: [
          { id: 'c1', kind: 'field', field_id: 'a', width: 12 },
          { id: 'c2', kind: 'field', field_id: 'b', width: 12 },
          { id: 'c3', kind: 'field', field_id: 'asset', width: 12 },
        ],
      },
      {
        id: 'hidden-section',
        label: 'Hidden',
        visible: false,
        controls: [{ id: 'c4', kind: 'field', field_id: 'hidden', width: 12 }],
      },
    ],
  };
  const before = structuredClone(values);
  const groups = metadataReadGroups(values, definition, 'quantity');
  expect(
    groups.map((group) => [group.label, group.entries.map(([id]) => id)]),
  ).toEqual([
    ['First', ['a', 'b']],
    ['Other retained values', ['hidden', 'old', 'asset']],
  ]);
  expect(groups[0].entries[0][1].label).toBe('Historical a');
  expect(groups[0].entries[0][1].value).toBe(false);
  expect(values).toEqual(before);
  expect(groups.flatMap((group) => group.entries)).toHaveLength(5);
});
