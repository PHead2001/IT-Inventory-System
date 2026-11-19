import { z } from 'zod';
import { LOCATION_CODE, targetPath } from '@/features/scan/targets';

export const peekTargetSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('asset'), id: z.uuid() }),
  z.strictObject({ kind: z.literal('quantity'), id: z.uuid() }),
  z.strictObject({
    kind: z.literal('location'),
    code: z.string().max(256).regex(LOCATION_CODE),
  }),
]);
export type PeekTarget = z.infer<typeof peekTargetSchema>;
export function peekTargetFromHref(href: string): PeekTarget | null {
  const target = targetPath(href);
  if (!target) return null;
  return target.kind === 'location'
    ? { kind: 'location', code: target.code }
    : { kind: target.kind, id: target.id };
}
export const peekLocationSchema = z.object({
  code: z.string().max(256),
  name: z.string().max(200),
  breadcrumb: z.string().max(2000),
  active: z.boolean(),
  canHold: z.boolean(),
  spaceRootCode: z.string().max(100).regex(LOCATION_CODE).nullable(),
});
const count = z
  .string()
  .regex(/^(0|[1-9]\d*)$/)
  .max(40);
export const peekPayloadSchema = z.object({
  target: peekTargetSchema,
  name: z.string().max(200),
  status: z.enum(['active', 'archived', 'retired', 'inactive']),
  assetTag: z.string().max(100).nullable(),
  stock: z
    .object({ available: count, assigned: count, recorded: count })
    .nullable(),
  locations: z.array(peekLocationSchema).max(3),
  moreLocations: z.boolean(),
  siteName: z.string().max(200).nullable(),
  photo: z
    .object({ path: z.string().max(1024), name: z.string().max(255) })
    .nullable(),
});
export type PeekPayload = z.infer<typeof peekPayloadSchema>;
export const peekEnvelopeSchema = z.object({
  actor: z.uuid(),
  backend: z.url(),
  payload: peekPayloadSchema,
});
export function peekKey(target: PeekTarget) {
  return (
    target.kind +
    ':' +
    (target.kind === 'location' ? target.code : target.id.toLowerCase())
  );
}
export function peekHref(target: PeekTarget) {
  return target.kind === 'location'
    ? '/locations/' + encodeURIComponent(target.code)
    : '/inventory/' +
        (target.kind === 'asset' ? 'assets/' : 'quantity/') +
        target.id;
}
