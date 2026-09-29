import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { supabaseConfig } from './lib/supabase/config';
import { validReturnPath } from './features/scan/targets';
import {
  createAuthDiagnostic,
  observeAuthStage,
} from './lib/auth/diagnostic.server';

export async function proxy(request: NextRequest) {
  // Replace any caller-supplied header with a value derived from the matched URL.
  request.headers.set(
    'x-inventory-return',
    validReturnPath(request.nextUrl.pathname) ?? '',
  );
  let response = NextResponse.next({ request: { headers: request.headers } });
  response.headers.set('Cache-Control', 'private, no-store');
  const { url, key } = supabaseConfig();
  const supabase = createServerClient(url, key, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(values, headers) {
        const previousCookies = response.cookies.getAll();
        const previousHeaders = new Headers(response.headers);
        values.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request: { headers: request.headers } });
        previousHeaders.forEach((value, name) => {
          if (!name.startsWith('x-middleware-'))
            response.headers.set(name, value);
        });
        previousCookies.forEach((cookie) => response.cookies.set(cookie));
        values.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options),
        );
        Object.entries(headers).forEach(([name, value]) =>
          response.headers.set(name, value),
        );
      },
    },
  });
  const diagnostic = createAuthDiagnostic();
  await observeAuthStage(diagnostic, 'proxy.getClaims', () =>
    supabase.auth.getClaims(),
  );
  return response;
}
export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
