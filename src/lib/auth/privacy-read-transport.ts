'use client';
import { authPost } from './auth-post';
import type { ProtectedPrivacyBinding } from './protected-binding';
import type { LogoutPrivacyGeneration } from './privacy-barrier';
import {
  privacyReadRequestSchema,
  privacyReadRequestBytes,
  privacyGenerationSchema,
  protectedPrivacyIdentitySchema,
  type ProtectedPrivacyIdentity,
} from './privacy-read-contract';

export async function readLogoutPrivacyGeneration(
  signal?: AbortSignal,
): Promise<LogoutPrivacyGeneration> {
  try {
    return await authPost(
      '/api/auth/privacy-read',
      { operation: 'read-generation' },
      privacyGenerationSchema,
      { signal, requestBytes: privacyReadRequestBytes },
    );
  } catch {
    return { status: 'unavailable' };
  }
}
export async function readProtectedPrivacyIdentity(
  expected: ProtectedPrivacyBinding,
  signal?: AbortSignal,
): Promise<ProtectedPrivacyIdentity> {
  try {
    const body = privacyReadRequestSchema.parse({
      operation: 'verify-identity',
      expected,
    });
    return await authPost(
      '/api/auth/privacy-read',
      body,
      protectedPrivacyIdentitySchema,
      { signal, requestBytes: privacyReadRequestBytes },
    );
  } catch {
    return { status: 'unavailable' };
  }
}
