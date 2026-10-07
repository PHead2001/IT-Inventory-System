import { expect, it } from 'vitest';
import { historySummary } from './history-summary';
import type { HistoryEvent, LocationRef } from './contracts-ui';
const location = (id: string, breadcrumb: string) =>
  ({ id, breadcrumb }) as LocationRef;
const from = location('from', 'Original source');
const to = location('to', 'Destination');
const event: HistoryEvent = {
  id: 'event',
  entityId: 'item',
  entityName: 'Cable',
  kind: 'quantity',
  eventType: 'moved',
  at: '2026-10-07T12:00:00Z',
  actorName: 'Staff',
  reason: null,
  assignment: null,
  fromLocation: from,
  toLocation: to,
  lines: [
    { location: from, delta: -3, before: 8, after: 5 },
    { location: to, delta: 3, before: 1, after: 4 },
  ],
  metadataChanges: [],
  customMetadataPresent: false,
  customMetadataChanged: false,
};
it('summarizes moved amount from balanced recorded deltas, not current balance or repeated item names', () => {
  expect(historySummary(event)).toBe(
    '3 units · Original source → Destination (current location labels)',
  );
  expect(
    historySummary({
      ...event,
      lines: [{ ...event.lines[0], delta: -4 }, event.lines[1]],
    }),
  ).toContain('Amount not recorded');
  expect(historySummary({ ...event, lines: [] })).toContain(
    'Amount not recorded',
  );
  expect(
    historySummary({
      ...event,
      lines: [
        ...event.lines,
        { ...event.lines[1], location: location('extra', 'Unknown'), delta: 2 },
      ],
    }),
  ).toContain('Amount not recorded');
});
it('uses immutable custody quantity and labels even when current location labels differ', () => {
  expect(
    historySummary({
      ...event,
      eventType: 'site_issued',
      assignment: {
        eventId: 'assignment',
        kind: 'issued',
        quantity: 2,
        from: { locationId: 'from', siteId: null, label: 'Historical closet' },
        to: { locationId: null, siteId: 'site', label: 'Historical site' },
        reference: null,
      },
    }),
  ).toBe('2 units · Historical closet → Historical site');
});
it('keeps metadata, corrections and unknown legacy operations distinct', () => {
  expect(historySummary({ ...event, eventType: 'metadata_updated' })).toBe(
    'Record details updated',
  );
  expect(historySummary({ ...event, eventType: 'adjusted' })).toContain(
    'Physical count corrected',
  );
  expect(
    historySummary({
      ...event,
      eventType: 'legacy',
      fromLocation: null,
      toLocation: null,
      lines: [],
    }),
  ).toBe('Historical operation details unavailable');
});
