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
