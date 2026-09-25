import {
  metadataDefinition,
  type FieldType,
  type MetadataDefinition,
} from './contracts';
import { z } from 'zod';

export type Field = MetadataDefinition['fields'][number];
export type Section = MetadataDefinition['layout'][number];
export type Control = Section['controls'][number];
export type Option = Field['options'][number];
export const widths = ['Auto', 3, 4, 6, 8, 9, 12] as const;
export const builtins = [
  'name',
  'category_id',
  'description',
  'manufacturer',
  'model',
  'reorder_threshold',
  'asset_tag',
  'serial_number',
] as const;
export const selectTypes: FieldType[] = [
  'single_select',
  'multi_select',
  'hierarchical_select',
];
export const newId = () => crypto.randomUUID();

export function initialDefinition(value: unknown): MetadataDefinition | null {
  const parsed = metadataDefinition.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export function moveControl(
  def: MetadataDefinition,
  controlId: string,
  sectionId: string,
  index: number,
): MetadataDefinition {
  const copy = structuredClone(def);
  const source = copy.layout.find((section) =>
    section.controls.some((control) => control.id === controlId),
  );
  const target = copy.layout.find((section) => section.id === sectionId);
  if (!source || !target) return def;
  const sourceIndex = source.controls.findIndex(
    (control) => control.id === controlId,
  );
  const [control] = source.controls.splice(sourceIndex, 1);
  const adjusted = source === target && index > sourceIndex ? index - 1 : index;
  target.controls.splice(
    Math.max(0, Math.min(adjusted, target.controls.length)),
    0,
    control,
  );
  return copy;
}

export function optionPath(options: Option[], id: string): string | null {
  const byId = new Map(options.map((option) => [option.id, option]));
  const path: string[] = [];
  const visited = new Set<string>();
  let current: Option | undefined = byId.get(id);
  while (current) {
    if (visited.has(current.id) || path.length >= 64) return null;
    visited.add(current.id);
    path.unshift(current.label);
    if (current.parent_id && !byId.has(current.parent_id)) return null;
    current = current.parent_id ? byId.get(current.parent_id) : undefined;
  }
  return path.join(' / ');
}

/** Builds paths once for a choice editor render; each walk is capped at 64 hops. */
export function buildOptionIndex(options: Option[]) {
  const byId = new Map(options.map((option) => [option.id, option]));
  const children = new Map<string | null, Option[]>();
  const paths = new Map<string, string | null>();
  const depths = new Map<string, number | null>();
  for (const option of options) {
    const parent = option.parent_id ?? null;
    const siblings = children.get(parent) ?? [];
    siblings.push(option);
    children.set(parent, siblings);
    const labels: string[] = [];
    const seen = new Set<string>();
    let current: Option | undefined = option;
    while (current && labels.length < 64 && !seen.has(current.id)) {
      labels.unshift(current.label);
      seen.add(current.id);
      current = current.parent_id ? byId.get(current.parent_id) : undefined;
    }
    const missing = [...seen].some((id) => {
      const parentId = byId.get(id)?.parent_id;
      return !!parentId && !byId.has(parentId);
    });
    const valid = !current && !missing;
    paths.set(option.id, valid ? labels.join(' / ') : null);
    depths.set(option.id, valid ? labels.length : null);
  }
  const descendantsOf = (id: string) => {
    const descendants = new Set<string>([id]);
    const queue = [id];
    for (let cursor = 0; cursor < queue.length; cursor += 1) {
      for (const child of children.get(queue[cursor]) ?? []) {
        if (!descendants.has(child.id)) {
          descendants.add(child.id);
          queue.push(child.id);
        }
      }
    }
    return descendants;
  };
  return { byId, children, paths, depths, descendantsOf };
}

export function canReparent(
  options: Option[],
  id: string,
  parentId: string | null,
): boolean {
  const { byId, children } = buildOptionIndex(options);
  if (!byId.has(id)) return false;
  const seen = new Set<string>([id]);
  let parent = parentId;
  let ancestorDepth = 0;
  while (parent) {
    if (seen.has(parent) || ancestorDepth >= 63) return false;
    const option = byId.get(parent);
    if (!option) return false;
    seen.add(parent);
    ancestorDepth += 1;
    parent = option.parent_id ?? null;
  }
  const descendants = new Set<string>([id]);
  const queue = [{ id, depth: 1 }];
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const current = queue[cursor];
    if (ancestorDepth + current.depth > 64) return false;
    for (const child of children.get(current.id) ?? []) {
      // The old parent link of the moved node is replaced by this operation.
      if (child.id === id) continue;
      if (descendants.has(child.id)) return false;
      descendants.add(child.id);
      queue.push({ id: child.id, depth: current.depth + 1 });
    }
  }
  return true;
}

