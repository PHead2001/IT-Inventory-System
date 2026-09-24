import { describe, expect, it } from 'vitest';
import { formEnvelope, metadataDefinition } from './contracts';

const ids = {
  category: '00000000-0000-4000-8000-000000000001',
  revision: '00000000-0000-4000-8000-000000000002',
  field: 'a0000000-0000-4000-8000-000000000003',
  section: 'c0000000-0000-4000-8000-000000000004',
  name: '00000000-0000-4000-8000-000000000005',
  categoryControl: '00000000-0000-4000-8000-000000000006',
  fieldControl: '00000000-0000-4000-8000-000000000007',
  option: 'b0000000-0000-4000-8000-000000000008',
};
const definition = () => ({
  fields: [
    {
      id: ids.field,
      type: 'single_select',
      label: 'Choice',
      applies_to: ['quantity'],
      required: false,
      rules: {},
      options: [{ id: ids.option, label: 'Option', active: true }],
    },
  ],
  layout: [
    {
      id: ids.section,
      label: 'Details',
      controls: [
        { id: ids.name, kind: 'builtin', builtin: 'name', width: 12 },
        {
          id: ids.categoryControl,
          kind: 'builtin',
          builtin: 'category_id',
          width: 12,
        },
        {
          id: ids.fieldControl,
          kind: 'field',
          field_id: ids.field,
          width: 'Auto',
        },
      ],
    },
  ],
});
const envelope = (published_definition: unknown) => ({
  category_id: ids.category,
  published_revision_id: ids.revision,
  published_number: '1',
  published_definition,
  draft_id: null,
  draft_version: null,
  draft_definition: null,
});

describe('published metadata wire contract', () => {
  it('parses valid canonical IDs and kind-specific controls', () => {
    expect(formEnvelope.safeParse(envelope(definition())).success).toBe(true);
  });

  it('rejects UUID spelling that the mutation patch cannot address', () => {
    for (const change of [
      (value: ReturnType<typeof definition>) => {
        value.fields[0].id = ids.field.toUpperCase();
      },
      (value: ReturnType<typeof definition>) => {
        value.fields[0].options[0].id = ids.option.toUpperCase();
      },
      (value: ReturnType<typeof definition>) => {
        value.layout[0].id = ids.section.toUpperCase();
      },
      (value: ReturnType<typeof definition>) => {
        value.layout[0].controls[2].field_id = ids.field.toUpperCase();
      },
    ]) {
      const value = definition();
      change(value);
      expect(metadataDefinition.safeParse(value).success).toBe(false);
      expect(formEnvelope.safeParse(envelope(value)).success).toBe(false);
    }
  });

  it('rejects control properties that are not valid for their kind', () => {
    for (const extras of [
      { help: null },
      { field_id: 'garbage' },
      { field_id: ids.field },
    ]) {
      const value = definition();
      Object.assign(value.layout[0].controls[0], extras);
      expect(formEnvelope.safeParse(envelope(value)).success).toBe(false);
    }
    const value = definition();
    Object.assign(value.layout[0].controls[2], { builtin: 'name' });
    expect(formEnvelope.safeParse(envelope(value)).success).toBe(false);
  });
});
