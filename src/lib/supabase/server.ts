import 'server-only';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import type { Database } from './database.types';
import { supabaseConfig } from './config';
export async function createSupabaseServerClient(writable = false) {
  const jar = await cookies();
  const { url, key } = supabaseConfig();
  return createServerClient<Database>(url, key, {
    cookies: {
      getAll: () => jar.getAll(),
      setAll(values) {
        // Proxy owns refresh writes during Server Component rendering.
        if (writable)
          values.forEach(({ name, value, options }) =>
            jar.set(name, value, options),
          );
      },
    },
  });
}
