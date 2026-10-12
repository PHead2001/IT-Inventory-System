'use client';
import { acknowledgeLogoutPrivacyGeneration } from '@/lib/auth/logout-transport';
import {
  isLogoutGeneration,
  logoutAcknowledgementKey,
  type LogoutPrivacyGeneration,
} from '@/lib/auth/privacy-barrier';
import {
  invalidateAssignmentPrivacy,
  readAuthoritativeLogoutCleanup,
} from '@/features/scan/assign-batch';

export const cleanupIssue =
  'Signed out, but this tab could not clear its private saved data. Restore browser storage access and retry cleanup, or close this tab before signing in.';
export const unverifiableIssue =
  'This tab’s privacy cleanup state cannot be verified. Keep its saved data intact and close this tab before signing in.';
export const reminderIssue =
  'Signed out, but the browser cleanup reminder could not be saved. Close this tab before signing in again.';

/** Does not trust URL flags, anonymous sessions, or a tab acknowledgement alone. */
export async function verifyTabPrivacy(
  initial: LogoutPrivacyGeneration,
  active: () => boolean,
  force = false,
  pause: () => void = () => {},
): Promise<
  { ready: true; generation: string } | { ready: false; issue: string }
> {
  let current = initial;
  // Bounded restarts for a concurrent logout, with explicit retry under sustained churn.
  for (let attempt = 0; attempt < 3 && active(); attempt++) {
    const marker = readAuthoritativeLogoutCleanup();
    if (marker === 'blocked') return { ready: false, issue: unverifiableIssue };
    if (current.status === 'invalid' || current.status === 'unavailable')
      return { ready: false, issue: unverifiableIssue };
    if (current.status === 'absent') {
      if (marker === 'pending') {
        pause();
        if (!invalidateAssignmentPrivacy(true, false))
          return { ready: false, issue: cleanupIssue };
      }
      return { ready: true, generation: 'absent' };
    }
    if (!isLogoutGeneration(current.generation))
      return { ready: false, issue: unverifiableIssue };
    try {
      const acknowledged = sessionStorage.getItem(logoutAcknowledgementKey);
      if (acknowledged !== null && !isLogoutGeneration(acknowledged))
        return { ready: false, issue: unverifiableIssue };
      if (
        force ||
        marker === 'pending' ||
        acknowledged !== current.generation
      ) {
        pause();
        if (!invalidateAssignmentPrivacy(true, false))
          return { ready: false, issue: cleanupIssue };
      }
      const expected = current.generation;
      const comparison = await acknowledgeLogoutPrivacyGeneration(expected);
      if (!active()) return { ready: false, issue: cleanupIssue };
      if (comparison.status === 'changed') {
        current = { status: 'valid', generation: comparison.generation };
        force = true;
        continue;
      }
      if (comparison.status !== 'match')
        return { ready: false, issue: unverifiableIssue };
      if (readAuthoritativeLogoutCleanup() !== 'none')
        return { ready: false, issue: cleanupIssue };
      sessionStorage.setItem(logoutAcknowledgementKey, expected);
      if (sessionStorage.getItem(logoutAcknowledgementKey) !== expected)
        return { ready: false, issue: cleanupIssue };
      return { ready: true, generation: expected };
    } catch {
      return { ready: false, issue: cleanupIssue };
    }
  }
  return { ready: false, issue: cleanupIssue };
}
