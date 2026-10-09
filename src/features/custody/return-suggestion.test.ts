import { beforeEach, expect, it, vi } from 'vitest';
import { getAssetReturnSuggestion } from './queries.server';

const mocks = vi.hoisted(() => ({ member: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/auth/session.server', () => ({ requireMember: mocks.member }));
const id = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const asset = {
  id: id(1),
  version: 80,
  status: 'active' as const,
  siteId: id(2),
};
const event = {
  id: id(3),
  asset_id: asset.id,
  version: 2,
  kind: 'site_assigned',
  from_location_id: id(4),
};
const destination = { id: id(4), active: true, can_hold_inventory: true };
const calls: unknown[][] = [];
function setup(
  boundary: unknown = [event],
  location: unknown = destination,
  error: unknown = null,
  locationError: unknown = null,
) {
  mocks.member.mockResolvedValue({
    supabase: {
      from: (table: string) => {
        calls.push(['from', table]);
        const query = {
          select: (columns: string) => {
            calls.push(['select', columns]);
            return query;
          },
          eq: (key: string, value: unknown) => {
            calls.push(['eq', key, value]);
            return query;
          },
          lte: (key: string, value: unknown) => {
            calls.push(['lte', key, value]);
            return query;
          },
          not: (key: string, operator: string, value: string) => {
            calls.push(['not', key, operator, value]);
            return query;
          },
          order: (key: string, value: unknown) => {
            calls.push(['order', key, value]);
            return query;
          },
          limit: async (count: number) => {
            calls.push(['limit', count]);
            return { data: boundary, error };
          },
          maybeSingle: async () => ({ data: location, error: locationError }),
        };
        return query;
      },
    },
  });
}
beforeEach(() => {
  calls.length = 0;
  mocks.member.mockReset();
  setup();
});

it('bounds the caller-authorized current episode by asset version, independent of a recent 25-row timeline', async () => {
  expect(await getAssetReturnSuggestion(asset)).toEqual({
    assetId: asset.id,
    assetVersion: '80',
    sourceEventId: event.id,
    locationId: destination.id,
    status: 'suggested',
  });
  expect(calls).toContainEqual(['eq', 'asset_id', asset.id]);
  expect(calls).toContainEqual(['lte', 'version', 80]);
  expect(calls).toContainEqual([
    'not',
    'kind',
    'in',
    '(metadata_updated,site_transferred,site_corrected)',
  ]);
  expect(calls).toContainEqual(['order', 'version', { ascending: false }]);
  expect(calls).toContainEqual(['limit', 1]);
});
it.each([
  ['site_opened', null, 'no_storage_origin'],
  ['site_returned', id(4), 'unavailable'],
  ['retired', id(4), 'unavailable'],
  ['site_assigned', null, 'unavailable'],
] as const)(
  'stops at %s without searching an older episode',
  async (kind, origin, status) => {
    setup([{ ...event, kind, from_location_id: origin }]);
    expect(await getAssetReturnSuggestion(asset)).toMatchObject({
      status,
      locationId: null,
    });
    expect(calls.filter((call) => call[0] === 'from')).toHaveLength(1);
  },
);
it.each([
  { events: [] },
  { events: [{ ...event, asset_id: id(7) }] },
  { events: [{ ...event, from_location_id: 'bad' }] },
  { events: [{ ...event, version: 81 }] },
])('keeps missing or malformed history unavailable: %j', async ({ events }) => {
  setup(events);
  expect(await getAssetReturnSuggestion(asset)).toMatchObject({
    status: 'unavailable',
    locationId: null,
  });
});
it.each([
  { ...destination, active: false },
  { ...destination, can_hold_inventory: false },
])('keeps an ineligible former location blank', async (location) => {
  setup([event], location);
  expect(await getAssetReturnSuggestion(asset)).toMatchObject({
    status: 'ineligible',
    sourceEventId: event.id,
    locationId: null,
  });
});
it('distinguishes transport failure from absent or unavailable history', async () => {
  setup(null, destination, { message: 'transport failed' });
  await expect(getAssetReturnSuggestion(asset)).rejects.toThrow(
    'could not be loaded',
  );
  setup([event], null, null, { message: 'transport failed' });
  await expect(getAssetReturnSuggestion(asset)).rejects.toThrow(
    'could not be checked',
  );
});
it.each([
  { ...asset, status: 'retired' as const },
  { ...asset, siteId: null },
])('does not suggest storage outside active site custody', async (input) => {
  expect(await getAssetReturnSuggestion(input)).toMatchObject({
    status: 'unavailable',
  });
  expect(mocks.member).not.toHaveBeenCalled();
});
