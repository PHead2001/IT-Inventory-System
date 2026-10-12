import type { NextRequest } from 'next/server';
import { compareLogoutGeneration } from '@/lib/auth/privacy-barrier.server';
import { privacyConfirmRequestSchema } from '@/lib/auth/logout-contract';
import {
  admitAuthPost,
  privateAuthJson,
  rejectAuthMethod,
} from '@/lib/auth/logout-http.server';

export const runtime = 'nodejs';
export async function POST(request: NextRequest) {
  const admitted = await admitAuthPost(request, privacyConfirmRequestSchema);
  if ('response' in admitted) return admitted.response;
  return privateAuthJson(
    await compareLogoutGeneration(admitted.data.generation),
  );
}
export const GET = rejectAuthMethod;
export const HEAD = rejectAuthMethod;
export const OPTIONS = rejectAuthMethod;
export const PUT = rejectAuthMethod;
export const PATCH = rejectAuthMethod;
export const DELETE = rejectAuthMethod;
