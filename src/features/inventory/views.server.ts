import 'server-only';
import { z } from 'zod';
import { requireMember } from '@/lib/auth/session.server';
import { getLocations } from './queries.server';
import { mapSearch, readFilters, searchPage, searchRow } from './read-model';
import type { InventoryResult, PageResult } from './contracts-ui';
import { readViewPreferences } from './view-preferences';
import {
  withInventoryViewReader,
  ViewReadDeadlineError,
  type ViewReadClient,
} from './view-reader.server';

const decimal = z.string().regex(/^(0|[1-9]\d*)$/);
const canonicalId = z
  .string()
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
const text = (max: number) =>
  z.string().refine((value) => Buffer.byteLength(value, 'utf8') <= max);
const absence = z.enum([
  'unanswered',
  'not_applicable',
  'historical_unavailable',
  'field_unavailable',
]);
const previewSchema = z.strictObject({
  answers: z
    .array(
      z
        .strictObject({
          fieldId: canonicalId,
          label: text(160),
          type: z.string(),
          displayValue: text(256),
          truncated: z.boolean(),
          present: z.boolean(),
          legacy: z.boolean(),
          absence: absence.nullable(),
        })
        .refine((answer) => answer.present === (answer.absence === null)),
    )
    .max(6),
  truncated: z.boolean(),
});
export type SelectedPreview = z.infer<typeof previewSchema>;
const publishedLabel = z
  .string()
  .refine((value) => Array.from(value).length <= 200);
