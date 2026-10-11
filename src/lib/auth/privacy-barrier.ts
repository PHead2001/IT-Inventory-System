/** Privacy coordination only: never an authentication or authorization credential. */
export const logoutAcknowledgementKey = 'inventory-logout-acknowledgement-v1';
export const logoutGenerationField = 'logout_generation';
export const isLogoutGeneration = (value: unknown): value is string =>
  typeof value === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
export type LogoutPrivacyGeneration =
  | { status: 'absent' }
  | { status: 'invalid' }
  | { status: 'unavailable' }
  | { status: 'valid'; generation: string };
export type LogoutPrivacyComparison =
  | { status: 'match' | 'invalid' | 'unavailable' }
  | { status: 'changed'; generation: string };
export type LogoutPrivacyReceipt =
  | { logoutGeneration: string; cleanupReminderUnavailable?: never }
  | { logoutGeneration?: never; cleanupReminderUnavailable: true };
