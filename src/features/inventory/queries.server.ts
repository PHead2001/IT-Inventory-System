import 'server-only';
import { z } from 'zod';
import { requireMember } from '@/lib/auth/session.server';
import type {
  AssetDetail,
  CategoryRef,
  DuplicateSerial,
  HistoryEvent,
  InventoryResult,
  Metadata,
  PageResult,
  QuantityDetail,
} from './contracts-ui';
import {
  assetRow,
  quantityRow,
  mapLocation,
  mapSearch,
  mapHistory,
  locationById,
  readFilters,
  searchPage,
  historyPage,
  mapQuantityStockSummary,
} from './read-model';

const dashboardSchema = z.object({
  configured_count: z.number().int().nonnegative(),
  needs_restocking_count: z.number().int().nonnegative(),
  out_of_stock_count: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
  rows: z.array(
    z.object({
      entity_id: z.uuid(),
      name: z.string(),
      category_name: z.string(),
      recorded_total: z.number().int().nonnegative(),
      reorder_threshold: z.number().int().nonnegative(),
      stock_state: z.enum(['needs_restocking', 'out_of_stock']),
    }),
  ),
});

const pageSize = 25;
const categorySchema = z.object({
  id: z.uuid(),
  name: z.string(),
  active: z.boolean(),
});
function requireData<T>(data: T | null, error: unknown, message: string): T {
  if (error || data === null) throw new Error(message);
  return data;
}
export async function getLocations() {
  const { supabase } = await requireMember();
  const { data, error } = await supabase
    .from('inventory_locations')
    .select(
      'id,code,name,breadcrumb,active,can_hold_inventory,parent_id,sort_order',
    )
    .order('breadcrumb')
    .order('code');
  return requireData(data, error, 'Locations could not be loaded.').map(
    mapLocation,
  );
}
export async function getLocation(code: string) {
  const locations = await getLocations();
  return locations.find((l) => l.code === code) ?? null;
}
export async function getCategories(): Promise<CategoryRef[]> {
  const { supabase } = await requireMember();
  const { data, error } = await supabase
    .from('categories')
    .select('id,name,active')
    .order('sort_order')
    .order('id');
  return z
    .array(categorySchema)
    .parse(requireData(data, error, 'Categories could not be loaded.'));
}
export async function getInventory(
  input: Record<string, string | undefined> = {},
): Promise<PageResult<InventoryResult>> {
  const { supabase } = await requireMember();
  const filter = readFilters(input);
  const [{ data, error }, locations] = await Promise.all([
    supabase.rpc('inventory_search_v2', {
      p_query: filter.query,
      p_type: filter.type,
      p_status: filter.status,
      p_category_id: filter.category,
      p_location_code: filter.location,
      p_page: filter.page,
      p_page_size: pageSize,
      p_low_stock: filter.lowStock,
    }),
    getLocations(),
  ]);
  const result = searchPage.parse(
    requireData(data, error, 'Inventory could not be loaded.'),
  );
  return {
    rows: result.rows.map((r) => mapSearch(r, locations)),
    total: result.total,
    page: filter.page,
    pageSize,
  };
}
export async function getLowStockDashboard(page = 1) {
  const { supabase } = await requireMember();
  const safePage = Number.isSafeInteger(page)
    ? Math.min(100000, Math.max(1, page))
    : 1;
  const { data, error } = await supabase.rpc('low_stock_dashboard', {
    p_page: safePage,
    p_page_size: pageSize,
  });
  const result = dashboardSchema.parse(
    requireData(data, error, 'Low-stock overview could not be loaded.'),
  );
  return {
    configuredCount: result.configured_count,
    needsRestockingCount: result.needs_restocking_count,
    outOfStockCount: result.out_of_stock_count,
    rows: result.rows.map((row) => ({
      id: row.entity_id,
      name: row.name,
      categoryName: row.category_name,
      recordedTotal: row.recorded_total,
      reorderThreshold: row.reorder_threshold,
      stockState: row.stock_state,
    })),
    total: result.total,
    page: safePage,
    pageSize,
  };
}
export async function getHistory(
  input: Record<string, string | undefined> = {},
): Promise<PageResult<HistoryEvent>> {
  const { supabase } = await requireMember();
  const filter = readFilters(input);
  const [{ data, error }, locations, categories] = await Promise.all([
    supabase.rpc('inventory_history', {
      p_type: filter.type,
      p_entity_id: filter.entityId,
      p_location_code: filter.location,
      p_page: filter.page,
      p_page_size: pageSize,
    }),
    getLocations(),
    getCategories(),
  ]);
  const result = historyPage.parse(
    requireData(data, error, 'History could not be loaded.'),
  );
  return {
    rows: result.rows.map((r) => mapHistory(r, locations, categories)),
    total: result.total,
    page: filter.page,
    pageSize,
  };
}
function metadata(
  row: z.infer<typeof quantityRow> | z.infer<typeof assetRow>,
  categories: CategoryRef[],
): Metadata {
  const category = categories.find((c) => c.id === row.category_id);
  if (!category) throw new Error('Inventory category could not be resolved.');
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    categoryId: row.category_id,
    categoryName: category.name,
    manufacturer: row.manufacturer,
    model: row.model,
    version: row.version,
    customValues: row.custom_values,
    validatedFormRevisionId: row.validated_form_revision_id ?? null,
    needsMetadata: row.needs_metadata,
  };
}
export async function getQuantityDetail(
  id: string,
): Promise<QuantityDetail | null> {
  const { supabase } = await requireMember();
  if (!z.uuid().safeParse(id).success) return null;
  const { data, error } = await supabase
    .from('quantity_items')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (error) throw new Error('Quantity inventory could not be loaded.');
  if (!data) return null;
  const row = quantityRow.parse(data);
  const [
    { data: balances, error: balanceError },
    { data: stockSummary, error: stockSummaryError },
    locations,
    categories,
    history,
  ] = await Promise.all([
    supabase
      .from('stock_balances')
      .select('location_id,quantity')
      .eq('item_id', id)
      .order('location_id'),
    supabase
      .from('inventory_search_rows')
      .select('recorded_total,reorder_threshold,stock_state')
      .eq('entity_id', id)
      .eq('kind', 'quantity')
      .limit(1)
      .maybeSingle(),
    getLocations(),
    getCategories(),
    getHistory({ type: 'quantity', entityId: id }),
  ]);
  return {
    item: {
      ...metadata(row, categories),
      archived: row.archived,
      reorderThreshold: row.reorder_threshold,
    },
    stockSummary: mapQuantityStockSummary(
      requireData(
        stockSummary,
        stockSummaryError,
        'Stock state could not be loaded.',
      ),
    ),
    balances: requireData(
      balances,
      balanceError,
      'Stock balances could not be loaded.',
    ).map((b) => ({
      location: locationById(locations, b.location_id),
      quantity: b.quantity,
    })),
    history: history.rows,
  };
}
export async function getAssetDetail(id: string): Promise<AssetDetail | null> {
  const { supabase } = await requireMember();
  if (!z.uuid().safeParse(id).success) return null;
  const { data, error } = await supabase
    .from('serialized_assets')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (error) throw new Error('Asset could not be loaded.');
  if (!data) return null;
  const row = assetRow.parse(data);
  const [locations, categories, history, duplicateSerialMatches] =
    await Promise.all([
      getLocations(),
      getCategories(),
      getHistory({ type: 'asset', entityId: id }),
      duplicateSerials(row.serial_number ?? '', id),
    ]);
  return {
    asset: {
      ...metadata(row, categories),
      status: row.status,
      assetTag: row.asset_tag,
      serialNumber: row.serial_number,
    },
    location: locationById(locations, row.location_id),
    history: history.rows,
    duplicateSerialMatches,
  };
}
export async function duplicateSerials(
  serial: string,
  excludeId?: string,
): Promise<DuplicateSerial[]> {
  const { supabase } = await requireMember();
  const parsed = z.string().trim().max(200).safeParse(serial);
  if (!parsed.success || !parsed.data) return [];
  if (excludeId && !z.uuid().safeParse(excludeId).success) return [];
  const { data, error } = await supabase.rpc('inventory_serial_matches', {
    p_serial: parsed.data,
    p_exclude_id: excludeId,
  });
  return requireData(data, error, 'Serial matches could not be loaded.').map(
    (row) => ({
      id: row.id,
      name: row.name,
      assetTag: row.asset_tag,
      status: row.status,
    }),
  );
}
