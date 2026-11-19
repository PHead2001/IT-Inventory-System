'use server';
import { redirect, unstable_rethrow } from 'next/navigation';
import { loadDashboardSnapshot } from './snapshot.server';
import type { DashboardSnapshot } from './snapshot.server';

export async function refreshDashboard(
  page: number,
  view?: 'low-stock',
): Promise<{ ok: true; snapshot: DashboardSnapshot } | { ok: false }> {
  let snapshot: DashboardSnapshot;
  try {
    snapshot = await loadDashboardSnapshot(page);
  } catch (error) {
    unstable_rethrow(error);
    return { ok: false };
  }
  if (
    snapshot.result.page >
    Math.max(1, Math.ceil(snapshot.result.total / snapshot.result.pageSize))
  )
    redirect(
      view === 'low-stock'
        ? '/dashboard?view=low-stock&page=1'
        : '/dashboard?page=1',
    );
  return { ok: true, snapshot };
}
