import { expect, it } from 'vitest';
import {
  historyFilterParams,
  historyRpcFilters,
  isHistoryEventCompatible,
  parseHistoryFilters,
} from './history-filters';
import { resolveActivityPreset } from '@/features/custody/activity-range';
const actor = '00000000-0000-4000-8000-000000000001';
it.each([
  ['quantity', 'site_opened'],
  ['quantity', 'site_issued'],
  ['quantity', 'site_returned'],
  ['quantity', 'site_transferred'],
  ['quantity', 'site_corrected'],
  ['quantity', 'site_written_off'],
  ['asset', 'site_opened'],
  ['asset', 'site_assigned'],
  ['asset', 'site_returned'],
  ['asset', 'site_transferred'],
  ['asset', 'site_corrected'],
  ['asset', 'site_written_off'],
  ['asset', 'site_retired'],
] as const)(
  'retains persisted custody filter identity for %s %s',
  (type, eventType) => {
    expect(parseHistoryFilters({ type, eventType }).valid).toBe(true);
    expect(historyRpcFilters({ type, eventType }).p_event_type).toBe(eventType);
    expect(parseHistoryFilters({ type: 'all', eventType }).valid).toBe(true);
  },
);
it('passes every applied filter literally and preserves microseconds', () => {
  expect(
    historyRpcFilters({
      type: 'quantity',
      entityId: actor,
      actor,
      location: 'ITC',
      q: ' %_\\ 😀 ',
      eventType: 'movements',
      from: '2026-11-01T01:59:59.123456-05:00',
      until: '2026-11-01T01:59:59.123457-05:00',
    }),
  ).toEqual({
    p_type: 'quantity',
    p_entity_id: actor,
    p_actor_id: actor,
    p_location_code: 'ITC',
    p_query: '%_\\ 😀',
    p_event_type: 'movements',
    p_from: '2026-11-01T06:59:59.123456Z',
    p_until: '2026-11-01T06:59:59.123457Z',
  });
});
it.each([
  { actor: 'bad' },
  { entityId: 'bad' },
  { entityId: '' },
  { eventType: 'made-up' },
  { type: 'quantity', eventType: 'retired' },
  { type: 'asset', eventType: 'received' },
  { type: 'bad' },
  { q: '😀'.repeat(201) },
  { from: '2026-10-01T00:00:00.1234567Z' },
  { from: '2026-10-02T00:00:00Z', until: '2026-10-01T00:00:00Z' },
  { zone: 'not-a-zone' },
  { page: '1.5' },
])(
  'retains invalid URL input and refuses broadened RPC filters: %j',
  (params) => {
    expect(parseHistoryFilters(params).valid).toBe(false);
    expect(() => historyRpcFilters(params)).toThrow(
      'History filters are invalid.',
    );
    expect(historyFilterParams(params, true).size).toBeGreaterThan(0);
  },
);
it.each([
  ['quantity', 'location_corrected'],
  ['quantity', 'retired'],
  ['quantity', 'site_assigned'],
  ['quantity', 'site_retired'],
  ['asset', 'received'],
  ['asset', 'adjusted'],
  ['asset', 'archived'],
  ['asset', 'site_issued'],
])(
  'rejects incompatible %s/%s without removing the URL selection',
  (type, eventType) => {
    expect(isHistoryEventCompatible(type, eventType)).toBe(false);
    expect(parseHistoryFilters({ type, eventType }).errors.eventType).toMatch(
      /unavailable/,
    );
    expect(historyFilterParams({ type, eventType }).get('eventType')).toBe(
      eventType,
    );
    expect(() => historyRpcFilters({ type, eventType })).toThrow();
    expect(parseHistoryFilters({ type: 'all', eventType }).valid).toBe(true);
  },
);
it.each(['all', 'quantity', 'asset'])(
  'allows shared groups and site write-off for %s',
  (type) => {
    for (const eventType of ['all', 'movements', 'site_written_off'])
      expect(parseHistoryFilters({ type, eventType }).valid).toBe(true);
  },
);
it('defines last week as previous Monday to this Monday across named-zone DST', () => {
  expect(
    resolveActivityPreset(
      'lastweek',
      'America/Chicago',
      new Date('2026-11-04T12:00:00Z'),
    ),
  ).toEqual({
    from: '2026-10-26T05:00:00.000Z',
    until: '2026-11-02T06:00:00.000Z',
  });
  expect(
    resolveActivityPreset(
      'last7',
      'America/Chicago',
      new Date('2026-11-04T12:00:00Z'),
    ),
  ).toEqual({
    from: '2026-10-29T05:00:00.000Z',
    until: '2026-11-05T06:00:00.000Z',
  });
  expect(
    resolveActivityPreset(
      'lastweek',
      'America/Chicago',
      new Date('2026-03-09T12:00:00Z'),
    ),
  ).toEqual({
    from: '2026-03-02T06:00:00.000Z',
    until: '2026-03-09T05:00:00.000Z',
  });
});
