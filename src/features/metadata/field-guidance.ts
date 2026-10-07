import type { MetadataField } from './field-value-validation';

export function requiredFieldHelp(field: MetadataField): string {
  if (!field.required) return 'Staff can leave this field unanswered.';
  switch (field.type) {
    case 'boolean':
      return 'Record Yes or No. Either answer satisfies required; unanswered does not.';
    case 'multi_select':
      return 'Record an answer: select any that apply, or explicitly choose none.';
    case 'single_select':
    case 'hierarchical_select':
      return 'Choose one available option.';
    case 'date':
      return 'Choose a calendar date.';
    case 'datetime':
      return 'Choose a date, time and timezone.';
    case 'integer':
      return 'Enter a whole number. Zero is an answer when allowed by the bounds.';
    case 'decimal':
      return 'Enter an exact decimal number within the configured bounds.';
    case 'currency':
      return 'Enter an amount in the configured currency. Amounts are not rounded.';
    case 'url':
      return 'Enter an HTTP or HTTPS link without credentials.';
    default:
      return 'Record a text answer. Empty text is accepted unless the minimum length requires characters.';
  }
}

/** Neutral prompts cannot contradict user-authored bounds or imply a default. */
export function fieldPlaceholder(field: MetadataField): string {
  switch (field.type) {
    case 'integer':
      return 'Enter a whole number';
    case 'decimal':
      return 'Enter a decimal number';
    case 'currency':
      return `Enter amount${typeof field.rules.currencyCode === 'string' ? ` in ${field.rules.currencyCode}` : ''}`;
    case 'url':
      return 'https://example.com/manual';
    case 'long_text':
      return 'Enter a detailed note';
    default:
      return 'Enter text';
  }
}

export function validationIssueSummary(count: number): string {
  return count === 0
    ? 'No answers need attention.'
    : `${count} ${count === 1 ? 'answer needs' : 'answers need'} attention.`;
}
export function countNoun(
  count: number,
  singular: string,
  plural = singular + 's',
): string {
  return `${count} ${count === 1 ? singular : plural}`;
}
