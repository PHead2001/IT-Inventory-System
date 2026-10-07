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
  it.each([
    ['2026-10-07T00:00:00.000001Z', '2026-10-07T00:00:00.000999Z'],
    ['1969-12-31T23:59:59.999998Z', '1969-12-31T23:59:59.999999Z'],
    ['1969-12-31T23:59:59.999999Z', '1970-01-01T00:00:00.000001Z'],
    ['0001-01-01T00:00:00.000001Z', '0001-01-01T00:00:00.000002Z'],
    ['9999-12-31T23:59:59.999998Z', '9999-12-31T23:59:59.999999Z'],
  ])(
    'preserves and orders exact microsecond boundaries %s / %s',
    (from, until) => {
      expect(parseActivityRange({ from, until })).toEqual({
        from,
        until,
        errors: {},
        valid: true,
      });
      expect(parseActivityRange({ from: until, until: from })).toMatchObject({
        valid: false,
        errors: { until: expect.stringContaining('Until must be later') },
      });
    },
  );
  it.each([
    ['2026-10-07T00:00:00.123456-05:30', '2026-10-07T05:30:00.123456Z'],
    ['2026-01-01T00:00:00.000001+01:00', '2025-12-31T23:00:00.000001Z'],
    ['1969-12-31T23:59:59.999999-00:01', '1970-01-01T00:00:59.999999Z'],
    ['2024-02-29T23:59:59.1234-00:01', '2024-03-01T00:00:59.1234Z'],
    ['2026-10-07T00:00:00.1Z', '2026-10-07T00:00:00.100Z'],
    ['2026-10-07T00:00:00.123Z', '2026-10-07T00:00:00.123Z'],
  ])('normalizes offsets without changing precision %s', (from, normalized) => {
    expect(parseActivityRange({ from })).toMatchObject({
      from: normalized,
      valid: true,
    });
  });
  it('rejects equal instants expressed using different offsets and precision', () => {
    expect(
      parseActivityRange({
        from: '2026-10-07T00:00:00.000001-05:00',
        until: '2026-10-07T05:00:00.000001Z',
      }),
    ).toMatchObject({ valid: false });
    expect(
      parseActivityRange({
        from: '2026-10-07T00:00:00.1Z',
        until: '2026-10-07T00:00:00.100000Z',
      }),
    ).toMatchObject({ valid: false });
  });
  it.each(['from', 'until'] as const)(
    'rejects unsupported precision on %s with an actionable error',
    (key) => {
      expect(
        parseActivityRange({ [key]: '2026-10-07T00:00:00.1234567Z' }),
      ).toMatchObject({
        [key]: null,
        valid: false,
        errors: {
          [key]: expect.stringContaining('at most 6 fractional digits'),
        },
      });
    },
  );
  it.each([
    '2026-02-29T00:00:00.000001Z',
    '2026-04-31T00:00:00.000001Z',
    '2026-10-07T24:00:00.000001Z',
    '2026-10-07T23:59:60.000001Z',
    '2026-10-07T00:00:00.000001+24:00',
    '2026-10-07T00:00:00.000001+00:60',
    '2026-10-07T00:00:00.000001',
    '0001-01-01T00:00:00.000001+00:01',
    '9999-12-31T23:59:59.999999-00:01',
  ])(
    'rejects invalid calendars, offsets, and unsupported year rollover %s',
    (from) => {
      expect(parseActivityRange({ from })).toMatchObject({
        from: null,
        valid: false,
      });
    },
  );
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
