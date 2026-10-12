import type { NextRequest } from 'next/server';
import { readLogoutGeneration } from '@/lib/auth/privacy-barrier.server';
import { verifyProtectedPrivacyBinding } from '@/lib/auth/protected-binding.server';
import {
  privacyReadRequestSchema,
  privacyReadRequestBytes,
} from '@/lib/auth/privacy-read-contract';
import {
  admitAuthPost,
  privateAuthJson,
  rejectAuthMethod,
} from '@/lib/auth/logout-http.server';

export const runtime = 'nodejs';
export async function POST(request: NextRequest) {
  const admitted = await admitAuthPost(
    request,
    privacyReadRequestSchema,
    privacyReadRequestBytes,
  );
  if ('response' in admitted) return admitted.response;
  try {
    return privateAuthJson(
      admitted.data.operation === 'read-generation'
        ? await readLogoutGeneration()
        : await verifyProtectedPrivacyBinding(admitted.data.expected, false),
    );
  } catch {
    return privateAuthJson({ status: 'unavailable' });
  }
}
export const GET = rejectAuthMethod;
export const HEAD = rejectAuthMethod;
export const OPTIONS = rejectAuthMethod;
export const PUT = rejectAuthMethod;
export const PATCH = rejectAuthMethod;
export const DELETE = rejectAuthMethod;
