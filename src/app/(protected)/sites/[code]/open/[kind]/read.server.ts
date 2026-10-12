import 'server-only';
import { cache } from 'react';
import { getSite } from '@/features/custody/queries.server';
import { requireMember } from '@/lib/auth/session.server';

// Request-scoped sharing for metadata and this page; action reads remain fresh.
export const readSiteOpeningPage = cache(async (code: string) => {
  const { member } = await requireMember();
  const site = await getSite(code);
  return { member, site };
});
