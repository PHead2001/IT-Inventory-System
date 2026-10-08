export type LabelRect = {
  id: string;
  selected: boolean;
  priority?: number;
  locationCode?: string;
  left: number;
  top: number;
  width: number;
  height: number;
};
export type LabelPlacement = {
  id: string;
  visible: boolean;
  dx: number;
  dy: number;
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
      (b.priority ?? Number(b.selected) * 3) -
        (a.priority ?? Number(a.selected) * 3) ||
      a.top - b.top ||
      a.left - b.left ||
      a.id.localeCompare(b.id),
  );
  const occupied = [...reserved];
  const placedCodes = new Set<string>();
  return ordered.map((label) => {
    if (label.locationCode && placedCodes.has(label.locationCode))
      return { id: label.id, visible: false, dx: 0, dy: 0 };
    for (const [dx, dy] of offsets) {
      const candidate = {
        left: label.left + dx,
        top: label.top + dy,
        right: label.left + dx + label.width,
        bottom: label.top + dy + label.height,
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
      return { id: label.id, visible: true, dx, dy };
    }
    return { id: label.id, visible: false, dx: 0, dy: 0 };
  });
}
