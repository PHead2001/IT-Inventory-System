export function overviewFixture() {
  const dates = Array.from(
    { length: 14 },
    (_, i) => `2026-10-${String(i + 1).padStart(2, '0')}`,
  );
  return {
    version: 1,
    asOf: '2026-10-14T12:00:00Z',
    timeZone: 'UTC',
    window: {
      startDate: dates[0],
      endDate: dates[13],
      days: 14,
      todaySoFar: true,
    },
    stock: {
      monitoredItems: '1',
      needsAttention: '1',
      zeroAvailable: '0',
      unmonitoredItems: '0',
      attention: [
        {
          itemId: '00000000-0000-4000-8000-000000000001',
          name: 'Cable',
          available: '5',
          threshold: '5',
          shortfall: '0',
        },
      ],
      unmonitored: [],
    },
    atSites: {
      assets: '0',
      quantityDefinitions: '0',
      occupiedSites: '0',
      rows: [],
    },
    recentEvents: [],
    activity: {
      coverage: 'complete',
      reason: null,
      points: dates.map((date) => ({ date, value: '0' as string | null })),
    },
    stockTrends: [
      {
        itemId: '00000000-0000-4000-8000-000000000001',
        name: 'Cable',
        available: '5',
        threshold: '5',
        coverage: 'complete',
        reason: null,
        points: dates.map((date, index) => ({
          date,
          at:
            index === 13
              ? '2026-10-14T12:00:00Z'
              : `${dates[index + 1]}T00:00:00Z`,
          state: 'recorded',
          value: '5' as string | null,
        })),
      },
    ],
  };
}
