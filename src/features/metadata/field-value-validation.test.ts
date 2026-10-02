import { describe, expect, it } from 'vitest';
import { resolveWallTime, wallTimeAt } from './datetime-adapter';
import {
  fieldValueError,
  instantMicros,
  type MetadataField,
} from './field-value-validation';
const field = (type: MetadataField['type'], rules = {}): MetadataField => ({
  id: 'f',
  type,
  label: 'Example',
  required: false,
  applies_to: ['quantity'],
  rules,
  options: [],
});
describe('metadata answer adapters', () => {
  it('resolves UTC and local wall times without changing microseconds', () => {
    const instant = '2026-10-01T18:12:34.123456Z';
    expect(wallTimeAt(instant, 'America/Chicago')).toBe(
      '2026-10-01T13:12:34.123456',
    );
    expect(
      resolveWallTime('2026-10-01T13:12:34.123456', 'America/Chicago'),
    ).toEqual([{ instant, offset: 'UTC-05:00' }]);
    expect(wallTimeAt('0099-10-01T12:00:00Z', 'UTC')).toBe(
      '0099-10-01T12:00:00',
    );
    expect(wallTimeAt(instant, 'Asia/Kathmandu')).toBe(
      '2026-10-01T23:57:34.123456',
    );
  });
  it('handles the supported year edges without invalid sampling or boundary-crossing instants', () => {
    for (const wall of ['0001-01-01T00:00:00', '9999-12-31T23:59:59'])
      expect(resolveWallTime(wall, 'UTC')).toEqual([
        { instant: wall + 'Z', offset: 'UTC+00:00' },
      ]);
    expect(resolveWallTime('0001-01-01T00:00:00', 'Asia/Tokyo')).toEqual([]);
    expect(resolveWallTime('9999-12-31T23:59:59', 'America/Chicago')).toEqual(
      [],
    );
    expect(wallTimeAt('0001-01-01T00:00:00Z', 'America/Chicago')).toBe('');
  });
  it('rejects nonexistent DST wall times and exposes both repeated offsets', () => {
    expect(resolveWallTime('1870-01-01T12:00:00', 'America/Chicago')).toEqual([
      { instant: '1870-01-01T17:50:36Z', offset: 'UTC-05:50:36' },
    ]);
    expect(resolveWallTime('2026-03-08T02:30:00', 'America/Chicago')).toEqual(
      [],
    );
    expect(resolveWallTime('2026-11-01T01:30:00', 'America/Chicago')).toEqual([
      { instant: '2026-11-01T06:30:00Z', offset: 'UTC-05:00' },
      { instant: '2026-11-01T07:30:00Z', offset: 'UTC-06:00' },
    ]);
    expect(resolveWallTime('2026-02-30T12:00', 'UTC')).toEqual([]);
    expect(resolveWallTime('2026-10-01T25:00', 'UTC')).toEqual([]);
  });
  it('keeps unset, false, zero, empty text and empty selections distinct', () => {
    expect(
      fieldValueError({ ...field('boolean'), required: true }, false),
    ).toBe('');
    expect(
      fieldValueError({ ...field('boolean'), required: true }, undefined),
    ).not.toBe('');
    expect(fieldValueError(field('integer'), 0)).toBe('');
    expect(fieldValueError(field('short_text'), '')).toBe('');
    expect(fieldValueError(field('multi_select'), [])).toBe('');
    expect(fieldValueError(field('integer'), '')).not.toBe('');
    expect(fieldValueError(field('integer'), '-')).not.toBe('');
    expect(fieldValueError(field('integer'), 1.5)).not.toBe('');
  });
  it('compares decimal and currency limits exactly without rounding', () => {
    const decimal = field('decimal', {
      precision: 6,
      min: '9007199254740992.000001',
      max: '9007199254740992.000002',
    });
    expect(fieldValueError(decimal, '9007199254740992.000001')).toBe('');
    expect(fieldValueError(decimal, '9007199254740992.000000')).not.toBe('');
    expect(fieldValueError(decimal, '9007199254740992.000003')).not.toBe('');
    expect(
      fieldValueError(field('decimal', { precision: 2 }), '1.234'),
    ).toMatch(/not be rounded/);
    expect(
      fieldValueError(
        field('currency', { precision: 2, currencyCode: 'USD', min: '0' }),
        { amount: '0.00', currency: 'USD' },
      ),
    ).toBe('');
    expect(
      fieldValueError(
        field('currency', { precision: 2, currencyCode: 'USD' }),
        { amount: '1.234', currency: 'USD' },
      ),
    ).not.toBe('');
  });
  it('validates dates, exact instant bounds, text length and safe HTTP links', () => {
    expect(
      fieldValueError(field('date', { min: '2026-10-01' }), '2026-09-30'),
    ).not.toBe('');
    expect(fieldValueError(field('date'), '2026-02-30')).not.toBe('');
    const datetime = field('datetime', { min: '2026-10-01T12:00:00.123456Z' });
    expect(fieldValueError(datetime, '2026-10-01T07:00:00.123456-05:00')).toBe(
      '',
    );
    expect(fieldValueError(datetime, '2026-10-01T12:00:00.123455Z')).not.toBe(
      '',
    );
    expect(instantMicros('2026-10-01T12:00:00')).toBeNull();
    expect(
      fieldValueError(field('short_text', { minLength: 2 }), '😀'),
    ).not.toBe('');
    expect(fieldValueError(field('long_text'), 'a\nb')).toBe('');
    expect(fieldValueError(field('url'), 'https://example.com/manual')).toBe(
      '',
    );
    expect(
      fieldValueError(field('url'), 'https://user:pass@example.com'),
    ).not.toBe('');
    expect(fieldValueError(field('url'), 'javascript:alert(1)')).not.toBe('');
  });
  it('allows nonleaf selections but rejects retired and duplicate new choices', () => {
    const choices = [
      { id: 'parent', label: 'USB', active: true, parent_id: null },
      { id: 'child', label: 'USB-C', active: true, parent_id: 'parent' },
      { id: 'old', label: 'Old', active: false, parent_id: null },
    ];
    expect(
      fieldValueError(
        { ...field('hierarchical_select'), options: choices },
        'parent',
      ),
    ).toBe('');
    expect(
      fieldValueError({ ...field('single_select'), options: choices }, 'old'),
    ).not.toBe('');
    expect(
      fieldValueError({ ...field('multi_select'), options: choices }, [
        'child',
        'child',
      ]),
    ).not.toBe('');
  });
});
