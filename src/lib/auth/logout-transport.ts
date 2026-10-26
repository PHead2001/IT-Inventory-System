'use client';
import { authPost, authTransportTimeoutMs } from './auth-post';
import {
  logoutResultSchema,
  logoutUnknownMessage,
  privacyComparisonSchema,
  type LogoutResult,
} from './logout-contract';
import {
  isLogoutGeneration,
  type LogoutPrivacyComparison,
} from './privacy-barrier';

export const logoutTransportTimeoutMs = authTransportTimeoutMs;
export async function signOutSession(): Promise<LogoutResult> {
  try {
    return await authPost('/api/auth/logout', {}, logoutResultSchema);
  } catch {
    // Abort/timeout is uncertainty; it cannot prove the server cancelled logout.
    return { ok: false, message: logoutUnknownMessage };
  }
}
export async function acknowledgeLogoutPrivacyGeneration(
  generation: string,
): Promise<LogoutPrivacyComparison> {
  if (!isLogoutGeneration(generation)) return { status: 'invalid' };
  try {
    return await authPost(
      '/api/auth/privacy-confirm',
      { generation },
      privacyComparisonSchema,
    );
  } catch {
    return { status: 'unavailable' };
  }
}
