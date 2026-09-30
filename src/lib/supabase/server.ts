import 'server-only';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import type { Database } from './database.types';
import { supabaseConfig } from './config';
import {
  observeAuthStageSync,
  type AuthDiagnostic,
} from '@/lib/auth/diagnostic.server';
export async function createSupabaseServerClient(
  writable = false,
  diagnostic: AuthDiagnostic | null = null,
) {
  const jar = await cookies();
  const { url, key } = supabaseConfig();
  return createServerClient<Database>(url, key, {
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
}
