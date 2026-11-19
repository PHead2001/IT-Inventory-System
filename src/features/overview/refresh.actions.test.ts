import { beforeEach, expect, it, vi } from 'vitest';
import { redirect, unstable_rethrow } from 'next/navigation';
import { parseOverviewProjection, OverviewReadError } from './contracts';
import { overviewFixture } from './test-fixtures';

vi.mock('server-only', () => ({}));
const mocks = vi.hoisted(() => ({ member: vi.fn(), read: vi.fn() }));
vi.mock('@/lib/auth/session.server', () => ({ requireMember: mocks.member }));
vi.mock('./queries.server', () => ({ getOverviewSnapshot: mocks.read }));
import { refreshOverview } from './refresh.actions';

beforeEach(() => {
  vi.resetAllMocks();
  mocks.member.mockResolvedValue({ member: { active: true, role: 'staff' } });
});

it('returns explicit serializable fields and current permissions only after a successful UTC read', async () => {
  const snapshot = {
    ...parseOverviewProjection(overviewFixture()),
    fetchedAt: '2026-10-14T12:01:00Z',
  };
  mocks.read.mockResolvedValue(snapshot);
  expect(await refreshOverview()).toEqual({
    ok: true,
    snapshot,
    mayEdit: true,
  });
  expect(mocks.read).toHaveBeenCalledExactlyOnceWith('UTC');
  mocks.member.mockResolvedValue({ member: { active: true, role: 'viewer' } });
  expect(await refreshOverview()).toMatchObject({ ok: true, mayEdit: false });
});

it.each(['/login', '/login?next=%2Fdashboard', '/access-denied'])(
  'clears private data for the real framework authentication redirect %s',
  async (destination) => {
    mocks.member.mockImplementation(() => redirect(destination));
    expect(await refreshOverview()).toEqual({
      ok: false,
      code: 'forbidden',
      clearSnapshot: true,
      mayEdit: false,
    });
    expect(mocks.read).not.toHaveBeenCalled();
  },
);

it.each([
  '/inventory',
  '/login?next=https%3A%2F%2Fevil.invalid',
  '/login?extra=1',
  'https://evil.invalid/login',
  'https://inventory.invalid/login',
  '/access-denied?extra=1',
])('preserves unrelated framework control flow %s', async (destination) => {
  mocks.member.mockImplementation(() => redirect(destination));
  await expect(refreshOverview()).rejects.toThrow();
});

it('distinguishes RPC revocation from transient transport errors without public details', async () => {
  mocks.read.mockRejectedValue(new OverviewReadError('forbidden'));
  expect(await refreshOverview()).toEqual({
    ok: false,
    code: 'forbidden',
    clearSnapshot: true,
    mayEdit: false,
  });
  mocks.read.mockRejectedValue(new Error('private transport detail'));
  expect(await refreshOverview()).toEqual({
    ok: false,
    code: 'unexpected',
    clearSnapshot: false,
    mayEdit: true,
  });
  // Installed framework control flow is tested above, not mocked by string matching.
  expect(typeof unstable_rethrow).toBe('function');
});

it('returns a newly verified viewer permission even when the later RPC read is transiently unavailable', async () => {
  mocks.member.mockResolvedValue({ member: { active: true, role: 'viewer' } });
  mocks.read.mockRejectedValue(new OverviewReadError('unexpected'));
  expect(await refreshOverview()).toEqual({
    ok: false,
    code: 'unexpected',
    clearSnapshot: false,
    mayEdit: false,
  });
});
