import 'server-only';
import { z } from 'zod';
import { requireMember } from '@/lib/auth/session.server';
import { parseActivityRange } from './activity-range';

const id = z.uuid();
const decimal = z.union([
  z.string().regex(/^(0|[1-9]\d*)$/),
  z.number().int().safe().nonnegative().transform(String),
]);
const version = z.union([
  z.string().regex(/^[1-9]\d*$/),
  z.number().int().safe().positive().transform(String),
]);
const site = z.object({
  id,
  code: z.string(),
  name: z.string(),
  notes: z.string().nullable(),
  active: z.boolean(),
  version,
});
const location = z.object({
  id,
  code: z.string(),
  name: z.string(),
  parent_id: id.nullable(),
  kind: z.string(),
  can_hold_inventory: z.boolean(),
  active: z.boolean(),
  sort_order: z.number().int(),
  version,
});
const holding = z.object({
  site_id: id,
  site_code: z.string(),
  site_name: z.string(),
  site_active: z.boolean(),
  inventory_kind: z.enum(['quantity', 'asset']),
  entity_id: id,
  name: z.string(),
  category_name: z.string(),
  manufacturer: z.string().nullable(),
  model: z.string().nullable(),
  quantity: z.number().int().positive(),
  asset_tag: z.string().nullable(),
  serial_number: z.string().nullable(),
});
const assignment = z.object({
  id,
  item_id: id.nullable(),
  asset_id: id.nullable(),
  kind: z.string(),
  actor_name: z.string(),
  reason: z.string().nullable(),
  reference: z.string().nullable(),
  from_location_id: id.nullable(),
  to_location_id: id.nullable(),
  from_site_id: id.nullable(),
  to_site_id: id.nullable(),
  from_label: z.string().nullable(),
  to_label: z.string().nullable(),
  quantity: z.number().int().positive().nullable(),
  created_at: z.string(),
});
const summary = z.object({
  site_id: id,
  current_quantity_units: decimal,
  current_serialized_assets: decimal,
  quantity: z.object({
    gross_issued_units: decimal,
    return_units: decimal,
    transfer_in_units: decimal,
    transfer_out_units: decimal,
    opening_units: decimal,
    write_off_units: decimal,
  }),
  serialized: z.object({
    gross_storage_issue_events: decimal,
    unique_issued_assets: decimal,
    return_events: decimal,
    opening_events: decimal,
    retirement_events: decimal,
  }),
});
const groupPage = z.object({
  rows: z.array(
    z.object({
      inventory_kind: z.enum(['quantity', 'asset']),
      category_name: z.string(),
      name: z.string(),
      model: z.string().nullable(),
      quantity_units: decimal.nullable(),
      serialized_devices: decimal.nullable(),
    }),
  ),
  total: z.number().int().nonnegative(),
});
export type Site = z.infer<typeof site>;
export type ManagedLocation = z.infer<typeof location>;
export type SiteHolding = z.infer<typeof holding>;
export type AssignmentEvent = z.infer<typeof assignment>;
export type SiteSummary = z.infer<typeof summary>;

