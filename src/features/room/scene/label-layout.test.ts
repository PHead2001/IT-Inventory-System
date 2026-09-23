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
});
