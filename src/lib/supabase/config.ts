import { z } from 'zod';
export function supabaseConfig() {
  return z.object({ url: z.url(), key: z.string().min(1) }).parse({
    url: process.env.NEXT_PUBLIC_SUPABASE_URL,
    key: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  });
}
