import { describe, expect, it, vi } from 'vitest';
import { parseOptionPath, reviewOptionPaths } from './option-path-paste';
const options = [
  { id: 'usb', label: 'USB', active: true },
  { id: 'c', parent_id: 'usb', label: 'USB-C', active: true },
];
describe('local option path review', () => {
  it('preserves literal separators/backslashes and rejects malformed paths', () => {
    expect(parseOptionPath(String.raw`A\>B > C\\D`)).toEqual(['A>B', 'C\\D']);
    for (const input of ['> USB', 'USB >', 'USB >> C', String.raw`A\q`, 'A\\'])
      expect(() => parseOptionPath(input)).toThrow();
  });
  it('reuses shared normalized parents and skips repetitions without regenerating existing IDs', () => {
    const ids = vi
      .fn()
      .mockReturnValueOnce('dock')
      .mockReturnValueOnce('adapter');
    const review = reviewOptionPaths(
      ' usb > USB-C > Dock\nUSB > usb-c > Adapter\nUSB > USB-C > dock',
      options,
      2,
      ids,
    );
    expect(review.conflicts).toEqual([]);
    expect(review.options.slice(0, 2)).toEqual(options);
    expect(review.options.slice(2)).toMatchObject([
      { id: 'dock', parent_id: 'c' },
      { id: 'adapter', parent_id: 'c' },
    ]);
    expect(ids).toHaveBeenCalledTimes(2);
    expect(review.reused).toContain('usb');
    expect(review.skipped).toHaveLength(1);
    expect(options).toHaveLength(2);
  });
  it('never chooses the first ambiguous sibling or reactivates retired paths', () => {
    for (const addition of [
      { id: 'duplicate', label: ' usb ', active: true },
      { id: 'retired', label: 'USB', active: false },
    ]) {
      const ids = vi.fn();
      const review = reviewOptionPaths(
        'USB > New',
        [...options, addition],
        3,
        ids,
      );
      expect(review.conflicts).toHaveLength(1);
      expect(ids).not.toHaveBeenCalled();
      expect(review.options).toEqual([...options, addition]);
    }
  });
  it('refuses fresh equal names under distinct parents while sharing new parents', () => {
    let id = 0;
    const review = reviewOptionPaths(
      'Video > Shared\nAudio > Shared\nVideo > HDMI',
      [],
      0,
      () => `new-${++id}`,
    );
    expect(review.conflicts).toHaveLength(1);
    expect(review.conflicts[0]).toContain('elsewhere in this field');
    expect(review.options).toHaveLength(4);
    expect(
      review.options.filter((option) => option.label === 'Video'),
    ).toHaveLength(1);
    expect(
      review.options.filter((option) => option.label === 'Shared'),
    ).toHaveLength(1);
  });
  it('accepts six and 64 levels, rejects 65 and enforces field/revision/input limits', () => {
    for (const depth of [6, 64])
      expect(
        reviewOptionPaths(
          Array.from({ length: depth }, (_, n) => `N${n}`).join(' > '),
          [],
        ).conflicts,
      ).toEqual([]);
    expect(
      reviewOptionPaths(
        Array.from({ length: 65 }, (_, n) => `N${n}`).join(' > '),
        [],
      ).conflicts.join(),
    ).toContain('64');
    expect(
      reviewOptionPaths(
        'New',
        Array.from({ length: 1000 }, (_, n) => ({
          id: `${n}`,
          label: `N${n}`,
          active: true,
        })),
      ).conflicts.join(),
    ).toContain('1,000');
    expect(
      reviewOptionPaths('USB > New', options, 5000).conflicts.join(),
    ).toContain('5,000');
    expect(
      reviewOptionPaths('N'.repeat(262145), []).conflicts.join(),
    ).toContain('256 KiB');
    expect(
      reviewOptionPaths('N\n'.repeat(1001), []).conflicts.join(),
    ).toContain('1,000 nonblank');
    expect(reviewOptionPaths('N'.repeat(201), []).conflicts.join()).toContain(
      '200',
    );
  });
});
