import { describe, expect, it } from 'vitest';
import {
  labelQueueEntry,
  projectLabelSelection,
  selectLabelRows,
} from './label-selection';
import type { LiveLabel } from './queue.server';

const row = (n: number, kind: LiveLabel['kind'] = 'quantity'): LiveLabel => ({
  kind,
  key: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
  name: 'Same name',
  path: '/inventory/quantity/' + n,
  barcode: null,
  tag: null,
  state: 'active',
  context: '',
  holdingContext: '',
  categoryName: null,
});

describe('explicit label selection', () => {
  it('deduplicates holdings across pages by typed identity and preserves selection order', () => {
    const a = row(1);
    const b = row(1, 'asset');
    expect(selectLabelRows([a], [a, b, row(2), a])).toEqual([a, b, row(2)]);
  });
  it('preserves copies and order and identifies added, present and unavailable rows', () => {
    const existing = { ...labelQueueEntry(row(1)), copies: 17 };
    const result = projectLabelSelection(
      [existing],
      [row(2), row(1), row(3), row(2)],
      [row(1), row(2)],
    );
    expect(result.next).toEqual([existing, labelQueueEntry(row(2))]);
    expect(result.next![0]).toBe(existing);
    expect(result.added).toEqual([row(2)]);
    expect(result.already).toEqual([row(1)]);
    expect(result.unavailable).toEqual([row(3)]);
  });
  it('accepts 200 identities and rejects an over-limit projection without a prefix', () => {
    const rows = Array.from({ length: 201 }, (_, n) => row(n));
    expect(
      projectLabelSelection([], rows.slice(0, 200), rows.slice(0, 200)).next,
    ).toHaveLength(200);
    expect(projectLabelSelection([], rows, rows).next).toBeNull();
  });
  it('counts existing copies toward 500 and excludes unavailable identities before checking caps', () => {
    const entries = Array.from({ length: 5 }, (_, n) => ({
      ...labelQueueEntry(row(n)),
      copies: n === 4 ? 99 : 100,
    }));
    expect(
      projectLabelSelection(entries, [row(5), row(6)], [row(5)]).next,
    ).toHaveLength(6);
    expect(
      projectLabelSelection(entries, [row(5), row(6)], [row(5), row(6)]).next,
    ).toBeNull();
    expect(entries[4].copies).toBe(99);
  });
  it('leaves historical additions requiring lifecycle review', () => {
    const historical = [
      { ...row(1), state: 'archived' },
      { ...row(2, 'asset'), state: 'retired' },
    ];
    expect(
      projectLabelSelection([], historical, historical).next?.every(
        (entry) => !entry.lifecycleAcknowledged,
      ),
    ).toBe(true);
  });
  it('rejects duplicate or unsolicited resolved records atomically', () => {
    expect(() =>
      projectLabelSelection([], [row(1)], [row(1), row(1)]),
    ).toThrow();
    expect(() => projectLabelSelection([], [row(1)], [row(2)])).toThrow();
  });
});
