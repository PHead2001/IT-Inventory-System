import { custodyEventLabel } from '@/features/custody/vocabulary';
import type { HistoryEvent } from './contracts-ui';
import { countLabel } from '@/lib/count';

const eventNames: Record<string, string> = {
  created: 'Created',
  received: 'Stock received',
  moved: 'Physically moved',
  adjusted: 'Physical count corrected',
  metadata_updated: 'Details updated',
  archived: 'Quantity item archived',
  restored: 'Restored',
  location_corrected: 'Recorded location corrected',
  retired: 'Asset retired',
};
export const historyEventTitle = (event: HistoryEvent) =>
  event.eventType.startsWith('site_')
    ? custodyEventLabel(event.eventType, event.kind)
    : (eventNames[event.eventType] ?? 'Inventory updated');

type LedgerLine = HistoryEvent['lines'][number];
const locationLabel = (location: HistoryEvent['fromLocation']) =>
  location?.breadcrumb.trim() || 'Location label unavailable';
function consistentLine(line: LedgerLine) {
  return (
    Number.isSafeInteger(line.delta) &&
    Number.isSafeInteger(line.before) &&
    Number.isSafeInteger(line.after) &&
    line.before >= 0 &&
    line.after >= 0 &&
    line.after - line.before === line.delta
  );
}
function endpointSummary(event: HistoryEvent) {
  if (event.fromLocation?.id === event.toLocation?.id && event.toLocation)
    return `At ${locationLabel(event.toLocation)}`;
  if (event.fromLocation && event.toLocation)
    return `${locationLabel(event.fromLocation)} → ${locationLabel(event.toLocation)}`;
  if (event.toLocation) return `To ${locationLabel(event.toLocation)}`;
  if (event.fromLocation) return `From ${locationLabel(event.fromLocation)}`;
  return null;
}

export function siteCountCorrectionSummary(siteName: string | null) {
  return `Count corrected at ${siteName?.trim() || 'recorded site'}`;
}
export function assignmentEndpointSummary(
  assignment: NonNullable<HistoryEvent['assignment']>,
) {
  const same = Boolean(
    (assignment.from.locationId &&
      assignment.from.locationId === assignment.to.locationId) ||
    (assignment.from.siteId && assignment.from.siteId === assignment.to.siteId),
  );
  const label = (
    endpoint: typeof assignment.from,
    side: 'Source' | 'Destination',
  ) =>
    endpoint.label?.trim() ||
    (endpoint.locationId || endpoint.siteId
      ? `${side} label unavailable`
      : `No recorded ${side.toLowerCase()}`);
  return same
    ? `At ${assignment.to.label?.trim() || assignment.from.label?.trim() || 'Location label unavailable'}`
    : `${label(assignment.from, 'Source')} → ${label(assignment.to, 'Destination')}`;
}

/** Amounts come only from immutable event lines/custody snapshots, never holdings. */
export function historySummary(event: HistoryEvent): string | null {
  if (
    event.kind === 'quantity' &&
    (event.eventType === 'site_corrected' ||
      event.assignment?.kind === 'corrected')
  )
    return siteCountCorrectionSummary(event.assignment?.from.label ?? null);
  if (event.assignment) {
    const amount =
      event.assignment.quantity === null
        ? event.kind === 'quantity'
          ? 'Amount not recorded · '
          : ''
        : countLabel(event.assignment.quantity, 'unit') + ' · ';
    return amount + assignmentEndpointSummary(event.assignment);
  }
  if (event.eventType === 'metadata_updated') {
    const fields = event.metadataChanges.map((change) => change.field);
    if (event.customMetadataChanged) fields.push('Custom fields');
    return fields.length ? `Changed: ${fields.join(', ')}` : null;
  }
  if (event.kind === 'quantity' && event.eventType === 'moved') {
    if (
      event.lines.length > 0 &&
      event.lines.every((line) => consistentLine(line) && line.delta === 0)
    )
      return 'No stock change recorded';
    const source = event.lines.find((line) => line.delta < 0);
    const destination = event.lines.find((line) => line.delta > 0);
    if (
      event.lines.length === 2 &&
      source &&
      destination &&
      event.lines.every(consistentLine) &&
      source.location.id !== destination.location.id &&
      -source.delta === destination.delta
    )
      return `${countLabel(destination.delta, 'unit')} · ${locationLabel(source.location)} → ${locationLabel(destination.location)}`;
    return 'Amount not recorded · Inspect recorded ledger lines';
  }
  if (event.kind === 'quantity' && event.eventType === 'received') {
    const [line] = event.lines;
    if (event.lines.length === 1 && line.delta === 0 && consistentLine(line))
      return `No stock change recorded · ${locationLabel(line.location)}`;
    return event.lines.length === 1 && line.delta > 0 && consistentLine(line)
      ? `${countLabel(line.delta, 'unit')} received · ${locationLabel(line.location)}`
      : 'Amount not recorded · Inspect recorded ledger lines';
  }
  if (event.kind === 'quantity' && event.eventType === 'adjusted') {
    const [line] = event.lines;
    return event.lines.length === 1 && consistentLine(line)
      ? `${line.before} → ${countLabel(line.after, 'unit')} (${line.delta > 0 ? '+' : ''}${line.delta}) · ${locationLabel(line.location)}`
      : 'Count details unavailable · Inspect recorded ledger lines';
  }
  if (event.eventType === 'created' && event.kind === 'quantity') {
    const [line] = event.lines;
    if (event.lines.length === 1 && line.delta > 0 && consistentLine(line))
      return `${countLabel(line.delta, 'unit')} opening stock · ${locationLabel(line.location)}`;
  }
  const endpoints = endpointSummary(event);
  if (endpoints) return endpoints;
  // The heading already names these operations. Details retain their snapshots/reason.
  if (eventNames[event.eventType] || event.eventType.startsWith('site_'))
    return null;
  if (event.metadataChanges.length || event.customMetadataChanged)
    return 'Record details updated';
  return 'Historical operation details unavailable';
}
