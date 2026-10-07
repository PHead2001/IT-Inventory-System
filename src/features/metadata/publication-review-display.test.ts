import { describe, expect, it } from 'vitest';
import type { MetadataDefinition } from './contracts';
import {
  publicationReasonText,
  designerDragName,
} from './publication-review-display';
const field = {
  id: 'f',
  label: 'Port count',
  type: 'integer' as const,
  applies_to: ['quantity' as const],
  required: false,
  rules: { min: 0, max: 24 },
  options: [],
};
const before: MetadataDefinition = {
  fields: [field],
  layout: [
    {
      id: 's',
      label: 'Equipment',
      controls: [{ id: 'c', kind: 'field', field_id: 'f', width: 6 }],
    },
  ],
};
const after: MetadataDefinition = {
  fields: [{ ...field, required: true, rules: { min: 2, max: 16 } }],
  layout: [
    {
      id: 's',
      label: 'Equipment',
      applies_to: ['asset'],
      controls: before.layout[0].controls,
    },
  ],
};
const snapshot = {
  proposal: after,
  baseline: before,
  expectedPublishedRevisionId: 'r1',
};
describe('publication review names bound to submitted revisions', () => {
  it('distinguishes a new required field from a tightened existing requirement', () => {
    expect(
      publicationReasonText({ kind: 'required_tightened', id: 'f' }, snapshot),
    ).toContain('optional → required');
    expect(
      publicationReasonText(
        { kind: 'required_tightened', id: 'f' },
        { ...snapshot, baseline: { fields: [], layout: [] } },
      ),
    ).toContain('Add required field “Port count”');
  });
  it('names actual before/after rules and resolves applicability control IDs', () => {
    const rules = publicationReasonText(
      { kind: 'rules_tightened', id: 'f', affected_kinds: ['quantity'] },
      snapshot,
    );
    expect(rules).toContain('Minimum value: 0 → 2');
    expect(rules).toContain('Maximum value: 24 → 16');
    expect(rules).toContain('Affected types: Quantity items');
    const scope = publicationReasonText(
      { kind: 'applicability_narrowed', id: 'c', affected_kinds: ['quantity'] },
      snapshot,
    );
    expect(scope).toContain(
      '“Port count” in “Equipment”: Quantity item → No form type',
    );
    expect(scope).not.toContain('(c)');
  });
  it('names retired paths and removed section contents from the published baseline', () => {
    const baseline = structuredClone(before);
    baseline.fields[0].options = [
      { id: 'o1', label: 'USB', active: true },
      { id: 'o2', label: 'USB-C', active: true, parent_id: 'o1' },
    ];
    expect(
      publicationReasonText(
        { kind: 'choice_retired', field_id: 'f', id: 'o2' },
        { ...snapshot, baseline },
      ),
    ).toContain('Retire option “USB / USB-C” in “Port count”');
    expect(
      publicationReasonText({ kind: 'section_removed', id: 's' }, snapshot),
    ).toContain('Remove section “Equipment”: Port count → removed from form');
  });
  it('uses human section, field and position names for drag announcements', () => {
    expect(designerDragName(before, 'control:c')).toBe(
      '“Port count” in “Equipment”, position 1',
    );
    expect(designerDragName(before, 'section:s')).toBe(
      'section “Equipment”, position 1',
    );
    expect(designerDragName(before, 'empty:s')).toContain('Equipment');
  });
});
