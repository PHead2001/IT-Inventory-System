import { z } from 'zod';

const id = z.uuid();
const version = z.string().regex(/^[1-9][0-9]*$/);
const count = z.number().int().min(0).max(2147483647);
const text = (limit: number) => z.string().trim().max(limit);
const note = text(2000);
const code = z
  .string()
  .regex(/^[A-Z][A-Z0-9]*(-[A-Z0-9]+)*$/)
  .max(100);
const siteShape = { name: text(200).min(1), notes: note.nullable() };
const custodyBase = {
  expected_version: version,
  reason: note.nullable().optional(),
  reference: text(200).nullable().optional(),
};
const quantityBase = { item_id: id, ...custodyBase };
const assetBase = { asset_id: id, ...custodyBase };
const positive = count.min(1);
const published = {
  name: text(200).min(1),
  description: text(4000).nullable(),
  category_id: id,
  manufacturer: text(200).nullable(),
  model: text(200).nullable(),
  site_id: id,
  expected_published_revision_id: id,
  custom_patch: z.strictObject({
    set: z.record(id, z.unknown()),
    unset: z.array(id).max(100),
  }),
  reason: note.nullable().optional(),
  reference: text(200).nullable().optional(),
};

export const custodySchemas = {
  location_rename: z.strictObject({
    location_id: id,
    expected_version: version,
    name: text(200).min(1),
  }),
  site_set_active: z.strictObject({
    site_id: id,
    expected_version: version,
    active: z.boolean(),
    reason: note.min(1),
  }),
  site_create: z.strictObject({ code, ...siteShape }),
  site_update: z.strictObject({
    site_id: id,
    expected_version: version,
    ...siteShape,
    active: z.boolean(),
  }),
  quantity_site_change: z.discriminatedUnion('action', [
    z.strictObject({
      action: z.literal('issue'),
      ...quantityBase,
      source_location_id: id,
      destination_site_id: id,
      quantity: positive,
    }),
    z.strictObject({
      action: z.literal('return'),
      ...quantityBase,
      source_site_id: id,
      destination_location_id: id,
      quantity: positive,
    }),
    z.strictObject({
      action: z.literal('transfer'),
      ...quantityBase,
      source_site_id: id,
      destination_site_id: id,
      quantity: positive,
    }),
    z.strictObject({
      action: z.literal('opening'),
      ...quantityBase,
      destination_site_id: id,
      quantity: positive,
    }),
    z.strictObject({
      action: z.literal('correct'),
      ...quantityBase,
      source_site_id: id,
      observed_quantity: count,
      reason: note.min(1),
      reference: text(200).nullable().optional(),
    }),
    z.strictObject({
      action: z.literal('write_off'),
      ...quantityBase,
      source_site_id: id,
      quantity: positive,
      reason: note.min(1),
      reference: text(200).nullable().optional(),
    }),
  ]),
  asset_site_change: z.discriminatedUnion('action', [
    z.strictObject({
      action: z.literal('assign'),
      ...assetBase,
      source_location_id: id,
      destination_site_id: id,
    }),
    z.strictObject({
      action: z.literal('return'),
      ...assetBase,
      source_site_id: id,
      destination_location_id: id,
    }),
    z.strictObject({
      action: z.literal('transfer'),
      ...assetBase,
      source_site_id: id,
      destination_site_id: id,
    }),
    z.strictObject({
      action: z.literal('correct'),
      ...assetBase,
      source_site_id: id,
      destination_site_id: id,
      reason: note.min(1),
      reference: text(200).nullable().optional(),
    }),
    z.strictObject({
      action: z.literal('write_off'),
      ...assetBase,
      source_site_id: id,
      reason: note.min(1),
      reference: text(200).nullable().optional(),
    }),
    z.strictObject({
      action: z.literal('retire'),
      ...assetBase,
      source_site_id: id,
      reason: note.min(1),
      reference: text(200).nullable().optional(),
    }),
  ]),
  quantity_site_open: z.strictObject({
    ...published,
    quantity: positive,
    reorder_threshold: count.nullable(),
    item_code: z.string().nullable().optional(),
  }),
  asset_site_open: z.strictObject({
    ...published,
    asset_tag: text(100).nullable(),
    serial_number: text(200).nullable(),
  }),
  asset_site_open_v3: z.strictObject({
    ...published,
    asset_tag: text(100).nullable(),
    serial_number: text(200).nullable(),
  }),
} as const;
export type CustodyOperation = keyof typeof custodySchemas;
export type CustodyReceipt = {
  eventId: string;
  operation: string;
  actorName: string;
  createdAt: string;
  quantity: number | null;
  source: {
    id: string;
    kind: 'storage' | 'site';
    name: string;
    // Optional for compatibility with receipts produced before full line snapshots.
    before?: number;
    delta?: number;
    after?: number;
  } | null;
  destination: {
    id: string;
    kind: 'storage' | 'site';
    name: string;
    before?: number;
    delta?: number;
    after?: number;
  } | null;
  reference: string | null;
  reason: string | null;
};
export type CustodyState =
  | {
      ok: true;
      entityId: string;
      version: string;
      changed: boolean;
      eventId?: string;
      custody?: CustodyReceipt;
      refreshFailed?: boolean;
    }
  | {
      ok: false;
      code: string;
      message: string;
      fieldErrors?: Record<string, string>;
    };

export function custodyOutcomeUnresolved(
  result: CustodyState,
  previouslyUncertain: boolean,
) {
  return (
    !result.ok &&
    (result.code === 'unexpected' ||
      (previouslyUncertain &&
        [
          'P1001',
          'P1009',
          'forbidden',
          'actor_changed',
          'idempotency_conflict',
        ].includes(result.code)))
  );
}

export function parseCustodyCommand(input: unknown) {
  const envelope = z
    .strictObject({
      operation: z.enum(
        Object.keys(custodySchemas) as [
          CustodyOperation,
          ...CustodyOperation[],
        ],
      ),
      requestId: id,
      expectedActorId: id.optional(),
      payload: z.record(z.string(), z.unknown()),
    })
    .safeParse(input);
  if (!envelope.success) return envelope;
  const payload = custodySchemas[envelope.data.operation].safeParse(
    envelope.data.payload,
  );
  return payload.success
    ? {
        success: true as const,
        data: { ...envelope.data, payload: payload.data },
      }
    : payload;
}

export function custodyError(code?: string): CustodyState {
  const messages: Record<string, string> = {
    P1001:
      'Only active staff may change custody; location and site settings also require configuration access.',
    P1002:
      'This record changed. Keep your entries and refresh the current state before resubmitting.',
    P1003: 'The source does not have enough available stock.',
    P1004: 'Choose a valid active destination or a recorded source.',
    P1005: 'Choose a different destination.',
    P1006: 'Enter a valid whole-unit quantity within the available balance.',
    P1007: 'That permanent code or asset tag is already in use.',
    P1008:
      'Resolve current holdings or modeled-location restrictions before this change.',
    P1009:
      'This request ID belongs to a different submission. Start a new request.',
    P1010: 'The selected record no longer exists.',
    P1011: 'Choose an active category.',
    P1012: 'Check the supplied values and try again.',
    P1023: 'Complete the required published form fields.',
    P1024:
      'The published form changed. Review its current fields before submitting.',
  };
  return {
    ok: false,
    code: code && messages[code] ? code : 'unexpected',
    message:
      code && messages[code]
        ? messages[code]
        : 'The result could not be confirmed. Retry the same submission to safely check it.',
  };
}
