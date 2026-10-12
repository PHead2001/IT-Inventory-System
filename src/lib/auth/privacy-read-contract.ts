import { z } from 'zod';
import { isLogoutGeneration } from './privacy-barrier';

const backendOrigin = z
  .string()
  .min(1)
  .max(256)
  .refine((value) => {
    try {
      const url = new URL(value);
      return (
        (url.protocol === 'http:' || url.protocol === 'https:') &&
        url.origin === value
      );
    } catch {
      return false;
    }
  });
export const protectedPrivacyBindingSchema = z.strictObject({
  actorId: z.uuid(),
  backend: backendOrigin,
  role: z.enum(['viewer', 'staff']),
  canManageConfiguration: z.boolean(),
});
export const privacyReadRequestSchema = z.discriminatedUnion('operation', [
  z.strictObject({ operation: z.literal('read-generation') }),
  z.strictObject({
    operation: z.literal('verify-identity'),
    expected: protectedPrivacyBindingSchema,
  }),
]);
export const privacyReadRequestBytes = 512;
export const privacyGenerationSchema = z.union([
  z.strictObject({ status: z.enum(['absent', 'invalid', 'unavailable']) }),
  z.strictObject({
    status: z.literal('valid'),
    generation: z.string().refine(isLogoutGeneration),
  }),
]);
export const protectedPrivacyIdentitySchema = z.union([
  z.strictObject({
    status: z.literal('match'),
    generation: privacyGenerationSchema,
  }),
  z.strictObject({ status: z.enum(['denied', 'unavailable']) }),
]);
export type ProtectedPrivacyIdentity = z.infer<
  typeof protectedPrivacyIdentitySchema
>;
