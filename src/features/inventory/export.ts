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
const inventoryRow = z.object({
  ...common,
  kind: z.enum(['quantity', 'asset']),
  asset_tag: text,
  serial_number: text,
  quantity: z.number().int().nonnegative().nullable(),
  location_name: text,
  location_code: text,
  breadcrumb: text,
});
const lowStockRow = z.object({
  ...common,
  recorded_total: z.number().int().nonnegative(),
  reorder_threshold: z.number().int().nonnegative(),
  stock_state: z.enum(['needs_restocking', 'out_of_stock']),
  holding_context: z.string(),
});
const snapshot = <T extends z.ZodType>(row: T) =>
  z.object({
    rows: z.array(row).max(10000),
    total: z.number().int().min(0).max(10000),
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

function csvNumber(value: number | null | undefined) {
  return value === null || value === undefined ? '' : String(value);
}

export function exportCsv(
  type: ExportType,
  input: unknown,
  environment: 'Production' | 'Preview',
): { csv: string; exportedAt: string } {
  const parsed = parseExportSnapshot(type, input);
  const exportedAt = parsed.exported_at;
  if (type === 'inventory') {
    const rows = snapshot(inventoryRow).parse(parsed).rows;
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
      'Exported At (UTC)',
      'Environment',
    ];
    return {
      exportedAt,
      csv:
        '\uFEFF' +
        [
          headers.map(csvText).join(','),
          ...rows.map((row) =>
            [
              csvText(row.entity_id),
              csvText(
                row.kind === 'quantity' ? 'Quantity' : 'Serialized asset',
              ),
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
              csvText(exportedAt),
              csvText(environment),
            ].join(','),
          ),
        ].join('\r\n') +
        '\r\n',
    };
  }
  const rows = snapshot(lowStockRow).parse(parsed).rows;
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
  ];
  return {
    exportedAt,
    csv:
      '\uFEFF' +
      [
        headers.map(csvText).join(','),
        ...rows.map((row) =>
          [
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
          ].join(','),
        ),
      ].join('\r\n') +
      '\r\n',
  };
}