const numericBoundPattern = /^-?(0|[1-9]\d*)(\.\d{1,6})?$/;
// Pinned to the same SIX ISO 4217 List One snapshot as
// private.metadata_currency_code_valid in 20260925000100_published_metadata.sql.
export const supportedCurrencyCodes = new Set(
  [
    'AED AFN ALL AMD AOA ARS AUD AWG AZN BAM BBD BDT BHD BIF BMD BND BOB BOV',
    'BRL BSD BTN BWP BYN BZD CAD CDF CHE CHF CHW CLF CLP CNY COP COU CRC CUP',
    'CVE CZK DJF DKK DOP DZD EGP ERN ETB EUR FJD FKP GBP GEL GHS GIP GMD GNF',
    'GTQ GYD HKD HNL HTG HUF IDR ILS INR IQD IRR ISK JMD JOD JPY KES KGS KHR',
    'KMF KPW KRW KWD KYD KZT LAK LBP LKR LRD LSL LYD MAD MDL MGA MKD MMK MNT',
    'MOP MRU MUR MVR MWK MXN MXV MYR MZN NAD NGN NIO NOK NPR NZD OMR PAB PEN',
    'PGK PHP PKR PLN PYG QAR RON RSD RUB RWF SAR SBD SCR SDG SEK SGD SHP SLE',
    'SOS SRD SSP STN SVC SYP SZL THB TJS TMT TND TOP TRY TTD TWD TZS UAH UGX',
    'USD USN UYI UYU UYW UZS VED VES VND VUV WST XAD XAF XAG XAU XBA XBB XBC',
    'XBD XCD XCG XDR XOF XPD XPF XPT XSU XTS XUA XXX YER ZAR ZMW ZWG',
  ]
    .join(' ')
    .split(' '),
);
function numericBoundValid(
  value: unknown,
  precision: number,
  integer: boolean,
) {
  const raw = String(value);
  if (!numericBoundPattern.test(raw)) return false;
  if ((raw.match(/\d/g) ?? []).length > 24) return false;
  if ((raw.split('.')[1]?.length ?? 0) > precision) return false;
  return !integer || Number.isSafeInteger(Number(raw));
}
function scaledNumericBound(value: unknown): bigint {
  const raw = String(value);
  const negative = raw.startsWith('-');
  const [whole, fraction = ''] = (negative ? raw.slice(1) : raw).split('.');
  const scaled = BigInt(whole) * 1_000_000n + BigInt(fraction.padEnd(6, '0'));
  return negative ? -scaled : scaled;
}

function datetimeInstantMicros(value: unknown): bigint | null {
  if (typeof value !== 'string') return null;
  const match =
    /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))?(Z|[+-]\d{2}:\d{2})$/.exec(
      value,
    );
  if (
    !match ||
    value.startsWith('0000-') ||
    !z.iso.datetime({ offset: true }).safeParse(value).success
  )
    return null;
  // Date.parse normalizes the whole second and its UTC offset. Keep the
  // fractional microseconds separately so PostgreSQL's six digits survive.
  const wholeSecondMillis = Date.parse(`${match[1]}${match[3]}`);
  if (!Number.isFinite(wholeSecondMillis)) return null;
  return (
    BigInt(wholeSecondMillis) * 1000n +
    BigInt((match[2] ?? '').padEnd(6, '0') || '0')
  );
}

