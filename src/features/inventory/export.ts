import { z } from 'zod';

const text = z.string().nullable();
const identity = z.uuid();
const common = {
  entity_id: identity,
  name: z.string(),
  category_name: z.string(),
  manufacturer: text,
  model: text,
  status: z.string(),
};
const safeDecimal = z.union([
  z.string().regex(/^(0|[1-9]\d*)$/),
  z.number().int().nonnegative().safe().transform(String),
]);
const inventoryRow = z.object({
  ...common,
  kind: z.enum(['quantity', 'asset']),
  asset_tag: text,
  serial_number: text,
  quantity: z.number().int().nonnegative().nullable(),
  location_name: text,
  location_code: text,
  breadcrumb: text,
  location_id: identity.nullable().optional(),
  custody_kind: z.string().nullable().optional(),
  site_id: identity.nullable().optional(),
  site_code: text.optional(),
  site_name: text.optional(),
  available_quantity: safeDecimal.nullable().optional(),
  assigned_quantity: safeDecimal.nullable().optional(),
  recorded_quantity: safeDecimal.nullable().optional(),
  custom_fields: z.record(z.string(), z.unknown()).optional(),
});
const lowStockRow = z.object({
  ...common,
  recorded_total: safeDecimal,
  reorder_threshold: z.number().int().nonnegative(),
  stock_state: z.enum(['needs_restocking', 'out_of_stock']),
  holding_context: z.string(),
  available_quantity: safeDecimal.optional(),
  assigned_quantity: safeDecimal.optional(),
  custom_fields: z.record(z.string(), z.unknown()).optional(),
});
const snapshot = <T extends z.ZodType>(row: T) =>
  z.object({
    rows: z.array(row).max(10000),
    total: safeDecimal.refine((value) => BigInt(value) <= 10000n),
    exported_at: z.iso.datetime({ offset: true }),
  });

export type ExportType = 'inventory' | 'low_stock';
export function parseExportSnapshot(type: ExportType, input: unknown) {
  return type === 'inventory'
    ? snapshot(inventoryRow).parse(input)
    : snapshot(lowStockRow).parse(input);
}

// Guard the first meaningful character as well as leading tabs and controls.
// Quoting alone does not stop spreadsheet formula evaluation.
export function csvText(value: string | null | undefined): string {
  const source = value ?? '';
  const prefix =
    /^[\p{Cc}\p{Cf}]/u.test(source) || /^[\s\p{Cc}\p{Cf}]*[=+\-@]/u.test(source)
      ? "'"
      : '';
  return '"' + (prefix + source).replaceAll('"', '""') + '"';
}

function csvNumber(value: number | string | null | undefined) {
  return value === null || value === undefined ? '' : String(value);
}

export class ExportTooLargeError extends Error {
  constructor() {
    super('export_too_large');
  }
}
const csvLimit = 3 * 1024 * 1024;
function boundedCsv(
  lines: Iterable<string>,
  checkDeadline: () => void,
  onRow?: (bytes: number) => void,
) {
  const encoder = new TextEncoder();
  const chunks = ['\uFEFF'];
  let size = encoder.encode(chunks[0]).byteLength;
  checkDeadline();
  for (const line of lines) {
    checkDeadline();
    const next = line + '\r\n';
    size += encoder.encode(next).byteLength;
    checkDeadline();
    if (size > csvLimit) {
      onRow?.(size);
      checkDeadline();
      throw new ExportTooLargeError();
    }
    chunks.push(next);
    onRow?.(size);
    checkDeadline();
  }
  checkDeadline();
  const complete = chunks.join('');
  checkDeadline();
  return complete;
}

export function exportCsv(
  type: ExportType,
  input: unknown,
  environment: 'Production' | 'Preview',
  includeCustom = false,
  checkDeadline: () => void = () => {},
  onRow?: (bytes: number) => void,
): { csv: string; exportedAt: string } {
  checkDeadline();
  if (type === 'inventory') {
    const parsed = snapshot(inventoryRow).parse(input);
    checkDeadline();
    const { rows, exported_at: exportedAt } = parsed;
    const headers = [
      'Record ID',
      'Type',
      'Name',
      'Category',
      'Manufacturer',
      'Model',
      'Asset Tag',
      'Serial Number',
      'Status',
      'Quantity at Location',
      'Location Name',
      'Location Code',
      'Location Breadcrumb',
      'Location ID',
      'Custody',
      'Site ID',
      'Site Code',
      'Site Name',
      'Available in Storage (Item-wide)',
      'Assigned to Sites (Item-wide)',
      'Total Recorded (Item-wide)',
      'Exported At (UTC)',
      'Environment',
    ];
    if (includeCustom) headers.push('Custom Fields JSON');
    function* lines() {
      yield headers.map(csvText).join(',');
      for (const row of rows) {
        const cells = [
          csvText(row.entity_id),
          csvText(row.kind === 'quantity' ? 'Quantity' : 'Serialized asset'),
          csvText(row.name),
          csvText(row.category_name),
          csvText(row.manufacturer),
          csvText(row.model),
          csvText(row.asset_tag),
          csvText(row.serial_number),
          csvText(row.status),
          csvNumber(row.quantity),
          csvText(row.location_name),
          csvText(row.location_code),
          csvText(row.breadcrumb),
          csvText(row.location_id),
          csvText(row.custody_kind),
          csvText(row.site_id),
          csvText(row.site_code),
          csvText(row.site_name),
          csvNumber(row.available_quantity),
          csvNumber(row.assigned_quantity),
          csvNumber(row.recorded_quantity),
          csvText(exportedAt),
          csvText(environment),
        ];
        if (includeCustom)
          cells.push(csvText(JSON.stringify(row.custom_fields ?? {})));
        yield cells.join(',');
      }
    }
    return {
      exportedAt,
      csv: boundedCsv(lines(), checkDeadline, onRow),
    };
  }
  const parsed = snapshot(lowStockRow).parse(input);
  checkDeadline();
  const { rows, exported_at: exportedAt } = parsed;
  const headers = [
    'Record ID',
    'Type',
    'Name',
    'Category',
    'Manufacturer',
    'Model',
    'Status',
    'Recorded Total',
    'Reorder Threshold',
    'Stock State',
    'All Current Holdings and Locations',
    'Exported At (UTC)',
    'Environment',
    'Available in Storage',
    'Assigned to Sites',
  ];
  if (includeCustom) headers.push('Custom Fields JSON');
  function* lines() {
    yield headers.map(csvText).join(',');
    for (const row of rows) {
      const cells = [
        csvText(row.entity_id),
        csvText('Quantity'),
        csvText(row.name),
        csvText(row.category_name),
        csvText(row.manufacturer),
        csvText(row.model),
        csvText(row.status),
        csvNumber(row.recorded_total),
        csvNumber(row.reorder_threshold),
        csvText(
          row.stock_state === 'out_of_stock'
            ? 'Out of stock'
            : 'Needs restocking',
        ),
        csvText(row.holding_context),
        csvText(exportedAt),
        csvText(environment),
        csvNumber(row.available_quantity),
        csvNumber(row.assigned_quantity),
      ];
      if (includeCustom)
        cells.push(csvText(JSON.stringify(row.custom_fields ?? {})));
      yield cells.join(',');
    }
  }
  return {
    exportedAt,
    csv: boundedCsv(lines(), checkDeadline, onRow),
  };
}
