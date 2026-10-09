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
  focused?: boolean;
  hovered?: boolean;
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
      Number(b.focused) - Number(a.focused) ||
      Number(b.hovered) - Number(a.hovered) ||
      Number(b.selected) - Number(a.selected) ||
      Number(b.mandatory) - Number(a.mandatory) ||
      (b.priority ?? Number(b.selected) * 3) -
        (a.priority ?? Number(a.selected) * 3) ||
      (a.locationCode ?? a.id).localeCompare(b.locationCode ?? b.id) ||
      a.id.localeCompare(b.id),
  );
  const pack = (
    compactPacking: boolean,
    protectedPlacements: LabelPlacement[] = [],
    bottomFirst = false,
    rightFirst = false,
  ) => {
    const occupied = [...reserved];
    for (const result of protectedPlacements) {
      const label = labels.find((entry) => entry.id === result.id)!;
      const size = result.compact ? label.compact! : label;
      occupied.push({
        left: label.left + result.dx,
        top: label.top + result.dy,
        right: label.left + result.dx + size.width,
        bottom: label.top + result.dy + size.height,
      });
    }
    const placedCodes = new Set<string>();
    const placements = ordered.map((label) => {
      const protectedPlacement = protectedPlacements.find(
        (entry) => entry.id === label.id,
      );
      if (protectedPlacement) {
        if (label.locationCode) placedCodes.add(label.locationCode);
        return { ...protectedPlacement };
      }
      if (label.locationCode && placedCodes.has(label.locationCode))
        return { id: label.id, visible: false, dx: 0, dy: 0 };
      const candidates: { dx: number; dy: number; compact: boolean }[] = [];
      if (label.previous && (!compactPacking || label.focused || label.hovered))
        candidates.push({
          ...label.previous,
          compact:
            label.focused || label.hovered
              ? label.previous.compact && !!label.compact
              : !!label.compact,
        });
      // Selected/full mandatory text wins. Ordinary occupied markers use compact
      // first so optional full text cannot consume another target's hit footprint.
      const variants = label.compact ? [true] : [false];
      for (const compact of variants) {
        if (!compactPacking)
          for (const [dx, dy] of offsets) candidates.push({ dx, dy, compact });
        if (label.mandatory) {
          const dimension = compact ? label.compact! : label;
          // A finite deterministic viewport rail is allowed for mandatory labels.
          // It never changes geometry, shrinks targets or steals optional slots.
          const railLefts: number[] = [];
          for (
            let left = viewport.left + EDGE;
            left + dimension.width <= viewport.right - EDGE;
            left += dimension.width + GAP
          )
            railLefts.push(left);
          const mirroredLefts = railLefts.map(
            (left) =>
              viewport.right -
              EDGE -
              dimension.width -
              (left - viewport.left - EDGE),
          );
          const columns = compactPacking
            ? rightFirst
              ? [...mirroredLefts, ...railLefts]
              : [...railLefts, ...mirroredLefts]
            : railLefts;
          for (
            let top = viewport.top + EDGE;
            top + dimension.height <= viewport.bottom - EDGE;
            top += dimension.height + GAP
          )
            for (const left of columns)
              candidates.push({
                dx: left - label.left,
                dy:
                  (bottomFirst
                    ? viewport.bottom -
                      EDGE -
                      dimension.height -
                      (top - viewport.top - EDGE)
                    : top) - label.top,
                compact,
              });
        }
      }
      if (compactPacking)
        for (const compact of variants)
          for (const [dx, dy] of offsets) candidates.push({ dx, dy, compact });
      // A live focused action keeps its current footprint and position. If it no
      // longer fits the viewport, normal constrained placement remains available.
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
    return placements;
  };
  let placements = pack(false);
  const mandatoryCodes = new Set(
    labels
      .filter((label) => label.mandatory || label.selected)
      .map((label) => label.locationCode ?? label.id),
  );
  const labelById = new Map(labels.map((label) => [label.id, label]));
  const coverage = (results: LabelPlacement[]) =>
    new Set(
      results
        .filter((result) => result.visible)
        .map((result) => labelById.get(result.id)!)
        .filter((label) => label.mandatory || label.selected)
        .map((label) => label.locationCode ?? label.id),
    ).size;
  if (coverage(placements) < mandatoryCodes.size) {
    const normal = placements;
    const sources = labelById;
    const areaOf = (result: LabelPlacement) => {
      const label = sources.get(result.id)!;
      const size = result.compact ? label.compact! : label;
      return {
        left: label.left + result.dx,
        top: label.top + result.dy,
        right: label.left + result.dx + size.width,
        bottom: label.top + result.dy + size.height,
      };
    };
    const protectedPlacements = normal.filter(
      (result) =>
        result.visible &&
        (sources.get(result.id)!.selected ||
          sources.get(result.id)!.focused ||
          sources.get(result.id)!.hovered),
    );
    const normalCoverage = coverage(normal);
    let bestCoverage = normalCoverage;
    let bestDistance = Infinity;
    const consider = (protectedEntries: LabelPlacement[]) => {
      const distance = protectedEntries.reduce((sum, entry) => {
        const previous = normal.find((item) => item.id === entry.id)!;
        return (
          sum +
          Math.abs(entry.dx - previous.dx) +
          Math.abs(entry.dy - previous.dy)
        );
      }, 0);
      for (const bottomFirst of [false, true])
        for (const rightFirst of [false, true]) {
          const packed = pack(true, protectedEntries, bottomFirst, rightFirst);
          const count = coverage(packed),
            best = bestCoverage;
          if (
            count > best ||
            (count === best &&
              count > normalCoverage &&
              distance < bestDistance)
          ) {
            placements = packed;
            bestCoverage = count;
            bestDistance = distance;
          }
        }
    };
    consider(protectedPlacements);
    // Inactive selected text can align with compact rows instead of consuming
    // two rows between them. A live focus/hover action is never moved here.
    const candidates: { placements: LabelPlacement[]; distance: number }[] = [];
    for (const selected of bestCoverage === mandatoryCodes.size
      ? []
      : protectedPlacements) {
      const label = sources.get(selected.id)!;
      if (!label.selected || label.focused || label.hovered) continue;
      const others = protectedPlacements.filter((entry) => entry !== selected);
      const obstacles = [...reserved, ...others.map(areaOf)];
      const xs = new Set([
        label.left + selected.dx,
        viewport.left + EDGE,
        viewport.right - EDGE - label.width,
      ]);
      const ys = new Set([
        label.top + selected.dy,
        viewport.top + EDGE,
        viewport.bottom - EDGE - label.height,
      ]);
      // The mandatory action grid is 44px, with the same collision gap.
      for (
        let offset = 0;
        offset < viewport.right - viewport.left;
        offset += 44 + GAP
      ) {
        xs.add(viewport.left + EDGE + offset);
        xs.add(viewport.right - EDGE - label.width - offset);
      }
      for (
        let offset = 0;
        offset < viewport.bottom - viewport.top;
        offset += 44 + GAP
      ) {
        ys.add(viewport.top + EDGE + offset);
        ys.add(viewport.bottom - EDGE - label.height - offset);
      }
      for (const obstacle of obstacles) {
        xs.add(obstacle.right + GAP);
        xs.add(obstacle.left - GAP - label.width);
        ys.add(obstacle.bottom + GAP);
        ys.add(obstacle.top - GAP - label.height);
      }
      for (const left of xs)
        for (const top of ys) {
          const area = {
            left,
            top,
            right: left + label.width,
            bottom: top + label.height,
          };
          if (
            left < viewport.left + EDGE ||
            top < viewport.top + EDGE ||
            area.right > viewport.right - EDGE ||
            area.bottom > viewport.bottom - EDGE ||
            obstacles.some((obstacle) => overlaps(area, obstacle))
          )
            continue;
          candidates.push({
            distance:
              Math.abs(left - label.left - selected.dx) +
              Math.abs(top - label.top - selected.dy),
            placements: [
              ...others,
              {
                ...selected,
                dx: left - label.left,
                dy: top - label.top,
                ...(label.compact ? { compact: false } : {}),
              },
            ],
          });
        }
    }
    // Search nearest selected placements first. Once every mandatory location
    // fits, farther candidates cannot improve coverage or displacement. Stable
    // sorting retains the original candidate order for equal-distance ties.
    candidates.sort((a, b) => a.distance - b.distance);
    for (const candidate of candidates) {
      if (bestCoverage === mandatoryCodes.size) break;
      consider(candidate.placements);
    }
  }
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
