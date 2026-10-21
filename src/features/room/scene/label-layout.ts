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
  pointer?: { x: number; y: number; bounds: LabelArea };
  holdCompact?: boolean;
  compact?: { width: number; height: number };
  previous?: { dx: number; dy: number; compact: boolean };
};
export type LabelPlacement = {
  id: string;
  visible: boolean;
  dx: number;
  dy: number;
  compact?: boolean;
  yielded?: boolean;
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

export type LabelPackingBudget = {
  maxOperations: number;
  maxCandidates: number;
  maxNodes: number;
  maxMilliseconds: number;
  maxInputs: number;
  maxCandidatesPerLabel: number;
};
export type LabelPackingStats = {
  operations: number;
  candidates: number;
  nodes: number;
  backtracks: number;
  elapsedMs: number;
  greedyComplete: boolean;
};
export type LabelLayoutResult = {
  placements: LabelPlacement[];
  status: 'complete' | 'candidate-infeasible' | 'budget-exhausted';
  stats: LabelPackingStats;
};
export const LABEL_PACKING_BUDGET: Readonly<LabelPackingBudget> = Object.freeze(
  {
    maxOperations: 2_000_000,
    maxCandidates: 50_000,
    maxNodes: 4096,
    maxMilliseconds: 16,
    maxInputs: 128,
    maxCandidatesPerLabel: 4096,
  },
);

type Candidate = LabelPlacement & { area: LabelArea };
// A viewport-space candidate must also have a representable anchor-relative
// displacement. Validate anchors before either greedy or search construction;
// the cooperative deadline may prevent the final defensive pass from running.
const hasFiniteAnchor = (label: LabelRect) =>
  Number.isFinite(label.left) && Number.isFinite(label.top);
const logicalKey = (label: LabelRect) => label.locationCode ?? label.id;
function areaOf(label: LabelRect, placement: LabelPlacement): LabelArea {
  const size = placement.compact ? label.compact! : label;
  return {
    left: label.left + placement.dx,
    top: label.top + placement.dy,
    right: label.left + placement.dx + size.width,
    bottom: label.top + placement.dy + size.height,
  };
}
function inside(area: LabelArea, viewport: LabelArea) {
  return (
    Number.isFinite(area.left) &&
    Number.isFinite(area.top) &&
    Number.isFinite(area.right) &&
    Number.isFinite(area.bottom) &&
    area.right > area.left &&
    area.bottom > area.top &&
    area.left >= viewport.left + EDGE &&
    area.top >= viewport.top + EDGE &&
    area.right <= viewport.right - EDGE &&
    area.bottom <= viewport.bottom - EDGE
  );
}

function preferredLayout(
  labels: LabelRect[],
  viewport: LabelArea,
  reserved: LabelArea[],
  control: {
    take(kind?: 'operations' | 'candidates' | 'nodes'): boolean;
    checkpoint(): boolean;
    exhausted(): boolean;
    stop(): void;
    maxCandidatesPerLabel: number;
  },
  initialPins: LabelPlacement[],
): LabelPlacement[] {
  const { take, checkpoint, exhausted } = control;
  const allocate = (candidates: unknown[]) => {
    if (candidates.length >= control.maxCandidatesPerLabel) {
      control.stop();
      return false;
    }
    return take('candidates');
  };
  if (!checkpoint())
    return labels.map(
      (label) =>
        initialPins.find((pin) => pin.id === label.id) ?? {
          id: label.id,
          visible: false,
          dx: 0,
          dy: 0,
        },
    );
  const ordered = [...labels].sort(
    (a, b) =>
      Number(b.focused ?? false) - Number(a.focused ?? false) ||
      Number(b.hovered ?? false) - Number(a.hovered ?? false) ||
      Number(b.selected) - Number(a.selected) ||
      Number(b.mandatory ?? false) - Number(a.mandatory ?? false) ||
      (b.priority ?? Number(b.selected) * 3) -
        (a.priority ?? Number(a.selected) * 3) ||
      (a.locationCode ?? a.id).localeCompare(b.locationCode ?? b.id) ||
      a.id.localeCompare(b.id),
  );
  if (!checkpoint())
    return labels.map(
      (label) =>
        initialPins.find((pin) => pin.id === label.id) ?? {
          id: label.id,
          visible: false,
          dx: 0,
          dy: 0,
        },
    );
  const labelById = new Map(labels.map((label) => [label.id, label]));
  // Candidate coordinates depend on this measured frame, not on a trial's
  // occupied slots. Reuse them across selected-position and hover-yield trials.
  const candidateCache = new Map<
    string,
    { dx: number; dy: number; compact: boolean; area?: LabelArea }[]
  >();
  type PreparedOffset = {
    dx: number;
    dy: number;
    compact: boolean;
    area: LabelArea;
  };
  // Anchored offsets have identical geometry in every directional trial for a
  // given measured label. Cache only this immutable tail, never another label's
  // domain. Actual allocations/filtering are charged once, reused references on
  // every pass; the raw per-label candidate cap still includes all 225 offsets.
  const offsetTails = new Map<LabelRect, PreparedOffset[]>();
  const prepare = (
    label: LabelRect,
    candidates: { dx: number; dy: number; compact: boolean }[],
  ): PreparedOffset[] =>
    candidates
      .map((candidate) => {
        const size = candidate.compact ? label.compact! : label;
        return {
          ...candidate,
          area: {
            left: label.left + candidate.dx,
            top: label.top + candidate.dy,
            right: label.left + candidate.dx + size.width,
            bottom: label.top + candidate.dy + size.height,
          },
        };
      })
      .filter(
        ({ area }) =>
          take() &&
          area.left >= viewport.left + EDGE &&
          area.top >= viewport.top + EDGE &&
          area.right <= viewport.right - EDGE &&
          area.bottom <= viewport.bottom - EDGE &&
          !reserved.some((other) => !take() || overlaps(area, other)),
      );
  // Viewport rails depend on footprint dimensions, not a label's anchor. Share
  // their immutable geometry; a trial advances its cursor past occupied slots
  // because adding another placement can never make a rejected slot available.
  const railCache = new Map<string, LabelArea[]>();
  const pack = (
    compactPacking: boolean,
    protectedPlacements: LabelPlacement[] = [],
    bottomFirst = false,
    rightFirst = false,
  ) => {
    if (!checkpoint())
      return ordered.map(
        (label) =>
          protectedPlacements.find((pin) => pin.id === label.id) ?? {
            id: label.id,
            visible: false,
            dx: 0,
            dy: 0,
          },
      );
    const occupied = [...reserved];
    const railCursors = new Map<string, number>();
    for (const result of protectedPlacements) {
      const label = labelById.get(result.id)!;
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
      if (!hasFiniteAnchor(label))
        return { id: label.id, visible: false, dx: 0, dy: 0 };
      const protectedPlacement = protectedPlacements.find(
        (entry) => entry.id === label.id,
      );
      if (protectedPlacement) {
        if (label.locationCode) placedCodes.add(label.locationCode);
        return { ...protectedPlacement };
      }
      if (!take()) return { id: label.id, visible: false, dx: 0, dy: 0 };
      if (label.locationCode && placedCodes.has(label.locationCode))
        return { id: label.id, visible: false, dx: 0, dy: 0 };
      if (!checkpoint()) return { id: label.id, visible: false, dx: 0, dy: 0 };
      const sharedRails =
        compactPacking && label.mandatory && !label.focused && !label.hovered;
      if (sharedRails) {
        const compact = !!label.compact && !label.selected;
        const size = compact ? label.compact! : label;
        const railKey = `${size.width}:${size.height}:${bottomFirst}:${rightFirst}`;
        let rails = railCache.get(railKey);
        if (!rails) {
          rails = [];
          const columns: number[] = [];
          for (
            let left = viewport.left + EDGE;
            left + size.width <= viewport.right - EDGE;
            left += size.width + GAP
          ) {
            if (!take()) break;
            if (columns.length >= control.maxCandidatesPerLabel) {
              control.stop();
              break;
            }
            columns.push(left);
          }
          const mirrored = columns.map(
            (left) =>
              viewport.right -
              EDGE -
              size.width -
              (left - viewport.left - EDGE),
          );
          const orderedColumns = rightFirst
            ? [...mirrored, ...columns]
            : [...columns, ...mirrored];
          for (
            let top = viewport.top + EDGE;
            top + size.height <= viewport.bottom - EDGE && !exhausted();
            top += size.height + GAP
          ) {
            for (const left of orderedColumns) {
              // Keep the per-label domain cap, including its anchored tail.
              if (
                rails.length + offsets.length >=
                control.maxCandidatesPerLabel
              ) {
                control.stop();
                break;
              }
              if (!allocate(rails)) break;
              const y = bottomFirst
                ? viewport.bottom -
                  EDGE -
                  size.height -
                  (top - viewport.top - EDGE)
                : top;
              rails.push({
                left,
                top: y,
                right: left + size.width,
                bottom: y + size.height,
              });
            }
          }
          railCache.set(railKey, rails);
        }
        let cursor = railCursors.get(railKey) ?? 0;
        for (; cursor < rails.length; cursor++) {
          if (!take()) break;
          const area = rails[cursor];
          if (occupied.some((other) => !take() || overlaps(area, other)))
            continue;
          railCursors.set(railKey, cursor + 1);
          occupied.push(area);
          if (label.locationCode) placedCodes.add(label.locationCode);
          return {
            id: label.id,
            visible: true,
            dx: area.left - label.left,
            dy: area.top - label.top,
            ...(label.compact ? { compact } : {}),
          };
        }
        railCursors.set(railKey, cursor);
        if (!checkpoint())
          return { id: label.id, visible: false, dx: 0, dy: 0 };
      }
      const key = JSON.stringify([
        label.id,
        compactPacking,
        bottomFirst,
        rightFirst,
      ]);
      if (!checkpoint()) return { id: label.id, visible: false, dx: 0, dy: 0 };
      let candidates = candidateCache.get(key);
      if (!candidates) {
        candidates = [];
        if (
          label.previous &&
          (!compactPacking || label.focused || label.hovered)
        ) {
          if (!allocate(candidates))
            return { id: label.id, visible: false, dx: 0, dy: 0 };
          candidates.push({
            ...label.previous,
            compact:
              label.focused || label.hovered
                ? !label.selected && label.previous.compact && !!label.compact
                : !!label.compact && !label.selected,
          });
        }
        // Selected/full mandatory text wins. Ordinary occupied markers use compact
        // first so optional full text cannot consume another target's hit footprint.
        const variants = label.compact && !label.selected ? [true] : [false];
        for (const compact of variants) {
          if (!take()) break;
          if (!compactPacking)
            for (const [dx, dy] of offsets) {
              if (!allocate(candidates)) break;
              candidates.push({ dx, dy, compact });
            }
          if (label.mandatory && !sharedRails) {
            const dimension = compact ? label.compact! : label;
            // A finite deterministic viewport rail is allowed for mandatory labels.
            // It never changes geometry, shrinks targets or steals optional slots.
            const railLefts: number[] = [];
            for (
              let left = viewport.left + EDGE;
              left + dimension.width <= viewport.right - EDGE && !exhausted();
              left += dimension.width + GAP
            ) {
              if (!take()) break;
              if (railLefts.length >= control.maxCandidatesPerLabel) {
                control.stop();
                break;
              }
              railLefts.push(left);
            }
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
              top + dimension.height <= viewport.bottom - EDGE && !exhausted();
              top += dimension.height + GAP
            )
              for (const left of columns) {
                if (!allocate(candidates)) break;
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
        }
        if (!checkpoint())
          return { id: label.id, visible: false, dx: 0, dy: 0 };
        if (compactPacking) {
          if (
            candidates.length + offsets.length >
            control.maxCandidatesPerLabel
          ) {
            control.stop();
            return { id: label.id, visible: false, dx: 0, dy: 0 };
          }
          let tail = offsetTails.get(label);
          if (!tail) {
            const raw: { dx: number; dy: number; compact: boolean }[] = [];
            for (const compact of variants)
              for (const [dx, dy] of offsets) {
                if (!allocate(raw)) break;
                raw.push({ dx, dy, compact });
              }
            if (!checkpoint())
              return { id: label.id, visible: false, dx: 0, dy: 0 };
            tail = prepare(label, raw);
            if (!checkpoint())
              return { id: label.id, visible: false, dx: 0, dy: 0 };
            offsetTails.set(label, tail);
          }
          candidates = prepare(label, candidates);
          for (const candidate of tail) {
            if (!take()) break;
            candidates.push(candidate);
          }
        }
        if (!checkpoint())
          return { id: label.id, visible: false, dx: 0, dy: 0 };
        candidateCache.set(key, candidates);
      }
      // A live focused action keeps its current footprint and position. If it no
      // longer fits the viewport, normal constrained placement remains available.
      for (const { dx, dy, compact, area } of candidates) {
        if (!take()) break;
        const size = compact ? label.compact! : label;
        const candidate = area ?? {
          left: label.left + dx,
          top: label.top + dy,
          right: label.left + dx + size.width,
          bottom: label.top + dy + size.height,
        };
        if (!area && !inside(candidate, viewport)) continue;
        if (occupied.some((item) => !take() || overlaps(candidate, item)))
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
  let placements = pack(false, initialPins);
  const mandatoryCodes = new Set(
    labels
      .filter((label) => label.mandatory || label.selected)
      .map((label) => label.locationCode ?? label.id),
  );

  const coverage = (results: LabelPlacement[]) =>
    new Set(
      results
        .filter((result) => result.visible)
        .map((result) => labelById.get(result.id)!)
        .filter((label) => label.mandatory || label.selected)
        .map((label) => label.locationCode ?? label.id),
    ).size;
  if (!exhausted() && coverage(placements) < mandatoryCodes.size) {
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
      if (!checkpoint()) return;
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
          if (!checkpoint()) return;
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
          if (bestCoverage === mandatoryCodes.size) return;
        }
    };
    const optimize = (
      protectedPlacements: LabelPlacement[],
      considerCurrent = true,
    ) => {
      if (!checkpoint()) return;
      if (considerCurrent) consider(protectedPlacements);
      // Inactive selected text can align with compact rows instead of consuming
      // two rows between them. A live focus/hover action is never moved here.
      const candidates: { placements: LabelPlacement[]; distance: number }[] =
        [];
      for (const selected of bestCoverage === mandatoryCodes.size
        ? []
        : protectedPlacements) {
        if (!take()) break;
        const label = sources.get(selected.id)!;
        // Selecting a compact action introduces a new required full footprint.
        // Optimize that first placement even when focus remains on the same DOM
        // action; the next measurement records compact:false and pins it again.
        const becomingSelectedFull =
          label.previous?.compact === true && !label.compact;
        if (
          !label.selected ||
          ((label.focused || label.hovered) && !becomingSelectedFull)
        )
          continue;
        const others = protectedPlacements.filter(
          (entry) => entry !== selected,
        );
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
          if (!take()) break;
          xs.add(viewport.left + EDGE + offset);
          xs.add(viewport.right - EDGE - label.width - offset);
        }
        for (
          let offset = 0;
          offset < viewport.bottom - viewport.top;
          offset += 44 + GAP
        ) {
          if (!take()) break;
          ys.add(viewport.top + EDGE + offset);
          ys.add(viewport.bottom - EDGE - label.height - offset);
        }
        for (const obstacle of obstacles) {
          if (!take()) break;
          xs.add(obstacle.right + GAP);
          xs.add(obstacle.left - GAP - label.width);
          ys.add(obstacle.bottom + GAP);
          ys.add(obstacle.top - GAP - label.height);
        }
        for (const left of xs)
          for (const top of ys) {
            if (!take()) break;
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
              obstacles.some((obstacle) => !take() || overlaps(area, obstacle))
            )
              continue;
            if (!allocate(candidates)) break;
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
      if (!checkpoint()) return;
      candidates.sort((a, b) => a.distance - b.distance);
      if (!checkpoint()) return;
      for (const candidate of candidates) {
        if (!checkpoint()) break;
        if (bestCoverage === mandatoryCodes.size) break;
        consider(candidate.placements);
      }
    };
    // Try the current pinned footprints first. Optional full hover text must
    // not consume the selected-position search budget before mandatory actions
    // can use its pointer-contained compact footprint.
    consider(protectedPlacements);
    if (bestCoverage < mandatoryCodes.size)
      for (const prior of protectedPlacements) {
        if (!take()) break;
        const label = sources.get(prior.id)!;
        if (
          label.selected ||
          label.focused ||
          !label.hovered ||
          prior.compact ||
          !label.compact ||
          !label.pointer
        )
          continue;
        const old = label.pointer.bounds,
          point = label.pointer,
          size = label.compact;
        if (
          !old ||
          prior.dx !== label.previous?.dx ||
          prior.dy !== label.previous?.dy ||
          !Number.isFinite(point.x) ||
          !Number.isFinite(point.y) ||
          point.x < old.left ||
          point.x >= old.right ||
          point.y < old.top ||
          point.y >= old.bottom ||
          size.width > old.right - old.left ||
          size.height > old.bottom - old.top
        )
          continue;
        const left = Math.max(
          old.left,
          Math.min(point.x - size.width / 2, old.right - size.width),
        );
        const top = Math.max(
          old.top,
          Math.min(point.y - size.height / 2, old.bottom - size.height),
        );
        const yielded = {
          ...prior,
          dx: left - label.left,
          dy: top - label.top,
          compact: true,
          yielded: true,
        };
        const otherAreas = protectedPlacements
          .filter((entry) => entry !== prior)
          .map(areaOf);
        if (
          !inside(areaOf(yielded), viewport) ||
          [...reserved, ...otherAreas].some(
            (other) => !take() || overlaps(areaOf(yielded), other),
          )
        )
          continue;
        // Yield optional full text only around a real pointer, preserving the
        // same DOM action and a contained hit rectangle. The readable summary
        // carries its name/counts until the pointer leaves this compact marker.
        optimize(
          protectedPlacements.map((entry) =>
            entry === prior ? yielded : entry,
          ),
        );
        if (bestCoverage === mandatoryCodes.size) break;
      }
    // No valid pointer witness (or no complete yielded layout): retain the full
    // hover pin and try selected relocation. Focused/selected actions never yield.
    if (bestCoverage < mandatoryCodes.size)
      optimize(protectedPlacements, false);
  }
  return placements;
}

/** Finite candidate feasibility search, not a physical-capacity or optimality proof. */
export function layoutLabelsDetailed(
  labels: LabelRect[],
  viewport: LabelArea,
  reserved: LabelArea[] = [],
  limits: Partial<LabelPackingBudget> = {},
  clock: () => number = () => performance.now(),
): LabelLayoutResult {
  const started = clock();
  const stats: LabelPackingStats = {
    operations: 0,
    candidates: 0,
    nodes: 0,
    backtracks: 0,
    elapsedMs: 0,
    greedyComplete: false,
  };
  const budget = Object.fromEntries(
    Object.entries(LABEL_PACKING_BUDGET).map(([key, fallback]) => {
      const value = limits[key as keyof LabelPackingBudget] ?? fallback;
      return [
        key,
        Number.isFinite(value)
          ? Math.max(0, key === 'maxMilliseconds' ? value : Math.floor(value))
          : fallback,
      ];
    }),
  ) as LabelPackingBudget;
  let exhausted = false;
  let checksSinceClock = 0;
  // Cooperative watchdog: at most 32 primitive checks between clock samples.
  // Native work and trial boundaries are checked independently. This allows a
  // bounded overrun for that batch/native operation; it is not preemption.
  const checkpoint = () => {
    checksSinceClock = 0;
    if (clock() - started >= budget.maxMilliseconds) exhausted = true;
    return !exhausted;
  };
  const take = (kind: 'operations' | 'candidates' | 'nodes' = 'operations') => {
    if (exhausted || (++checksSinceClock >= 32 && !checkpoint())) return false;
    const maximum =
      kind === 'operations'
        ? budget.maxOperations
        : kind === 'candidates'
          ? budget.maxCandidates
          : budget.maxNodes;
    if (stats[kind] >= maximum) {
      exhausted = true;
      return false;
    }
    stats[kind]++;
    return true;
  };
  // Refuse oversized requests before copying/sorting; no partially allocated
  // result is advertised as a feasibility decision. Runtime's 27 actions fit.
  if (labels.length + reserved.length > budget.maxInputs) {
    return {
      placements: [],
      status: 'budget-exhausted',
      stats: { ...stats, elapsedMs: clock() - started },
    };
  }
  if (!take())
    return {
      placements: labels.map((label) => ({
        id: label.id,
        visible: false,
        dx: 0,
        dy: 0,
      })),
      status: 'budget-exhausted',
      stats: { ...stats, elapsedMs: clock() - started },
    };
  const conflicts = (area: LabelArea, others: LabelArea[]) => {
    for (const other of others) {
      if (!take() || overlaps(area, other)) return true;
    }
    return false;
  };
  checkpoint();
  const ordered = [...labels].sort(
    (a, b) =>
      Number(b.focused ?? false) - Number(a.focused ?? false) ||
      Number(b.hovered ?? false) - Number(a.hovered ?? false) ||
      Number(b.selected) - Number(a.selected) ||
      Number(b.mandatory ?? false) - Number(a.mandatory ?? false) ||
      (b.priority ?? Number(b.selected) * 3) -
        (a.priority ?? Number(a.selected) * 3) ||
      logicalKey(a).localeCompare(logicalKey(b)) ||
      a.id.localeCompare(b.id),
  );
  checkpoint();
  const byId = new Map(labels.map((label) => [label.id, label]));
  const mandatory = new Set(
    labels.filter((label) => label.mandatory || label.selected).map(logicalKey),
  );
  checkpoint();
  const coverage = (placements: LabelPlacement[]) =>
    new Set(
      placements
        .filter(
          (placement) =>
            placement.visible &&
            mandatory.has(logicalKey(byId.get(placement.id)!)),
        )
        .map((placement) => logicalKey(byId.get(placement.id)!)),
    ).size;
  const hidden = (label: LabelRect): LabelPlacement => ({
    id: label.id,
    visible: false,
    dx: 0,
    dy: 0,
  });
  const pins: LabelPlacement[] = [],
    pinAreas: LabelArea[] = [];
  for (const label of ordered) {
    if (!take()) break;
    // A newly selected full footprint has not yet become a live full focus pin.
    if (
      !(label.focused || label.hovered) ||
      !label.previous ||
      (label.selected && label.previous.compact)
    )
      continue;
    const pin: LabelPlacement = {
      id: label.id,
      visible: true,
      dx: label.previous.dx,
      dy: label.previous.dy,
      ...(label.compact
        ? { compact: !label.selected && label.previous.compact }
        : {}),
      ...(label.holdCompact ? { yielded: true } : {}),
    };
    const area = areaOf(label, pin);
    if (!inside(area, viewport) || conflicts(area, [...reserved, ...pinAreas]))
      continue;
    pins.push(pin);
    pinAreas.push(area);
  }
  let placements = preferredLayout(
    labels,
    viewport,
    reserved,
    {
      take,
      checkpoint,
      exhausted: () => exhausted,
      stop: () => {
        exhausted = true;
      },
      maxCandidatesPerLabel: budget.maxCandidatesPerLabel,
    },
    pins,
  );
  stats.greedyComplete = coverage(placements) === mandatory.size;
  let status: LabelLayoutResult['status'] = stats.greedyComplete
    ? 'complete'
    : 'candidate-infeasible';
  if (!stats.greedyComplete && !exhausted) {
    const units: LabelRect[] = [],
      codes = new Set<string>();
    for (const label of ordered) {
      if (!(label.mandatory || label.selected) || codes.has(logicalKey(label)))
        continue;
      const pinned = pins.find(
        (pin) => logicalKey(byId.get(pin.id)!) === logicalKey(label),
      );
      units.push(pinned ? byId.get(pinned.id)! : label);
      codes.add(logicalKey(label));
    }
    // Optional full hover text may yield only to a compact rectangle containing
    // the witnessed pointer inside the same old action. Never relocate that action.
    const yieldedPins = pins.map((pin) => {
      const label = byId.get(pin.id)!,
        point = label.pointer,
        size = label.compact;
      if (
        label.selected ||
        label.focused ||
        !label.hovered ||
        pin.compact ||
        !size ||
        !point
      )
        return pin;
      const old = point.bounds;
      if (
        ![point.x, point.y, old.left, old.top, old.right, old.bottom].every(
          Number.isFinite,
        ) ||
        point.x < old.left ||
        point.x >= old.right ||
        point.y < old.top ||
        point.y >= old.bottom ||
        size.width > old.right - old.left ||
        size.height > old.bottom - old.top
      )
        return pin;
      const left = Math.max(
        old.left,
        Math.min(point.x - size.width / 2, old.right - size.width),
      );
      const top = Math.max(
        old.top,
        Math.min(point.y - size.height / 2, old.bottom - size.height),
      );
      return {
        ...pin,
        dx: left - label.left,
        dy: top - label.top,
        compact: true,
        yielded: true,
      };
    });
    const variants = yieldedPins.some((pin, index) => pin !== pins[index])
      ? [yieldedPins, pins]
      : [pins];
    for (const protectedPins of variants) {
      if (exhausted) break;
      const protectedAreas: LabelArea[] = [];
      let validPins = true;
      for (const pin of protectedPins) {
        const area = areaOf(byId.get(pin.id)!, pin);
        if (
          !inside(area, viewport) ||
          conflicts(area, [...reserved, ...protectedAreas])
        ) {
          validPins = false;
          break;
        }
        protectedAreas.push(area);
      }
      if (!validPins) continue;
      const obstacles = [...reserved, ...protectedAreas];
      if (!checkpoint()) break;
      const widths = [
        ...new Set(
          units.map(
            (label) =>
              (label.compact && !label.selected
                ? label.compact.width
                : label.width) + GAP,
          ),
        ),
      ].sort((a, b) => a - b);
      const heights = [
        ...new Set(
          units.map(
            (label) =>
              (label.compact && !label.selected
                ? label.compact.height
                : label.height) + GAP,
          ),
        ),
      ].sort((a, b) => a - b);
      if (!checkpoint()) break;
      const domains = new Map<string, Candidate[]>();
      const axes = (
        minimum: number,
        maximum: number,
        size: number,
        edges: number[],
        steps: number[],
        preferred: number[],
      ) => {
        const values = new Set(preferred.filter(Number.isFinite));
        if (!checkpoint()) return [];
        const seeds = [minimum + EDGE, maximum - EDGE - size, ...edges]
          .filter(Number.isFinite)
          .sort((a, b) => a - b);
        if (!checkpoint()) return [];
        for (const seed of seeds)
          for (const step of steps) {
            if (!(step > 0 && Number.isFinite(step))) continue;
            const first = Math.ceil((minimum + EDGE - seed) / step),
              last = Math.floor((maximum - EDGE - size - seed) / step);
            for (let offset = first; offset <= last; offset++) {
              if (!take()) return [];
              if (values.size >= budget.maxCandidatesPerLabel) {
                exhausted = true;
                return [];
              }
              values.add(seed + offset * step);
            }
          }
        if (!checkpoint()) return [];
        const sorted = [...values]
          .filter(
            (value) =>
              value >= minimum + EDGE && value + size <= maximum - EDGE,
          )
          .sort((a, b) => a - b);
        return checkpoint() ? sorted : [];
      };
      for (const label of units) {
        if (!hasFiniteAnchor(label)) {
          domains.set(label.id, []);
          continue;
        }
        const pin = protectedPins.find((entry) => entry.id === label.id);
        if (pin) {
          domains.set(label.id, [{ ...pin, area: areaOf(label, pin) }]);
          continue;
        }
        const compact = !!label.compact && !label.selected,
          size = compact ? label.compact! : label;
        const xs = axes(
          viewport.left,
          viewport.right,
          size.width,
          obstacles.flatMap((area) => [
            area.right + GAP,
            area.left - GAP - size.width,
          ]),
          widths,
          [label.left, label.left + (label.previous?.dx ?? 0)],
        );
        const ys = axes(
          viewport.top,
          viewport.bottom,
          size.height,
          obstacles.flatMap((area) => [
            area.bottom + GAP,
            area.top - GAP - size.height,
          ]),
          heights,
          [label.top, label.top + (label.previous?.dy ?? 0)],
        );
        const candidates: Candidate[] = [],
          seen = new Set<string>();
        for (const left of xs)
          for (const top of ys) {
            if (!take()) break;
            const area = {
              left,
              top,
              right: left + size.width,
              bottom: top + size.height,
            };
            if (!inside(area, viewport) || conflicts(area, obstacles)) continue;
            const key = left.toFixed(6) + ':' + top.toFixed(6);
            if (!take()) break;
            if (seen.has(key)) continue;
            if (candidates.length >= budget.maxCandidatesPerLabel) {
              exhausted = true;
              break;
            }
            if (!take('candidates')) break;
            seen.add(key);
            candidates.push({
              id: label.id,
              visible: true,
              dx: left - label.left,
              dy: top - label.top,
              ...(label.compact ? { compact } : {}),
              area,
            });
          }
        const origin = label.previous ?? { dx: 0, dy: 0 };
        if (!checkpoint()) break;
        candidates.sort(
          (a, b) =>
            Math.abs(a.dx - origin.dx) +
              Math.abs(a.dy - origin.dy) -
              Math.abs(b.dx - origin.dx) -
              Math.abs(b.dy - origin.dy) ||
            Math.abs(a.dx - origin.dx) - Math.abs(b.dx - origin.dx) ||
            a.dy - b.dy ||
            a.dx - b.dx,
        );
        if (!checkpoint()) break;
        domains.set(label.id, candidates);
      }
      if (exhausted) break;
      const pinnedIds = new Set(protectedPins.map((pin) => pin.id));
      const remaining = units.filter((label) => !pinnedIds.has(label.id));
      const search = (
        pending: LabelRect[],
        available: Map<string, Candidate[]>,
        chosen: Candidate[],
      ): Candidate[] | null => {
        if (!take('nodes')) return null;
        if (!pending.length) return chosen;
        let next = pending[0];
        for (const label of pending) {
          if (!take()) return null;
          if (available.get(label.id)!.length < available.get(next.id)!.length)
            next = label;
        }
        const rest = pending.filter((label) => label !== next);
        for (const candidate of available.get(next.id)!) {
          if (!take()) return null;
          const forward = new Map(available);
          let feasible = true;
          for (const label of rest) {
            const kept: Candidate[] = [];
            for (const other of available.get(label.id)!) {
              if (!take()) return null;
              if (!overlaps(candidate.area, other.area)) kept.push(other);
            }
            forward.set(label.id, kept);
            if (!kept.length) {
              feasible = false;
              break;
            }
          }
          if (!feasible) {
            stats.backtracks++;
            continue;
          }
          const result = search(rest, forward, [...chosen, candidate]);
          if (result) return result;
          stats.backtracks++;
          if (exhausted) return null;
        }
        return null;
      };
      const solution = search(remaining, domains, []);
      if (solution) {
        const solved = new Map<string, LabelPlacement>(
          [
            ...protectedPins,
            ...solution.map((candidate) => ({
              id: candidate.id,
              visible: candidate.visible,
              dx: candidate.dx,
              dy: candidate.dy,
              ...(candidate.compact === undefined
                ? {}
                : { compact: candidate.compact }),
            })),
          ].map((placement) => [placement.id, placement]),
        );
        placements = ordered.map(
          (label) => solved.get(label.id) ?? hidden(label),
        );
        status =
          coverage(placements) === mandatory.size
            ? 'complete'
            : 'candidate-infeasible';
        break;
      }
    }
  }
  // Optional text expands at the same anchor only after mandatory feasibility;
  // expansion never moves or displaces a neighboring action.
  for (const placement of placements) {
    if (!take()) break;
    const label = byId.get(placement.id)!;
    if (
      !placement.visible ||
      !placement.compact ||
      !label.preferFull ||
      placement.yielded ||
      label.holdCompact
    )
      continue;
    if (!checkpoint()) break;
    const full = { ...placement, compact: false },
      area = areaOf(label, full);
    const others = placements
      .filter((entry) => entry !== placement && entry.visible)
      .map((entry) => areaOf(byId.get(entry.id)!, entry));
    if (!checkpoint()) break;
    if (inside(area, viewport) && !conflicts(area, [...reserved, ...others]))
      placement.compact = false;
  }
  // Each construction step already checked its placements. This final check
  // shares the same deadline; on expiry keep that verified prior result rather
  // than publish a half-constructed replacement or run an unbounded postpass.
  const checked: LabelPlacement[] = [],
    checkedAreas: LabelArea[] = [];
  checkpoint();
  for (const placement of placements) {
    if (!take()) break;
    if (!placement.visible) {
      checked.push(placement);
      continue;
    }
    const area = areaOf(byId.get(placement.id)!, placement);
    const collision = conflicts(area, [...reserved, ...checkedAreas]);
    if (exhausted) break;
    if (!inside(area, viewport) || collision) {
      placements = ordered.map(
        (label) =>
          checked.find((entry) => entry.id === label.id) ?? hidden(label),
      );
      exhausted = true;
      break;
    }
    checked.push(placement);
    checkedAreas.push(area);
  }
  checkpoint();
  stats.elapsedMs = clock() - started;
  if (stats.elapsedMs >= budget.maxMilliseconds) exhausted = true;
  if (exhausted) status = 'budget-exhausted';
  return { placements, status, stats };
}

/** Backward-compatible array contract; failure statuses require the detailed API. */
export function layoutLabels(
  labels: LabelRect[],
  viewport: LabelArea,
  reserved: LabelArea[] = [],
): LabelPlacement[] {
  return layoutLabelsDetailed(labels, viewport, reserved).placements;
}
