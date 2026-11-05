'use client';
import { useFrame, useThree } from '@react-three/fiber';
import { createContext, useContext, useEffect, type ReactNode } from 'react';
import {
  layoutLabelsDetailed,
  LABEL_PACKING_BUDGET,
  type LabelPackingBudget,
  type LabelRect,
  type LabelArea,
  type LabelPlacement,
} from './label-layout';
import {
  bindRoomDemand,
  recordRoomDemand,
  recordRoomResize,
  type RoomDemandReason,
} from './room-demand-diagnostics';
import { createLabelLayoutDiagnostics } from './label-layout-diagnostics';

export type LabelOptions = {
  priority: number;
  locationCode?: string;
  presentation?: 'occupied-marker';
  interactive?: boolean;
  mandatory?: boolean;
  compact?: boolean;
  preferFull?: boolean;
  readableSummary?: string;
  inspection?: 'focus' | 'hover' | null;
  pointer?: () => { x: number; y: number } | null;
  isVisible?: () => boolean;
  pickReservation?: () => LabelArea | null;
};
// At Chromium device scale 1.5, translation alone changed measured widths by
// up to 3/65536px. This comparison-only bound is 128 times smaller than a
// 1/64px layout unit; actual packing still uses the unrounded measured sizes.
const DIMENSION_NOISE = 1 / 8192;
const MAX_VALIDATION_CONTINUATIONS = 4;
type GeometryIdentity = {
  camera: object;
  projection: readonly number[];
  world: readonly number[];
};

type Entry = {
  element: HTMLElement;
  leader: HTMLElement;
  options: LabelOptions;
  dx: number;
  dy: number;
  placed: boolean;
  compact: boolean;
  yielded: boolean;
};

function sceneLabelVisible(element: HTMLElement, host: HTMLElement) {
  for (
    let parent = element.parentElement;
    parent && parent !== host;
    parent = parent.parentElement
  )
    if (parent.style.display === 'none' || parent.style.visibility === 'hidden')
      return false;
  return element.isConnected;
}

