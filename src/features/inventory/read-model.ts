import { z } from 'zod';
import type {
  CategoryRef,
  HistoryEvent,
  InventoryResult,
  LocationRef,
} from './contracts-ui';

const id = z.uuid();
const nullableText = z.string().nullable();
export const locationRow = z.object({
  id,
  code: z.string(),
  name: z.string(),
  breadcrumb: z.string(),
  active: z.boolean(),
  can_hold_inventory: z.boolean(),
  parent_id: id.nullable(),
  sort_order: z.number().int().optional(),
});
export function mapLocation(input: unknown): LocationRef {
  const row = locationRow.parse(input);
  return { ...row, parentId: row.parent_id, sortOrder: row.sort_order };
}
export const metadataRow = z.object({
  id,
  name: z.string(),
  description: nullableText,
  category_id: id,
  manufacturer: nullableText,
  model: nullableText,
  version: z.number().int().positive(),
  custom_values: z
    .record(
      z.string(),
      z.object({
        value: z.unknown(),
        validated_revision_id: id,
      }),
    )
    .default({}),
  validated_form_revision_id: id.nullish(),
  needs_metadata: z.boolean().default(false),
});
export const quantityRow = metadataRow.extend({
  archived: z.boolean(),
  item_code: nullableText.default(null),
  reorder_threshold: z.number().int().min(0).max(2147483647).nullable(),
});
export const assetRow = metadataRow.extend({
  status: z.enum(['active', 'retired']),
  asset_tag: nullableText,
  serial_number: nullableText,
  location_id: id.nullable(),
  site_id: id.nullable().optional(),
});
export const searchRow = z.object({
  kind: z.enum(['quantity', 'asset']),
  entity_id: id,
  name: z.string(),
  category_name: z.string(),
  status: z.string(),
  location_id: id.nullable(),
  site_id: id.nullable().optional(),
  site_code: z.string().nullable().optional(),
  site_name: z.string().nullable().optional(),
  custody_kind: z.enum(['storage', 'site', 'unlocated', 'retired']).optional(),
  available_quantity: z
    .string()
    .regex(/^(0|[1-9]\d*)$/)
    .nullable()
    .optional(),
  assigned_quantity: z
    .string()
    .regex(/^(0|[1-9]\d*)$/)
    .nullable()
    .optional(),
  recorded_quantity: z
    .string()
    .regex(/^(0|[1-9]\d*)$/)
    .nullable()
    .optional(),
  quantity: z.number().int().nonnegative().nullable(),
  asset_tag: nullableText,
  item_code: nullableText.default(null),
  serial_number: nullableText,
  recorded_total: z.number().int().nonnegative().nullable(),
  reorder_threshold: z.number().int().min(0).max(2147483647).nullable(),
  stock_state: z
    .enum([
      'disabled',
      'in_stock',
      'needs_restocking',
      'out_of_stock',
      'archived',
    ])
    .nullable(),
});
export const historyRow = z.object({
  id,
  kind: z.enum(['quantity', 'asset']),
  entity_id: id,
  entity_name: z.string(),
  event_type: z.string(),
  created_at: z.string(),
  actor_name: z.string(),
  reason: nullableText,
  before_metadata: z.record(z.string(), z.unknown()).nullable(),
  after_metadata: z.record(z.string(), z.unknown()).nullable(),
  custom_present: z.boolean(),
  custom_changed: z.boolean(),
  assignment_event_id: id.nullable(),
  assignment_kind: z.string().nullable(),
  assignment_from_location_id: id.nullable(),
  assignment_to_location_id: id.nullable(),
  assignment_from_site_id: id.nullable(),
  assignment_to_site_id: id.nullable(),
  assignment_from_label: nullableText,
  assignment_to_label: nullableText,
  assignment_quantity: z.number().int().positive().nullable(),
  assignment_reference: nullableText,
  from_location_id: id.nullable(),
  to_location_id: id.nullable(),
  lines: z.array(
    z.object({
      location_id: id,
      delta: z.number().int(),
      before_quantity: z.number().int().nonnegative(),
      after_quantity: z.number().int().nonnegative(),
    }),
  ),
});
export const searchPage = z.object({
  rows: z.array(searchRow),
  total: z.number().int().nonnegative(),
});
export const quantityStockSummaryRow = z.object({
  available_quantity: z.string().regex(/^(0|[1-9]\d*)$/),
  assigned_quantity: z.string().regex(/^(0|[1-9]\d*)$/),
  recorded_quantity: z.string().regex(/^(0|[1-9]\d*)$/),
  stock_state: z.enum([
    'disabled',
    'in_stock',
    'needs_restocking',
    'out_of_stock',
    'archived',
  ]),
});
export function mapQuantityStockSummary(input: unknown) {
  const row = quantityStockSummaryRow.parse(input);
  return {
    availableQuantity: row.available_quantity,
    assignedQuantity: row.assigned_quantity,
    ownedQuantity: row.recorded_quantity,
    stockState: row.stock_state,
  };
}
export const historyPage = z.object({
  rows: z.array(historyRow),
  total: z.number().int().nonnegative(),
});

