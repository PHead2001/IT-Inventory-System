import { z } from 'zod';

export const commandQuery = z
  .object({
    query: z
      .string()
      .refine(
        (value) => !/[\u0000-\u001f\u007f-\u009f]/u.test(value),
        'Control characters are unavailable.',
      )
      .transform((value) => value.trim())
      .refine(
        (value) =>
          Array.from(value).length <= 200 &&
          new TextEncoder().encode(value).length <= 800 &&
          !/[\u0000-\u001f\u007f-\u009f]/u.test(value),
        'Use up to 200 characters without control characters.',
      ),
    scope: z.enum(['active', 'all']).default('active'),
    purpose: z.enum(['all', 'move', 'print']).default('all'),
  })
  .strict();
const boundedText = (limit: number) =>
  z.string().refine((value) => Array.from(value).length <= limit);
export const entityRow = z
  .object({
    kind: z.enum(['asset', 'quantity', 'location', 'site']),
    id: z.string().uuid(),
    name: boundedText(200),
    code: boundedText(200).nullable(),
    assetTag: boundedText(100).nullable(),
    serialNumber: boundedText(200).nullable(),
    status: z.enum(['active', 'retired', 'archived', 'inactive']),
    matchedField: z.enum(['name', 'code', 'assetTag', 'serialNumber']),
    context: z
      .object({
        places: z
          .array(
            z
              .object({
                kind: z.enum(['location', 'site']),
                id: z.string().uuid(),
                name: boundedText(200),
                code: boundedText(200),
              })
              .strict(),
          )
          .max(3),
        hasMore: z.boolean(),
      })
      .strict()
      .nullable()
      .optional(),
  })
  .strict();
export const commandResults = z
  .object({
    version: z.literal(1),
    rows: z.array(entityRow).max(20),
    hasMore: z.boolean(),
  })
  .strict();
export type EntityRow = z.infer<typeof entityRow>;
export type CommandResults = z.infer<typeof commandResults>;
export type EntityIntent = 'open' | 'move' | 'label';
export function entityDestination(row: EntityRow, intent: EntityIntent) {
  if (intent === 'label') {
    if (row.kind === 'site') return null;
    return (
      '/labels?' +
      new URLSearchParams({
        [row.kind]: row.kind === 'location' ? (row.code ?? '') : row.id,
      })
    );
  }
  const path =
    row.kind === 'asset'
      ? '/inventory/assets/' + row.id
      : row.kind === 'quantity'
        ? '/inventory/quantity/' + row.id
        : row.kind === 'location'
          ? '/locations/' + encodeURIComponent(row.code ?? '')
          : '/sites/' + encodeURIComponent(row.code ?? '');
  if (intent === 'move') {
    if (!['asset', 'quantity'].includes(row.kind) || row.status !== 'active')
      return null;
    return (
      path + '?task=' + (row.kind === 'asset' ? 'asset_move' : 'quantity_move')
    );
  }
  return path;
}
