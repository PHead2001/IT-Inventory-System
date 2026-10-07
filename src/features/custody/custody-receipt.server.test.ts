import { expect, it, vi } from 'vitest';
import { readCustodyReceipt } from './custody-receipt.server';
vi.mock('server-only', () => ({}));
const id = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const assignment = {
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
function clientFor(row = assignment, after = 0) {
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
                : { before_quantity: 0, after_quantity: 1, delta: 1 },
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
