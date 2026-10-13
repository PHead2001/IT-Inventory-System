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
  signal?: AbortSignal,
) {
  const jar = await cookies();
  const { url, key } = supabaseConfig();
  const outbound: typeof fetch = signal
    ? (input, init) =>
        globalThis.fetch(input, {
          ...init,
          signal: AbortSignal.any([
            signal,
            ...(input instanceof Request ? [input.signal] : []),
            ...(init?.signal ? [init.signal] : []),
          ]),
        })
    : globalThis.fetch;
  const guard = privacyRead ? createPrivacyReadFetch(url, outbound) : undefined;
  const client = createServerClient<Database>(url, key, {
    ...(guard || signal ? { global: { fetch: guard?.fetch ?? outbound } } : {}),
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
  signal?: AbortSignal,
) {
  return (await createCookieClient(writable, diagnostic, false, signal)).client;
}
/** Dedicated mode for /api/auth/privacy-read; ordinary server refresh is intact. */
export function createSupabasePrivacyReadClient() {
  return createCookieClient(false, null, true);
}
