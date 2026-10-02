import type { FieldType } from './contracts';
import { controlKinds, formKinds } from './effective-controls';
import type { Field, Control, Section } from './designer-model';

export const fieldTypeInfo: Record<
  FieldType,
  { name: string; purpose: string; example: string }
> = {
  short_text: {
    name: 'Short text',
    purpose: 'One line of text.',
    example: 'Manufacturer: Dell',
  },
  long_text: {
    name: 'Long text',
    purpose: 'Notes or descriptions with multiple lines.',
    example: 'Setup notes: Keep the spare adapter with this laptop.',
  },
  integer: {
    name: 'Whole number',
    purpose: 'A count without fractions.',
    example: 'Port count: 24',
  },
  decimal: {
    name: 'Decimal number',
    purpose: 'An exact number that can include fractions.',
    example: 'Cable length: 1.5',
  },
  boolean: {
    name: 'Checkbox',
    purpose: 'A question answered checked or unchecked.',
    example: 'Has USB-C?',
  },
  date: {
    name: 'Date',
    purpose: 'A calendar date without a time.',
    example: 'Inspection date: October 1, 2026',
  },
  datetime: {
    name: 'Date & time',
    purpose: 'A date and time in a stated timezone.',
    example: 'Maintenance starts: October 1, 2026 at 9:00 AM',
  },
  url: {
    name: 'Web link',
    purpose: 'A link to an HTTP or HTTPS page.',
    example: 'Support page: https://example.com/support',
  },
  currency: {
    name: 'Money',
    purpose: 'An exact amount in one currency.',
    example: 'Replacement cost: USD 49.95',
  },
  single_select: {
    name: 'Dropdown',
    purpose: 'Choose one option from a list.',
    example: 'Condition: Good',
  },
  multi_select: {
    name: 'Multiple choice',
    purpose: 'Choose more than one option.',
    example: 'Accessories: Charger, Dock',
  },
  hierarchical_select: {
    name: 'Nested dropdown',
    purpose: 'Choose through related levels of options.',
    example: 'Connection → USB → USB-C',
  },
};
export function fieldName(field?: Field) {
  return field ? field.label.trim() || 'Untitled field' : 'Missing field';
}
export function placementName(control: Control, fields: Field[]) {
  return control.kind === 'field'
    ? fieldName(fields.find((field) => field.id === control.field_id))
    : control.kind === 'help'
      ? 'Instructions'
      : control.builtin === 'category_id'
        ? 'Category'
        : (control.builtin ?? '')
            .replaceAll('_', ' ')
            .replace(/\b\w/g, (letter) => letter.toUpperCase());
}
export function scopeRestriction(
  definition: import('./contracts').MetadataDefinition,
  field: Field,
  kinds: typeof formKinds,
): string | null {
  for (const section of definition.layout)
    for (const control of section.controls.filter(
      (item) => item.field_id === field.id,
    )) {
      const restricted = kinds.filter(
        (kind) =>
          !(section.applies_to ?? formKinds).includes(kind) ||
          !(control.applies_to ?? formKinds).includes(kind),
      );
      if (restricted.length)
        return `${section.label || 'Untitled section'} restricts this field to ${controlKinds(definition, section, control).join(' and ') || 'no form type'}. Move it to a compatible section or adjust its existing restrictions in Advanced JSON recovery first.`;
    }
  return null;
}
export function additionRestriction(
  section: Section | undefined,
  kinds: typeof formKinds,
): string | null {
  if (!section) return 'Add a visible section first.';
  if (section.visible === false)
    return 'This section is hidden. Show it before adding a field.';
  if (kinds.some((kind) => !(section.applies_to ?? formKinds).includes(kind)))
    return 'This section does not show on every selected form type. Choose a compatible section or change Show on.';
  return null;
}
import { fieldValueError, instantMicros } from './field-value-validation';

