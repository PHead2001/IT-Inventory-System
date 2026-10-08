import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';

const SESSION_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EMAIL_METHODS = new Set(['otp', 'magiclink', 'recovery']);
export const EMAIL_PASSWORD_WINDOW_SECONDS = 600;

/** Only call with claims verified by Auth, never decoded browser input. */
export function hasRecentEmailProof(
  claims: Record<string, unknown>,
  userId: string,
  now = Math.floor(Date.now() / 1000),
): boolean {
  return (
    claims.sub === userId &&
    typeof claims.session_id === 'string' &&
    SESSION_ID.test(claims.session_id) &&
    typeof claims.exp === 'number' &&
    Number.isSafeInteger(claims.exp) &&
    claims.exp > now &&
    typeof claims.iat === 'number' &&
    Number.isSafeInteger(claims.iat) &&
    claims.iat <= now &&
    Array.isArray(claims.amr) &&
    claims.amr.some((entry: unknown) => {
      if (!entry || typeof entry !== 'object') return false;
      const { method, timestamp } = entry as Record<string, unknown>;
      return (
        typeof method === 'string' &&
        EMAIL_METHODS.has(method) &&
        typeof timestamp === 'number' &&
        Number.isSafeInteger(timestamp) &&
        timestamp <= now &&
        timestamp >= now - EMAIL_PASSWORD_WINDOW_SECONDS
      );
    })
  );
}

export async function readPasswordSession(auth: SupabaseClient['auth']) {
  try {
    const { data, error } = await auth.getUser();
    if (error || !data.user) return null;
    // getClaims verifies the current client's token (signature and expiry), not
    // caller-supplied claims. getUser also establishes a live Auth identity.
    const verified = await auth.getClaims();
    const claims = verified.data?.claims;
    if (
      verified.error ||
      !claims ||
      claims.sub !== data.user.id ||
      typeof claims.session_id !== 'string' ||
      !SESSION_ID.test(claims.session_id) ||
      !Number.isSafeInteger(claims.exp) ||
      claims.exp <= Math.floor(Date.now() / 1000)
    )
      return null;
    return {
      user: data.user,
      emailedCompletion: hasRecentEmailProof(claims, data.user.id),
    };
  } catch {
    return null;
  }
}
