import { z } from 'zod';

export const fileParentSchema = z.strictObject({
  parentType: z.enum(['asset', 'quantity']),
  parentId: z.uuid().transform((id) => id.toLowerCase()),
});
export type FileParent = z.infer<typeof fileParentSchema>;
export const fileRevisionSchema = z
  .string()
  .regex(/^[1-9][0-9]{0,18}$/)
  .refine((value) => BigInt(value) <= 9223372036854775807n);
const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export const cleanupResultSchema = z
  .strictObject({
    deleted: count,
    failed: count,
    outstanding: count,
    blocked: count,
    pending: z.boolean(),
    status: z.enum(['no_work', 'complete', 'pending', 'partial', 'failed']),
  })
  .refine(
    (value) =>
      value.pending === (value.outstanding > 0 || value.failed > 0) &&
      value.blocked <= value.outstanding &&
      (value.status !== 'no_work' || (!value.pending && value.deleted === 0)) &&
      (value.status !== 'complete' || !value.pending) &&
      (value.status !== 'pending' ||
        (value.outstanding > 0 && value.failed === 0)) &&
      (value.status !== 'partial' || (value.deleted > 0 && value.failed > 0)) &&
      (value.status !== 'failed' || (value.deleted === 0 && value.failed > 0)),
  );
export type CleanupResult = z.infer<typeof cleanupResultSchema>;

// Caller-authorized card metadata; no private object paths or capabilities.
export const inventoryFileCardSchema = z.strictObject({
  id: z.string().min(1),
  name: z.string(),
  filename: z.string(),
  uploader: z.string(),
  ready_at: z.string().nullable(),
  type: z.string().min(1),
  bytes: z.number().int().nonnegative().nullable(),
  purpose: z.string().min(1),
  state: z.enum([
    'reserved',
    'uploaded',
    'validating',
    'validated',
    'ready',
    'rejected',
    'removed',
    'cancelled',
    'expired',
  ]),
  created_at: z.string().min(1),
  version: fileRevisionSchema,
  replaces_file_id: z.string().nullable(),
  reviewed_replaced_file_version: fileRevisionSchema.nullable(),
});
export const inventoryFileCardsSchema = z.strictObject({
  revision: fileRevisionSchema,
  files: z.array(inventoryFileCardSchema),
});
export type InventoryFileCard = z.infer<typeof inventoryFileCardSchema>;
export type InventoryFileCards = z.infer<typeof inventoryFileCardsSchema>;
