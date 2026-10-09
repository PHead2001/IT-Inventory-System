import capturedTransition from '../../../../tests/fixtures/room/selected-footprint-transition.json';
import capturedActive from '../../../../tests/fixtures/room/more-active-labels.json';
import capturedSelected from '../../../../tests/fixtures/room/more-selected-labels.json';
import capturedMore from '../../../../tests/fixtures/room/more-labels.json';
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
  const narrowViewport = { left: 30, top: 404, right: 345, bottom: 812 };
  const morePanel = [{ left: 106, top: 397, right: 346, bottom: 617 }];
  it('recovers all 22 exposed real-scene targets from fragmented prior placements with More open', () => {
    // Captured production RoomScene, room JSON, CSS and Inter font at 375x812.
    const input: LabelRect[] = capturedMore;
    expect(input).toHaveLength(22);
    const result = layoutLabels(input, narrowViewport, morePanel);
    expect(result.every((entry) => entry.visible)).toBe(true);
    const areas = result.map((entry) => {
      const source = input.find((item) => item.id === entry.id)!;
      const size = entry.compact ? source.compact! : source;
      return {
        left: source.left + entry.dx,
        top: source.top + entry.dy,
        right: source.left + entry.dx + size.width,
        bottom: source.top + entry.dy + size.height,
      };
    });
    for (const [index, area] of areas.entries()) {
      expect(area.left).toBeGreaterThanOrEqual(narrowViewport.left + 2);
      expect(area.top).toBeGreaterThanOrEqual(narrowViewport.top + 2);
      expect(area.right).toBeLessThanOrEqual(narrowViewport.right - 2);
      expect(area.bottom).toBeLessThanOrEqual(narrowViewport.bottom - 2);
      for (const other of [...morePanel, ...areas.slice(index + 1)])
        expect(
          area.left >= other.right + 3 ||
            area.right + 3 <= other.left ||
            area.top >= other.bottom + 3 ||
            area.bottom + 3 <= other.top,
        ).toBe(true);
    }
    expect(result).toEqual(
      layoutLabels([...input].reverse(), narrowViewport, morePanel),
    );
    const repeated = input.map((entry) => {
      const placement = result.find((item) => item.id === entry.id)!;
      return {
        ...entry,
        previous: {
          dx: placement.dx,
          dy: placement.dy,
          compact: !!placement.compact,
        },
      };
    });
    expect(layoutLabels(repeated, narrowViewport, morePanel)).toEqual(result);
  });
  it('realigns inactive selected text to recover all 22 targets and remains stable on the next frame', () => {
    const input: LabelRect[] = capturedSelected;
    expect(input).toHaveLength(22);
    const result = layoutLabels(input, narrowViewport, morePanel);
    expect(result.every((entry) => entry.visible)).toBe(true);
    const selected = input.find((entry) => entry.selected)!;
    // Same minimum-displacement result as exhaustive candidate traversal.
    expect(result.find((entry) => entry.id === selected.id)).toMatchObject({
      dx: 24,
      dy: -11.967041015625,
    });
    expect(result.find((entry) => entry.id === selected.id)?.visible).toBe(
      true,
    );
    expect(
      result.find((entry) => entry.id === selected.id)?.compact ?? false,
    ).toBe(false);
    const repeated = input.map((entry) => {
      const placed = result.find((item) => item.id === entry.id)!;
      return {
        ...entry,
        previous: { dx: placed.dx, dy: placed.dy, compact: !!placed.compact },
      };
    });
    expect(layoutLabels(repeated, narrowViewport, morePanel)).toEqual(result);
    // Pointer entry must preserve the selected full label's settled hit rectangle.
    expect(
      layoutLabels(
        repeated.map((entry) => ({ ...entry, hovered: entry.selected })),
        narrowViewport,
        morePanel,
      ),
    ).toEqual(result);
  });
  it('fits the captured focused selection plus a separately hovered full label without moving either', () => {
    const input: LabelRect[] = capturedActive;
    const active = input.filter((entry) => entry.focused || entry.hovered);
    expect(active).toHaveLength(2);
    const result = layoutLabels(input, narrowViewport, morePanel);
    expect(result.every((entry) => entry.visible)).toBe(true);
    for (const entry of active)
      expect(result.find((item) => item.id === entry.id)).toMatchObject({
        visible: true,
        dx: entry.previous!.dx,
        dy: entry.previous!.dy,
      });
  });
  it.each([
    ['fits', 0],
    ['fits', 0.5],
    ['fits', 1],
    ['overflows', 0],
    ['overflows', 0.5],
    ['overflows', 1],
  ] as const)(
    'repacks only the newly selected full footprint when its prior compact position %s and pointer fraction %s',
    (variant, fraction) => {
      const input: LabelRect[] = capturedTransition.map((entry) =>
        entry.selected && variant === 'overflows'
          ? {
              ...entry,
              previous: {
                ...entry.previous!,
                dx: 299 - entry.left,
                compact: true,
              },
            }
          : entry.hovered
            ? {
                ...entry,
                pointer: {
                  x:
                    entry.left +
                    entry.previous!.dx +
                    1 +
                    (entry.width - 2) * fraction,
                  y: entry.top + entry.previous!.dy + 22,
                  bounds: {
                    left: entry.left + entry.previous!.dx,
                    top: entry.top + entry.previous!.dy,
                    right: entry.left + entry.previous!.dx + entry.width,
                    bottom: entry.top + entry.previous!.dy + entry.height,
                  },
                },
              }
            : entry,
      );
      const result = layoutLabels(input, narrowViewport, morePanel);
      expect(result.every((entry) => entry.visible)).toBe(true);
      const selected = input.find((entry) => entry.selected)!;
      const full = result.find((entry) => entry.id === selected.id)!;
      expect(full.compact ?? false).toBe(false);
      const hovered = input.find((entry) => entry.hovered)!;
      const marker = result.find((entry) => entry.id === hovered.id)!;
      expect(marker.yielded).toBe(true);
      const box = {
        left: hovered.left + marker.dx,
        top: hovered.top + marker.dy,
        right: hovered.left + marker.dx + 44,
        bottom: hovered.top + marker.dy + 44,
      };
      expect(box.left).toBeGreaterThanOrEqual(hovered.pointer!.bounds.left);
      expect(box.right).toBeLessThanOrEqual(hovered.pointer!.bounds.right);
      expect(box.top).toBeGreaterThanOrEqual(hovered.pointer!.bounds.top);
      expect(box.bottom).toBeLessThanOrEqual(hovered.pointer!.bounds.bottom);
      expect(hovered.pointer!.x).toBeGreaterThanOrEqual(box.left);
      expect(hovered.pointer!.x).toBeLessThan(box.right);
      const settled = input.map((entry) => {
        const placed = result.find((item) => item.id === entry.id)!;
        return {
          ...entry,
          holdCompact: !!placed.yielded,
          previous: { dx: placed.dx, dy: placed.dy, compact: !!placed.compact },
        };
      });
      expect(layoutLabels(settled, narrowViewport, morePanel)).toEqual(result);
      expect(settled.find((entry) => entry.id === selected.id)?.focused).toBe(
        true,
      );
    },
  );
  it('keeps a prior full hovered action pinned without a valid pointer witness even if coverage is incomplete', () => {
    const input: LabelRect[] = capturedTransition;
    const hovered = input.find((entry) => entry.hovered)!;
    for (const pointer of [
      undefined,
      { x: NaN, y: 0, bounds: morePanel[0] },
      { x: 0, y: 0, bounds: morePanel[0] },
    ]) {
      const result = layoutLabels(
        input.map((entry) =>
          entry === hovered ? { ...entry, pointer } : entry,
        ),
        narrowViewport,
        morePanel,
      );
      expect(result.find((entry) => entry.id === hovered.id)).toMatchObject({
        visible: true,
        compact: false,
        dx: hovered.previous!.dx,
        dy: hovered.previous!.dy,
      });
      expect(result.some((entry) => !entry.visible)).toBe(true);
    }
  });
  it.each(['focused', 'hovered'] as const)(
    'honestly reports impossible capacity beside a %s selected action',
    (active) => {
      // Usable area is 92x44: the 91x44 selected action leaves only one pixel.
      const input: LabelRect[] = [
        {
          ...label('selected', 2, 2, true),
          mandatory: true,
          width: 91,
          height: 44,
          [active]: true,
          previous: { dx: 0, dy: 0, compact: false },
        },
        { ...label('other', 2, 2), mandatory: true, width: 44, height: 44 },
      ];
      const result = layoutLabels(input, {
        left: 0,
        top: 0,
        right: 96,
        bottom: 48,
      });
      expect(result.find((entry) => entry.id === 'selected')).toMatchObject({
        visible: true,
        dx: 0,
        dy: 0,
      });
      expect(result.find((entry) => entry.id === 'other')?.visible).toBe(false);
    },
  );
  it('uses the lower free band when an overlay cuts across the top-origin rail grid', () => {
    const input = Array.from({ length: 24 }, (_, index) => ({
      ...label(String(index), 150, 650),
      mandatory: true,
      width: 180,
      height: 44,
      compact: { width: 44, height: 44 },
    }));
    expect(
      layoutLabels(input, narrowViewport, morePanel).every(
        (entry) => entry.visible,
      ),
    ).toBe(true);
  });
  it('preserves a genuinely focused expanded footprint and selected text during fallback', () => {
    const input: LabelRect[] = [
      {
        ...label('focused', 32, 625),
        mandatory: true,
        focused: true,
        preferFull: true,
        width: 91,
        height: 44,
        compact: { width: 44, height: 44 },
        previous: { dx: 0, dy: 0, compact: false },
      },
      {
        ...label('selected', 126, 625, true),
        mandatory: true,
        width: 185,
        height: 44,
      },
      ...Array.from({ length: 20 }, (_, index) => ({
        ...label('M' + index, 150, 700),
        mandatory: true,
        width: 180,
        height: 44,
        compact: { width: 44, height: 44 },
      })),
    ];
    const result = layoutLabels(input, narrowViewport, morePanel);
    expect(result.every((entry) => entry.visible)).toBe(true);
    expect(result.find((entry) => entry.id === 'focused')).toMatchObject({
      visible: true,
      dx: 0,
      dy: 0,
      compact: false,
    });
    expect(result.find((entry) => entry.id === 'selected')).toMatchObject({
      visible: true,
      dx: 0,
      dy: 0,
    });
  });
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
