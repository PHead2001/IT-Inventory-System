import { beforeEach, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
  member: vi.fn(),
  from: vi.fn(),
  locations: vi.fn(),
  categories: vi.fn(),
}));
vi.mock('@/lib/auth/session.server', () => ({ requireMember: m.member }));
vi.mock('server-only', () => ({}));
vi.mock('./queries.server', () => ({
  getLocations: m.locations,
  getCategories: m.categories,
}));
import { getHistoryEvent } from './history-event.server';

const id = '00000000-0000-4000-8000-000000000001';
const entityId = '00000000-0000-4000-8000-000000000002';
const row = {
  id,
  kind: 'asset',
  entity_id: entityId,
  entity_name: 'Switch',
  event_type: 'metadata_updated',
  created_at: '2026-10-07T12:00:00Z',
  actor_name: 'Recorded staff',
  reason: 'Original reason',
  before_metadata: { name: 'Original switch' },
  after_metadata: { name: 'Switch' },
  custom_present: false,
  custom_changed: false,
  assignment_event_id: null,
  assignment_kind: null,
  assignment_from_location_id: null,
  assignment_to_location_id: null,
  assignment_from_site_id: null,
  assignment_to_site_id: null,
  assignment_from_label: null,
  assignment_to_label: null,
  assignment_quantity: null,
  assignment_reference: null,
  from_location_id: null,
  to_location_id: null,
  lines: [],
};
beforeEach(() => {
  vi.clearAllMocks();
  m.member.mockResolvedValue({ supabase: { from: m.from } });
  m.locations.mockResolvedValue([]);
  m.categories.mockResolvedValue([]);
});
function response(data: unknown, error: unknown = null) {
  const query = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data, error }),
  };
  m.from.mockReturnValue(query);
  return query;
}
it.each(['asset', 'quantity'])(
  'resolves a %s event beyond 25 newer events and remains stable after further inserts',
  async (kind) => {
    const target = { ...row, kind };
    const newer = Array.from({ length: 30 }, (_, index) => ({
      ...target,
      id: `00000000-0000-4000-8000-${String(index + 100).padStart(12, '0')}`,
      created_at: '2026-10-08T12:00:00Z',
      reason: 'Newer operation',
    }));
    const records = [...newer, target];
    const queries: { filters: Record<string, string>; limit?: number }[] = [];
    m.from.mockImplementation(() => {
      const request: (typeof queries)[number] = { filters: {} };
      queries.push(request);
      const query = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn((field: string, value: string) => {
          request.filters[field] = value;
          return query;
        }),
        limit: vi.fn((size: number) => {
          request.limit = size;
          return query;
        }),
        maybeSingle: vi.fn(async () => ({
          data:
            records.find(
              (record) =>
                record.id === request.filters.id &&
                record.kind === request.filters.kind,
            ) ?? null,
          error: null,
        })),
      };
      return query;
    });
    const first = await getHistoryEvent(kind, id);
    expect(records.indexOf(target)).toBeGreaterThan(25);
    records.unshift({
      ...newer[0],
      id: '00000000-0000-4000-8000-000000000999',
    });
    expect(await getHistoryEvent(kind, id)).toEqual(first);
    expect(first).toMatchObject({
      id,
      kind,
      entityId,
      reason: 'Original reason',
      metadataChanges: [
        { field: 'Name', before: 'Original switch', after: 'Switch' },
      ],
    });
    expect(queries).toEqual([
      { filters: { kind, id }, limit: 2 },
      { filters: { kind, id }, limit: 2 },
    ]);
    expect(m.from.mock.calls).toEqual([
      ['inventory_history_rows'],
      ['inventory_history_rows'],
    ]);
  },
);
it.each([
  ['invalid', id],
  ['asset', 'invalid'],
])(
  'rejects invalid identity %s/%s without querying or broadening history',
  async (kind, eventId) => {
    expect(await getHistoryEvent(kind, eventId)).toBeNull();
    expect(m.member).toHaveBeenCalledOnce();
    expect(m.from).not.toHaveBeenCalled();
  },
);
it('keeps missing or RLS-inaccessible events unavailable without reading reference data', async () => {
  const query = response(null);
  expect(await getHistoryEvent('asset', id)).toBeNull();
  expect(query.eq.mock.calls).toEqual([
    ['kind', 'asset'],
    ['id', id],
  ]);
  expect(m.locations).not.toHaveBeenCalled();
  expect(m.categories).not.toHaveBeenCalled();
});
it('binds a valid UUID spelling to the same canonical database identity', async () => {
  const canonical = 'aaaaaaaa-0000-4000-8000-000000000001';
  const query = response({ ...row, id: canonical });
  expect(await getHistoryEvent('asset', canonical.toUpperCase())).toMatchObject(
    { id: canonical },
  );
  expect(query.eq.mock.calls).toEqual([
    ['kind', 'asset'],
    ['id', canonical],
  ]);
});
it('propagates membership and read failures instead of claiming an event is absent', async () => {
  m.member.mockRejectedValueOnce(new Error('Membership required'));
  await expect(getHistoryEvent('asset', id)).rejects.toThrow(
    'Membership required',
  );
  expect(m.from).not.toHaveBeenCalled();
  response(null, { message: 'Database read failed' });
  await expect(getHistoryEvent('asset', id)).rejects.toThrow(
    'History event could not be loaded',
  );
});
it('rejects a returned identity mismatch rather than rendering another event', async () => {
  response({ ...row, id: entityId });
  await expect(getHistoryEvent('asset', id)).rejects.toThrow(
    'identity could not be verified',
  );
  response({ ...row, kind: 'quantity' });
  await expect(getHistoryEvent('asset', id)).rejects.toThrow(
    'identity could not be verified',
  );
  expect(m.locations).not.toHaveBeenCalled();
});
