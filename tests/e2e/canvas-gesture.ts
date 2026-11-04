type Bounds = { left: number; top: number; right: number; bottom: number };
type Viewport = { width: number; height: number };
type Delta = { dx: number; dy: number };

/** Sample starts where the entire unchanged gesture fits in the visible canvas.
 * Actual native hit testing must still reject DOM overlays along every path. */
export function canvasGestureCandidates(
  canvas: Bounds,
  viewport: Viewport,
  delta: Delta,
) {
  const left = Math.max(0, canvas.left) + 1;
  const top = Math.max(0, canvas.top) + 1;
  const right = Math.min(viewport.width, canvas.right) - 1;
  const bottom = Math.min(viewport.height, canvas.bottom) - 1;
  const minX = Math.max(left, left - delta.dx);
  const maxX = Math.min(right, right - delta.dx);
  const minY = Math.max(top, top - delta.dy);
  const maxY = Math.min(bottom, bottom - delta.dy);
  if (minX > maxX || minY > maxY) return [];
  const candidates = [];
  for (const yPart of [0.5, 0.3, 0.7, 0.15, 0.85])
    for (const xPart of [0.5, 0.3, 0.7, 0.15, 0.85])
      candidates.push({
        x: minX + (maxX - minX) * xPart,
        y: minY + (maxY - minY) * yPart,
      });
  return candidates;
}