function calendarDateValid(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    !value.startsWith('0000-') &&
    z.iso.date().safeParse(value).success
  );
}

function numericDefaultValid(
  raw: string,
  rules: Field['rules'],
  precision: number,
  integer = false,
): boolean {
  if (!numericBoundValid(raw, precision, integer)) return false;
  const min = rules.min;
  const max = rules.max;
  if (
    (min !== undefined &&
      numericBoundValid(min, precision, integer) &&
      scaledNumericBound(raw) < scaledNumericBound(min)) ||
    (max !== undefined &&
      numericBoundValid(max, precision, integer) &&
      scaledNumericBound(raw) > scaledNumericBound(max))
  )
    return false;
  return true;
}

function defaultObeysRules(field: Field): boolean {
  const value = field.default;
  const rules = field.rules;
  if (value === undefined || value === null) return true;
  switch (field.type) {
    case 'short_text':
    case 'long_text': {
      if (typeof value !== 'string') return true; // Type issue is reported separately.
      const length = [...value].length;
      return (
        length <= (field.type === 'short_text' ? 500 : 10000) &&
        (rules.minLength === undefined || length >= Number(rules.minLength)) &&
        (rules.maxLength === undefined || length <= Number(rules.maxLength))
      );
    }
    case 'integer':
      return typeof value !== 'number' || !Number.isSafeInteger(value)
        ? true
        : numericDefaultValid(String(value), rules, 0, true);
    case 'decimal':
      return (
        typeof value !== 'string' ||
        numericDefaultValid(value, rules, Number(rules.precision ?? 6))
      );
    case 'date':
      return (
        typeof value !== 'string' ||
        (calendarDateValid(value) &&
          (rules.min === undefined || value >= String(rules.min)) &&
          (rules.max === undefined || value <= String(rules.max)))
      );
    case 'datetime': {
      if (typeof value !== 'string') return true;
      const instant = datetimeInstantMicros(value);
      if (instant === null) return false;
      const minimum =
        rules.min === undefined ? null : datetimeInstantMicros(rules.min);
      const maximum =
        rules.max === undefined ? null : datetimeInstantMicros(rules.max);
      return (
        (minimum === null || instant >= minimum) &&
        (maximum === null || instant <= maximum)
      );
    }
    case 'url':
      return (
        typeof value !== 'string' ||
        ([...value].length <= 2048 &&
          /^https?:\/\/[^/?#@:\s]+(:[0-9]{1,5})?([/?#][^\s]*)?$/.test(value) &&
          !/[\x00-\x1f\x7f]/.test(value))
      );
    case 'currency':
      if (!value || typeof value !== 'object' || Array.isArray(value))
        return true; // Existing shape issue is reported separately.
      if (!('amount' in value) || !('currency' in value)) return true;
      return (
        Object.keys(value).length === 2 &&
        typeof value.amount === 'string' &&
        typeof value.currency === 'string' &&
        supportedCurrencyCodes.has(value.currency) &&
        value.currency === rules.currencyCode &&
        numericDefaultValid(value.amount, rules, Number(rules.precision))
      );
    case 'multi_select':
      return (
        !Array.isArray(value) ||
        (value.length <= Number(rules.maxSelections ?? 1000) &&
          new Set(value).size === value.length)
      );
    default:
      return true;
  }
}

export function designerIssues(def: MetadataDefinition): string[] {
  const issues: string[] = [];
  if (def.fields.length > 100) issues.push('At most 100 fields are supported.');
  let totalOptions = 0;
  const controls = def.layout.flatMap((section) => section.controls);
  for (const field of def.fields) {
    const optionIndex = buildOptionIndex(field.options);
    if (!field.label.trim()) issues.push('A field needs a label.');
    if (field.applies_to.length === 0)
      issues.push(`${field.label || 'A field'} needs inventory applicability.`);
    totalOptions += field.options.length;
    if (field.options.length > 1000)
      issues.push(`${field.label || 'A field'} exceeds 1,000 options.`);
    if (field.options.some((option) => !option.label.trim()))
      issues.push(`${field.label || 'A field'} has an unlabeled option.`);
    if (
      field.options.some((option) => optionIndex.paths.get(option.id) === null)
    )
      issues.push(
        `${field.label || 'A field'} has an invalid option parent, cycle, or depth over 64.`,
      );
    if (
      new Set(field.options.map((option) => option.id)).size !==
      field.options.length
    )
      issues.push(`${field.label || 'A field'} has repeated choice IDs.`);
    if (
      field.type !== 'hierarchical_select' &&
      field.options.some((option) => option.parent_id)
    )
      issues.push(
        `${field.label || 'A field'} supports parent choices only as a hierarchy.`,
      );
    if (!selectTypes.includes(field.type) && field.options.length)
      issues.push(
        `${field.label || 'A field'} has choices on a non-selection type.`,
      );
    const allowed = ['short_text', 'long_text'].includes(field.type)
      ? ['minLength', 'maxLength']
      : ['integer', 'decimal', 'currency'].includes(field.type)
        ? [
            'min',
            'max',
            ...(field.type === 'integer' ? [] : ['precision']),
            ...(field.type === 'currency' ? ['currencyCode'] : []),
          ]
        : ['date', 'datetime'].includes(field.type)
          ? ['min', 'max']
          : field.type === 'multi_select'
            ? ['maxSelections']
            : [];
    if (Object.keys(field.rules).some((key) => !allowed.includes(key)))
      issues.push(`${field.label || 'A field'} has unsupported rules.`);
    if (['short_text', 'long_text'].includes(field.type)) {
      const min = field.rules.minLength,
        max = field.rules.maxLength;
      const cap = field.type === 'short_text' ? 500 : 10000;
      if (
        [min, max].some(
          (value) =>
            value !== undefined &&
            (!Number.isInteger(value) ||
              Number(value) < 0 ||
              Number(value) > cap),
        ) ||
        (min !== undefined && max !== undefined && Number(min) > Number(max))
      )
        issues.push(`${field.label || 'A field'} has invalid text bounds.`);
    }
    if (['integer', 'decimal', 'currency'].includes(field.type)) {
      const configuredPrecision = field.rules.precision;
      const precision =
        typeof configuredPrecision === 'number' &&
        Number.isInteger(configuredPrecision) &&
        configuredPrecision >= 0 &&
        configuredPrecision <= 6
          ? configuredPrecision
          : 6;
      const min = field.rules.min;
      const max = field.rules.max;
      const minValid =
        min === undefined ||
        numericBoundValid(min, precision, field.type === 'integer');
      const maxValid =
        max === undefined ||
        numericBoundValid(max, precision, field.type === 'integer');
      if (
        !minValid ||
        !maxValid ||
        (minValid &&
          maxValid &&
          min !== undefined &&
          max !== undefined &&
          scaledNumericBound(min) > scaledNumericBound(max))
      )
        issues.push(`${field.label || 'A field'} has invalid numeric bounds.`);
      if (
        field.type === 'decimal' &&
        field.rules.precision !== undefined &&
        (!Number.isInteger(field.rules.precision) ||
          Number(field.rules.precision) < 0 ||
          Number(field.rules.precision) > 6)
      )
        issues.push(`${field.label || 'A field'} has invalid precision.`);
    }
    if (['date', 'datetime'].includes(field.type)) {
      const min = field.rules.min;
      const max = field.rules.max;
      const valid = (value: unknown) =>
        field.type === 'date'
          ? calendarDateValid(value)
          : datetimeInstantMicros(value) !== null;
      if (
        (min !== undefined && !valid(min)) ||
        (max !== undefined && !valid(max))
      )
        issues.push(`${field.label || 'A field'} has invalid date bounds.`);
      else if (
        min !== undefined &&
        max !== undefined &&
        (field.type === 'date'
          ? String(min) > String(max)
          : datetimeInstantMicros(min)! > datetimeInstantMicros(max)!)
      )
        issues.push(`${field.label || 'A field'} has inverted date bounds.`);
    }
    if (
      field.type === 'multi_select' &&
      field.rules.maxSelections !== undefined &&
      (!Number.isInteger(field.rules.maxSelections) ||
        Number(field.rules.maxSelections) < 1 ||
        Number(field.rules.maxSelections) > 1000)
    )
      issues.push(`${field.label || 'A field'} has an invalid choice limit.`);
    if (field.default === null)
      issues.push(
        `${field.label || 'A field'} has a null default; unset it instead.`,
      );
    if (field.default !== undefined && field.default !== null) {
      const value = field.default;
      if (
        (field.type === 'integer' && !Number.isSafeInteger(value)) ||
        (field.type === 'boolean' && typeof value !== 'boolean') ||
        ([
          'short_text',
          'long_text',
          'decimal',
          'date',
          'datetime',
          'url',
          'single_select',
          'hierarchical_select',
        ].includes(field.type) &&
          typeof value !== 'string') ||
        (field.type === 'multi_select' &&
          (!Array.isArray(value) ||
            value.some((entry) => typeof entry !== 'string')))
      )
        issues.push(
          `${field.label || 'A field'} has a default of the wrong type.`,
        );
      if (
        ['single_select', 'hierarchical_select'].includes(field.type) &&
        typeof value === 'string' &&
        !field.options.some((option) => option.id === value && option.active)
      )
        issues.push(
          `${field.label || 'A field'} has a default choice that is not active.`,
        );
      if (
        field.type === 'multi_select' &&
        Array.isArray(value) &&
        value.some(
          (id) =>
            !field.options.some((option) => option.id === id && option.active),
        )
      )
        issues.push(
          `${field.label || 'A field'} has a default choice that is not active.`,
        );
      if (
        field.type === 'currency' &&
        (!value ||
          typeof value !== 'object' ||
          !('amount' in value) ||
          !('currency' in value) ||
          value.currency !== field.rules.currencyCode)
      )
        issues.push(
          `${field.label || 'A field'} has an invalid currency default.`,
        );
      if (!defaultObeysRules(field))
        issues.push(
          `${field.label || 'A field'} has a default that violates its field rules.`,
        );
    }
    if (
      field.required &&
      !controls.some(
        (control) => control.kind === 'field' && control.field_id === field.id,
      )
    )
      issues.push(
        `${field.label || 'A required field'} must appear in the layout.`,
      );
    if (
      field.type === 'currency' &&
      (!supportedCurrencyCodes.has(String(field.rules.currencyCode ?? '')) ||
        !Number.isInteger(field.rules.precision) ||
        Number(field.rules.precision) < 0 ||
        Number(field.rules.precision) > 4)
    )
      issues.push(
        `${field.label || 'A currency field'} needs an ISO currency code and precision from 0 to 4.`,
      );
  }
  if (totalOptions > 5000)
    issues.push('At most 5,000 options are supported per revision.');
  for (const required of ['name', 'category_id'])
    if (
      controls.filter(
        (control) => control.kind === 'builtin' && control.builtin === required,
      ).length !== 1
    )
      issues.push(
        `Include ${required === 'category_id' ? 'Category' : 'Name'} exactly once.`,
      );
  if (new Set(controls.map((control) => control.id)).size !== controls.length)
    issues.push('Layout control IDs must be unique.');
  if (
    new Set(def.layout.map((section) => section.id)).size !== def.layout.length
  )
    issues.push('Section IDs must be unique.');
  if (new Set(def.fields.map((field) => field.id)).size !== def.fields.length)
    issues.push('Field IDs must be unique.');
  const optionIds = def.fields.flatMap((field) =>
    field.options.map((option) => option.id),
  );
  if (new Set(optionIds).size !== optionIds.length)
    issues.push('Choice IDs must be unique across the form.');
  for (const control of controls) {
    if (
      control.kind === 'field' &&
      !def.fields.some((field) => field.id === control.field_id)
    )
      issues.push('A layout control refers to a missing field.');
  }
  for (const builtin of builtins)
    if (
      controls.filter(
        (control) => control.kind === 'builtin' && control.builtin === builtin,
      ).length > 1
    )
      issues.push(`${builtin} appears more than once in the layout.`);
  return [...new Set(issues)];
}
