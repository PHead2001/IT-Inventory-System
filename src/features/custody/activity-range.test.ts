import { describe, expect, it } from 'vitest';
import { parseActivityRange, resolveActivityPreset } from './activity-range';

describe('activity URL boundary validation', () => {
  for (const [from, until] of [
    ['2026-10-08T00:00', '2026-10-07T00:00'],
    ['2026-10-07T00:00', '2026-10-07T00:00'],
  ]) {
    it(`rejects a non-increasing range ${from} / ${until}`, () => {
      expect(parseActivityRange({ from, until })).toMatchObject({
        valid: false,
        errors: { until: expect.stringContaining('Until must be later') },
      });
    });
  }
  for (const from of [
    '2026-02-30T00:00',
    '2026-10-07',
    'garbage',
    ['2026-10-07T00:00'],
    '0000-01-01T00:00:00Z',
    '2026-10-07T25:00:00Z',
  ]) {
    it(`rejects malformed direct URLs ${String(from)}`, () =>
      expect(parseActivityRange({ from }).valid).toBe(false));
  }
  it('preserves one-sided UTC and offset instants and legacy UTC wall-time semantics', () => {
    expect(parseActivityRange({ from: '2026-10-07T00:00' })).toMatchObject({
      valid: true,
      from: '2026-10-07T00:00:00.000Z',
      until: null,
    });
    expect(
      parseActivityRange({ until: '2026-10-07T00:00:00-05:00' }),
    ).toMatchObject({
      valid: true,
      from: null,
      until: '2026-10-07T05:00:00.000Z',
    });
  });
});
describe('named-zone calendar activity presets', () => {
  it.each([
    [
      '2026-03-08T18:00:00Z',
      '2026-03-08T06:00:00.000Z',
      '2026-03-09T05:00:00.000Z',
      23,
    ],
    [
      '2026-11-01T18:00:00Z',
      '2026-11-01T05:00:00.000Z',
      '2026-11-02T06:00:00.000Z',
      25,
    ],
  ])('resolves Today across DST at %s', (now, from, until, hours) => {
    const range = resolveActivityPreset(
      'today',
      'America/Chicago',
      new Date(now),
    );
    expect(range).toEqual({ from, until });
    expect((Date.parse(range.until) - Date.parse(range.from)) / 3600000).toBe(
      hours,
    );
  });
  it('uses the browser-selected calendar day rather than the UTC/server day', () => {
    expect(
      resolveActivityPreset(
        'today',
        'America/Los_Angeles',
        new Date('2027-01-01T01:00:00Z'),
      ),
    ).toEqual({
      from: '2026-12-31T08:00:00.000Z',
      until: '2027-01-01T08:00:00.000Z',
    });
  });
  it('uses seven calendar dates including today through a DST transition', () => {
    expect(
      resolveActivityPreset(
        'last7',
        'America/Chicago',
        new Date('2026-03-09T17:00:00Z'),
      ),
    ).toEqual({
      from: '2026-03-03T06:00:00.000Z',
      until: '2026-03-10T05:00:00.000Z',
    });
  });
  it('resolves Yesterday on the prior date across a year boundary and supports explicit UTC', () => {
    expect(
      resolveActivityPreset(
        'yesterday',
        'UTC',
        new Date('2027-01-01T01:00:00Z'),
      ),
    ).toEqual({
      from: '2026-12-31T00:00:00.000Z',
      until: '2027-01-01T00:00:00.000Z',
    });
    expect(() => resolveActivityPreset('today', 'invalid-zone')).toThrow();
  });
});
