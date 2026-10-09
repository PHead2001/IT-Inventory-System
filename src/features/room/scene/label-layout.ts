export type LabelRect = {
  id: string;
  selected: boolean;
  priority?: number;
  locationCode?: string;
  left: number;
  top: number;
  width: number;
  height: number;
  mandatory?: boolean;
  preferFull?: boolean;
  compact?: { width: number; height: number };
  previous?: { dx: number; dy: number; compact: boolean };
};
export type LabelPlacement = {
  id: string;
  visible: boolean;
  dx: number;
  dy: number;
  compact?: boolean;
};
export type LabelArea = {
  left: number;
  top: number;
  right: number;
  bottom: number;
};

const MAX_SHIFT = 56;
const STEP = 8;
const GAP = 3;
const EDGE = 2;
const offsets: [number, number][] = [];
for (let dx = -MAX_SHIFT; dx <= MAX_SHIFT; dx += STEP)
  for (let dy = -MAX_SHIFT; dy <= MAX_SHIFT; dy += STEP) offsets.push([dx, dy]);
offsets.sort(
  (a, b) =>
    Math.abs(a[0]) + Math.abs(a[1]) - Math.abs(b[0]) - Math.abs(b[1]) ||
    Math.abs(a[0]) - Math.abs(b[0]) ||
    a[1] - b[1] ||
    a[0] - b[0],
);

function overlaps(a: LabelArea, b: LabelArea) {
  return (
    a.left < b.right + GAP &&
    a.right + GAP > b.left &&
    a.top < b.bottom + GAP &&
    a.bottom + GAP > b.top
  );
}

/** Deterministic screen-space placement; scene geometry and focus points never move. */
export function layoutLabels(
  labels: LabelRect[],
  viewport: LabelArea,
  reserved: LabelArea[] = [],
): LabelPlacement[] {
  const ordered = [...labels].sort(
    (a, b) =>
      Number(b.selected) - Number(a.selected) ||
      Number(b.mandatory) - Number(a.mandatory) ||
      (b.priority ?? Number(b.selected) * 3) -
        (a.priority ?? Number(a.selected) * 3) ||
      (a.locationCode ?? a.id).localeCompare(b.locationCode ?? b.id) ||
      a.id.localeCompare(b.id),
  );
  const occupied = [...reserved];
  const placedCodes = new Set<string>();
  const placements = ordered.map((label) => {
    if (label.locationCode && placedCodes.has(label.locationCode))
      return { id: label.id, visible: false, dx: 0, dy: 0 };
    const candidates: { dx: number; dy: number; compact: boolean }[] = [];
    if (label.previous)
      candidates.push({ ...label.previous, compact: !!label.compact });
    // Selected/full mandatory text wins. Ordinary occupied markers use compact
    // first so optional full text cannot consume another target's hit footprint.
    const variants = label.compact ? [true] : [false];
    for (const compact of variants) {
      for (const [dx, dy] of offsets) candidates.push({ dx, dy, compact });
      if (label.mandatory) {
        const dimension = compact ? label.compact! : label;
        // A finite deterministic viewport rail is allowed for mandatory labels.
        // It never changes geometry, shrinks targets or steals optional slots.
        for (
          let top = viewport.top + EDGE;
          top + dimension.height <= viewport.bottom - EDGE;
          top += dimension.height + GAP
        )
          for (
            let left = viewport.left + EDGE;
            left + dimension.width <= viewport.right - EDGE;
            left += dimension.width + GAP
          )
            candidates.push({
              dx: left - label.left,
              dy: top - label.top,
              compact,
            });
      }
    }
    for (const { dx, dy, compact } of candidates) {
      const dimension = compact ? label.compact! : label;
      const candidate = {
        left: label.left + dx,
        top: label.top + dy,
        right: label.left + dx + dimension.width,
        bottom: label.top + dy + dimension.height,
      };
      if (
        candidate.left < viewport.left + EDGE ||
        candidate.top < viewport.top + EDGE ||
        candidate.right > viewport.right - EDGE ||
        candidate.bottom > viewport.bottom - EDGE ||
        occupied.some((item) => overlaps(candidate, item))
      )
        continue;
      occupied.push(candidate);
      if (label.locationCode) placedCodes.add(label.locationCode);
      return {
        id: label.id,
        visible: true,
        dx,
        dy,
        ...(label.compact ? { compact } : {}),
      };
    }
    return { id: label.id, visible: false, dx: 0, dy: 0 };
  });
  // Expand only after every mandatory footprint has its place. Keep the same
  // anchor and offset: no focus/hover expansion may move or displace a neighbor.
  for (const result of placements) {
    const label = labels.find((entry) => entry.id === result.id)!;
    if (!result.visible || !result.compact || !label.preferFull) continue;
    const area = {
      left: label.left + result.dx,
      top: label.top + result.dy,
      right: label.left + result.dx + label.width,
      bottom: label.top + result.dy + label.height,
    };
    const others = placements
      .filter((entry) => entry !== result && entry.visible)
      .map((entry) => {
        const source = labels.find((candidate) => candidate.id === entry.id)!;
        const dimension = entry.compact ? source.compact! : source;
        return {
          left: source.left + entry.dx,
          top: source.top + entry.dy,
          right: source.left + entry.dx + dimension.width,
          bottom: source.top + entry.dy + dimension.height,
        };
      });
    if (
      area.left >= viewport.left + EDGE &&
      area.top >= viewport.top + EDGE &&
      area.right <= viewport.right - EDGE &&
      area.bottom <= viewport.bottom - EDGE &&
      ![...reserved, ...others].some((other) => overlaps(area, other))
    )
      result.compact = false;
  }
  return placements;
}
