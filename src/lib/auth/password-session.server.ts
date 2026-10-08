import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';

const SESSION_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EMAIL_METHODS = new Set(['otp', 'magiclink', 'recovery']);
export const EMAIL_PASSWORD_WINDOW_SECONDS = 600;

type EmailProof = 'absent' | 'recent' | 'unusable';

/** Only call with claims verified by Auth, never decoded browser input. */
export function emailProofState(
  claims: Record<string, unknown>,
  userId: string,
  now = Math.floor(Date.now() / 1000),
): EmailProof | null {
  if (
    claims.sub !== userId ||
    typeof claims.session_id !== 'string' ||
    !SESSION_ID.test(claims.session_id) ||
    typeof claims.exp !== 'number' ||
    !Number.isSafeInteger(claims.exp) ||
    claims.exp <= now ||
    typeof claims.iat !== 'number' ||
    !Number.isSafeInteger(claims.iat) ||
    claims.iat > now ||
    !Array.isArray(claims.amr)
  )
    return null;
  let state: EmailProof = 'absent';
  for (const entry of claims.amr) {
    if (!entry || typeof entry !== 'object' || typeof entry.method !== 'string')
      return null;
    const { method, timestamp } = entry;
    if (EMAIL_METHODS.has(method)) {
      // GoTrue exempts emailed sessions even when their AMR is stale. Never
      // route an unusable emailed session through the ordinary password path.
      if (
        typeof timestamp !== 'number' ||
        !Number.isSafeInteger(timestamp) ||
        timestamp > now ||
        timestamp < now - EMAIL_PASSWORD_WINDOW_SECONDS
      )
        return 'unusable';
      state = 'recent';
    } else if (
      typeof timestamp !== 'number' ||
      !Number.isSafeInteger(timestamp) ||
      timestamp > now
    )
      return null;
  }
  return state;
}

export function hasRecentEmailProof(
  claims: Record<string, unknown>,
  userId: string,
  now = Math.floor(Date.now() / 1000),
): boolean {
  return emailProofState(claims, userId, now) === 'recent';
}

export async function readPasswordSession(auth: SupabaseClient['auth']) {
  try {
    const { data, error } = await auth.getUser();
    if (error || !data.user) return null;
    // getClaims verifies the current client's token (signature and expiry), not
    // caller-supplied claims. getUser also establishes a live Auth identity.
    const verified = await auth.getClaims();
    const claims = verified.data?.claims;
    if (verified.error || !claims) return null;
    const emailProof = emailProofState(claims, data.user.id);
    if (!emailProof) return null;
    return {
      user: data.user,
      emailProof,
      emailedCompletion: emailProof === 'recent',
    };
  } catch {
    return null;
  }
}
