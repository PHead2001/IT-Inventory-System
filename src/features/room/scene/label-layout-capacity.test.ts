import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import captured from '../../../../tests/fixtures/room/ci-phone-selected-capacity.json';
import {
  layoutLabels,
  type LabelArea,
  type LabelPlacement,
  type LabelRect,
} from './label-layout';

// Sanitized CI 38023742642 / job 114130066900, exact settled transaction 221
// at cf3caf4551b3aa44dab4e33b3f614c8574049e0b; geometry/flags/output retained.
const baseline = captured.passes[0];
const labels: LabelRect[] = baseline.labels;
const css = readFileSync(
  resolve(process.cwd(), 'src/features/room/room-visual.module.css'),
  'utf8',
);

// This models the authored border-box limits against the exact failing inputs.
// It is not a revised browser measurement: the unchanged phone E2E must record
// the actual popup, wrapped selected text and all independently exposed targets.
function modeledPhonePanel(): LabelArea[] {
  const phone = css.match(
    /@media \(max-width: 720px\) \{\s*\.moreMenu \{([^}]+)\}/,
  );
  expect(
    phone,
    'canonical phone breakpoint overrides the popup footprint',
  ).toBeTruthy();
  const width = Number(phone![1].match(/width: min\((\d+)px, 100%\)/)?.[1]);
  const height = Number(
    phone![1].match(/max-height: min\(35dvh, (\d+)px\)/)?.[1],
  );
  expect(Number.isFinite(width) && width > 0).toBe(true);
  expect(Number.isFinite(height) && height > 0).toBe(true);
  return baseline.reserved.map((panel) => ({
    ...panel,
    left: panel.right - width,
    bottom: panel.top + height,
  }));
}

function assertPhysicalPlacement(
  result: LabelPlacement[],
  reserved: LabelArea[],
) {
  expect(result).toHaveLength(22);
  expect(result.every((entry) => entry.visible)).toBe(true);
  const areas = result.map((placed) => {
    const source = labels.find((entry) => entry.id === placed.id)!;
    const size = placed.compact ? source.compact! : source;
    expect(size.width).toBeGreaterThanOrEqual(44);
    expect(size.height).toBeGreaterThanOrEqual(44);
    if (source.selected) {
      expect(placed.compact ?? false).toBe(false);
      expect(size).toMatchObject({ width: 238, height: 62 });
    }
    return {
      left: source.left + placed.dx,
      top: source.top + placed.dy,
      right: source.left + placed.dx + size.width,
      bottom: source.top + placed.dy + size.height,
    };
  });
  for (const [index, area] of areas.entries()) {
    expect(area.left).toBeGreaterThanOrEqual(baseline.viewport.left + 2);
    expect(area.top).toBeGreaterThanOrEqual(baseline.viewport.top + 2);
    expect(area.right).toBeLessThanOrEqual(baseline.viewport.right - 2);
    expect(area.bottom).toBeLessThanOrEqual(baseline.viewport.bottom - 2);
    for (const other of [...reserved, ...areas.slice(index + 1)]) {
      expect(
        area.left >= other.right + 3 ||
          area.right + 3 <= other.left ||
          area.top >= other.bottom + 3 ||
          area.bottom + 3 <= other.top,
      ).toBe(true);
    }
  }
}

describe('captured CI phone selected-label capacity', () => {
  it('preserves the exact settled 22-input transaction and its three suppressed actions', () => {
    expect(captured).toMatchObject({
      schema: 1,
      transaction: 221,
      complete: true,
      settled: true,
    });
    expect(labels).toHaveLength(22);
    expect(
      labels.every(
        (entry) => entry.mandatory && !entry.focused && !entry.hovered,
      ),
    ).toBe(true);
    const result = layoutLabels(labels, baseline.viewport, baseline.reserved);
    expect(result).toEqual(baseline.output);
    expect(result.filter((entry) => entry.visible)).toHaveLength(19);
    expect(
      result.filter((entry) => !entry.visible).map((entry) => entry.id),
    ).toEqual(['shelf-3c', 'shelf-4b', 'shelf-4c']);
  });

  it('models all 22 actions beside the CSS phone popup without shrinking selected text or touch targets', () => {
    const reserved = modeledPhonePanel();
    const result = layoutLabels(labels, baseline.viewport, reserved);
    assertPhysicalPlacement(result, reserved);
    expect(
      layoutLabels([...labels].reverse(), baseline.viewport, reserved),
    ).toEqual(result);
    const settled = labels.map((entry) => {
      const placed = result.find((item) => item.id === entry.id)!;
      return {
        ...entry,
        previous: { dx: placed.dx, dy: placed.dy, compact: !!placed.compact },
      };
    });
    expect(layoutLabels(settled, baseline.viewport, reserved)).toEqual(result);
  });
});
