import { describe, expect, it } from 'vitest';
import { layoutLabels, type LabelRect } from './label-layout';

const viewport = { left: 0, top: 0, right: 160, bottom: 100 };
const label = (
  id: string,
  left: number,
  top: number,
  selected = false,
): LabelRect => ({
  id,
  left,
  top,
  width: 45,
  height: 18,
  selected,
});

describe('scene label placement', () => {
  it('expands focus text only when every occupied action stays in its original placement', () => {
    const input: LabelRect[] = [
      {
        ...label('focus', 10, 10),
        priority: 3,
        mandatory: true,
        width: 130,
        height: 44,
        compact: { width: 44, height: 44 },
      },
      {
        ...label('neighbor', 70, 10),
        priority: 3,
        mandatory: true,
        width: 130,
        height: 44,
        compact: { width: 44, height: 44 },
      },
    ];
    const normal = layoutLabels(input, viewport);
    const focused = layoutLabels(
      input.map((entry) => ({ ...entry, preferFull: entry.id === 'focus' })),
      viewport,
    );
    expect(focused).toEqual(normal);
    expect(focused.every((entry) => entry.visible && entry.compact)).toBe(true);
    const spacious = layoutLabels(
      [{ ...input[0], preferFull: true }],
      viewport,
    );
    expect(spacious[0]).toMatchObject({
      visible: true,
      compact: false,
      dx: 0,
      dy: 0,
    });
  });
  it('fits 28 occupied 44px actions plus a wrapped selected label on a narrow 310px canvas', () => {
    const input: LabelRect[] = [
      {
        ...label('selected', 30, 160, true),
        locationCode: 'SELECTED',
        priority: 4,
        mandatory: true,
        width: 240,
        height: 84,
      },
      ...Array.from({ length: 27 }, (_, index) => ({
        ...label(`occupied-${index}`, 140, 195),
        locationCode: `L${String(index).padStart(2, '0')}`,
        priority: 3,
        mandatory: true,
        width: 220,
        height: 62,
        compact: { width: 44, height: 44 },
      })),
    ];
    const result = layoutLabels(input, {
      left: 0,
      top: 0,
      right: 310,
      bottom: 410,
    });
    expect(result.every((item) => item.visible)).toBe(true);
    const areas = result.map((item) => {
      const source = input.find((row) => row.id === item.id)!;
      const size = item.compact ? source.compact! : source;
      return {
        left: source.left + item.dx,
        top: source.top + item.dy,
        right: source.left + item.dx + size.width,
        bottom: source.top + item.dy + size.height,
      };
    });
    for (const [index, area] of areas.entries())
      for (const other of areas.slice(index + 1))
        expect(
          area.left >= other.right + 3 ||
            area.right + 3 <= other.left ||
            area.top >= other.bottom + 3 ||
            area.bottom + 3 <= other.top,
        ).toBe(true);
  });
  it('reports insufficient capacity instead of shrinking mandatory actions or pretending they fit an overlay', () => {
    const input = Array.from({ length: 28 }, (_, index) => ({
      ...label(`L${index}`, 150, 150),
      locationCode: `L${index}`,
      priority: 3,
      mandatory: true,
      width: 44,
      height: 44,
    }));
    const result = layoutLabels(
      input,
      { left: 0, top: 0, right: 310, bottom: 410 },
      [{ left: 10, top: 0, right: 310, bottom: 300 }],
    );
    expect(result.filter((item) => item.visible).length).toBeLessThan(28);
    expect(result.some((item) => !item.visible)).toBe(true);
  });
  it('uses preferred positions and separates colliding drawer rows deterministically', () => {
    const input = [label('D04', 50, 37), label('D01', 50, 30)];
    const first = layoutLabels(input, viewport);
    expect(first).toEqual(layoutLabels([...input].reverse(), viewport));
    expect(first.find((item) => item.id === 'D01')).toMatchObject({
      visible: true,
      dx: 0,
      dy: 0,
    });
    const second = first.find((item) => item.id === 'D04')!;
    expect(second.visible).toBe(true);
    const verticalGap = Math.abs(37 + second.dy - 30);
    const horizontalGap = Math.abs(second.dx);
    expect(verticalGap >= 21 || horizontalGap >= 48).toBe(true);
  });

  it('keeps selected labels first and inside canvas edges', () => {
    const input = [label('ordinary', 0, 0), label('selected', 0, 0, true)];
    const placements = layoutLabels(input, viewport);
    const selected = placements.find((item) => item.id === 'selected')!;
    const ordinary = placements.find((item) => item.id === 'ordinary')!;
    expect(selected).toMatchObject({ visible: true, dx: 8, dy: 8 });
    expect(ordinary.visible).toBe(true);
    for (const item of placements) {
      expect(item.dx).toBeGreaterThanOrEqual(-56);
      expect(item.dx).toBeLessThanOrEqual(56);
      expect(item.dy).toBeGreaterThanOrEqual(-56);
      expect(item.dy).toBeLessThanOrEqual(56);
      expect(
        input.find((row) => row.id === item.id)!.left + item.dx,
      ).toBeGreaterThanOrEqual(2);
      expect(
        input.find((row) => row.id === item.id)!.top + item.dy,
      ).toBeGreaterThanOrEqual(2);
    }
  });

  it('suppresses lowest-priority labels when bounded space cannot hold them', () => {
    const crowded = [label('selected', 10, 10, true), label('low', 10, 10)];
    const placements = layoutLabels(crowded, {
      left: 0,
      top: 0,
      right: 55,
      bottom: 25,
    });
    expect(placements.find((item) => item.id === 'selected')?.visible).toBe(
      true,
    );
    expect(placements.find((item) => item.id === 'low')?.visible).toBe(false);
  });

  it('prioritizes selection then hover, deduplicates location text and avoids reserved panels', () => {
    const input = [
      { ...label('decoration', 30, 30), priority: 0 },
      { ...label('normal', 30, 30), priority: 1, locationCode: 'ITC-D01' },
      { ...label('hover', 30, 30), priority: 2, locationCode: 'ITC-D01' },
      { ...label('selected', 30, 30), priority: 3, locationCode: 'ITC-D02' },
    ];
    const reserved = [{ left: 0, top: 0, right: 70, bottom: 25 }];
    const placements = layoutLabels(input, viewport, reserved);
    expect(placements.map((item) => item.id)).toEqual([
      'selected',
      'hover',
      'normal',
      'decoration',
    ]);
    expect(placements.find((item) => item.id === 'normal')?.visible).toBe(
      false,
    );
    const areas = placements
      .filter((item) => item.visible)
      .map((item) => {
        const source = input.find((row) => row.id === item.id)!;
        return {
          left: source.left + item.dx,
          top: source.top + item.dy,
          right: source.left + item.dx + source.width,
          bottom: source.top + item.dy + source.height,
        };
      });
    for (const [index, area] of areas.entries())
      for (const other of [...reserved, ...areas.slice(index + 1)])
        expect(
          area.left >= other.right + 3 ||
            area.right + 3 <= other.left ||
            area.top >= other.bottom + 3 ||
            area.bottom + 3 <= other.top,
        ).toBe(true);
  });
});
