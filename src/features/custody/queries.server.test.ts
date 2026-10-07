import { beforeEach, expect, it, vi } from 'vitest';
import { getSiteDetail } from './queries.server';
const mocks = vi.hoisted(() => ({
  member: vi.fn(),
  rpc: vi.fn(),
  reads: [] as {
    table: string;
    filters: [string, unknown][];
    ranged: boolean;
  }[],
}));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/auth/session.server', () => ({ requireMember: mocks.member }));
const siteId = '00000000-0000-4000-8000-000000000001';
const zero = '0';
const summary = {
  site_id: siteId,
  current_quantity_units: zero,
  current_serialized_assets: zero,
  quantity: {
    gross_issued_units: zero,
    return_units: zero,
    transfer_in_units: zero,
    transfer_out_units: zero,
    opening_units: zero,
    write_off_units: zero,
  },
  serialized: {
    gross_storage_issue_events: zero,
    unique_issued_assets: zero,
    return_events: zero,
    opening_events: zero,
    retirement_events: zero,
  },
};
beforeEach(() => {
  mocks.reads.length = 0;
  mocks.rpc.mockReset();
  mocks.rpc.mockImplementation(async (operation: string) => ({
    data:
      operation === 'site_activity_summary' ? summary : { rows: [], total: 0 },
    error: null,
  }));
  mocks.member.mockResolvedValue({
    supabase: {
      rpc: mocks.rpc,
      from: (table: string) => {
        const read = {
          table,
          filters: [] as [string, unknown][],
          ranged: false,
        };
        mocks.reads.push(read);
        const query = {
          select: () => query,
          eq: () => query,
          order: () => query,
          or: () => query,
          gte: (key: string, value: unknown) => {
            read.filters.push([key, value]);
            return query;
          },
          lt: (key: string, value: unknown) => {
            read.filters.push([key, value]);
            return query;
          },
          ilike: () => query,
          range: async () => {
            read.ranged = true;
            return { data: [], count: 0, error: null };
          },
        };
        return query;
      },
    },
  });
});
it.each([
  { from: '2026-10-08T00:00', until: '2026-10-07T00:00' },
  { from: 'bad-date' },
  { until: '2026-02-30T00:00' },
  { from: '2026-10-07T00:00:00.1234567Z' },
])(
  'preserves holdings and exposes filter errors without executing invalid activity reads: %o',
  async (filters) => {
    const result = await getSiteDetail(siteId, filters);
    expect(result.activityValid).toBe(false);
    expect(Object.keys(result.activityErrors).length).toBeGreaterThan(0);
    expect(
      mocks.reads.find((read) => read.table === 'site_current_holdings')
        ?.ranged,
    ).toBe(true);
    expect(
      mocks.reads.find((read) => read.table === 'assignment_events')?.ranged,
    ).toBe(false);
    expect(mocks.rpc).toHaveBeenCalledWith('site_activity_summary', {
      p_site_id: siteId,
      p_from: undefined,
      p_until: undefined,
    });
  },
);
it.each([
  ['2026-11-01T05:00:00.000Z', '2026-11-02T06:00:00.000Z'],
  ['2026-10-07T00:00:00.000001Z', '2026-10-07T00:00:00.000999Z'],
])(
  'uses identical inclusive/exclusive instants for rows and metrics: %s / %s',
  async (from, until) => {
    const result = await getSiteDetail(siteId, { from, until });
    expect(result.activityValid).toBe(true);
    expect(
      mocks.reads.find((read) => read.table === 'assignment_events')?.filters,
    ).toEqual([
      ['created_at', from],
      ['created_at', until],
    ]);
    expect(mocks.rpc).toHaveBeenCalledWith('site_activity_summary', {
      p_site_id: siteId,
      p_from: from,
      p_until: until,
    });
  },
);
it('keeps actual access/read failures distinct from invalid filters', async () => {
  mocks.member.mockRejectedValue(new Error('Access denied'));
  await expect(getSiteDetail(siteId, { from: 'bad' })).rejects.toThrow(
    'Access denied',
  );
});
