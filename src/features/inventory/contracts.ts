import { z } from 'zod';

export const operations = [
  'quantity_create',
  'quantity_create_v2',
  'quantity_receive',
  'quantity_move',
  'quantity_adjust',
  'quantity_update',
  'quantity_update_v2',
  'quantity_archive',
  'quantity_archive_and_clear',
  'quantity_restore',
  'asset_create',
  'asset_create_v2',
  'asset_move',
  'asset_correct_location',
  'asset_update',
  'asset_update_v2',
  'asset_retire',
  'asset_restore',
] as const;
export type Operation = (typeof operations)[number];
export type MutationCommand = {
  operation: Operation;
  requestId: string;
  payload: Record<string, unknown>;
};
export type MutationState =
  | {
      ok: true;
      entityId: string;
      version: string;
      changed: boolean;
      needsMetadata?: boolean;
    }
  | {
      ok: false;
      kind: 'validation' | 'domain' | 'unexpected';
      code: string;
      message: string;
      fieldErrors?: Record<string, string>;
    };

const uuid = z.uuid();
const count = z.number().int().min(0).max(2147483647);
const positive = count.min(1);
const versionWire = z
  .union([z.string().regex(/^[1-9][0-9]*$/), z.number().int().safe().min(1)])
  .transform(String);
const archiveVersion = versionWire.refine(
  (v) => v.length <= 10 && Number(v) <= 2147483647,
);
const reorderThreshold = count.nullable().optional();
export function normalizeItemCode(value: string): string | null {
  const trimmed = value.replace(
    /^[\u0009-\u000D\u0020\u0085\u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000]+|[\u0009-\u000D\u0020\u0085\u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000]+$/gu,
    '',
  );
  return trimmed || null;
}
export function itemCodeValid(value: string | null): boolean {
  return (
    value === null || ([...value].length <= 100 && !/[\p{Cc}]/u.test(value))
  );
}
const itemCode = z
  .string()
  .nullable()
  .optional()
  .transform((value) =>
    typeof value === 'string' ? normalizeItemCode(value) : value,
  )
  .refine((value) => value === undefined || itemCodeValid(value), {
    message: 'Use at most 100 characters without control characters.',
  });
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => v || null);
const reason = z
  .string()
  .trim()
  .min(1, 'Explain why this change is needed.')
  .max(2000);
const metadata = {
  name: z.string().trim().min(1).max(200),
  description: optionalText(4000),
  category_id: uuid,
  manufacturer: optionalText(200),
  model: optionalText(200),
};
const quantity = { item_id: uuid, expected_version: positive };
const asset = { asset_id: uuid, expected_version: positive };
const identifiers = {
  asset_tag: optionalText(100),
  serial_number: optionalText(200),
};
const customPatch = z.strictObject({
  set: z.record(uuid, z.unknown()).default({}),
  unset: z.array(uuid).max(100).default([]),
});
const published = {
  expected_published_revision_id: uuid,
  custom_patch: customPatch.default({ set: {}, unset: [] }),
};
export const payloadSchemas = {
  quantity_create: z
    .strictObject({
      ...metadata,
      initial_location_id: uuid.nullish().transform((v) => v ?? null),
      initial_quantity: count.default(0),
      reorder_threshold: reorderThreshold,
      item_code: itemCode,
    })
    .refine((v) => v.initial_quantity === 0 || !!v.initial_location_id, {
      path: ['initial_location_id'],
      message: 'Choose a location for initial stock.',
    }),
  quantity_create_v2: z
    .strictObject({
      ...metadata,
      ...published,
      initial_location_id: uuid.nullish().transform((v) => v ?? null),
      initial_quantity: count.default(0),
      reorder_threshold: reorderThreshold,
      item_code: itemCode,
    })
    .refine((v) => v.initial_quantity === 0 || !!v.initial_location_id, {
      path: ['initial_location_id'],
      message: 'Choose a location for initial stock.',
    }),
  quantity_receive: z.strictObject({
    ...quantity,
    location_id: uuid,
    quantity: positive,
    reason,
  }),
  quantity_move: z
    .strictObject({
      ...quantity,
      source_location_id: uuid,
      destination_location_id: uuid,
      quantity: positive.nullish().transform((v) => v ?? null),
      move_all: z.boolean().default(false),
      reason: optionalText(2000),
    })
    .refine((v) => (v.move_all ? v.quantity === null : v.quantity !== null), {
      path: ['quantity'],
      message: 'Enter a quantity or choose Move All.',
    }),
  quantity_adjust: z.strictObject({
    ...quantity,
    location_id: uuid,
    observed_quantity: count,
    reason,
  }),
  quantity_update: z.strictObject({
    ...quantity,
    ...metadata,
    reorder_threshold: reorderThreshold,
    item_code: itemCode,
  }),
  quantity_update_v2: z.strictObject({
    ...quantity,
    ...metadata,
    ...published,
    acknowledge_legacy_values: z.boolean().optional(),
    reorder_threshold: reorderThreshold,
    item_code: itemCode,
  }),
  quantity_archive: z.strictObject({ ...quantity, reason }),
  quantity_archive_and_clear: z.strictObject({
    item_id: uuid,
    expected_version: archiveVersion,
    confirm_clear_stock: z.literal(true),
    reason,
  }),
  quantity_restore: z.strictObject({ ...quantity, reason }),
  asset_create: z.strictObject({
    ...metadata,
    ...identifiers,
    location_id: uuid,
  }),
  asset_create_v2: z.strictObject({
    ...metadata,
    ...identifiers,
    ...published,
    location_id: uuid,
  }),
  asset_move: z.strictObject({
    ...asset,
    location_id: uuid,
    reason: optionalText(2000),
  }),
  asset_correct_location: z.strictObject({
    ...asset,
    location_id: uuid,
    reason,
  }),
  asset_update: z.strictObject({ ...asset, ...metadata, ...identifiers }),
  asset_update_v2: z.strictObject({
    ...asset,
    ...metadata,
    ...identifiers,
    ...published,
    acknowledge_legacy_values: z.boolean().optional(),
  }),
  asset_retire: z.strictObject({ ...asset, reason }),
  asset_restore: z.strictObject({ ...asset, location_id: uuid, reason }),
} satisfies Record<Operation, z.ZodType>;

