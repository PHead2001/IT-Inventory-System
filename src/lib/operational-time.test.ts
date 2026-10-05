import { describe, expect, it, vi } from 'vitest';
import {
  formatOperationalTimestamp,
  resolveDisplayTimeZone,
  exportTimeZoneHref,
  browserDisplayTimeZone,
} from './operational-time';
const at = '2026-10-03T05:23:06.123456Z';
const format = (value: unknown, zone: unknown = 'UTC') =>
  formatOperationalTimestamp(value, resolveDisplayTimeZone(zone));
describe('operational time presentation', () => {
  it('uses explicit UTC fallback if browser zone resolution is unavailable', () => {
    const browser = vi
      .spyOn(Intl, 'DateTimeFormat')
      .mockImplementationOnce(() => {
        throw new RangeError('Zone resolution unavailable');
      });
    try {
      expect(browserDisplayTimeZone()).toEqual({
        timeZone: 'UTC',
        fallback: true,
      });
    } finally {
      browser.mockRestore();
    }
  });
  it.each([
    ['UTC', '3 Oct 2026, 05:23:06 UTC'],
    [
      'America/Los_Angeles',
      '2 Oct 2026, 22:23:06 UTC-07:00 (America/Los_Angeles)',
    ],
    ['Asia/Kolkata', '3 Oct 2026, 10:53:06 UTC+05:30 (Asia/Calcutta)'],
  ])(
    'shows the same source instant in %s without changing subseconds',
    (zone, text) => {
      const result = format(at, zone);
      // Runtime IANA canonical aliases can differ; displayed context matches the validated zone.
      expect(result?.text.replace('Asia/Kolkata', 'Asia/Calcutta')).toBe(text);
      expect(result?.dateTime).toBe(at);
    },
  );
  it('handles a leap-day rollover and does not shift an explicit offset twice', () => {
    expect(format('2024-03-01T00:30:00Z', 'America/Los_Angeles')?.text).toBe(
      '29 Feb 2024, 16:30:00 UTC-08:00 (America/Los_Angeles)',
    );
    expect(format('2026-10-02T22:23:06.123456-07:00')?.text).toBe(
      '3 Oct 2026, 05:23:06 UTC',
    );
  });
  it('distinguishes DST repeated wall times by each event offset and round trips the original instant', () => {
    const values = ['2026-11-01T05:30:00Z', '2026-11-01T06:30:00Z'];
    const displays = values.map((value) => format(value, 'America/New_York')!);
    expect(displays.map((row) => row.text)).toEqual([
      '1 Nov 2026, 01:30:00 UTC-04:00 (America/New_York)',
      '1 Nov 2026, 01:30:00 UTC-05:00 (America/New_York)',
    ]);
    displays.forEach((row, index) => {
      const offset = row.offset.replace('UTC', '');
      expect(new Date('2026-11-01T01:30:00' + offset).toISOString()).toBe(
        values[index].replace('Z', '.000Z'),
      );
    });
    expect(format('2026-03-08T06:59:59Z', 'America/New_York')?.offset).toBe(
      'UTC-05:00',
    );
    expect(format('2026-03-08T07:00:00Z', 'America/New_York')?.offset).toBe(
      'UTC-04:00',
    );
  });
  it('retains historical offset seconds when the IANA rule needs them', () => {
    expect(format('1900-01-01T00:00:00Z', 'Europe/Paris')?.text).toBe(
      '1 Jan 1900, 00:09:21 UTC+00:09:21 (Europe/Paris)',
    );
  });
  it.each([
    null,
    undefined,
    '',
    0,
    new Date(at),
    'invalid',
    '2026-02-30T12:00:00Z',
    '2026-10-03',
    '2026-10-03T05:23:06',
    '0000-01-01T00:00:00Z',
  ])('does not invent an instant from %s', (value) => {
    expect(format(value)).toBeNull();
  });
  it.each([
    undefined,
    null,
    '',
    '=CMD()',
    'America/Unknown',
    ' America/Chicago',
    '+05:30',
    'A'.repeat(129),
  ])('bounds and explicitly falls back for zone %s', (zone) => {
    expect(resolveDisplayTimeZone(zone)).toEqual({
      timeZone: 'UTC',
      fallback: true,
    });
    expect(
      formatOperationalTimestamp(at, resolveDisplayTimeZone(zone))?.text,
    ).toBe('3 Oct 2026, 05:23:06 UTC (UTC fallback)');
  });
  it('preserves export filter values, custom opt-in, fragments and ordinary anchor destinations', () => {
    const href = exportTimeZoneHref(
      '/api/exports/inventory?q=100%25_%5C&site=s&customFields=true&export=low_stock#download',
      'America/Los_Angeles',
    );
    const url = new URL(href, 'https://inventory.invalid');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      q: '100%_\\',
      site: 's',
      customFields: 'true',
      export: 'low_stock',
      displayTimeZone: 'America/Los_Angeles',
    });
    expect(url.hash).toBe('#download');
    expect(exportTimeZoneHref('/history?site=s#event', 'UTC')).toBe(
      '/history?site=s#event',
    );
    expect(
      exportTimeZoneHref('https://other.invalid/api/exports/inventory', 'UTC'),
    ).toBe('https://other.invalid/api/exports/inventory');
  });
  it('omits fallback zones even when a link already has an override, while retaining resolved UTC', () => {
    const href =
      '/api/exports/inventory?q=Cable&displayTimeZone=America%2FNew_York#csv';
    expect(exportTimeZoneHref(href, { timeZone: 'UTC', fallback: true })).toBe(
      '/api/exports/inventory?q=Cable#csv',
    );
    expect(exportTimeZoneHref(href, { timeZone: 'UTC', fallback: false })).toBe(
      '/api/exports/inventory?q=Cable&displayTimeZone=UTC#csv',
    );
  });
});
