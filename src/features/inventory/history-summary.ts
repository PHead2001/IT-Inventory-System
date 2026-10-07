import type { HistoryEvent } from './contracts-ui';
import { countLabel } from '@/lib/count';

/** Amounts come only from immutable event lines/custody snapshots, never holdings. */
export function historySummary(event: HistoryEvent): string {
  if (event.assignment) {
    const amount =
      event.assignment.quantity === null
        ? event.kind === 'quantity'
          ? 'Amount not recorded · '
          : ''
        : countLabel(event.assignment.quantity, 'unit') + ' · ';
    return (
      amount +
      (event.assignment.from.label ?? 'No recorded source') +
      ' → ' +
      (event.assignment.to.label ?? 'No recorded destination')
    );
  }
  if (event.eventType === 'created') return 'Record created';
  if (event.eventType === 'metadata_updated') return 'Record details updated';
  if (event.kind === 'quantity' && event.eventType === 'moved') {
    const source = event.lines.find(
      (line) => line.location.id === event.fromLocation?.id && line.delta < 0,
    );
    const destination = event.lines.find(
      (line) => line.location.id === event.toLocation?.id && line.delta > 0,
    );
    const amount =
      event.lines.length === 2 &&
      source &&
      destination &&
      source.location.id !== destination.location.id &&
      -source.delta === destination.delta
        ? countLabel(destination.delta, 'unit')
        : 'Amount not recorded';
    return `${amount} · ${event.fromLocation?.breadcrumb ?? 'No recorded source'} → ${event.toLocation?.breadcrumb ?? 'No recorded destination'} (current location labels)`;
  }
  if (event.kind === 'quantity' && event.eventType === 'received') {
    const line = event.lines.find(
      (entry) => entry.location.id === event.toLocation?.id && entry.delta > 0,
    );
    return `${line ? countLabel(line.delta, 'unit') : 'Amount not recorded'} received · ${event.toLocation?.breadcrumb ?? 'No recorded destination'} (current location label)`;
  }
  if (event.kind === 'quantity' && event.eventType === 'adjusted')
    return 'Physical count corrected; recorded before/after quantities in details';
  if (event.eventType === 'archived') return 'Definition archived';
  if (event.eventType === 'restored') return 'Record restored';
  if (event.eventType === 'retired') return 'Asset retired';
  if (event.eventType === 'location_corrected')
    return 'Recorded location corrected';
  if (event.fromLocation || event.toLocation)
    return `${event.fromLocation?.breadcrumb ?? 'No recorded source'} → ${event.toLocation?.breadcrumb ?? 'No recorded destination'} (current location labels)`;
  if (event.metadataChanges.length || event.customMetadataChanged)
    return 'Record details updated';
  return 'Historical operation details unavailable';
}
