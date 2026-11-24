import { z } from 'zod';
import { parseActivityRange } from '@/features/custody/activity-range';
import { resolveDisplayTimeZone } from '@/lib/operational-time';
import { historyEventNames } from './history-summary';

export type HistoryParams = Record<string, string | undefined>;
// The persisted kind constraints in integrated_custody_locations, not the
// union of display labels: some events exist for only one tracking type.
export const historyEventsByType = {
  quantity: [
    'created',
    'received',
    'moved',
    'adjusted',
    'metadata_updated',
    'archived',
    'restored',
    'site_opened',
    'site_issued',
    'site_returned',
    'site_transferred',
    'site_corrected',
    'site_written_off',
  ],
  asset: [
    'created',
    'moved',
    'location_corrected',
    'metadata_updated',
    'retired',
    'restored',
    'site_opened',
    'site_assigned',
    'site_returned',
    'site_transferred',
    'site_corrected',
    'site_written_off',
    'site_retired',
  ],
} as const;
export function isHistoryEventCompatible(type: string, eventType: string) {
  if (!['all', 'quantity', 'asset'].includes(type)) return false;
  if (eventType === 'all' || eventType === 'movements') return true;
  if (!Object.hasOwn(historyEventNames, eventType)) return false;
  return (
    type === 'all' ||
    historyEventsByType[type as 'quantity' | 'asset'].some(
      (event) => event === eventType,
    )
  );
}
export const historyFilterKeys = [
  'type',
  'location',
  'entityId',
  'q',
  'actor',
  'eventType',
  'from',
  'until',
  'zone',
] as const;
export function parseHistoryFilters(input: HistoryParams) {
  const range = parseActivityRange(input);
  const errors: Record<string, string> = { ...range.errors };
  const uuid = (key: 'entityId' | 'actor') => {
    if (input[key] === undefined || (key === 'actor' && input[key] === ''))
      return null;
    if (!z.uuid().safeParse(input[key]).success) {
      errors[key] =
        key === 'actor'
          ? 'Choose a person from history.'
          : 'Record filter is invalid.';
      return null;
    }
    return input[key]!.toLowerCase();
  };
  const type = input.type || 'all';
  if (!['all', 'quantity', 'asset'].includes(type))
    errors.type = 'Choose a tracking type.';
  const eventType = input.eventType || 'all';
  if (
    eventType !== 'all' &&
    eventType !== 'movements' &&
    !Object.hasOwn(historyEventNames, eventType)
  )
    errors.eventType = 'Choose an event type.';
  else if (!isHistoryEventCompatible(type, eventType) && !errors.type)
    errors.eventType =
      'This event type is unavailable for the selected tracking type. Choose another event type or clear it.';
  const query = (input.q ?? '').trim();
  if ([...query].length > 200) errors.q = 'Use at most 200 characters.';
  const location = input.location || null;
  if (location && location.length > 200)
    errors.location = 'Choose a valid location.';
  if (input.zone && resolveDisplayTimeZone(input.zone).fallback)
    errors.zone = 'Choose a supported named timezone.';
  const entityId = uuid('entityId');
  const actor = uuid('actor');
  const page = Number(input.page || '1');
  if (!Number.isSafeInteger(page) || page < 1 || page > 100000)
    errors.page = 'Choose a valid history page.';
  return {
    type,
    entityId,
    actor,
    eventType,
    query,
    location,
    from: range.from,
    until: range.until,
    page,
    errors,
    valid: Object.keys(errors).length === 0,
  };
}
/** Preserve invalid input for local errors; never normalize a bad scope into all records. */
export function historyFilterParams(input: HistoryParams, withPage = false) {
  const params = new URLSearchParams();
  for (const key of historyFilterKeys) {
    const value = input[key];
    if (
      value !== undefined &&
      (value !== '' || key === 'entityId') &&
      !((key === 'type' || key === 'eventType') && value === 'all')
    )
      params.set(key, value);
  }
  if (withPage && input.page && input.page !== '1')
    params.set('page', input.page);
  return params;
}
export function historyRpcFilters(input: HistoryParams) {
  const filter = parseHistoryFilters(input);
  if (!filter.valid) throw new Error('History filters are invalid.');
  return {
    p_type: filter.type,
    p_entity_id: filter.entityId,
    p_location_code: filter.location,
    p_query: filter.query,
    p_actor_id: filter.actor,
    p_event_type: filter.eventType,
    p_from: filter.from,
    p_until: filter.until,
  };
}
