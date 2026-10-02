import { z } from 'zod';
import type { MetadataDefinition } from './contracts';
export type MetadataField = MetadataDefinition['fields'][number];
const decimalPattern = /^-?(0|[1-9]\d*)(\.\d{1,6})?$/;
function decimalUnits(raw: string) {
  const negative = raw.startsWith('-');
  const [whole, fraction = ''] = (negative ? raw.slice(1) : raw).split('.');
  const units = BigInt(whole) * 1_000_000n + BigInt(fraction.padEnd(6, '0'));
  return negative ? -units : units;
}
export function instantMicros(value: unknown): bigint | null {
  if (typeof value !== 'string' || value.startsWith('0000-')) return null;
  const match =
    /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))?(Z|[+-]\d{2}:\d{2})$/.exec(
      value,
    );
  if (!match || !z.iso.datetime({ offset: true }).safeParse(value).success)
    return null;
  const wholeMillis = Date.parse(match[1] + match[3]);
  if (!Number.isFinite(wholeMillis)) return null;
  return (
    BigInt(wholeMillis) * 1000n + BigInt((match[2] ?? '').padEnd(6, '0') || '0')
  );
}
export function fieldValueError(field: MetadataField, value: unknown): string {
  if (value === undefined)
    return field.required ? 'Answer this required field.' : '';
  const rules = field.rules;
  const boundsError = (below: boolean, above: boolean) =>
    below
      ? `${field.type === 'date' || field.type === 'datetime' ? 'Choose on or after' : 'Enter at least'} ${String(rules.min)}.`
      : above
        ? `${field.type === 'date' || field.type === 'datetime' ? 'Choose on or before' : 'Enter at most'} ${String(rules.max)}.`
        : '';
  switch (field.type) {
    case 'short_text':
    case 'long_text': {
      if (typeof value !== 'string') return 'Enter text.';
      const length = [...value].length;
      const min = Number(rules.minLength ?? 0);
      const max = Number(
        rules.maxLength ?? (field.type === 'short_text' ? 500 : 10000),
      );
      return length < min
        ? `Enter at least ${min} characters.`
        : length > max
          ? `Use at most ${max} characters.`
          : '';
    }
    case 'boolean':
      return typeof value === 'boolean'
        ? ''
        : 'Choose checked, unchecked or clear the answer.';
    case 'integer':
    case 'decimal':
    case 'currency': {
      const money = field.type === 'currency';
      const raw =
        money && value && typeof value === 'object' && 'amount' in value
          ? String(value.amount)
          : String(value);
      if (
        field.type === 'integer' &&
        (typeof value !== 'number' || !Number.isSafeInteger(value))
      )
        return 'Enter a whole number (no fractions).';
      if (
        money &&
        (!value ||
          typeof value !== 'object' ||
          !('currency' in value) ||
          !('amount' in value) ||
          typeof value.amount !== 'string' ||
          Object.keys(value).length !== 2 ||
          value.currency !== rules.currencyCode)
      )
        return 'Use the configured currency.';
      if (field.type === 'decimal' && typeof value !== 'string')
        return 'Enter a decimal number.';
      const places =
        field.type === 'integer' ? 0 : Number(rules.precision ?? 6);
      if (!decimalPattern.test(raw) || (raw.match(/\d/g) ?? []).length > 24)
        return 'Enter a number without commas or exponents (at most 24 digits).';
      if ((raw.split('.')[1]?.length ?? 0) > places)
        return `Use at most ${places} decimal places; the amount will not be rounded.`;
      const amount = decimalUnits(raw);
      return boundsError(
        rules.min !== undefined &&
          decimalPattern.test(String(rules.min)) &&
          amount < decimalUnits(String(rules.min)),
        rules.max !== undefined &&
          decimalPattern.test(String(rules.max)) &&
          amount > decimalUnits(String(rules.max)),
      );
    }
    case 'date':
      if (
        typeof value !== 'string' ||
        value.startsWith('0000-') ||
        !z.iso.date().safeParse(value).success
      )
        return 'Choose a valid calendar date.';
      return boundsError(
        rules.min !== undefined && value < String(rules.min),
        rules.max !== undefined && value > String(rules.max),
      );
    case 'datetime': {
      const instant = instantMicros(value);
      if (instant === null) return 'Choose a valid date, time and timezone.';
      const min = instantMicros(rules.min),
        max = instantMicros(rules.max);
      return boundsError(
        min !== null && instant < min,
        max !== null && instant > max,
      );
    }
    case 'url':
      return typeof value === 'string' &&
        [...value].length <= 2048 &&
        /^https?:\/\/[^/?#@:\s]+(:[0-9]{1,5})?([/?#][^\s]*)?$/.test(value) &&
        !/[\x00-\x1f\x7f]/.test(value)
        ? ''
        : 'Enter an http:// or https:// link without credentials or spaces.';
    case 'multi_select':
      if (
        !Array.isArray(value) ||
        value.length > Number(rules.maxSelections ?? 1000)
      )
        return `Choose at most ${Number(rules.maxSelections ?? 1000)} options.`;
      return new Set(value).size === value.length &&
        value.every((id) =>
          field.options.some((option) => option.id === id && option.active),
        )
        ? ''
        : 'Choose available options; a selected choice is retired or unavailable.';
    case 'single_select':
    case 'hierarchical_select':
      return field.options.some(
        (option) => option.id === value && option.active,
      )
        ? ''
        : 'Choose an available option; the retained choice is retired or unavailable.';
  }
}
