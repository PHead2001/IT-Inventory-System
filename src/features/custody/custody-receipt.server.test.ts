import { expect, it, vi } from 'vitest';
import type { Tables } from '@/lib/supabase/database.types';
import { readCustodyReceipt } from './custody-receipt.server';
vi.mock('server-only', () => ({}));
type AssignmentFixture = Omit<Tables<'assignment_events'>, 'id' | 'actor_id'>;
type SiteLineFixture = Pick<
  Tables<'site_quantity_event_lines'>,
  'before_quantity' | 'after_quantity' | 'delta'
>;
const id = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const assignment: AssignmentFixture = {
  quantity_event_id: id(1),
  asset_event_id: null,
  item_id: id(2),
  asset_id: null,
  kind: 'issued',
  actor_name: 'Staff',
  created_at: '2026-10-07T12:00:00Z',
  from_location_id: id(3),
  to_location_id: null,
  from_site_id: null,
  to_site_id: id(4),
  from_label: 'Red',
  to_label: 'Headquarters',
  quantity: 1,
  reference: 'TICKET-12',
  reason: null,
};
function clientFor(
  row: AssignmentFixture = assignment,
  after = 0,
  siteLine: SiteLineFixture | null = {
    before_quantity: 0,
    after_quantity: 1,
    delta: 1,
  },
) {
  const reads: { table: string; filters: [string, unknown][] }[] = [];
  const client = {
    from: vi.fn((table: string) => {
      const read = { table, filters: [] as [string, unknown][] };
      reads.push(read);
      const query = {
        select: vi.fn(() => query),
        eq: vi.fn((key: string, value: unknown) => {
          read.filters.push([key, value]);
          return query;
        }),
        maybeSingle: vi.fn(async () => ({
          data:
            table === 'assignment_events'
              ? row
              : table === 'quantity_event_lines'
                ? { before_quantity: 1, after_quantity: after, delta: -1 }
                : siteLine,
          error: null,
        })),
      };
      return query;
    }),
  };
  return {
    client: client as unknown as Parameters<typeof readCustodyReceipt>[0],
    reads,
  };
}
it('reads exact immutable event and line balances, preserving zero and historical endpoint names', async () => {
  const { client, reads } = clientFor();
  const receipt = await readCustodyReceipt(client, 'quantity', id(2), id(1));
  expect(receipt).toMatchObject({
    eventId: id(1),
    reference: 'TICKET-12',
    source: { name: 'Red', after: 0 },
    destination: { name: 'Headquarters', after: 1 },
  });
  expect(reads[0].filters).toEqual([
    ['quantity_event_id', id(1)],
    ['item_id', id(2)],
  ]);
  expect(
    reads
      .slice(1)
      .every((read) =>
        read.filters.some(
          ([key, value]) => key === 'event_id' && value === id(1),
        ),
      ),
  ).toBe(true);
  expect(reads.map((read) => read.table)).not.toContain('stock_balances');
  expect(reads.map((read) => read.table)).not.toContain(
    'site_quantity_holdings',
  );
});
it.each([
  { before_quantity: 10, delta: 5, after_quantity: 15 },
  { before_quantity: 10, delta: -5, after_quantity: 5 },
  { before_quantity: 5, delta: -5, after_quantity: 0 },
])(
  'retains the authoritative signed correction line: $delta',
  async (siteLine) => {
    const { client, reads } = clientFor(
      {
        ...assignment,
        kind: 'corrected',
        from_location_id: null,
        from_site_id: id(4),
        to_site_id: null,
        from_label: 'Historical site name',
        to_label: null,
        quantity: Math.abs(siteLine.delta),
      },
      0,
      siteLine,
    );
    expect(
      await readCustodyReceipt(client, 'quantity', id(2), id(1)),
    ).toMatchObject({
      operation: 'corrected',
      quantity: 5,
      source: {
        id: id(4),
        kind: 'site',
        name: 'Historical site name',
        before: siteLine.before_quantity,
        delta: siteLine.delta,
        after: siteLine.after_quantity,
      },
      destination: null,
    });
    expect(reads[1]).toEqual({
      table: 'site_quantity_event_lines',
      filters: [
        ['event_id', id(1)],
        ['site_id', id(4)],
      ],
    });
  },
);
it('rejects a missing correction line instead of inferring a signed adjustment from its absolute amount', async () => {
  const { client } = clientFor(
    {
      ...assignment,
      kind: 'corrected',
      from_location_id: null,
      from_site_id: id(4),
      to_site_id: null,
      to_label: null,
      quantity: 5,
    },
    0,
    null,
  );
  await expect(
    readCustodyReceipt(client, 'quantity', id(2), id(1)),
  ).rejects.toThrow('Custody balance unavailable.');
});
it('rejects a mismatched entity or inconsistent event-line arithmetic', async () => {
  const mismatch = clientFor({ ...assignment, item_id: id(9) });
  await expect(
    readCustodyReceipt(mismatch.client, 'quantity', id(2), id(1)),
  ).rejects.toThrow('mismatch');
  const invalid = clientFor(assignment, 4);
  await expect(
    readCustodyReceipt(invalid.client, 'quantity', id(2), id(1)),
  ).rejects.toThrow();
});
