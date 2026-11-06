import { describe, expect, it } from 'vitest';
import { overviewChartRatio, parseOverviewProjection } from './contracts';

import { overviewFixture } from './test-fixtures';

describe('Overview read contract', () => {
  it('keeps canonical values above JavaScript safe integer precision', () => {
    const fixture = overviewFixture();
    fixture.stock.monitoredItems = '9007199254740993';
    expect(parseOverviewProjection(fixture).stock.monitoredItems).toBe(
      '9007199254740993',
    );
    expect(overviewChartRatio('9007199254740993', '18014398509481986')).toBe(
      0.5,
    );
    expect(overviewChartRatio('1', '0')).toBe(0);
  });
  it('retains inclusive threshold attention without a fabricated shortage', () => {
    expect(
      parseOverviewProjection(overviewFixture()).stock.attention[0]?.shortfall,
    ).toBe('0');
    const fixture = overviewFixture();
    fixture.stock.attention[0]!.shortfall = '1';
    expect(() => parseOverviewProjection(fixture)).toThrow();
  });
  it('rejects floating point/count coercion, wrong dates and oversized responses', () => {
    const fixture = overviewFixture();
    expect(() =>
      parseOverviewProjection({
        ...fixture,
        stock: { ...fixture.stock, monitoredItems: 1 },
      }),
    ).toThrow();
    fixture.activity.points[3]!.date = '2026-10-10';
    expect(() => parseOverviewProjection(fixture)).toThrow();
    expect(() => parseOverviewProjection({ extra: 'x'.repeat(65537) })).toThrow(
      /size limit/,
    );
  });
  it.each([65535, 65536, 65537])(
    'enforces the inclusive UTF-8 response cap at %i bytes with metadata overhead',
    (bytes) => {
      const fixture = overviewFixture();
      // The parser permits additive wire metadata but must budget its bytes
      // before Zod strips it. Keep every known field independently valid.
      const response = { ...fixture, boundaryMetadata: '' };
      const encoder = new TextEncoder();
      const overhead = encoder.encode(JSON.stringify(response)).byteLength;
      const padding = bytes - overhead;
      response.boundaryMetadata =
        '界'.repeat(Math.floor(padding / 3)) + 'x'.repeat(padding % 3);
      const serialized = JSON.stringify(response);
      expect(encoder.encode(serialized).byteLength).toBe(bytes);
      expect(serialized.length).toBeLessThan(65536);
      expect(encoder.encode(response.boundaryMetadata).byteLength).toBeLessThan(
        65536,
      );
      if (bytes <= 65536) {
        expect(parseOverviewProjection(response)).toEqual(fixture);
      } else {
        expect(() => parseOverviewProjection(response)).toThrow(/size limit/);
      }
    },
  );
  it('preserves not-yet-recorded gaps and rejects invented zero endpoints', () => {
    const fixture = overviewFixture();
    const trend = fixture.stockTrends[0]!;
    trend.coverage = 'partial';
    trend.points[0]!.state = 'not_yet_recorded';
    trend.points[0]!.value = null;
    expect(
      parseOverviewProjection(fixture).stockTrends[0]?.points[0]?.value,
    ).toBeNull();
    trend.points[0]!.value = '0';
    expect(() => parseOverviewProjection(fixture)).toThrow();
  });
  it('rejects a today endpoint that disagrees with the same-snapshot balance', () => {
    const fixture = overviewFixture();
    fixture.stockTrends[0]!.points[13]!.value = '4';
    expect(() => parseOverviewProjection(fixture)).toThrow(/reconcile/);
  });
  it('refuses truncated activity dressed as exact counts', () => {
    const fixture = overviewFixture();
    fixture.activity.coverage = 'unavailable';
    expect(() => parseOverviewProjection(fixture)).toThrow();
    const unavailable = {
      ...fixture,
      activity: {
        coverage: 'unavailable',
        reason: 'activity_budget',
        points: fixture.activity.points.map((point) => ({
          ...point,
          value: null,
        })),
      },
    };
    expect(
      parseOverviewProjection(unavailable).activity.points.every(
        (point) => point.value === null,
      ),
    ).toBe(true);
  });
});