/** One registry spans R3F Html portals and the ordinary DOM hover label. */
export function createRoomLabelRegistry(
  onSuppressionChange: (count: number, missingCodes?: string[]) => void,
  onReadSummaryChange?: (summary: string | null) => void,
  onPlacementIssueChange?: (codes: string[]) => void,
  options: { clock?: () => number; limits?: Partial<LabelPackingBudget> } = {},
) {
  const entries = new Map<string, Entry>();
  let canvas: HTMLCanvasElement | null = null;
  let observer: ResizeObserver | null = null;
  let overlays: MutationObserver | null = null;
  let pending: number | null = null;
  let continuation: (() => void) | null = null;
  let identityRevision = 0;
  let geometryIdentity: (() => GeometryIdentity) | undefined;
  let invalidateGeometry: (() => void) | undefined;
  let lastSuppressed = -1;
  let lastMissing = '';
  let revision = 0;
  let lastSummary: string | null = null;
  let lastIssue = '';
  let failedMeasurement = '';
  const clock = options.clock ?? (() => performance.now());
  const limits = { ...LABEL_PACKING_BUDGET, ...options.limits };
  const reportIssue = (codes: string[]) => {
    const key = [...new Set(codes)].sort().join('|');
    if (key !== lastIssue) {
      lastIssue = key;
      onPlacementIssueChange?.(key ? key.split('|') : []);
    }
  };
  const diagnostics = createLabelLayoutDiagnostics(
    typeof window === 'undefined' ? undefined : window,
  );
  const releaseFocus = (element: HTMLElement) => {
    const focused = document.activeElement;
    if (focused instanceof HTMLElement && element.contains(focused))
      focused.blur();
  };
  const setFocusability = (entry: Entry, visible = false) => {
    if (entry.options.presentation === 'occupied-marker')
      entry.element.removeAttribute('tabindex');
    else
      entry.element.tabIndex =
        visible && entry.options.interactive !== false ? 0 : -1;
  };
  const hideEntry = (entry: Entry) => {
    releaseFocus(entry.element);
    entry.element.dataset.roomExposed = 'false';
    entry.element.dataset.labelSuppressed = 'true';
    entry.element.style.visibility = 'hidden';
    entry.element.style.pointerEvents = 'none';
    setFocusability(entry);
    entry.element.setAttribute('aria-hidden', 'true');
    entry.leader.style.display = 'none';
    entry.placed = false;
  };
  const place = () => {
    pending = null;
    if (continuation) {
      const resume = continuation;
      continuation = null;
      resume();
      return;
    }
    const startedAt = clock();
    let deadline = startedAt + limits.maxMilliseconds;
    let frameStartedAt = startedAt;
    let continuationCount = 0;
    let hiddenForValidation = false;
    const originalCanvas = canvas;
    const originalRevision = identityRevision;
    diagnostics?.begin(startedAt);
    diagnostics?.mark('initial-measurement-start', startedAt);
    const remaining = { ...limits };
    let measurementExhausted = false;
    let timeExhausted = false;
    const charge = () => {
      remaining.maxOperations -= 1;
      if (clock() >= deadline) timeExhausted = true;
      if (remaining.maxOperations < 0 || timeExhausted)
        measurementExhausted = true;
      return !measurementExhausted;
    };
    const host = canvas?.parentElement;
    const viewport = canvas?.getBoundingClientRect();
    if (!host || !viewport) {
      diagnostics?.abort('missing-host', clock());
      return;
    }
    if (
      !Number.isFinite(viewport.width) ||
      !Number.isFinite(viewport.height) ||
      viewport.width <= 0 ||
      viewport.height <= 0
    ) {
      const codes: string[] = [];
      for (const entry of entries.values()) {
        hideEntry(entry);
        if (
          (entry.options.interactive !== false || entry.options.mandatory) &&
          entry.options.locationCode
        )
          codes.push(entry.options.locationCode);
      }
      reportIssue(codes);
      if (canvas) {
        canvas.dataset.labelLayoutStatus = 'budget-exhausted';
        canvas.dataset.labelLayoutError = 'Room viewport is not measured';
        canvas.dataset.labelLayoutPending = 'false';
      }
      diagnostics?.abort('unmeasured-viewport', clock());
      return;
    }
    const measuredBounds = new Map<string, LabelArea>();
    const measure = () => {
      measuredBounds.clear();
      const labels: LabelRect[] = [];
      for (const [id, entry] of entries) {
        if (!charge()) break;
        if (
          !sceneLabelVisible(entry.element, host) ||
          entry.options.isVisible?.() === false
        ) {
          // Blur while still exposed, before a hidden action can retain keys.
          releaseFocus(entry.element);
          entry.element.dataset.roomExposed = 'false';
          entry.element.dataset.labelSuppressed = 'true';
          entry.element.style.visibility = 'hidden';
          entry.element.style.pointerEvents = 'none';
          setFocusability(entry);
          entry.element.setAttribute('aria-hidden', 'true');
          entry.leader.style.display = 'none';
          entry.placed = false;
          continue;
        }
        const rect = entry.element.getBoundingClientRect();
        measuredBounds.set(id, {
          left: rect.left,
          top: rect.top,
          right: rect.right,
          bottom: rect.bottom,
        });
        if (!charge()) break;
        entry.element.dataset.roomExposed = 'true';
        const full = entry.element.querySelector<HTMLElement>(
          '[data-room-label-full]',
        );
        const fullRect = full?.getBoundingClientRect();
        if (!charge()) break;
        const pointer = entry.options.pointer?.();
        const hovered = entry.options.inspection === 'hover';
        const witnessedPointer =
          hovered &&
          pointer &&
          Number.isFinite(pointer.x) &&
          Number.isFinite(pointer.y) &&
          pointer.x >= rect.left &&
          pointer.x < rect.right &&
          pointer.y >= rect.top &&
          pointer.y < rect.bottom &&
          entry.element.contains(
            document.elementFromPoint(pointer.x, pointer.y),
          )
            ? {
                ...pointer,
                bounds: {
                  left: rect.left,
                  top: rect.top,
                  right: rect.right,
                  bottom: rect.bottom,
                },
              }
            : undefined;
        labels.push({
          id,
          selected: entry.options.priority >= 4,
          priority: entry.options.priority,
          locationCode: entry.options.locationCode,
          presentation: entry.options.presentation,
          left: rect.left - entry.dx,
          top: rect.top - entry.dy,
          width: fullRect?.width
            ? Math.max(44, fullRect.width + 18)
            : rect.width,
          height: fullRect?.height
            ? Math.max(
                44,
                fullRect.height +
                  (entry.element.dataset.roomOccupied === 'true' ? 8 : 12),
              )
            : rect.height,
          mandatory: entry.options.mandatory,
          preferFull: entry.options.preferFull,
          focused: document.activeElement === entry.element,
          hovered,
          pointer: witnessedPointer,
          holdCompact: entry.yielded && hovered,
          compact: entry.options.compact
            ? entry.options.presentation === 'occupied-marker'
              ? { width: rect.width, height: rect.height }
              : { width: 44, height: 44 }
            : undefined,
          previous: entry.placed
            ? { dx: entry.dx, dy: entry.dy, compact: entry.compact }
            : undefined,
        });
      }
      return labels;
    };
    const readReserved = () => {
      const result: LabelArea[] = [];
      for (const element of host
        .closest('[data-room-surface]')
        ?.querySelectorAll<HTMLElement>('[data-room-obstruction]') ?? []) {
        if (!charge()) break;
        if (element.getClientRects().length > 0)
          result.push(element.getBoundingClientRect());
      }
      // Physical reservations remain packing masks, never visibility geometry.
      for (const entry of entries.values()) {
        if (!entry.options.pickReservation) continue;
        if (!charge()) break;
        if (
          !sceneLabelVisible(entry.element, host) ||
          entry.options.isVisible?.() === false
        )
          continue;
        const area = entry.options.pickReservation();
        if (
          area &&
          [area.left, area.top, area.right, area.bottom].every(
            Number.isFinite,
          ) &&
          area.left < area.right &&
          area.top < area.bottom &&
          area.right > viewport.left &&
          area.left < viewport.right &&
          area.bottom > viewport.top &&
          area.top < viewport.bottom
        )
          result.push({
            left: area.left,
            top: area.top,
            right: area.right,
            bottom: area.bottom,
          });
      }
      return result;
    };
    const reserved = readReserved();
    const cameraIdentity = geometryIdentity?.();
    const sameGeometry = () => {
      if (
        canvas !== originalCanvas ||
        identityRevision !== originalRevision ||
        !charge()
      )
        return false;
      const current = canvas?.getBoundingClientRect();
      const camera = geometryIdentity?.();
      return (
        !!current &&
        ['left', 'top', 'right', 'bottom', 'width', 'height'].every(
          (key) =>
            current[key as keyof DOMRect] === viewport[key as keyof DOMRect],
        ) &&
        (cameraIdentity
          ? !!camera &&
            camera.camera === cameraIdentity.camera &&
            camera.projection.length === cameraIdentity.projection.length &&
            camera.world.length === cameraIdentity.world.length &&
            camera.projection.every(
              (value, index) => value === cameraIdentity.projection[index],
            ) &&
            camera.world.every(
              (value, index) => value === cameraIdentity.world[index],
            )
          : !camera) &&
        JSON.stringify(readReserved()) === JSON.stringify(reserved)
      );
    };
    const measuredKey = (labels: LabelRect[]) =>
      JSON.stringify([
        {
          left: viewport.left,
          top: viewport.top,
          right: viewport.right,
          bottom: viewport.bottom,
        },
        reserved.map(({ left, top, right, bottom }) => ({
          left,
          top,
          right,
          bottom,
        })),
        labels.map((label) => ({ ...label, previous: undefined })),
      ]);
    const hideUnverified = (
      message: string,
      labels: LabelRect[],
      cache = true,
    ) => {
      const codes: string[] = [];
      for (const entry of entries.values()) {
        const { element, leader } = entry;
        releaseFocus(element);
        element.style.visibility = 'hidden';
        element.style.pointerEvents = 'none';
        setFocusability(entry);
        element.setAttribute('aria-hidden', 'true');
        element.dataset.labelSuppressed = 'true';
        leader.style.display = 'none';
        entry.placed = false;
        if (
          entry.options.locationCode &&
          (entry.options.interactive !== false || entry.options.mandatory) &&
          entry.options.isVisible?.() !== false
        )
          codes.push(entry.options.locationCode);
      }
      failedMeasurement = cache ? measuredKey(labels) : '';
      reportIssue(codes);
      if (canvas) {
        canvas.dataset.labelLayoutError = message;
        canvas.dataset.labelLayoutStatus = 'budget-exhausted';
        canvas.dataset.labelLayoutPending = 'false';
      }
    };
    let suppressed = 0;
    const missing: string[] = [];
    let summary: string | null = null;
    let focusedSummary = false;
    let cacheableOutcome = true;
    let finalPlacements: LabelPlacement[] = [];
    let finalLabels: LabelRect[] = [];
    let finalStatus: 'complete' | 'candidate-infeasible' | 'budget-exhausted' =
      'complete';
    // CSS changes a centered Html wrapper immediately. Reflow/validate those
    // real dimensions before exposing a settled revision, without idle frames.
    // Cached suppression retains the last actual detail, with a separate
    // diagnostic attempt ID so observers cannot mistake it for current work.
    const initialLabels = measure();
    diagnostics?.mark('initial-measurement-end', clock());
    if (measurementExhausted) {
      hideUnverified(
        'Label measurement work budget exhausted',
        initialLabels,
        !timeExhausted,
      );
      diagnostics?.abort('measurement-budget', clock());
      return;
    }
    if (failedMeasurement === measuredKey(initialLabels)) {
      if (canvas) canvas.dataset.labelLayoutPending = 'false';
      diagnostics?.cachedSuppression(clock());
      return;
    }
    const finish = () => {
      if (canvas) canvas.dataset.labelLayoutStatus = finalStatus;
      if (finalStatus === 'complete') {
        failedMeasurement = '';
        reportIssue([]);
      } else {
        failedMeasurement = cacheableOutcome ? measuredKey(finalLabels) : '';

        reportIssue(missing);
      }
      if (lastSummary !== summary) {
        lastSummary = summary;
        onReadSummaryChange?.(summary);
      }
      if (suppressed !== lastSuppressed || missing.join('|') !== lastMissing) {
        lastSuppressed = suppressed;
        lastMissing = missing.join('|');
        onSuppressionChange(suppressed, missing);
      }
      if (canvas) {
        delete canvas.dataset.labelLayoutError;
        canvas.dataset.labelLayoutRevision = String(++revision);
        canvas.dataset.labelLayoutPending = 'false';
      }
      diagnostics?.finish(true, clock(), finalStatus);
    };
    const runPass = (pass: number) => {
      if (pass > 0)
        diagnostics?.mark('pass-measurement-start', clock(), pass + 1);
      const labels = pass === 0 ? initialLabels : measure();
      if (pass > 0)
        diagnostics?.mark('pass-measurement-end', clock(), pass + 1);
      finalLabels = labels;
      if (measurementExhausted) {
        hideUnverified(
          'Label measurement work budget exhausted',
          labels,
          !timeExhausted,
        );
        diagnostics?.abort('measurement-budget', clock());
        return;
      }
      diagnostics?.input(labels, viewport, reserved);
      let variantChanged = false;
      suppressed = 0;
      missing.length = 0;
      summary = null;
      focusedSummary = false;
      const solverEntry = clock();
      const allowance = {
        ...remaining,
        maxMilliseconds: Math.max(0, deadline - solverEntry),
      };
      const outcome = layoutLabelsDetailed(
        labels,
        viewport,
        reserved,
        allowance,
        clock,
      );
      if (diagnostics) {
        // Sample both boundaries before collector work. Its cost must neither
        // extend the solver's shared deadline nor become solver elapsed time.
        const solverEnd = clock();
        diagnostics.mark('solver-entry', solverEntry, pass + 1, allowance);
        diagnostics.mark('solver-end', solverEnd, pass + 1);
      }
      const placements = outcome.placements;
      diagnostics?.solver(outcome);
      finalStatus = outcome.status;
      cacheableOutcome = outcome.stats.exhaustion?.reason !== 'time';
      finalPlacements = placements;
      remaining.maxOperations -= outcome.stats.operations;
      remaining.maxCandidates -= outcome.stats.candidates;
      remaining.maxNodes -= outcome.stats.nodes;
      // An oversized request returns no partial placements. No old action may
      // remain exposed as if it had been checked against this measured view.
      if (placements.length !== labels.length) {
        hideUnverified(
          'Label placement work budget exhausted',
          labels,
          cacheableOutcome,
        );
        diagnostics?.abort('placement-budget', clock());
        return;
      }
      diagnostics?.output(placements);
      diagnostics?.mark('dom-application-start', clock(), pass + 1);
      const representedCodes = new Set(
        placements
          .filter((result) => result.visible)
          .map(
            (result) =>
              labels.find((label) => label.id === result.id)?.locationCode,
          ),
      );
      for (const result of placements) {
        if (!charge()) {
          hideUnverified(
            'Label application work budget exhausted',
            labels,
            !timeExhausted,
          );
          diagnostics?.abort('measurement-budget', clock());
          return;
        }
        const entry = entries.get(result.id);
        if (!entry) continue;
        const { element, leader, options } = entry;
        entry.dx = result.dx;
        entry.dy = result.dy;
        entry.placed = result.visible;
        entry.compact = result.compact ?? false;
        entry.yielded =
          !!result.yielded ||
          (entry.yielded && options.inspection === 'hover' && entry.compact);
        element.dataset.labelYielded = String(entry.yielded);
        const changed =
          (element.dataset.labelCompact === 'true') !== entry.compact;
        variantChanged ||= changed;
        element.dataset.labelCompact = String(entry.compact);
        if (
          options.inspection &&
          options.readableSummary &&
          (entry.compact || !result.visible) &&
          (!summary || (options.inspection === 'focus' && !focusedSummary))
        ) {
          summary = options.readableSummary;
          focusedSummary = options.inspection === 'focus';
        }
        element.dataset.labelDx = String(result.dx);
        element.dataset.labelDy = String(result.dy);
        element.dataset.labelSuppressed = String(!result.visible);
        element.style.transform = `translate(${result.dx}px, ${result.dy}px)`;
        if (changed && result.visible) {
          const source = labels.find((label) => label.id === result.id)!;
          const actual = element.getBoundingClientRect();
          // Changing width under Html center moves the untransformed top-left.
          // Compensate that movement so optional expansion cannot steal a
          // neighbor's physical footprint; the next pass validates the result.
          entry.dx += source.left + result.dx - actual.left;
          entry.dy += source.top + result.dy - actual.top;
          element.dataset.labelDx = String(entry.dx);
          element.dataset.labelDy = String(entry.dy);
          element.style.transform = `translate(${entry.dx}px, ${entry.dy}px)`;
        }
        if (!result.visible) releaseFocus(element);
        element.style.visibility = result.visible ? 'visible' : 'hidden';
        element.style.pointerEvents =
          result.visible && options.interactive !== false ? 'auto' : 'none';
        setFocusability(entry, result.visible);
        if (result.visible) element.removeAttribute('aria-hidden');
        else {
          suppressed += 1;
          if (
            options.mandatory &&
            options.locationCode &&
            !representedCodes.has(options.locationCode)
          )
            missing.push(options.locationCode);
          element.setAttribute('aria-hidden', 'true');
        }
        const distance = Math.hypot(entry.dx, entry.dy);
        leader.style.display =
          result.visible && distance >= 4 ? 'block' : 'none';
        if (distance >= 4) {
          leader.style.width = `${distance}px`;
          leader.style.transform = `rotate(${Math.atan2(entry.dy, entry.dx)}rad)`;
        }
      }
      diagnostics?.mark('dom-application-end', clock(), pass + 1);
      const validate = () => {
        diagnostics?.mark('remeasurement-start', clock(), pass + 1);
        // Every attempt is one whole authoritative DOM snapshot in this frame.
        // A partial attempt is discarded; it is never combined across frames.
        const beforeMatches = hiddenForValidation ? sameGeometry() : true;
        if (!beforeMatches && !measurementExhausted) {
          continuation = null;
          schedule();
          return;
        }
        const after = measurementExhausted ? [] : measure();
        diagnostics?.mark('remeasurement-end', clock(), pass + 1);
        finalLabels = after;
        const geometryMatches = hiddenForValidation ? sameGeometry() : true;
        if (
          canvas !== originalCanvas ||
          identityRevision !== originalRevision ||
          !beforeMatches ||
          !geometryMatches
        ) {
          if (!measurementExhausted) {
            continuation = null;
            schedule();
            return;
          }
        }
        const dimensionsStable =
          labels.length === after.length &&
          labels.every(
            (label, index) =>
              label.id === after[index].id &&
              label.selected === after[index].selected &&
              label.priority === after[index].priority &&
              label.locationCode === after[index].locationCode &&
              label.mandatory === after[index].mandatory &&
              label.presentation === after[index].presentation &&
              label.preferFull === after[index].preferFull &&
              label.hovered === after[index].hovered &&
              (!hiddenForValidation ||
                (label.left === after[index].left &&
                  label.top === after[index].top)) &&
              Math.abs(label.width - after[index].width) <= DIMENSION_NOISE &&
              Math.abs(label.height - after[index].height) <= DIMENSION_NOISE,
          );
        const actualGeometry = () => {
          const occupied = [...reserved];
          for (const result of finalPlacements) {
            if (!result.visible) continue;
            if (!charge()) return false;
            const area = measuredBounds.get(result.id);
            if (
              !area ||
              !Object.values(area).every(Number.isFinite) ||
              area.left < viewport.left + 2 ||
              area.top < viewport.top + 2 ||
              area.right > viewport.right - 2 ||
              area.bottom > viewport.bottom - 2
            )
              return false;
            for (const other of occupied) {
              if (!charge()) return false;
              if (!(
                area.left >= other.right + 3 ||
                area.right + 3 <= other.left ||
                area.top >= other.bottom + 3 ||
                area.bottom + 3 <= other.top
              ))
                return false;
            }
            occupied.push(area);
          }
          return true;
        };
        const actualFits =
          !measurementExhausted && (!hiddenForValidation || actualGeometry());
        if (measurementExhausted) {
          if (
            timeExhausted &&
            remaining.maxOperations >= 0 &&
            continuationCount < MAX_VALIDATION_CONTINUATIONS
          ) {
            continuationCount++;
            hiddenForValidation = true;
            for (const entry of entries.values()) {
              releaseFocus(entry.element);
              entry.element.style.visibility = 'hidden';
              entry.element.style.pointerEvents = 'none';
              setFocusability(entry);
              entry.element.setAttribute('aria-hidden', 'true');
              entry.element.dataset.labelSuppressed = 'true';
              entry.leader.style.display = 'none';
            }
            diagnostics?.frame(frameStartedAt, clock(), continuationCount);
            continuation = () => {
              frameStartedAt = clock();
              deadline = frameStartedAt + limits.maxMilliseconds;
              measurementExhausted = false;
              timeExhausted = false;
              validate();
            };
            schedule();
            return;
          }
          hideUnverified(
            'Label remeasurement work budget exhausted',
            after,
            !timeExhausted,
          );
          diagnostics?.frame(frameStartedAt, clock(), continuationCount);
          diagnostics?.abort('measurement-budget', clock());
          return;
        }
        if (!variantChanged && dimensionsStable && actualFits) {
          if (hiddenForValidation) {
            for (const result of finalPlacements) {
              if (!charge()) {
                hideUnverified(
                  'Label validation commit work budget exhausted',
                  after,
                  !timeExhausted,
                );
                diagnostics?.frame(frameStartedAt, clock(), continuationCount);
                diagnostics?.abort('measurement-budget', clock());
                return;
              }
              const entry = entries.get(result.id);
              if (!entry) continue;
              const visible =
                result.visible &&
                sceneLabelVisible(entry.element, host) &&
                entry.options.isVisible?.() !== false;
              entry.element.style.visibility = visible ? 'visible' : 'hidden';
              entry.element.style.pointerEvents =
                visible && entry.options.interactive !== false
                  ? 'auto'
                  : 'none';
              setFocusability(entry, visible);
              entry.element.dataset.labelSuppressed = String(!visible);
              if (visible) entry.element.removeAttribute('aria-hidden');
              else entry.element.setAttribute('aria-hidden', 'true');
              entry.leader.style.display =
                visible && Math.hypot(entry.dx, entry.dy) >= 4
                  ? 'block'
                  : 'none';
            }
          }
          if (hiddenForValidation && clock() >= deadline) {
            hideUnverified(
              'Label validation commit work budget exhausted',
              after,
              false,
            );
            diagnostics?.frame(frameStartedAt, clock(), continuationCount);
            diagnostics?.abort('measurement-budget', clock());
            return;
          }
          diagnostics?.frame(frameStartedAt, clock(), continuationCount);
          finish();
        } else if (pass < 3) {
          runPass(pass + 1);
        } else {
          hideUnverified(
            'Unstable label dimensions after four placement passes',
            after,
          );
          diagnostics?.frame(frameStartedAt, clock(), continuationCount);
          diagnostics?.abort('unstable-dimensions', clock());
        }
      };
      validate();
    };
    runPass(0);
  };
  const schedule = () => {
    if (canvas && pending === null) {
      canvas.dataset.labelLayoutPending = 'true';
      pending = requestAnimationFrame(place);
    }
  };
  const invalidateLayout = (reason: RoomDemandReason = 'layout-external') => {
    if (invalidateGeometry) recordRoomDemand(canvas, reason);
    invalidateGeometry?.();
    schedule();
  };
  return {
    schedule,
    invalidateLayout,
    hide(id: string) {
      const entry = entries.get(id);
      if (entry) {
        if (entry.element.dataset.roomExposed !== 'false') identityRevision++;
        hideEntry(entry);
      }
    },
    retry() {
      failedMeasurement = '';
      schedule();
    },
    register(
      id: string,
      element: HTMLElement,
      leader: HTMLElement,
      options: LabelOptions,
    ) {
      if (options.presentation === 'occupied-marker') {
        if (
          element.tagName !== 'SPAN' ||
          element.hasAttribute('contenteditable') ||
          (element.getAttribute('role') !== null &&
            element.getAttribute('role') !== 'img') ||
          options.priority >= 4
        )
          throw new Error(
            'Occupied markers require an unselected readonly span',
          );
        // Presentation metadata never turns a small badge into a DOM action.
        options = {
          ...options,
          interactive: false,
          compact: true,
          preferFull: false,
          inspection: null,
          pointer: undefined,
        };
        element.removeAttribute('tabindex');
        element.style.pointerEvents = 'none';
      }
      recordRoomDemand(canvas, 'label-register');
      identityRevision++;
      const entry = {
        element,
        leader,
        options,
        dx: Number(element.dataset.labelDx ?? 0),
        dy: Number(element.dataset.labelDy ?? 0),
        // Option changes run effect cleanup before registering again. Keep the
        // same DOM action's placement; layout still validates every constraint.
        placed:
          element.dataset.labelLayoutId === id &&
          element.dataset.labelSuppressed === 'false',
        yielded:
          element.dataset.labelLayoutId === id &&
          element.dataset.labelYielded === 'true',
        compact:
          element.dataset.labelLayoutId === id &&
          element.dataset.labelCompact === 'true',
      };
      element.dataset.labelLayoutId = id;
      entries.set(id, entry);
      observer?.observe(element);
      schedule();
      return () => {
        if (entries.get(id) !== entry) return;
        identityRevision++;
        recordRoomDemand(canvas, 'label-unregister');
        entries.delete(id);
        observer?.unobserve(element);
        schedule();
      };
    },
    connect(
      element: HTMLCanvasElement,
      invalidateScene?: () => void,
      readGeometryIdentity?: () => GeometryIdentity,
    ) {
      identityRevision++;
      continuation = null;
      geometryIdentity = readGeometryIdentity;
      canvas = element;
      invalidateGeometry = invalidateScene;
      const releaseDemand = bindRoomDemand(element, invalidateScene);
      let connected = true;
      const changed = (reason: RoomDemandReason) => {
        if (!connected) return;
        invalidateLayout(reason);
      };
      observer = new ResizeObserver((records) => {
        const labels = new Set(
          [...entries.values()].map((entry) => entry.element),
        );
        for (const record of records)
          recordRoomResize(
            element,
            record,
            record.target === element
              ? 'canvas'
              : labels.has(record.target as HTMLElement)
                ? 'label'
                : 'obstruction',
          );
        if (
          continuation &&
          records.length > 0 &&
          records.every((record) => labels.has(record.target as HTMLElement))
        ) {
          // Placement writes can resize Html labels. Request the retained whole
          // validation; that pass detects external dimension/anchor changes.
          recordRoomDemand(element, 'resize-continuation');
          schedule();
        } else changed('resize-scene');
      });
      observer.observe(element);
      for (const entry of entries.values()) observer.observe(entry.element);
      const surface = element.closest('[data-room-surface]');
      const obstructionElements = new Set<Element>();
      type ObstructionSnapshot = {
        canvas: number[];
        panels: {
          element: Element;
          rendered: boolean;
          rect: number[] | null;
        }[];
      };
      let previousObstructions: ObstructionSnapshot | null = null;
      const rectValues = (rect: DOMRect) => {
        const values = [
          rect.left,
          rect.top,
          rect.right,
          rect.bottom,
          rect.width,
          rect.height,
        ];
        return values.every(Number.isFinite) &&
          rect.width > 0 &&
          rect.height > 0
          ? values
          : null;
      };
      const observeOverlays = (records: MutationRecord[] = []) => {
        const panels = [
          ...(surface?.querySelectorAll('[data-room-obstruction]') ?? []),
        ];
        const nextElements = new Set(panels);
        const labelElements = new Set(
          [...entries.values()].map((entry) => entry.element),
        );
        for (const panel of obstructionElements) {
          if (!nextElements.has(panel)) {
            if (panel !== element && !labelElements.has(panel as HTMLElement))
              observer?.unobserve(panel);
            obstructionElements.delete(panel);
          }
        }
        for (const panel of panels) {
          if (!obstructionElements.has(panel)) {
            if (panel !== element && !labelElements.has(panel as HTMLElement))
              observer?.observe(panel);
            obstructionElements.add(panel);
          }
        }
        let snapshot: ObstructionSnapshot | null = null;
        try {
          const canvasRect = rectValues(element.getBoundingClientRect());
          const measured = panels.map((panel) => {
            const rendered = panel.getClientRects().length > 0;
            return {
              element: panel,
              rendered,
              rect: rendered ? rectValues(panel.getBoundingClientRect()) : null,
            };
          });
          if (
            canvasRect &&
            measured.every((panel) => !panel.rendered || panel.rect)
          )
            snapshot = { canvas: canvasRect, panels: measured };
        } catch {
          /* Unmeasurable geometry remains a conservative invalidation. */
        }
        const sameNumbers = (left: number[], right: number[]) =>
          left.length === right.length &&
          left.every((value, index) => value === right[index]);
        const unchanged =
          snapshot &&
          previousObstructions &&
          sameNumbers(snapshot.canvas, previousObstructions.canvas) &&
          snapshot.panels.length === previousObstructions.panels.length &&
          snapshot.panels.every((panel, index) => {
            const previous = previousObstructions!.panels[index];
            return (
              panel.element === previous.element &&
              panel.rendered === previous.rendered &&
              (panel.rect
                ? !!previous.rect && sameNumbers(panel.rect, previous.rect)
                : previous.rect === null)
            );
          });
        const containsObstruction = (node: Node) =>
          node instanceof Element &&
          (node.matches('[data-room-obstruction]') ||
            !!node.querySelector('[data-room-obstruction]'));
        const touchesObstruction = records.some(
          (record) =>
            (record.target instanceof Element &&
              !!record.target.closest('[data-room-obstruction]')) ||
            [...record.addedNodes, ...record.removedNodes].some(
              containsObstruction,
            ),
        );
        // Cache before demanding a frame. Unrelated Html/status child writes
        // cannot feed scene demand when actual canvas/obstruction inputs match.
        previousObstructions = snapshot;
        if (!snapshot) recordRoomDemand(element, 'mutation-unmeasurable');
        else if (!unchanged) recordRoomDemand(element, 'mutation-geometry');
        if (touchesObstruction)
          recordRoomDemand(element, 'mutation-obstruction');
        else if (unchanged) recordRoomDemand(element, 'mutation-ignored');
        if (!unchanged || touchesObstruction) changed('mutation-scene');
      };
      if (surface) {
        overlays = new MutationObserver(observeOverlays);
        overlays.observe(surface, { childList: true, subtree: true });
        observeOverlays();
      }
      const fontLoaded = () => changed('font-loaded');
      const fontReady = () => changed('font-ready');
      const windowScroll = () => changed('window-scroll');
      const windowResize = () => changed('window-resize');
      const visualScroll = () => changed('visual-scroll');
      const visualResize = () => changed('visual-resize');
      document.fonts?.addEventListener('loadingdone', fontLoaded);
      void document.fonts?.ready.then(fontReady);
      const visual = window.visualViewport;
      window.addEventListener('scroll', windowScroll, true);
      window.addEventListener('resize', windowResize);
      visual?.addEventListener('scroll', visualScroll);
      visual?.addEventListener('resize', visualResize);
      schedule();
      return () => {
        connected = false;
        releaseDemand();
        identityRevision++;
        continuation = null;
        geometryIdentity = undefined;
        invalidateGeometry = undefined;
        delete element.dataset.labelLayoutPending;
        delete element.dataset.labelLayoutRevision;
        delete element.dataset.labelLayoutError;
        delete element.dataset.labelLayoutStatus;
        canvas = null;
        observer?.disconnect();
        observer = null;
        overlays?.disconnect();
        overlays = null;
        document.fonts?.removeEventListener('loadingdone', fontLoaded);
        window.removeEventListener('scroll', windowScroll, true);
        window.removeEventListener('resize', windowResize);
        visual?.removeEventListener('scroll', visualScroll);
        visual?.removeEventListener('resize', visualResize);
        if (pending !== null) cancelAnimationFrame(pending);
        pending = null;
      };
    },
  };
}
export type RoomLabelRegistry = ReturnType<typeof createRoomLabelRegistry>;
const LabelLayoutContext = createContext<RoomLabelRegistry | null>(null);
export function useRoomLabelRegistry() {
  const registry = useContext(LabelLayoutContext);
  if (!registry) throw new Error('Room labels need a layout provider');
  return registry;
}
export function useRoomLabelLayout() {
  return useRoomLabelRegistry().register;
}
export function LabelLayoutProvider({
  children,
  registry,
}: {
  children: ReactNode;
  registry: RoomLabelRegistry;
}) {
  return (
    <LabelLayoutContext.Provider value={registry}>
      {children}
    </LabelLayoutContext.Provider>
  );
}
export function LabelLayoutDriver({
  registry,
}: {
  registry: RoomLabelRegistry;
}) {
  const { gl, invalidate, get } = useThree();
  useFrame(() => {
    recordRoomDemand(invalidate, 'driver-schedule');
    registry.schedule();
  });
  useEffect(
    () =>
      registry.connect(gl.domElement, invalidate, () => {
        const camera = get().camera;
        return {
          camera,
          projection: [...camera.projectionMatrix.elements],
          world: [...camera.matrixWorld.elements],
        };
      }),
    [registry, gl, invalidate, get],
  );
  return null;
}
