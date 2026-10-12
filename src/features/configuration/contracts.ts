import { z } from 'zod';
import { printLayoutSchema } from '@/features/labels/print-layout';

const uuid = z.uuid();
const backendOrigin = z
  .string()
  .max(2048)
  .refine((value) => {
    try {
      const url = new URL(value);
      return (
        ['http:', 'https:'].includes(url.protocol) &&
        url.origin === value &&
        !url.username &&
        !url.password
      );
    } catch {
      return false;
    }
  });
export type LabelSettingsBinding = { actorId: string; backend: string };
const version = z.union([
  z.string().regex(/^[1-9]\d*$/),
  z.number().int().positive().safe().transform(String),
]);
const total = z.union([
  z.string().regex(/^(0|[1-9]\d*)$/),
  z.number().int().nonnegative().safe().transform(String),
]);
export function normalizeCategoryName(value: string) {
  return value.trim().replace(/\s+/g, ' ');
}
const name = z.string().trim().min(1).max(200).transform(normalizeCategoryName);
const schemas = {
  category_create: z.strictObject({
    code: z
      .string()
      .regex(/^[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)*$/)
      .max(100),
    name,
    sort_order: z.number().int().min(0).max(2147483647).default(0),
  }),
  category_rename: z.strictObject({
    category_id: uuid,
    expected_version: version,
    name,
  }),
  category_remove: z.strictObject({
    category_id: uuid,
    replacement_id: uuid.nullable(),
    review_token: uuid,
  }),
  label_defaults_update: z.strictObject({
    expected_version: version,
    size: z.enum(['90x50', '70x35']),
    page: z.enum(['letter', 'A4']),
    format: z.enum(['qr', 'code128']),
    layout: printLayoutSchema.nullable().optional(),
  }),
};
export type ConfigurationOperation = keyof typeof schemas;
export type ConfigurationResult = {
  changed: boolean;
  version: string | null;
  entity_id?: string;
  event_id: string | null;
  category_id?: string;
  quantity_count?: string;
  asset_count?: string;
  historical_quantity_count?: string;
  historical_asset_count?: string;
  authored_revision_count?: string;
  retained_value_count?: string;
  quantity_needs_metadata_count?: string;
  asset_needs_metadata_count?: string;
  tombstoned?: boolean;
};
export type ConfigurationState =
  | { ok: true; result: ConfigurationResult }
  | { ok: false; code: string; message: string };
export type RemovalReview = {
  token: string;
  source_id: string;
  source_name: string;
  source_version: string;
  target_id: string | null;
  target_name: string | null;
  target_version: string | null;
  quantity_count: string;
  asset_count: string;
  historical_quantity_count: string;
  historical_asset_count: string;
  authored_revision_count: string;
  retained_value_count: string;
  quantity_needs_metadata_count: string;
  asset_needs_metadata_count: string;
  will_tombstone: boolean;
  expires_at: string;
};
const resultSchema = z.object({
  changed: z.boolean(),
  version: version.nullable(),
  entity_id: uuid.optional(),
  event_id: uuid.nullable(),
  category_id: uuid.optional(),
  quantity_count: total.optional(),
  asset_count: total.optional(),
  historical_quantity_count: total.optional(),
  historical_asset_count: total.optional(),
  authored_revision_count: total.optional(),
  retained_value_count: total.optional(),
  quantity_needs_metadata_count: total.optional(),
  asset_needs_metadata_count: total.optional(),
  tombstoned: z.boolean().optional(),
});
export const removalReviewSchema = z.object({
  token: uuid,
  source_id: uuid,
  source_name: z.string(),
  source_version: version,
  target_id: uuid.nullable(),
  target_name: z.string().nullable(),
  target_version: version.nullable(),
  quantity_count: total,
  asset_count: total,
  historical_quantity_count: total,
  historical_asset_count: total,
  authored_revision_count: total,
  retained_value_count: total,
  quantity_needs_metadata_count: total,
  asset_needs_metadata_count: total,
  will_tombstone: z.boolean(),
  expires_at: z.iso.datetime({ offset: true }),
});

export function parseConfigurationCommand(input: unknown) {
  const envelope = z
    .strictObject({
      operation: z.enum(
        Object.keys(schemas) as [
          ConfigurationOperation,
          ...ConfigurationOperation[],
        ],
      ),
      requestId: uuid,
      expectedActorId: uuid.optional(),
      expectedBackend: backendOrigin.optional(),
      payload: z.record(z.string(), z.unknown()),
    })
    .safeParse(input);
  if (!envelope.success) return null;
  const parsed = schemas[envelope.data.operation].safeParse(
    envelope.data.payload,
  );
  if (!parsed.success) return null;
  return { ...envelope.data, payload: parsed.data };
}
export function parseConfigurationResult(value: unknown) {
  return resultSchema.safeParse(value);
}
const messages: Record<string, string> = {
  actor_changed:
    'The signed-in staff member changed. Return to the original account before saving these label settings.',
  backend_changed:
    'This workspace changed environments. Return to the original workspace before retrying these label settings.',
  P1001: 'Only an active configuration maintainer can change settings.',
  P1002: 'These settings changed. Refresh them and review the latest values.',
  P1008: 'This category cannot be changed in its current state.',
  P1009: 'This request ID was already used for another change.',
  P1011: 'Choose an active category.',
  P1012: 'Check the supplied values.',
  P1014: 'That category code or active name is already in use.',
  P1015:
    'More than 10,000 records would be affected. Divide the work before removing this category.',
  P1016: 'This change requires a fresh read-committed transaction.',
  P1017: 'The impact changed. Review the affected records again.',
  P1018:
    'Choose a replacement category for current or historical inventory references.',
  '55P03': 'Another inventory change is in progress. Retry after it finishes.',
  '57014':
    'This change exceeded the time budget. Review the current state before retrying.',
};
export function configurationError(
  code: string | undefined,
): ConfigurationState {
  return {
    ok: false,
    code: code ?? 'unexpected',
    message:
      messages[code ?? ''] ??
      'The result could not be confirmed. Retry the same submission to check it.',
  };
}
