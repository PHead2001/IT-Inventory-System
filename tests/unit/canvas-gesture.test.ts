import { describe, expect, it } from 'vitest';
import { canvasGestureCandidates } from '../e2e/canvas-gesture';

describe('canvas gesture candidates', () => {
  it('finds the captured phone corridor without shortening the native drag', () => {
    const canvas = {
      left: 30,
      top: 365.046875,
      right: 360,
      bottom: 773.046875,
    };
    const viewport = { width: 390, height: 844 };
    const delta = { dx: 0, dy: 408 * 0.35 };
    const label = { left: 30, top: 529, right: 329, bottom: 573 };
    const uncovered = (point: { x: number; y: number }) =>
      Array.from({ length: 9 }, (_, step) => {
        const x = point.x + (delta.dx * step) / 8;
        const y = point.y + (delta.dy * step) / 8;
        return (
          x >= canvas.left &&
          x < canvas.right &&
          y >= canvas.top &&
          y < canvas.bottom &&
          !(
            x >= label.left &&
            x <= label.right &&
            y >= label.top &&
            y <= label.bottom
          )
        );
      }).every(Boolean);
    const oldStarts = [0.5, 0.3, 0.7, 0.15, 0.85].flatMap((y) =>
      [0.5, 0.3, 0.7, 0.15, 0.85].map((x) => ({
        x: canvas.left + (canvas.right - canvas.left) * x,
        y: canvas.top + (canvas.bottom - canvas.top) * y,
      })),
    );
    expect(oldStarts.some(uncovered)).toBe(false);
    const candidate = canvasGestureCandidates(canvas, viewport, delta).find(
      uncovered,
    );
    expect(candidate).toBeDefined();
    expect(candidate!.y).toBeGreaterThan(label.bottom);
    expect(candidate!.y + delta.dy).toBeLessThan(canvas.bottom);
  });

  it.each([
    { dx: 35, dy: 80 },
    { dx: -35, dy: -80 },
  ])('keeps both ends inside the visible canvas for %o', (delta) => {
    const candidates = canvasGestureCandidates(
      { left: -40, top: 30, right: 340, bottom: 500 },
      { width: 300, height: 400 },
      delta,
    );
    expect(candidates).toHaveLength(25);
    for (const start of candidates)
      for (const point of [
        start,
        { x: start.x + delta.dx, y: start.y + delta.dy },
      ]) {
        expect(point.x).toBeGreaterThan(0);
        expect(point.x).toBeLessThan(300);
        expect(point.y).toBeGreaterThan(30);
        expect(point.y).toBeLessThan(400);
      }
  });

  it('returns no candidates when the unchanged extent cannot fit', () => {
    expect(
      canvasGestureCandidates(
        { left: 0, top: 0, right: 100, bottom: 100 },
        { width: 100, height: 100 },
        { dx: 0, dy: 100 },
      ),
    ).toEqual([]);
  });
});
