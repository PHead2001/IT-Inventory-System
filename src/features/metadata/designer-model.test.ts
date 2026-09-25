import { describe, expect, it } from 'vitest';
import type { MetadataDefinition } from './contracts';
import {
  canReparent,
  designerIssues,
  moveControl,
  optionPath,
} from './designer-model';

const id = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const definition = (): MetadataDefinition => ({
  fields: [
    {
      id: id(1),
      type: 'hierarchical_select',
      label: 'Location type',
      applies_to: ['asset'],
      required: true,
      rules: {},
      options: [
        { id: id(11), label: 'Root', active: true },
        { id: id(12), label: 'Child', active: true, parent_id: id(11) },
        { id: id(13), label: 'Grandchild', active: true, parent_id: id(12) },
      ],
    },
  ],
  layout: [
    {
      id: id(2),
      label: 'Details',
      controls: [
        { id: id(3), kind: 'builtin', builtin: 'name', width: 12 },
        { id: id(4), kind: 'builtin', builtin: 'category_id', width: 12 },
        { id: id(5), kind: 'field', field_id: id(1), width: 6 },
      ],
    },
    { id: id(6), label: 'More', controls: [] },
  ],
});

describe('form designer model', () => {
  it('moves controls across sections in document order without losing identities', () => {
    const before = definition();
    const after = moveControl(before, id(5), id(6), 0);
    expect(after.layout[0].controls.map((control) => control.id)).toEqual([
      id(3),
      id(4),
    ]);
    expect(after.layout[1].controls.map((control) => control.id)).toEqual([
      id(5),
    ]);
    expect(before.layout[0].controls).toHaveLength(3);
  });
  it('rejects a hierarchy cycle, a missing parent and a path beyond 64 levels', () => {
    const options = definition().fields[0].options;
    expect(optionPath(options, id(13))).toBe('Root / Child / Grandchild');
    expect(canReparent(options, id(11), id(13))).toBe(false);
    expect(canReparent(options, id(12), id(99))).toBe(false);
    expect(canReparent(options, id(13), null)).toBe(true);
    const broken = options.map((option) =>
      option.id === id(12) ? { ...option, parent_id: id(99) } : option,
    );
    expect(optionPath(broken, id(12))).toBeNull();
    const deep = Array.from({ length: 65 }, (_, index) => ({
      id: id(index + 100),
      label: String(index),
      active: true,
      ...(index ? { parent_id: id(index + 99) } : {}),
    }));
    expect(optionPath(deep, id(164))).toBeNull();
  });
  it('includes the moved subtree height when enforcing the 64-level parent limit', () => {
    const chain = Array.from({ length: 63 }, (_, index) => ({
      id: id(index + 200),
      label: `Ancestor ${index}`,
      active: true,
      ...(index ? { parent_id: id(index + 199) } : {}),
    }));
    const moved = { id: id(300), label: 'Moved', active: true };
    const child = {
      id: id(301),
      label: 'Child',
      active: true,
      parent_id: moved.id,
    };
    expect(canReparent([...chain, moved, child], moved.id, chain[62].id)).toBe(
      false,
    );
    expect(canReparent([...chain, moved, child], moved.id, chain[61].id)).toBe(
      true,
    );
    expect(canReparent([...chain, moved, child], moved.id, null)).toBe(true);
  });
  it('allows saving a malformed semantic draft but reports publish blockers', () => {
    const draft = definition();
    draft.fields[0].label = '';
    draft.fields[0].options[1].parent_id = id(99);
    draft.layout[0].controls = draft.layout[0].controls.filter(
      (control) => control.kind !== 'field',
    );
    expect(designerIssues(draft)).toEqual(
      expect.arrayContaining([
        'A field needs a label.',
        'A field has an invalid option parent, cycle, or depth over 64.',
        'A required field must appear in the layout.',
      ]),
    );
  });
  it('compares datetime bounds by instant across offsets while keeping calendar dates ordered', () => {
    const draft = definition();
    draft.fields[0].type = 'datetime';
    draft.fields[0].options = [];
    draft.fields[0].rules = {
      min: '2026-09-25T10:00:00+02:00',
      max: '2026-09-25T09:30:00Z',
    };
    expect(designerIssues(draft)).not.toContain(
      'Location type has inverted date bounds.',
    );
    draft.fields[0].rules = {
      min: '2026-09-25T10:00:00Z',
      max: '2026-09-25T11:00:00+02:00',
    };
    expect(designerIssues(draft)).toContain(
      'Location type has inverted date bounds.',
    );
    draft.fields[0].type = 'date';
    draft.fields[0].rules = { min: '2026-09-26', max: '2026-09-25' };
    expect(designerIssues(draft)).toContain(
      'Location type has inverted date bounds.',
    );
  });
  it('enforces configured fractional precision and the database 24-digit bound cap', () => {
    const draft = definition();
    const field = draft.fields[0];
    field.type = 'decimal';
    field.options = [];
    field.rules = { precision: 2, min: '1.234' };
    expect(designerIssues(draft)).toContain(
      'Location type has invalid numeric bounds.',
    );
    field.rules = {
      precision: 2,
      min: '1.23',
      max: '9999999999999999999999.99',
    };
    expect(designerIssues(draft)).not.toContain(
      'Location type has invalid numeric bounds.',
    );
    field.rules.max = '99999999999999999999999.99';
    expect(designerIssues(draft)).toContain(
      'Location type has invalid numeric bounds.',
    );
    field.rules = { min: '0.123456' };
    expect(designerIssues(draft)).not.toContain(
      'Location type has invalid numeric bounds.',
    );
    field.rules.min = '0.1234567';
    expect(designerIssues(draft)).toContain(
      'Location type has invalid numeric bounds.',
    );
    field.type = 'currency';
    field.rules = { currencyCode: 'USD', precision: 0, min: '1.1' };
    expect(designerIssues(draft)).toContain(
      'Location type has invalid numeric bounds.',
    );
  });
  it('orders large numeric bounds exactly instead of rounding them through Number', () => {
    const draft = definition();
    const field = draft.fields[0];
    field.type = 'decimal';
    field.options = [];
    field.rules = {
      precision: 0,
      min: '999999999999999999999999',
      max: '999999999999999999999998',
    };
    expect(designerIssues(draft)).toContain(
      'Location type has invalid numeric bounds.',
    );
  });
});
