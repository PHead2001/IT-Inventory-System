import 'server-only';
import { requireMember } from '@/lib/auth/session.server';
import {
  OverviewReadError,
  overviewReadError,
  parseOverviewProjection,
  type OverviewSnapshot,
} from './contracts';

// One caller-scoped RPC; no global cache, separate history materialization,
// privileged credentials or second current-state query.
export async function getOverviewSnapshot(
  timeZone = 'UTC',
): Promise<OverviewSnapshot> {
  const { supabase } = await requireMember();
  try {
    const { data, error } = await supabase.rpc('overview_snapshot_v1', {
      p_time_zone: timeZone,
    });
    if (error || data === null) throw overviewReadError(error?.code);
    return {
      ...parseOverviewProjection(data),
      fetchedAt: new Date().toISOString(),
    };
  } catch (error) {
    if (error instanceof OverviewReadError) throw error;
    throw overviewReadError();
  }
}
