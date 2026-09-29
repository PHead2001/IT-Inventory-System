import { z } from 'zod';

export const fieldTypes = [
  'short_text',
  'long_text',
  'integer',
  'decimal',
  'boolean',
  'date',
  'datetime',
  'url',
  'currency',
  'single_select',
  'multi_select',
  'hierarchical_select',
] as const;
export type FieldType = (typeof fieldTypes)[number];
const uuid = z.guid().refine((value) => value === value.toLowerCase(), {
  message: 'Use a canonical lowercase UUID.',
});
const appliesTo = z
  .array(z.enum(['quantity', 'asset']))
  .min(1)
  .max(2);
const option = z.strictObject({
  id: uuid,
  label: z.string(),
  parent_id: uuid.nullish(),
  active: z.boolean(),
});
export const metadataField = z.strictObject({
  id: uuid,
  type: z.enum(fieldTypes),
  label: z.string(),
  help: z.string().nullish(),
  applies_to: appliesTo,
  required: z.boolean(),
  default: z.unknown().optional(),
  rules: z.record(z.string(), z.unknown()).default({}),
  options: z.array(option).default([]),
});
const control = z
  .strictObject({
    id: uuid,
    kind: z.enum(['field', 'builtin', 'help']),
    field_id: uuid.optional(),
    builtin: z.string().optional(),
    help: z.string().optional(),
    width: z.union([
      z.literal('Auto'),
      z.literal(3),
      z.literal(4),
      z.literal(6),
      z.literal(8),
      z.literal(9),
      z.literal(12),
    ]),
    visible: z.boolean().optional(),
    applies_to: appliesTo.optional(),
  })
  .superRefine((value, context) => {
    const expected =
      value.kind === 'field'
        ? 'field_id'
        : value.kind === 'builtin'
          ? 'builtin'
          : 'help';
    for (const key of ['field_id', 'builtin', 'help'] as const) {
      const present = Object.hasOwn(value, key);
      if (present !== (key === expected))
        context.addIssue({
          code: 'custom',
          path: [key],
          message: `${value.kind} controls require only ${expected}.`,
        });
    }
  });
export const metadataDefinition = z.strictObject({
  fields: z.array(metadataField),
  layout: z.array(
    z.strictObject({
      id: uuid,
      label: z.string(),
      visible: z.boolean().optional(),
      applies_to: appliesTo.optional(),
      controls: z.array(control),
    }),
  ),
});
export const formEnvelope = z.object({
  category_id: uuid,
  published_revision_id: uuid,
  published_number: z.string().regex(/^[1-9]\d*$/),
  published_definition: metadataDefinition,
  draft_id: uuid.nullish(),
  draft_version: z
    .string()
    .regex(/^[1-9]\d*$/)
    .nullish(),
  draft_definition: z.unknown().nullish(),
});
export type MetadataDefinition = z.infer<typeof metadataDefinition>;
export type MetadataForm = z.infer<typeof formEnvelope>;
export type StoredCustomValues = Record<
  string,
  {
    value: unknown;
    validated_revision_id: string;
  }
>;
export const storedCustomSchema = z.record(
  uuid,
  z.object({
    value: z.unknown(),
    validated_revision_id: uuid,
  }),
);

export const reviewSchema = z.object({
  token: uuid,
  category_id: uuid,
  draft_id: uuid,
  draft_version: z.string().regex(/^[1-9]\d*$/),
  published_revision_id: uuid,
  affected_quantity: z.string().regex(/^\d+$/),
  affected_assets: z.string().regex(/^\d+$/),
  expires_at: z.iso.datetime({ offset: true }),
});

const decimalCount = z.string().regex(/^\d+$/);
export const formSaveResult = z.discriminatedUnion('status', [
  z.strictObject({
    status: z.literal('saved'),
    changed: z.literal(true),
    entity_id: uuid,
    version: z.string().regex(/^[1-9]\d*$/),
    event_id: uuid,
    category_id: uuid,
    published_revision_id: uuid,
  }),
  z.strictObject({
    status: z.literal('confirmation_required'),
    changed: z.literal(false),
    token: uuid,
    expires_at: z.iso.datetime({ offset: true }),
    category_id: uuid,
    expected_published_revision_id: uuid,
    expected_draft_id: uuid.nullable(),
    expected_draft_version: decimalCount,
    reasons: z.array(
      z.strictObject({
        kind: z.enum([
          'field_retired',
          'required_tightened',
          'applicability_narrowed',
          'rules_tightened',
          'choice_retired',
          'section_removed',
        ]),
        id: uuid,
        field_id: uuid.optional(),
        affected_kinds: z.array(z.enum(['quantity', 'asset'])).max(2),
      }),
    ),
    affected_quantity: decimalCount,
    affected_assets: decimalCount,
    newly_needs_quantity: decimalCount,
    newly_needs_assets: decimalCount,
  }),
]);
export type FormSaveResult = z.infer<typeof formSaveResult>;

export function formatCustomValue(value: unknown, paths: unknown): string {
  if (Array.isArray(paths) && paths.length > 0) {
    return paths
      .map((path) => (Array.isArray(path) ? path.join(' / ') : ''))
      .join('; ');
  }
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'string' || typeof value === 'number')
    return String(value);
  if (Array.isArray(value)) return value.map(String).join(', ');
  if (
    value &&
    typeof value === 'object' &&
    'amount' in value &&
    'currency' in value
  ) {
    const amount = (value as { amount: unknown }).amount;
    const currency = (value as { currency: unknown }).currency;
    return String(amount) + ' ' + String(currency);
  }
  return JSON.stringify(value);
}
