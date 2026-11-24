import { z } from 'zod';
import { boundedCsv, csvText } from './export';
import { historyEventLabel } from './history-summary';
import {
  resolveDisplayTimeZone,
  displayTimeZoneLabel,
} from '@/lib/operational-time';

const nullable = z.string().nullable();
const identity = {
  event_id: z.uuid(),
  entity_id: z.uuid(),
  kind: z.enum(['quantity', 'asset']),
};
const event = z.object({
  ...identity,
  row_type: z.literal('event'),
  event_type: z.string(),
  created_at: z.iso.datetime({ offset: true }),
  actor_id: z.uuid(),
  actor_name: z.string(),
  name_current: z.string(),
  name_before: nullable,
  name_after: nullable,
  item_code_current: nullable,
  item_code_before: nullable,
  item_code_after: nullable,
  asset_tag_current: nullable,
  asset_tag_before: nullable,
  asset_tag_after: nullable,
  serial_number_current: nullable,
  serial_number_before: nullable,
  serial_number_after: nullable,
  reason: nullable,
  reference: nullable,
  event_quantity: z.number().int().positive().safe().nullable(),
  from_location_id: z.uuid().nullable(),
  from_location_code: nullable,
  from_label: nullable,
  to_location_id: z.uuid().nullable(),
  to_location_code: nullable,
  to_label: nullable,
  from_site_id: z.uuid().nullable(),
  from_site_code: nullable,
  to_site_id: z.uuid().nullable(),
  to_site_code: nullable,
  endpoint_label_provenance: z.string(),
});
const line = z
  .object({
    ...identity,
    row_type: z.literal('quantity_line'),
    kind: z.literal('quantity'),
    location_id: z.uuid().nullable(),
    location_code: nullable,
    location_label: nullable,
    site_id: z.uuid().nullable(),
    site_code: nullable,
    site_label: nullable,
    before_quantity: z.number().int().nonnegative().safe(),
    delta: z.number().int().safe(),
    after_quantity: z.number().int().nonnegative().safe(),
    line_label_provenance: z.string(),
  })
  .refine(
    (r) =>
      r.after_quantity - r.before_quantity === r.delta &&
      Boolean(r.location_id) !== Boolean(r.site_id),
  );
const snapshot = z.object({
  rows: z.array(z.union([event, line])).max(10000),
  event_count: z.number().int().nonnegative().max(10000),
  row_count: z.number().int().nonnegative().max(10000),
  exported_at: z.iso.datetime({ offset: true }),
});
const eventColumns = {
  event_type: 'Event type (machine)',
  created_at: 'Event time (UTC)',
  actor_id: 'Actor ID',
  actor_name: 'Actor name (recorded)',
  name_current: 'Name (current)',
  name_before: 'Name (recorded before)',
  name_after: 'Name (recorded after)',
  item_code_current: 'Item code (current)',
  item_code_before: 'Item code (recorded before)',
  item_code_after: 'Item code (recorded after)',
  asset_tag_current: 'Asset tag (current)',
  asset_tag_before: 'Asset tag (recorded before)',
  asset_tag_after: 'Asset tag (recorded after)',
  serial_number_current: 'Serial (current)',
  serial_number_before: 'Serial (recorded before)',
  serial_number_after: 'Serial (recorded after)',
  reason: 'Reason',
  reference: 'Reference',
  from_location_id: 'From location ID',
  from_location_code: 'From location code (current)',
  from_label: 'From label',
  to_location_id: 'To location ID',
  to_location_code: 'To location code (current)',
  to_label: 'To label',
  from_site_id: 'From site ID',
  from_site_code: 'From site code (current)',
  to_site_id: 'To site ID',
  to_site_code: 'To site code (current)',
  endpoint_label_provenance: 'Endpoint label provenance',
} as const;
const lineColumns = {
  location_id: 'Line location ID',
  location_code: 'Line location code (current)',
  location_label: 'Line location label (current)',
  site_id: 'Line site ID',
  site_code: 'Line site code (current)',
  site_label: 'Line site label (current)',
  line_label_provenance: 'Line label provenance',
} as const;

export function historyExportCsv(
  input: unknown,
  environment: 'Preview' | 'Production',
  zone: unknown,
  checkDeadline: () => void = () => {},
  onRow?: (bytes: number) => void,
) {
  checkDeadline();
  const parsed = snapshot.parse(input);
  checkDeadline();
  if (parsed.row_count !== parsed.rows.length)
    throw new Error('History row count is inconsistent.');
  const seen = new Set<string>();
  const lines = new Set<string>();
  let currentEvent: string | null = null;
  let currentEntity: string | null = null;
  for (const row of parsed.rows) {
    checkDeadline();
    const key = row.kind + ':' + row.event_id;
    if (row.row_type === 'event') {
      if (seen.has(key)) throw new Error('Duplicate history event.');
      seen.add(key);
      currentEvent = key;
      currentEntity = row.entity_id;
    } else {
      const lineKey =
        key +
        (row.location_id
          ? ':location:' + row.location_id
          : ':site:' + row.site_id);
      if (
        key !== currentEvent ||
        row.entity_id !== currentEntity ||
        !seen.has(key) ||
        lines.has(lineKey)
      )
        throw new Error('History line identity is inconsistent.');
      lines.add(lineKey);
    }
  }
  if (seen.size !== parsed.event_count)
    throw new Error('History event count is inconsistent.');
  const displayZone = displayTimeZoneLabel(resolveDisplayTimeZone(zone));
  function* csvRows() {
    yield [
      'Row type',
      'Event ID',
      'Tracking type',
      'Record ID',
      'Event',
      ...Object.values(eventColumns),
      'Event quantity',
      ...Object.values(lineColumns),
      'Before quantity',
      'Signed delta',
      'After quantity',
      'Snapshot time (UTC)',
      'Environment',
      'Display timezone',
      'Matching events',
      'CSV data rows',
    ]
      .map(csvText)
      .join(',');
    for (const row of parsed.rows) {
      checkDeadline();
      yield [
        csvText(row.row_type),
        csvText(row.event_id),
        csvText(row.kind),
        csvText(row.entity_id),
        csvText(
          row.row_type === 'event'
            ? historyEventLabel(row.event_type, row.kind)
            : '',
        ),
        ...Object.keys(eventColumns).map((key) =>
          csvText(
            row.row_type === 'event'
              ? row[key as keyof typeof eventColumns]
              : null,
          ),
        ),
        row.row_type === 'event' ? String(row.event_quantity ?? '') : '',
        ...Object.keys(lineColumns).map((key) =>
          csvText(
            row.row_type === 'quantity_line'
              ? row[key as keyof typeof lineColumns]
              : null,
          ),
        ),
        ...(row.row_type === 'quantity_line'
          ? [
              String(row.before_quantity),
              String(row.delta),
              String(row.after_quantity),
            ]
          : ['', '', '']),
        csvText(parsed.exported_at),
        csvText(environment),
        csvText(displayZone),
        String(parsed.event_count),
        String(parsed.row_count),
      ].join(',');
    }
  }
  return {
    csv: boundedCsv(csvRows(), checkDeadline, onRow),
    exportedAt: parsed.exported_at,
    eventCount: parsed.event_count,
    rowCount: parsed.row_count,
  };
}
