import { z } from 'zod';
import { restockShortfall } from '@/features/inventory/restock-shortfall';

// Counts/quantities remain decimal strings through UI, exports and assistive
// text. Only a bounded chart coordinate may be approximated for drawing.
export const overviewCount = z
  .string()
  .max(40)
  .regex(/^(0|[1-9][0-9]*)$/);
const id = z.uuid();
const name = z.string().max(200);
const instant = z.iso.datetime({ offset: true });
const date = z.iso.date();
const stockRow = z.object({ itemId: id, name, available: overviewCount });
const stockPoint = z
  .object({
    date,
    at: instant,
    value: overviewCount.nullable(),
    state: z.enum(['recorded', 'not_yet_recorded', 'unavailable']),
  })
  .superRefine((point, context) => {
    if ((point.state === 'recorded') !== (point.value !== null)) {
      context.addIssue({
        code: 'custom',
        message: 'Recorded points require a value; gaps require null.',
      });
    }
  });
export const overviewProjection = z
  .object({
    version: z.literal(1),
    asOf: instant,
    timeZone: z.string().min(1).max(100),
    window: z.object({
      startDate: date,
      endDate: date,
      days: z.literal(14),
      todaySoFar: z.literal(true),
    }),
    stock: z.object({
      monitoredItems: overviewCount,
      needsAttention: overviewCount,
      zeroAvailable: overviewCount,
      unmonitoredItems: overviewCount,
      attention: z
        .array(
          stockRow.extend({
            threshold: overviewCount,
            shortfall: overviewCount,
          }),
        )
        .max(5),
      unmonitored: z.array(stockRow).max(5),
    }),
    atSites: z.object({
      assets: overviewCount,
      quantityDefinitions: overviewCount,
      occupiedSites: overviewCount,
      rows: z
        .array(
          z.object({
            siteId: id,
            siteName: name,
            siteActive: z.boolean(),
            entityId: id,
            kind: z.enum(['quantity', 'asset']),
            name,
            quantity: overviewCount,
          }),
        )
        .max(5),
    }),
    recentEvents: z
      .array(
        z.object({
          eventId: id,
          recordKind: z.enum(['quantity', 'asset']),
          entityId: id,
          kind: z.string().max(40),
          name,
          actorName: name,
          at: instant,
        }),
      )
      .max(10),
    activity: z.object({
      coverage: z.enum(['complete', 'unavailable']),
      reason: z.literal('activity_budget').nullable(),
      points: z
        .array(z.object({ date, value: overviewCount.nullable() }))
        .length(14),
    }),
    stockTrends: z
      .array(
        stockRow.extend({
          threshold: overviewCount.nullable(),
          coverage: z.enum(['complete', 'partial', 'unavailable']),
          reason: z
            .enum([
              'ledger_budget',
              'missing_opening',
              'event_gap',
              'balance_chain',
              'event_shape',
              'current_mismatch',
            ])
            .nullable(),
          points: z.array(stockPoint).length(14),
        }),
      )
      .max(3),
  })
  .superRefine((snapshot, context) => {
    const fail = (message: string) =>
      context.addIssue({ code: 'custom', message });
    const expectedDates = Array.from({ length: 14 }, (_, index) =>
      new Date(
        Date.parse(snapshot.window.startDate + 'T00:00:00Z') + index * 86400000,
      )
        .toISOString()
        .slice(0, 10),
    );
    if (expectedDates[13] !== snapshot.window.endDate)
      fail('Window must span fourteen calendar dates.');
    const aligned = (points: { date: string }[]) =>
      points.every((point, index) => point.date === expectedDates[index]);
    if (
      !aligned(snapshot.activity.points) ||
      snapshot.stockTrends.some((trend) => !aligned(trend.points))
    )
      fail('Chart dates must match the declared window.');
    if (
      BigInt(snapshot.stock.zeroAvailable) >
        BigInt(snapshot.stock.needsAttention) ||
      BigInt(snapshot.stock.needsAttention) >
        BigInt(snapshot.stock.monitoredItems)
    )
      fail('Stock subsets are inconsistent.');
    for (const row of snapshot.stock.attention) {
      if (
        BigInt(row.available) > BigInt(row.threshold) ||
        row.shortfall !== restockShortfall(row.threshold, row.available)
      )
        fail(
          'Attention shortfall must agree with available stock and threshold.',
        );
    }
    const unavailable = snapshot.activity.coverage === 'unavailable';
    if (
      unavailable !== (snapshot.activity.reason !== null) ||
      snapshot.activity.points.some(
        (point) => unavailable !== (point.value === null),
      )
    )
      fail('Activity coverage must describe every point.');
    for (const trend of snapshot.stockTrends) {
      if ((trend.coverage === 'unavailable') !== (trend.reason !== null))
        fail('Trend reason must agree with coverage.');
      if (
        trend.coverage === 'unavailable' &&
        trend.points.some((point) => point.state !== 'unavailable')
      )
        fail('Unavailable trends cannot fabricate points.');
      if (
        trend.coverage !== 'unavailable' &&
        trend.points.some((point) => point.state === 'unavailable')
      )
        fail('Unavailable points require unavailable coverage.');
      if (
        (trend.coverage === 'partial') !==
        trend.points.some((point) => point.state === 'not_yet_recorded')
      )
        fail('Partial coverage must expose the opening boundary.');
      if (
        trend.coverage !== 'unavailable' &&
        trend.points[13]?.value !== trend.available
      )
        fail('Today must reconcile with current available stock.');
      if (
        trend.points.some(
          (point, index) =>
            Date.parse(point.at) > Date.parse(snapshot.asOf) ||
            (index > 0 &&
              Date.parse(point.at) < Date.parse(trend.points[index - 1]!.at)),
        ) ||
        Date.parse(trend.points[13]!.at) !== Date.parse(snapshot.asOf)
      )
        fail('Endpoints must be ordered and end at the snapshot time.');
    }
  });

