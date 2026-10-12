import type { NextRequest } from 'next/server';
import { signOutCurrentSession } from '@/lib/auth/logout.server';
import { logoutRequestSchema } from '@/lib/auth/logout-contract';
import {
  admitAuthPost,
  privateAuthJson,
  rejectAuthMethod,
} from '@/lib/auth/logout-http.server';

export const runtime = 'nodejs';
export async function POST(request: NextRequest) {
  const admitted = await admitAuthPost(request, logoutRequestSchema);
  if ('response' in admitted) return admitted.response;
  return privateAuthJson(await signOutCurrentSession());
}
export const GET = rejectAuthMethod;
export const HEAD = rejectAuthMethod;
export const OPTIONS = rejectAuthMethod;
export const PUT = rejectAuthMethod;
export const PATCH = rejectAuthMethod;
export const DELETE = rejectAuthMethod;
