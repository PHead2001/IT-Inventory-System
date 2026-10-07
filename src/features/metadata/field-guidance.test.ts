import { expect, it } from 'vitest';
import { fieldTypes } from './contracts';
import {
  fieldPlaceholder,
  requiredFieldHelp,
  validationIssueSummary,
} from './field-guidance';
import type { MetadataField } from './field-value-validation';
it('keeps type-specific required semantics, neutral examples and zero/one/many grammar aligned', () => {
  for (const type of fieldTypes) {
    const field: MetadataField = {
      id: 'test',
      label: 'Test',
      type,
      required: true,
      applies_to: ['quantity'],
      rules: {},
      options: [],
    };
    const help = requiredFieldHelp(field);
    expect(help.length).toBeGreaterThan(0);
    if (type !== 'boolean') expect(help).not.toContain('checkbox');
    if (type === 'multi_select')
      expect(help).toContain('explicitly choose none');
    if (['integer', 'decimal', 'currency'].includes(type))
      expect(fieldPlaceholder(field)).not.toMatch(/\d/);
  }
  expect([0, 1, 2].map(validationIssueSummary)).toEqual([
    'No answers need attention.',
    '1 answer needs attention.',
    '2 answers need attention.',
  ]);
});