export function settingRuleLabel(field: Field, key: string): string {
  return key === 'minLength'
    ? 'Minimum characters'
    : key === 'maxLength'
      ? 'Maximum characters'
      : key === 'maxSelections'
        ? 'Maximum selections'
        : field.type === 'date'
          ? key === 'min'
            ? 'Earliest allowed date'
            : 'Latest allowed date'
          : field.type === 'datetime'
            ? key === 'min'
              ? 'Earliest allowed date and time'
              : 'Latest allowed date and time'
            : field.type === 'currency'
              ? key === 'min'
                ? 'Minimum amount'
                : 'Maximum amount'
              : key === 'min'
                ? 'Minimum value'
                : 'Maximum value';
}

/** Authoring rules reuse answer validation and compare exact strings/instants. */
export function fieldSettingErrors(field: Field): Record<string, string> {
  const errors: Record<string, string> = {};
  const countKeys =
    field.type === 'multi_select'
      ? ['maxSelections']
      : ['short_text', 'long_text'].includes(field.type)
        ? ['minLength', 'maxLength']
        : [];
  for (const key of countKeys) {
    const value = field.rules[key];
    if (value === undefined) continue;
    const cap =
      key === 'maxSelections'
        ? 1000
        : field.type === 'short_text'
          ? 500
          : 10000;
    const minimum = key === 'maxSelections' ? 1 : 0;
    if (
      typeof value !== 'number' ||
      !Number.isInteger(value) ||
      value < minimum ||
      value > cap
    )
      errors[key] =
        `${settingRuleLabel(field, key)} must be a whole number from ${minimum} to ${cap}.`;
  }
  if (
    countKeys.length === 2 &&
    !errors.minLength &&
    !errors.maxLength &&
    field.rules.minLength !== undefined &&
    field.rules.maxLength !== undefined &&
    Number(field.rules.minLength) > Number(field.rules.maxLength)
  ) {
    errors.minLength = 'Minimum characters must be at most Maximum characters.';
    errors.maxLength =
      'Maximum characters must be at least Minimum characters.';
  }
  if (
    !['integer', 'decimal', 'currency', 'date', 'datetime'].includes(field.type)
  )
    return errors;
  const boundsField = {
    ...field,
    required: false,
    rules: {
      ...(field.rules.precision !== undefined
        ? { precision: field.rules.precision }
        : {}),
      ...(field.type === 'currency'
        ? { currencyCode: field.rules.currencyCode }
        : {}),
    },
  };
  const numericPattern = /^-?(0|[1-9]\d*)(\.\d{1,6})?$/;
  for (const key of ['min', 'max']) {
    if (field.rules[key] === undefined) continue;
    const raw = String(field.rules[key]);
    const value =
      field.type === 'currency'
        ? { amount: raw, currency: field.rules.currencyCode }
        : field.type === 'integer' && numericPattern.test(raw)
          ? Number(raw)
          : raw;
    const message = fieldValueError(boundsField, value);
    if (message) errors[key] = `${settingRuleLabel(field, key)}: ${message}`;
  }
  if (
    errors.min ||
    errors.max ||
    field.rules.min === undefined ||
    field.rules.max === undefined
  )
    return errors;
  const scale = (value: unknown) => {
    const raw = String(value),
      negative = raw.startsWith('-');
    const [whole, fraction = ''] = (negative ? raw.slice(1) : raw).split('.');
    const units = BigInt(whole) * 1000000n + BigInt(fraction.padEnd(6, '0'));
    return negative ? -units : units;
  };
  const inverted =
    field.type === 'date'
      ? String(field.rules.min) > String(field.rules.max)
      : field.type === 'datetime'
        ? instantMicros(field.rules.min)! > instantMicros(field.rules.max)!
        : scale(field.rules.min) > scale(field.rules.max);
  if (inverted) {
    const early = settingRuleLabel(field, 'min'),
      late = settingRuleLabel(field, 'max');
    errors.min = `${early} must be at or before ${late}.`;
    errors.max = `${late} must be at or after ${early}.`;
    if (['integer', 'decimal', 'currency'].includes(field.type)) {
      errors.min = `${early} must be at most ${late}.`;
      errors.max = `${late} must be at least ${early}.`;
    }
  }
  return errors;
}
