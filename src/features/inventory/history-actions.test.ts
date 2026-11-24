import { beforeEach, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
const m = vi.hoisted(() => ({ member: vi.fn(), actors: vi.fn() }));
vi.mock('@/lib/auth/session.server', () => ({ requireMember: m.member }));
vi.mock('@/lib/supabase/config', () => ({
  supabaseConfig: () => ({ url: 'https://backend.test/path' }),
}));
vi.mock('./history-queries.server', () => ({
  getHistoryActors: m.actors,
  HistoryAccessDeniedError: class extends Error {},
}));
import { HistoryAccessDeniedError } from './history-queries.server';
import { HistoryReadActorChangedError } from './history-reader.server';
import { searchHistoryActors } from './history-actions';
beforeEach(() => {
  m.member.mockResolvedValue({ member: { user_id: 'actor-A' } });
  m.actors.mockResolvedValue({ rows: [], total: 0 });
});
it.each([
  ['actor-B', 'https://backend.test'],
  ['actor-A', 'https://other.test'],
])(
  'rejects actor/backend substitution before reading history (%s)',
  async (actor, backend) => {
    expect(await searchHistoryActors('Alex', null, 1, actor, backend)).toEqual({
      ok: false,
      code: 'actor_changed',
    });
    expect(m.actors).not.toHaveBeenCalled();
  },
);
it('uses the exact verified request member context and retains selected identity', async () => {
  const context = await m.member();
  expect(
    await searchHistoryActors(
      'Alex',
      'selected-uuid',
      2,
      'actor-A',
      'https://backend.test',
    ),
  ).toEqual({ rows: [], total: 0 });
  expect(m.actors).toHaveBeenCalledExactlyOnceWith(
    'Alex',
    'selected-uuid',
    2,
    context,
  );
});
it('classifies actual RLS denial but keeps transient failures distinct', async () => {
  m.actors.mockRejectedValueOnce(new HistoryAccessDeniedError());
  expect(
    await searchHistoryActors('', null, 1, 'actor-A', 'https://backend.test'),
  ).toEqual({ ok: false, code: 'forbidden' });
  m.actors.mockRejectedValueOnce(new Error('timeout'));
  await expect(
    searchHistoryActors('', null, 1, 'actor-A', 'https://backend.test'),
  ).rejects.toThrow('timeout');
});

it('routes a verified bearer actor mismatch through the existing owned actor-changed outcome', async () => {
  m.actors.mockRejectedValueOnce(new HistoryReadActorChangedError());
  expect(
    await searchHistoryActors('', null, 1, 'actor-A', 'https://backend.test'),
  ).toEqual({ ok: false, code: 'actor_changed' });
});