export function locationById(
  locations: LocationRef[],
  value: string,
): LocationRef {
  const found = locations.find((l) => l.id === value);
  if (!found) throw new Error('Inventory location could not be resolved.');
  return found;
}
export function mapSearch(
  row: z.infer<typeof searchRow>,
  locations: LocationRef[],
): InventoryResult {
  return {
    kind: row.kind,
    id: row.entity_id,
    name: row.name,
    categoryName: row.category_name,
    status: row.status,
    location: row.location_id ? locationById(locations, row.location_id) : null,
    site:
      row.site_id && row.site_code && row.site_name
        ? { id: row.site_id, code: row.site_code, name: row.site_name }
        : null,
    custodyKind: row.custody_kind,
    quantity: row.quantity,
    assetTag: row.asset_tag,
    itemCode: row.item_code,
    serialNumber: row.serial_number,
    recordedTotal: row.recorded_total,
    availableQuantity: row.available_quantity,
    assignedQuantity: row.assigned_quantity,
    ownedQuantity: row.recorded_quantity,
    reorderThreshold: row.reorder_threshold,
    stockState: row.stock_state,
  };
}
export function mapHistory(
  row: z.infer<typeof historyRow>,
  locations: LocationRef[],
  categories: CategoryRef[],
): HistoryEvent {
  const labels: Record<string, string> = {
    name: 'Name',
    description: 'Description',
    category_id: 'Category',
    manufacturer: 'Manufacturer',
    model: 'Model',
    asset_tag: 'Asset tag',
    item_code: 'Item code (SKU)',
    serial_number: 'Serial number',
    reorder_threshold: 'Reorder threshold',
  };
  const display = (
    key: string,
    value: unknown,
    snapshot: Record<string, unknown>,
  ): string | null => {
    if (key === 'reorder_threshold')
      return typeof value === 'number' ? String(value) : null;
    if (typeof value !== 'string') return null;
    if (key === 'category_id')
      return typeof snapshot.category_name === 'string'
        ? snapshot.category_name
        : `Category at event time not recorded (current name: ${categories.find((c) => c.id === value)?.name ?? 'unavailable'})`;
    return value;
  };
  const before = row.before_metadata ?? {};
  const after = row.after_metadata ?? {};
  return {
    id: row.id,
    kind: row.kind,
    entityId: row.entity_id,
    entityName: row.entity_name,
    eventType: row.event_type,
    at: row.created_at,
    actorName: row.actor_name,
    reason: row.reason,
    assignment: row.assignment_event_id
      ? {
          eventId: row.assignment_event_id,
          kind: row.assignment_kind ?? 'unknown',
          from: {
            locationId: row.assignment_from_location_id,
            siteId: row.assignment_from_site_id,
            label: row.assignment_from_label,
          },
          to: {
            locationId: row.assignment_to_location_id,
            siteId: row.assignment_to_site_id,
            label: row.assignment_to_label,
          },
          quantity: row.assignment_quantity,
          reference: row.assignment_reference,
        }
      : null,
    customMetadataPresent: row.custom_present,
    customMetadataChanged: row.custom_changed,
    lines: row.lines.map((l) => ({
      location: locationById(locations, l.location_id),
      delta: l.delta,
      before: l.before_quantity,
      after: l.after_quantity,
    })),
    fromLocation: row.from_location_id
      ? locationById(locations, row.from_location_id)
      : null,
    toLocation: row.to_location_id
      ? locationById(locations, row.to_location_id)
      : null,
    metadataChanges: Object.entries(labels)
      .filter(([key]) => (before[key] ?? null) !== (after[key] ?? null))
      .map(([key, field]) => ({
        field,
        before: display(key, before[key], before),
        after: display(key, after[key], after),
      })),
  };
}
export function readFilters(input: Record<string, string | undefined>) {
  const number = Number(input.page ?? 1);
  return {
    page: Number.isSafeInteger(number)
      ? Math.min(100000, Math.max(1, number))
      : 1,
    type:
      input.type === 'quantity' || input.type === 'asset' ? input.type : 'all',
    status:
      input.status === 'historical' || input.status === 'all'
        ? input.status
        : 'active',
    query: (input.q ?? '').trim().slice(0, 200),
    category: id.safeParse(input.category).success ? input.category : undefined,
    location: input.location?.slice(0, 100) || undefined,
    site: id.safeParse(input.site).success ? input.site : undefined,
    entityId: id.safeParse(input.entityId).success ? input.entityId : undefined,
    lowStock: input.lowStock === 'true',
  };
}
