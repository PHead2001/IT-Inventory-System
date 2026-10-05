import { expect, it } from 'vitest';
import { displayedInstant } from '../helpers/displayed-instant';

it.each(['Sep', 'Sept'])(
  'correlates %s evidence with the canonical date across midnight and offsets',
  (month) => {
    expect(
      displayedInstant(
        `30 ${month} 2026, 23:23:06 UTC-07:00 (America/Los_Angeles)`,
      ),
    ).toBe(Date.parse('2026-10-01T06:23:06Z'));
  },
);
it('retains UTC fallback and half-hour offset evidence', () => {
  expect(displayedInstant('1 Sept 2026, 00:00:00 UTC (UTC fallback)')).toBe(
    Date.parse('2026-09-01T00:00:00Z'),
  );
  expect(
    displayedInstant('1 Sept 2026, 05:30:00 UTC+05:30 (Asia/Kolkata)'),
  ).toBe(Date.parse('2026-09-01T00:00:00Z'));
});
it('rejects unknown months rather than silently producing a different year or month', () => {
  expect(() => displayedInstant('1 Smarch 2026, 00:00:00 UTC')).toThrow(
    'Unrecognized operational month',
  );
});
