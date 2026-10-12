import 'server-only';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import type { Database } from './database.types';
import { supabaseConfig } from './config';
import { createPrivacyReadFetch } from './privacy-read-fetch.server';
import {
  observeAuthStageSync,
  type AuthDiagnostic,
} from '@/lib/auth/diagnostic.server';
async function createCookieClient(
  writable: boolean,
  diagnostic: AuthDiagnostic | null,
  privacyRead = false,
) {
  const jar = await cookies();
  const { url, key } = supabaseConfig();
  const guard = privacyRead
    ? createPrivacyReadFetch(url, globalThis.fetch)
    : undefined;
  const client = createServerClient<Database>(url, key, {
    ...(guard ? { global: { fetch: guard.fetch } } : {}),
    cookies: {
      getAll: () =>
        observeAuthStageSync(diagnostic, 'cookie.getAll', () => jar.getAll()),
      setAll(values) {
        // Proxy owns refresh writes during Server Component rendering.
        if (writable)
          observeAuthStageSync(diagnostic, 'cookie.setAll', () =>
            values.forEach(({ name, value, options }) =>
              jar.set(name, value, options),
            ),
          );
      },
    },
  });
  return { client, blocked: guard?.blocked ?? (() => false) };
}
export async function createSupabaseServerClient(
  writable = false,
  diagnostic: AuthDiagnostic | null = null,
) {
  return (await createCookieClient(writable, diagnostic)).client;
}
/** Dedicated mode for /api/auth/privacy-read; ordinary server refresh is intact. */
export function createSupabasePrivacyReadClient() {
  return createCookieClient(false, null, true);
}
