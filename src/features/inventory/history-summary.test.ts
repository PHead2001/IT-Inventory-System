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
  // The quantity history view intentionally exposes endpoints only in lines.
  fromLocation: null,
  toLocation: null,
  lines: [
    { location: from, delta: -3, before: 8, after: 5 },
    { location: to, delta: 3, before: 1, after: 4 },
  ],
  metadataChanges: [],
  customMetadataPresent: false,
  customMetadataChanged: false,
};
it('collapses unchanged snapshot identity to At while preserving actual moves between equally named sites', () => {
  const assignment = {
    eventId: 'assignment',
    kind: 'retired',
    quantity: null,
    from: { locationId: null, siteId: 'site', label: 'Recorded site' },
    to: { locationId: null, siteId: 'site', label: 'Recorded site' },
    reference: null,
  };
  expect(historySummary({ ...event, kind: 'asset', assignment })).toBe(
    'At Recorded site',
  );
  expect(
    historySummary({
      ...event,
      kind: 'asset',
      assignment: { ...assignment, to: { ...assignment.to, siteId: 'other' } },
    }),
  ).toBe('Recorded site → Recorded site');
  expect(
    historySummary({
      ...event,
      kind: 'asset',
      eventType: 'location_corrected',
      fromLocation: from,
      toLocation: from,
    }),
  ).toBe('At Original source');
});
it('summarizes moved amount from balanced recorded deltas, not current balance or repeated item names', () => {
  expect(historySummary(event)).toBe('3 units · Original source → Destination');
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
it('summarizes a real one-sided receipt from its ledger, regardless of endpoint fields or line order', () => {
  expect(historySummary({ ...event, lines: [...event.lines].reverse() })).toBe(
    '3 units · Original source → Destination',
  );
  expect(
    historySummary({
      ...event,
      eventType: 'received',
      lines: [event.lines[1]],
    }),
  ).toBe('3 units received · Destination');
  expect(
    historySummary({ ...event, eventType: 'received', lines: event.lines }),
  ).toContain('Amount not recorded');
});
it('does not invent a transfer for missing, zero, inconsistent or ambiguous ledger lines', () => {
  for (const lines of [
    [],
    [event.lines[1]],
    [{ ...event.lines[0], after: 7 }, event.lines[1]],
    [event.lines[0], { ...event.lines[1], location: from }],
  ]) {
    const summary = historySummary({ ...event, lines });
    expect(summary).toContain('Amount not recorded');
    expect(summary).not.toContain('→');
  }
});
it('identifies recorded zero-change ledger events without inventing a transfer or receipt', () => {
  const lines = event.lines.map((line) => ({
    ...line,
    delta: 0,
    after: line.before,
  }));
  expect(historySummary({ ...event, lines })).toBe('No stock change recorded');
  expect(
    historySummary({ ...event, eventType: 'received', lines: [lines[0]] }),
  ).toBe('No stock change recorded · Original source');
});
it('retains recorded corrections and distinguishes missing labels from missing amounts', () => {
  expect(
    historySummary({
      ...event,
      eventType: 'adjusted',
      lines: [event.lines[0]],
    }),
  ).toBe('8 → 5 units (-3) · Original source');
  expect(
    historySummary({
      ...event,
      eventType: 'adjusted',
      lines: [{ ...event.lines[0], delta: 0, after: 8 }],
    }),
  ).toBe('8 → 8 units (0) · Original source');
  expect(
    historySummary({
      ...event,
      lines: [
        event.lines[0],
        { ...event.lines[1], location: location('to', '') },
      ],
    }),
  ).toBe('3 units · Original source → Location label unavailable');
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
it('distinguishes an unavailable custody label from an absent endpoint', () => {
  const assignment = {
    eventId: 'assignment',
    kind: 'issued',
    quantity: 2,
    from: { locationId: 'storage', siteId: null, label: null },
    to: { locationId: null, siteId: 'site', label: '' },
    reference: null,
  };
  expect(historySummary({ ...event, assignment })).toBe(
    '2 units · Source label unavailable → Destination label unavailable',
  );
  expect(
    historySummary({
      ...event,
      assignment: {
        ...assignment,
        from: { ...assignment.from, locationId: null },
      },
    }),
  ).toBe('2 units · No recorded source → Destination label unavailable');
});
it('keeps metadata, corrections and unknown legacy operations distinct', () => {
  expect(
    historySummary({ ...event, eventType: 'metadata_updated' }),
  ).toBeNull();
  expect(
    historySummary({
      ...event,
      eventType: 'metadata_updated',
      metadataChanges: [
        { field: 'Name', before: 'Cable', after: 'Patch cable' },
      ],
      customMetadataChanged: true,
    }),
  ).toBe('Changed: Name, Custom fields');
  expect(historySummary({ ...event, eventType: 'adjusted' })).toContain(
    'Count details unavailable',
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
it.each([5, null])(
  'summarizes site count corrections without deriving direction from unsigned quantity %s',
  (quantity) => {
    expect(
      historySummary({
        ...event,
        eventType: 'site_corrected',
        lines: [],
        assignment: {
          eventId: 'correction',
          kind: 'corrected',
          quantity,
          from: { locationId: null, siteId: 'site', label: 'Historical site' },
          to: { locationId: null, siteId: null, label: null },
          reference: null,
        },
      }),
    ).toBe('Count corrected at Historical site');
  },
);
it('does not turn an asset custody correction into a quantity count correction', () => {
  expect(
    historySummary({
      ...event,
      kind: 'asset',
      eventType: 'site_corrected',
      lines: [],
      assignment: {
        eventId: 'correction',
        kind: 'corrected',
        quantity: null,
        from: { locationId: null, siteId: 'site', label: 'Historical site' },
        to: { locationId: null, siteId: 'other', label: 'Corrected site' },
        reference: null,
      },
    }),
  ).toBe('Historical site → Corrected site');
});