export type OverviewProjection = z.infer<typeof overviewProjection>;
export type OverviewSnapshot = OverviewProjection & { fetchedAt: string };

// Reuse the application's forbidden/unexpected outcome vocabulary. A refresh
// consumer must clear private snapshots on forbidden and may retain them stale
// on unexpected. Return these explicit fields from any future server action;
// do not rely on Next serializing thrown Error properties to the browser.
export class OverviewReadError extends Error {
  readonly clearSnapshot: boolean;
  constructor(readonly code: 'forbidden' | 'unexpected') {
    super(
      code === 'forbidden'
        ? 'Your access changed. Sign in again to load Overview.'
        : 'Overview could not be refreshed.',
    );
    this.name = 'OverviewReadError';
    this.clearSnapshot = code === 'forbidden';
  }
}

export function overviewReadError(code?: string): OverviewReadError {
  // P1001 is active-membership denial; 42501 is privilege denial. PostgREST
  // 301/302/303 are invalid/missing/failed-claims JWT outcomes, not transient
  // data failures. Never propagate database messages, hints or details.
  return new OverviewReadError(
    ['P1001', '42501', 'PGRST301', 'PGRST302', 'PGRST303'].includes(code ?? '')
      ? 'forbidden'
      : 'unexpected',
  );
}

export function parseOverviewProjection(value: unknown): OverviewProjection {
  if (new TextEncoder().encode(JSON.stringify(value)).byteLength > 65536)
    throw new Error('Overview response exceeded its size limit.');
  return overviewProjection.parse(value);
}

/** Drawing-only ratio. Never use a chart coordinate as an inventory value. */
export function overviewChartRatio(value: string, maximum: string): number {
  const count = BigInt(overviewCount.parse(value));
  const max = BigInt(overviewCount.parse(maximum));
  if (max === 0n) return 0;
  return Number(((count > max ? max : count) * 1000000n) / max) / 1000000;
}
