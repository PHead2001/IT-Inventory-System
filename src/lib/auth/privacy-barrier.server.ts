import 'server-only';
import { randomUUID } from 'node:crypto';
import { cookies } from 'next/headers';
import { getAppOrigin } from './origin';
import {
  isLogoutGeneration,
  type LogoutPrivacyComparison,
  type LogoutPrivacyGeneration,
  type LogoutPrivacyReceipt,
} from './privacy-barrier';

function cookieSettings() {
  const secure = new URL(getAppOrigin()).protocol === 'https:';
  if (process.env.VERCEL_ENV === 'production' && !secure)
    throw new Error('Production privacy cookie requires HTTPS.');
  return {
    name: secure ? '__Host-inventory-logout-v1' : 'inventory-logout-local-v1',
    secure,
  };
}
export async function readLogoutGeneration(): Promise<LogoutPrivacyGeneration> {
  try {
    const { name } = cookieSettings();
    const value = (await cookies()).get(name)?.value;
    if (value === undefined) return { status: 'absent' };
    if (!value.startsWith('v1:') || !isLogoutGeneration(value.slice(3)))
      return { status: 'invalid' };
    return { status: 'valid', generation: value.slice(3) };
  } catch {
    return { status: 'unavailable' };
  }
}
/** Call only after confirmed caller-scoped Supabase sign-out. */
export async function recordConfirmedLogout(): Promise<LogoutPrivacyReceipt> {
  try {
    const { name, secure } = cookieSettings();
    const generation = randomUUID();
    (await cookies()).set(name, `v1:${generation}`, {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      secure,
      maxAge: 60 * 60 * 24 * 365,
    });
    return { logoutGeneration: generation };
  } catch {
    return { cleanupReminderUnavailable: true };
  }
}
/** Read-only: one tab cannot consume the reminder or overwrite a newer logout. */
export async function compareLogoutGeneration(
  expected: string,
): Promise<LogoutPrivacyComparison> {
  if (!isLogoutGeneration(expected)) return { status: 'invalid' };
  const current = await readLogoutGeneration();
  if (current.status === 'valid')
    return current.generation === expected
      ? { status: 'match' }
      : { status: 'changed', generation: current.generation };
  return {
    status: current.status === 'unavailable' ? 'unavailable' : 'invalid',
  };
}
export async function mayEstablishSession(expected: unknown) {
  const current = await readLogoutGeneration();
  return current.status === 'absent'
    ? expected === 'absent'
    : current.status === 'valid' && expected === current.generation;
}
