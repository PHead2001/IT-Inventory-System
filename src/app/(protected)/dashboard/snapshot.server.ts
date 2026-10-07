import 'server-only';
import { getLowStockDashboard } from '@/features/inventory/queries.server';

export async function loadDashboardSnapshot(page: number) {
  const result = await getLowStockDashboard(page);
  // Record successful completion, never render, hydration, or click time.
  return { result, fetchedAt: new Date().toISOString() };
}
export type DashboardSnapshot = Awaited<
  ReturnType<typeof loadDashboardSnapshot>
>;