export async function getSites(): Promise<Site[]> {
  const { supabase } = await requireMember();
  const { data, error } = await supabase
    .from('sites')
    .select('id,code,name,notes,active,version')
    .order('name')
    .order('code');
  if (error) throw new Error('Sites could not be loaded.');
  return z.array(site).parse(data);
}
export async function getSite(code: string): Promise<Site | null> {
  if (!/^[A-Z][A-Z0-9]*(-[A-Z0-9]+)*$/.test(code) || code.length > 100)
    return null;
  const { supabase } = await requireMember();
  const { data, error } = await supabase
    .from('sites')
    .select('id,code,name,notes,active,version')
    .eq('code', code)
    .maybeSingle();
  if (error) throw new Error('Site could not be loaded.');
  return data ? site.parse(data) : null;
}
export async function getManagedLocations(): Promise<ManagedLocation[]> {
  const { supabase } = await requireMember();
  const { data, error } = await supabase
    .from('locations')
    .select(
      'id,code,name,parent_id,kind,can_hold_inventory,active,sort_order,version',
    )
    .order('sort_order')
    .order('code');
  if (error) throw new Error('Location configuration could not be loaded.');
  return z.array(location).parse(data);
}
export async function getSiteArchiveReview(siteId: string) {
  if (!id.safeParse(siteId).success) throw new Error('Invalid site.');
  const { supabase } = await requireMember();
  const { data, error, count } = await supabase
    .from('site_current_holdings')
    .select(
      'site_id,site_code,site_name,site_active,inventory_kind,entity_id,name,category_name,manufacturer,model,quantity,asset_tag,serial_number',
      { count: 'exact' },
    )
    .eq('site_id', siteId)
    .order('name')
    .order('entity_id')
    .range(0, 24);
  if (error) throw new Error('Site holdings could not be loaded.');
  return { holdings: z.array(holding).parse(data), total: count ?? 0 };
}
export async function getSiteDetail(
  siteId: string,
  input: {
    from?: string;
    until?: string;
    page?: string;
    q?: string;
    kind?: string;
    searchField?: string;
  } = {},
) {
  if (!id.safeParse(siteId).success) throw new Error('Invalid site.');
  const pageValue = Number(input.page ?? '1');
  const page = Number.isSafeInteger(pageValue)
    ? Math.max(1, Math.min(100000, pageValue))
    : 1;
  const range = parseActivityRange(input);
  const { from, until } = range;
  const { supabase } = await requireMember();
  const holdingsQuery = supabase
    .from('site_current_holdings')
    .select(
      'site_id,site_code,site_name,site_active,inventory_kind,entity_id,name,category_name,manufacturer,model,quantity,asset_tag,serial_number',
      { count: 'exact' },
    )
    .eq('site_id', siteId)
    .order('category_name')
    .order('name')
    .order('entity_id');
  const kind =
    input.kind === 'quantity' || input.kind === 'asset' ? input.kind : null;
  if (kind) holdingsQuery.eq('inventory_kind', kind);
  const query = input.q?.trim().slice(0, 100);
  const searchField =
    input.searchField === 'model' || input.searchField === 'category_name'
      ? input.searchField
      : 'name';
  if (query)
    holdingsQuery.ilike(
      searchField,
      `%${query.replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_')}%`,
    );
  const offset = (page - 1) * 25;
  let eventsQuery = supabase
    .from('assignment_events')
    .select(
      'id,item_id,asset_id,kind,actor_name,reason,reference,from_location_id,to_location_id,from_site_id,to_site_id,from_label,to_label,quantity,created_at',
      { count: 'exact' },
    )
    .or(`from_site_id.eq.${siteId},to_site_id.eq.${siteId}`);
  if (from) eventsQuery = eventsQuery.gte('created_at', from);
  if (until) eventsQuery = eventsQuery.lt('created_at', until);
  const [holdingsResult, eventsResult, summaryResult, groupsResult] =
    await Promise.all([
      holdingsQuery.range(offset, offset + 24),
      range.valid
        ? eventsQuery
            .order('created_at', { ascending: false })
            .order('id', { ascending: false })
            .range(0, 49)
        : Promise.resolve({ data: [], count: 0, error: null }),
      supabase.rpc('site_activity_summary', {
        p_site_id: siteId,
        p_from: range.valid ? (from ?? undefined) : undefined,
        p_until: range.valid ? (until ?? undefined) : undefined,
      }),
      supabase.rpc('site_holding_groups', {
        p_site_id: siteId,
        p_page: 1,
        p_page_size: 25,
      }),
    ]);
  if (
    holdingsResult.error ||
    eventsResult.error ||
    summaryResult.error ||
    groupsResult.error
  )
    throw new Error('Site holdings or activity could not be loaded.');
  return {
    holdings: z.array(holding).parse(holdingsResult.data),
    holdingTotal: holdingsResult.count ?? 0,
    page,
    events: z.array(assignment).parse(eventsResult.data),
    eventTotal: eventsResult.count ?? 0,
    summary: summary.parse(summaryResult.data),
    groups: groupPage.parse(groupsResult.data),
    from,
    until,
    activityErrors: range.errors,
    activityValid: range.valid,
  };
}
export async function getEntitySiteHoldings(
  itemId: string,
): Promise<SiteHolding[]> {
  if (!id.safeParse(itemId).success) return [];
  const { supabase } = await requireMember();
  const { data, error } = await supabase
    .from('site_current_holdings')
    .select(
      'site_id,site_code,site_name,site_active,inventory_kind,entity_id,name,category_name,manufacturer,model,quantity,asset_tag,serial_number',
    )
    .eq('entity_id', itemId)
    .order('site_code');
  if (error) throw new Error('Site holdings could not be loaded.');
  return z.array(holding).parse(data);
}
export async function getEntityAssignments(
  kind: 'quantity' | 'asset',
  entityId: string,
) {
  if (!id.safeParse(entityId).success) return [];
  const { supabase } = await requireMember();
  const { data, error } = await supabase
    .from('assignment_events')
    .select(
      'id,item_id,asset_id,kind,actor_name,reason,reference,from_location_id,to_location_id,from_site_id,to_site_id,from_label,to_label,quantity,created_at',
    )
    .eq(kind === 'quantity' ? 'item_id' : 'asset_id', entityId)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(25);
  if (error) throw new Error('Assignment history could not be loaded.');
  return z.array(assignment).parse(data);
}
