import { beforeEach, expect, it, vi } from 'vitest';
import { overviewFixture } from './test-fixtures';
const mocks = vi.hoisted(() => ({ member: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/auth/session.server', () => ({ requireMember: mocks.member }));
import { getOverviewSnapshot } from './queries.server';
import { OverviewReadError } from './contracts';

beforeEach(() => vi.resetAllMocks());

it('uses one caller-scoped snapshot and records fetch time separately from database as-of', async () => {
  const rpc = vi
    .fn()
    .mockResolvedValue({ data: overviewFixture(), error: null });
  mocks.member.mockResolvedValue({ supabase: { rpc } });
  const snapshot = await getOverviewSnapshot('America/Chicago');
  expect(rpc).toHaveBeenCalledExactlyOnceWith('overview_snapshot_v1', {
    p_time_zone: 'America/Chicago',
  });
  expect(snapshot.asOf).toBe('2026-10-14T12:00:00Z');
  expect(Number.isNaN(Date.parse(snapshot.fetchedAt))).toBe(false);
});

it('does not share clients or private snapshots across concurrent accounts', async () => {
  const first = overviewFixture();
  const second = overviewFixture();
  second.stock.monitoredItems = '2';
  mocks.member.mockResolvedValueOnce({
    supabase: { rpc: vi.fn().mockResolvedValue({ data: first, error: null }) },
  });
  mocks.member.mockResolvedValueOnce({
    supabase: { rpc: vi.fn().mockResolvedValue({ data: second, error: null }) },
  });
  const [a, b] = await Promise.all([
    getOverviewSnapshot(),
    getOverviewSnapshot(),
  ]);
  expect(a.stock.monitoredItems).toBe('1');
  expect(b.stock.monitoredItems).toBe('2');
});

it('propagates authorization failure without querying or returning private data', async () => {
  mocks.member.mockRejectedValue(new Error('access-denied'));
  await expect(getOverviewSnapshot()).rejects.toThrow('access-denied');
});

it.each(['P1001', '42501', 'PGRST301', 'PGRST302', 'PGRST303'])(
  'requires clearing private snapshots when %s occurs after membership validation',
  async (code) => {
    const rpc = vi.fn().mockResolvedValue({
      data: overviewFixture(),
      error: { code, message: 'private database detail' },
    });
    mocks.member.mockResolvedValue({ supabase: { rpc } });
    const failure = await getOverviewSnapshot().catch(
      (error: unknown) => error,
    );
    expect(failure).toBeInstanceOf(OverviewReadError);
    expect(failure).toMatchObject({ code: 'forbidden', clearSnapshot: true });
    expect((failure as Error).message).not.toContain('private database detail');
    expect(mocks.member).toHaveBeenCalledOnce();
    expect(rpc).toHaveBeenCalledOnce();
  },
);

it('distinguishes transient backend errors from revocation and hides backend details', async () => {
  const rpc = vi.fn().mockResolvedValue({
    data: null,
    error: { code: '57014', message: 'private database detail' },
  });
  mocks.member.mockResolvedValue({ supabase: { rpc } });
  await expect(getOverviewSnapshot()).rejects.toMatchObject({
    code: 'unexpected',
    clearSnapshot: false,
    message: 'Overview could not be refreshed.',
  });
});

it('rejects malformed projections and thrown transport failures with a generic public outcome', async () => {
  const rpc = vi
    .fn()
    .mockResolvedValueOnce({ data: {}, error: null })
    .mockRejectedValueOnce(new Error('private transport detail'));
  mocks.member.mockResolvedValue({ supabase: { rpc } });
  await expect(getOverviewSnapshot()).rejects.toMatchObject({
    code: 'unexpected',
    clearSnapshot: false,
    message: 'Overview could not be refreshed.',
  });
  await expect(getOverviewSnapshot()).rejects.toMatchObject({
    code: 'unexpected',
    clearSnapshot: false,
    message: 'Overview could not be refreshed.',
  });
});
