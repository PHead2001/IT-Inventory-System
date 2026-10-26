import { z } from 'zod';
import {
  isLogoutGeneration,
  type LogoutPrivacyReceipt,
} from './privacy-barrier';

export const logoutFailureMessage = 'Unable to sign out. Please try again.';
export const logoutUnknownMessage =
  'Sign-out could not be confirmed. Retry when your connection is available.';
const generation = z.string().refine(isLogoutGeneration);
export const logoutRequestSchema = z.strictObject({});
export const privacyConfirmRequestSchema = z.strictObject({ generation });
export const logoutResultSchema = z.union([
  z.strictObject({ ok: z.literal(true), logoutGeneration: generation }),
  z.strictObject({
    ok: z.literal(true),
    cleanupReminderUnavailable: z.literal(true),
  }),
  z.strictObject({
    ok: z.literal(false),
    message: z.enum([logoutFailureMessage, logoutUnknownMessage]),
  }),
]);
export type LogoutResult =
  | ({ ok: true } & LogoutPrivacyReceipt)
  | {
      ok: false;
      message: typeof logoutFailureMessage | typeof logoutUnknownMessage;
    };
export const privacyComparisonSchema = z.union([
  z.strictObject({ status: z.enum(['match', 'invalid', 'unavailable']) }),
  z.strictObject({ status: z.literal('changed'), generation }),
]);
