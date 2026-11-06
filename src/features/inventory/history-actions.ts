'use server';
import { requireMember } from '@/lib/auth/session.server';
import { HistoryReadActorChangedError } from './history-reader.server';
import { supabaseConfig } from '@/lib/supabase/config';
import {
  getHistoryActors,
  HistoryAccessDeniedError,
} from './history-queries.server';

export async function searchHistoryActors(
  query: string,
  selected: string | null,
  page: number,
  expectedActor: string,
  expectedBackend: string,
) {
  const context = await requireMember();
  if (
    context.member.user_id !== expectedActor ||
    new URL(supabaseConfig().url).origin !== expectedBackend
  )
    return { ok: false as const, code: 'actor_changed' as const };
  try {
    return await getHistoryActors(query, selected, page, context);
  } catch (error) {
    if (error instanceof HistoryReadActorChangedError)
      return { ok: false as const, code: 'actor_changed' as const };
    if (error instanceof HistoryAccessDeniedError)
      return { ok: false as const, code: 'forbidden' as const };
    throw error;
  }
}