const columnSchema = z.strictObject({
  id: canonicalId,
  label: publishedLabel,
  category: publishedLabel,
  type: z.string(),
  legacy: z.boolean(),
  ordinal: z.number().int().positive().nullable(),
});
export type InventoryColumn = z.infer<typeof columnSchema>;
const columnsSchema = z.strictObject({
  fields: z.array(columnSchema).max(206),
  truncated: z.boolean(),
});
const groupedSchema = z.object({
  rows: z
    .array(
      z.object({
        row: searchRow,
        holdings: z.array(searchRow).max(1000),
        scoped_storage: decimal,
        scoped_site: decimal,
        holding_count: z.number().int().nonnegative(),
      }),
    )
    .max(25),
  total: z.number().int().nonnegative().safe(),
  holding_rows: z.number().int().nonnegative().max(1000),
});
export type InventoryGroup = {
  row: InventoryResult;
  holdings: InventoryResult[];
  scopedStorage: string;
  scopedSite: string;
  holdingCount: number;
  preview?: SelectedPreview;
};
export type InventoryViewResult = PageResult<InventoryGroup> & {
  holdingRows: number;
  unit: 'item' | 'holding row';
  error?: string;
};
class InventoryViewLimitError extends Error {}
// Temporary narrow boundary for new migrations. Canonical db:types remains a required gate;
// this does not fabricate generated definitions. Every response is runtime validated.
type ReadClient = ViewReadClient;
function checked(
  data: unknown,
  error: { code?: string } | null,
  limit: number,
) {
  const limitMessage =
    limit === 131072
      ? 'Selected custom fields exceed the preview limit. Choose fewer columns or narrow the inventory filters.'
      : limit === 524288
        ? 'The published field catalog exceeds its response limit. Refine the field name or category search.'
        : 'This inventory view exceeds 1000 holdings or its response limit. Narrow the location, site or search filters, or use Holdings view.';
  if (error?.code === 'P1025') throw new InventoryViewLimitError(limitMessage);
  if (error?.code === '57014')
    throw new InventoryViewLimitError(
      'Inventory took too long to load. Narrow the filters and try again.',
    );
  if (!error && data && Buffer.byteLength(JSON.stringify(data), 'utf8') > limit)
    throw new InventoryViewLimitError(limitMessage);
  if (error || !data)
    throw new Error(
      'Inventory view could not be loaded. Try again with narrower filters.',
    );
  return data;
}
export async function readSelectedPreview(
  client: ReadClient,
  keys: { kind: 'asset' | 'quantity'; id: string }[],
  fields: string[],
) {
  if (!fields.length || !keys.length)
    return {} as Record<string, SelectedPreview>;
  const expected = new Set(
    keys.map(({ kind, id }) => `${kind}:${canonicalId.parse(id)}`),
  );
  if (
    keys.length > 25 ||
    keys.length !== expected.size ||
    fields.length > 6 ||
    new Set(fields).size !== fields.length
  )
    throw new Error('Invalid custom column request.');
  fields.forEach((id) => canonicalId.parse(id));
  const { data, error } = await client.rpc('metadata_selected_preview', {
    p_keys: keys,
    p_fields: fields,
  });
  const result = z
    .record(z.string(), previewSchema)
    .parse(checked(data, error, 131072));
  if (
    Object.keys(result).length !== expected.size ||
    Object.keys(result).some((key) => !expected.has(key)) ||
    Object.values(result).some(
      ({ answers }) =>
        answers.length !== fields.length ||
        answers.some((answer, index) => answer.fieldId !== fields[index]),
    )
  )
    throw new Error(
      'Custom column response did not match the requested records and fields.',
    );
  return result;
}
export async function getInventoryColumns(
  input: Record<string, string | undefined>,
): Promise<z.infer<typeof columnsSchema> & { error?: string }> {
  const view = readViewPreferences(input);
  if (view.error) return { fields: [], truncated: false };
  return withInventoryViewReader(await requireMember(), async (client) => {
    const { data, error } = await client.rpc('metadata_inventory_columns', {
      p_query: (input.columnSearch ?? '').trim().slice(0, 200),
      p_selected: view.preferences.columns,
    });
    try {
      return columnsSchema.parse(checked(data, error, 524288));
    } catch (cause) {
      if (!(cause instanceof InventoryViewLimitError)) throw cause;
      return { fields: [], truncated: false, error: cause.message };
    }
  }).catch((cause) => {
    if (!(cause instanceof ViewReadDeadlineError)) throw cause;
    return { fields: [], truncated: false, error: cause.message };
  });
}
export async function getInventoryView(
  input: Record<string, string | undefined>,
): Promise<InventoryViewResult> {
  try {
    return await readInventoryView(input);
  } catch (error) {
    if (
      !(error instanceof InventoryViewLimitError) &&
      !(error instanceof ViewReadDeadlineError)
    )
      throw error;
    const filter = readFilters(input);
    return {
      rows: [],
      total: 0,
      holdingRows: 0,
      page: filter.page,
      pageSize: 25,
      unit:
        readViewPreferences(input).preferences.view === 'items'
          ? 'item'
          : 'holding row',
      error: error.message,
    };
  }
}
async function readInventoryView(
  input: Record<string, string | undefined>,
): Promise<InventoryViewResult> {
  const view = readViewPreferences(input);
  const filter = readFilters(input);
  if (view.error)
    return {
      rows: [],
      total: 0,
      holdingRows: 0,
      page: filter.page,
      pageSize: 25,
      unit: 'item',
    };
  return withInventoryViewReader(await requireMember(), async (client) => {
    const args = {
      p_query: filter.query,
      p_type: filter.type,
      p_status: filter.status,
      p_category_id: filter.category,
      p_location_code: filter.location,
      p_site_id: filter.site,
      p_page: filter.page,
      p_low_stock: filter.lowStock,
    };
    const [{ data, error }, locations] = await Promise.all([
      client.rpc(
        view.preferences.view === 'items'
          ? 'inventory_grouped_page'
          : 'inventory_search_v3',
        view.preferences.view === 'items' ? args : { ...args, p_page_size: 25 },
      ),
      getLocations(),
    ]);
    let rows: InventoryGroup[];
    let total: number;
    let holdingRows: number;
    if (view.preferences.view === 'items') {
      const result = groupedSchema.parse(checked(data, error, 2097152));
      rows = result.rows.map((group) => ({
        row: mapSearch(group.row, locations),
        holdings: group.holdings.map((row) => mapSearch(row, locations)),
        scopedStorage: group.scoped_storage,
        scopedSite: group.scoped_site,
        holdingCount: group.holding_count,
      }));
      total = result.total;
      holdingRows = result.holding_rows;
      if (
        new Set(rows.map(({ row }) => `${row.kind}:${row.id}`)).size !==
          rows.length ||
        rows.reduce((count, group) => count + group.holdings.length, 0) !==
          holdingRows ||
        rows.some(
          (group) =>
            !group.holdings.length ||
            new Set(
              group.holdings.map((row) =>
                JSON.stringify([
                  row.location?.id ?? null,
                  row.site?.id ?? null,
                ]),
              ),
            ).size !== group.holdings.length ||
            group.holdings.some(
              (row) => row.kind !== group.row.kind || row.id !== group.row.id,
            ),
        )
      )
        throw new Error('Inventory groups did not match their holdings.');
    } else {
      const result = searchPage.parse(checked(data, error, 2097152));
      rows = result.rows.map((raw) => {
        const row = mapSearch(raw, locations);
        return {
          row,
          holdings: [row],
          scopedStorage:
            row.custodyKind === 'storage' ? String(row.quantity ?? 0) : '0',
          scopedSite:
            row.custodyKind === 'site' ? String(row.quantity ?? 0) : '0',
          holdingCount: row.location || row.site ? 1 : 0,
        };
      });
      total = result.total;
      holdingRows = rows.length;
    }
    const keys = [
      ...new Map(
        rows.map(({ row }) => [
          `${row.kind}:${row.id}`,
          { kind: row.kind, id: row.id },
        ]),
      ).values(),
    ];
    const previews = await readSelectedPreview(
      client,
      keys,
      view.preferences.columns,
    );
    rows.forEach((group) => {
      group.preview = previews[`${group.row.kind}:${group.row.id}`];
    });
    return {
      rows,
      total,
      holdingRows,
      page: filter.page,
      pageSize: 25,
      unit: view.preferences.view === 'items' ? 'item' : 'holding row',
    };
  });
}