export function validateCommand(input: unknown) {
  const envelope = z
    .strictObject({
      operation: z.enum(operations),
      requestId: uuid,
      payload: z.record(z.string(), z.unknown()),
    })
    .safeParse(input);
  if (!envelope.success)
    return { success: false as const, error: envelope.error };
  const parsed = payloadSchemas[envelope.data.operation].safeParse(
    envelope.data.payload,
  );
  if (!parsed.success) return parsed;
  return {
    success: true as const,
    data: { ...envelope.data, payload: parsed.data },
  };
}
const errors: Record<string, [string, string]> = {
  P1001: ['forbidden', 'Only active staff can change inventory.'],
  P1002: [
    'stale_version',
    'This record changed since you opened it. Refresh the latest state before trying again.',
  ],
  P1003: [
    'insufficient_stock',
    'The selected source does not have enough stock.',
  ],
  P1004: [
    'invalid_location',
    'Choose an active location that can hold inventory.',
  ],
  P1005: ['same_location', 'Choose a different destination.'],
  P1006: [
    'invalid_quantity',
    'Use a valid whole-unit quantity within the supported range.',
  ],
  P1007: [
    'identifier_conflict',
    'That asset tag is already in use, including by a retired asset.',
  ],
  P1008: [
    'invalid_transition',
    'This change is not allowed in the record’s current state.',
  ],
  P1009: [
    'idempotency_conflict',
    'This request ID was already used for a different change. Start a new submission.',
  ],
  P1010: ['not_found', 'This inventory record could not be found.'],
  P1011: ['invalid_category', 'Choose an active category.'],
  P1012: ['invalid_input', 'Check the supplied values and try again.'],
  P1021: [
    'invalid_metadata',
    'Review the published metadata fields and values.',
  ],
  P1022: [
    'metadata_limit',
    'Metadata exceeds a supported size or complexity limit.',
  ],
  P1023: [
    'metadata_required',
    'Open the current form to complete required metadata or review retained legacy values before changing category.',
  ],
  P1024: [
    'stale_schema',
    'The published form changed. Review the new revision before saving.',
  ],
  P1026: [
    'legacy_ack_required',
    'Review and acknowledge retained legacy values before changing category.',
  ],
};
export function mutationError(code: string | undefined): MutationState {
  const known = code ? errors[code] : undefined;
  if (!known)
    return {
      ok: false,
      kind: 'unexpected',
      code: 'unexpected',
      message:
        'The result could not be confirmed. Retry the same submission to safely check it.',
    };
  return {
    ok: false,
    kind: code === 'P1012' ? 'validation' : 'domain',
    code: known[0],
    message: known[1],
  };
}
export const mutationResultSchema = z.object({
  entity_id: uuid,
  version: versionWire,
  event_id: uuid.nullable(),
  changed: z.boolean(),
  needs_metadata: z.boolean().optional(),
});
