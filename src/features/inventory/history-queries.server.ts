import 'server-only';
import { z } from 'zod';
import { requireMember } from '@/lib/auth/session.server';
import { getCategories, getLocations } from './queries.server';
import { historyPage, mapHistory } from './read-model';
import {
  historyRpcFilters,
  parseHistoryFilters,
  type HistoryParams,
} from './history-filters';

import { withHistoryReader } from './history-reader.server';

const actorsPage = z.object({
  total: z.number().int().nonnegative().safe(),
  rows: z
    .array(
      z.object({
        actor_id: z.uuid(),
        actor_name: z.string(),
        first_recorded_at: z.string(),
        same_name_count: z.number().int().positive().safe(),
        name_ordinal: z.number().int().positive().safe(),
      }),
    )
    .max(51),
});
export class HistoryAccessDeniedError extends Error {}
function assertRead(
  error: { code?: string; status?: number } | null,
  message: string,
) {
  if (error?.code === '42501' || error?.status === 401 || error?.status === 403)
    throw new HistoryAccessDeniedError('History access denied.');
  if (error)
    throw new Error(
      error.code === 'P1025' || error.code === 'P1013'
        ? 'History is too large. Narrow the filters and retry.'
        : message,
    );
}
export type HistoryActor = z.infer<typeof actorsPage>['rows'][number];
export async function getHistoryActors(
  query = '',
  selectedId: string | null = null,
  page = 1,
  context?: Awaited<ReturnType<typeof requireMember>>,
) {
  if (
    [...query].length > 200 ||
    (selectedId && !z.uuid().safeParse(selectedId).success) ||
    !Number.isSafeInteger(page) ||
    page < 1 ||
    page > 100000
  )
    throw new Error('Person search is invalid.');
  const readContext = context ?? (await requireMember());
  const { data, error } = await withHistoryReader(readContext, async (client) =>
    client.rpc('inventory_history_actors', {
      p_query: query,
      p_selected_id: selectedId,
      p_page: page,
    }),
  );
  assertRead(error, 'People in history could not be loaded.');
  return actorsPage.parse(data);
}
export async function getFilteredHistory(input: HistoryParams = {}) {
  const filter = parseHistoryFilters(input);
  if (!filter.valid) throw new Error('History filters are invalid.');
  const context = await requireMember();
  const [{ data, error }, locations, categories] = await withHistoryReader(
    context,
    async (client) =>
      Promise.all([
        Promise.resolve(
          client.rpc('inventory_history_v2', {
            ...historyRpcFilters(input),
            p_page: filter.page,
            p_page_size: 25,
          }),
        ).then((result) => {
          // Check inside the owned scope: a known denial must not wait behind
          // reference reads and be replaced by the read deadline.
          assertRead(result.error, 'History could not be loaded.');
          return result;
        }),
        getLocations(),
        getCategories(),
      ]),
  );
  assertRead(error, 'History could not be loaded.');
  const result = historyPage
    .extend({
      rows: historyPage.shape.rows.max(100),
      total: z.number().int().nonnegative().safe(),
    })
    .parse(data);
  return {
    rows: result.rows.map((row) => mapHistory(row, locations, categories)),
    total: result.total,
    page: filter.page,
    pageSize: 25,
  };
}
