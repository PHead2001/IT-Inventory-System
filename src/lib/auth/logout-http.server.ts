import 'server-only';
import { NextResponse, type NextRequest } from 'next/server';
import type { z } from 'zod';
import { readBoundedJson } from './bounded-json';

export function privateAuthJson(value: unknown, status = 200) {
  return NextResponse.json(value, {
    status,
    headers: { 'Cache-Control': 'private, no-store' },
  });
}
export function rejectAuthMethod() {
  const response = privateAuthJson({ message: 'Method not allowed.' }, 405);
  response.headers.set('Allow', 'POST');
  return response;
}

/** Transport admission precedes cookie reads and sign-out. No forwarded-host trust. */
export async function admitAuthPost<T>(
  request: NextRequest,
  schema: z.ZodType<T>,
): Promise<{ data: T } | { response: NextResponse }> {
  if (request.method !== 'POST') return { response: rejectAuthMethod() };
  const origin = request.headers.get('origin');
  const fetchSite = request.headers.get('sec-fetch-site');
  let sameOrigin = false;
  try {
    const parsed = new URL(origin ?? '');
    sameOrigin =
      (parsed.protocol === 'http:' || parsed.protocol === 'https:') &&
      parsed.origin === origin &&
      parsed.origin === request.nextUrl.origin;
  } catch {
    // Missing, opaque, malformed and multiple origins fail closed.
  }
  if (!sameOrigin || (fetchSite !== null && fetchSite !== 'same-origin'))
    return { response: privateAuthJson({ message: 'Forbidden.' }, 403) };
  if (
    !/^application\/json(?:;\s*charset=utf-8)?$/i.test(
      request.headers.get('content-type') ?? '',
    )
  )
    return { response: privateAuthJson({ message: 'Invalid request.' }, 400) };
  try {
    const parsed = schema.safeParse(await readBoundedJson(request.body, 256));
    if (parsed.success) return { data: parsed.data };
  } catch {
    // Never return input or parser/provider details.
  }
  return { response: privateAuthJson({ message: 'Invalid request.' }, 400) };
}
