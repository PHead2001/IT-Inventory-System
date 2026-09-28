import { z } from 'zod';
import type { InventoryResult, PageResult } from '../inventory/contracts-ui';
export const roomContentsFilter = 'type=all;status=active' as const;

const identitySchema = z.strictObject({
  userId: z.string().min(1),
  environment: z.string().url(),
  spaceId: z.string().min(1),
  locationCode: z.string().min(1),
  filter: z.literal(roomContentsFilter),
  page: z.number().int().positive(),
});
export type RoomContentsIdentity = z.infer<typeof identitySchema>;
const rowSchema = z.custom<InventoryResult>((value) => {
  if (!value || typeof value !== 'object') return false;
  const row = value as Record<string, unknown>;
  return (
    (row.kind === 'quantity' || row.kind === 'asset') &&
    typeof row.id === 'string' &&
    typeof row.name === 'string' &&
    typeof row.categoryName === 'string' &&
    typeof row.status === 'string'
  );
});
const envelopeSchema = z.strictObject({
  identity: identitySchema,
  result: z.strictObject({
    rows: z.array(rowSchema),
    total: z.number().int().nonnegative(),
    page: z.number().int().positive(),
    pageSize: z.number().int().positive(),
  }),
});
export type RoomContentsEnvelope = {
  identity: RoomContentsIdentity;
  result: PageResult<InventoryResult>;
};

export function parseRoomContentsResponse(
  raw: unknown,
  expected: RoomContentsIdentity,
): RoomContentsEnvelope {
  const parsed = envelopeSchema.safeParse(raw);
  if (!parsed.success) throw new Error('Inventory response failed validation.');
  const envelope = parsed.data;
  if (
    envelope.identity.userId !== expected.userId ||
    envelope.identity.environment !== expected.environment ||
    envelope.identity.spaceId !== expected.spaceId ||
    envelope.identity.locationCode !== expected.locationCode ||
    envelope.identity.filter !== expected.filter ||
    envelope.identity.page !== expected.page ||
    envelope.result.page !== expected.page
  )
    throw new Error(
      'Inventory response identity did not match the selected location.',
    );
  return envelope;
}
