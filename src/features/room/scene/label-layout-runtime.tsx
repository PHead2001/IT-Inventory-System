'use client';
import { useFrame, useThree } from '@react-three/fiber';
import { createContext, useContext, useEffect, type ReactNode } from 'react';
import {
  layoutLabelsDetailed,
  LABEL_PACKING_BUDGET,
  type LabelPackingBudget,
  type LabelRect,
} from './label-layout';
import { createLabelLayoutDiagnostics } from './label-layout-diagnostics';

export type LabelOptions = {
  priority: number;
  locationCode?: string;
  interactive?: boolean;
  mandatory?: boolean;
  compact?: boolean;
  preferFull?: boolean;
  readableSummary?: string;
  inspection?: 'focus' | 'hover' | null;
  pointer?: () => { x: number; y: number } | null;
  isVisible?: () => boolean;
};
// At Chromium device scale 1.5, translation alone changed measured widths by
// up to 3/65536px. This comparison-only bound is 128 times smaller than a
// 1/64px layout unit; actual packing still uses the unrounded measured sizes.
const DIMENSION_NOISE = 1 / 8192;

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
  const hideEntry = (entry: Entry) => {
    releaseFocus(entry.element);
    entry.element.dataset.roomExposed = 'false';
    entry.element.dataset.labelSuppressed = 'true';
    entry.element.style.visibility = 'hidden';
    entry.element.style.pointerEvents = 'none';
    entry.element.tabIndex = -1;
    entry.element.setAttribute('aria-hidden', 'true');
    entry.leader.style.display = 'none';
    entry.placed = false;
  };
  const place = () => {
    pending = null;
    const deadline = clock() + limits.maxMilliseconds;
    const remaining = { ...limits };
    let measurementExhausted = false;
    const charge = () => {
      remaining.maxOperations -= 1;
      if (remaining.maxOperations < 0 || clock() >= deadline)
        measurementExhausted = true;
      return !measurementExhausted;
    };
    const host = canvas?.parentElement;
    const viewport = canvas?.getBoundingClientRect();
    if (!host || !viewport) return;
    if (
      !Number.isFinite(viewport.width) ||
      !Number.isFinite(viewport.height) ||
      viewport.width <= 0 ||
      viewport.height <= 0
    ) {
      const codes: string[] = [];
      for (const entry of entries.values()) {
        hideEntry(entry);
        if (entry.options.interactive !== false && entry.options.locationCode)
          codes.push(entry.options.locationCode);
      }
      reportIssue(codes);
      if (canvas) {
        canvas.dataset.labelLayoutStatus = 'budget-exhausted';
        canvas.dataset.labelLayoutError = 'Room viewport is not measured';
        canvas.dataset.labelLayoutPending = 'false';
      }
      return;
    }
    const measure = () => {
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
          entry.element.tabIndex = -1;
          entry.element.setAttribute('aria-hidden', 'true');
          entry.leader.style.display = 'none';
          entry.placed = false;
          continue;
        }
        const rect = entry.element.getBoundingClientRect();
        charge();
        entry.element.dataset.roomExposed = 'true';
        const full = entry.element.querySelector<HTMLElement>(
          '[data-room-label-full]',
        );
        const fullRect = full?.getBoundingClientRect();
        charge();
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
            ? { width: 44, height: 44 }
            : undefined,
          previous: entry.placed
            ? { dx: entry.dx, dy: entry.dy, compact: entry.compact }
            : undefined,
        });
      }
      return labels;
    };
    const reserved = Array.from(
      host
        .closest('[data-room-surface]')
        ?.querySelectorAll<HTMLElement>('[data-room-obstruction]') ?? [],
    )
      .filter((element) => element.getClientRects().length > 0)
      .map((element) => {
        charge();
        return element.getBoundingClientRect();
      });
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
    const hideUnverified = (message: string, labels: LabelRect[]) => {
      const codes: string[] = [];
      for (const entry of entries.values()) {
        const { element, leader } = entry;
        releaseFocus(element);
        element.style.visibility = 'hidden';
        element.style.pointerEvents = 'none';
        element.tabIndex = -1;
        element.setAttribute('aria-hidden', 'true');
        element.dataset.labelSuppressed = 'true';
        leader.style.display = 'none';
        entry.placed = false;
        if (
          entry.options.locationCode &&
          entry.options.interactive !== false &&
          entry.options.isVisible?.() !== false
        )
          codes.push(entry.options.locationCode);
      }
      failedMeasurement = measuredKey(labels);
      reportIssue(codes);
      if (canvas) {
        canvas.dataset.labelLayoutError = message;
        canvas.dataset.labelLayoutStatus = 'budget-exhausted';
      }
    };
    let suppressed = 0;
    const missing: string[] = [];
    let summary: string | null = null;
    let focusedSummary = false;
    let settled = false;
    let finalLabels: LabelRect[] = [];
    let finalStatus: 'complete' | 'candidate-infeasible' | 'budget-exhausted' =
      'complete';
    // CSS changes a centered Html wrapper immediately. Reflow/validate those
    // real dimensions before exposing a settled revision, without idle frames.
    diagnostics?.begin();
    for (let pass = 0; pass < 4; pass++) {
      const labels = measure();
      finalLabels = labels;
      if (measurementExhausted) {
        hideUnverified('Label measurement work budget exhausted', labels);
        diagnostics?.finish(false);
        return;
      }
      if (pass === 0 && failedMeasurement === measuredKey(labels)) {
        if (canvas) canvas.dataset.labelLayoutPending = 'false';
        diagnostics?.finish(false);
        return;
      }
      diagnostics?.input(labels, viewport, reserved);
      let variantChanged = false;
      suppressed = 0;
      missing.length = 0;
      summary = null;
      focusedSummary = false;
      const outcome = layoutLabelsDetailed(
        labels,
        viewport,
        reserved,
        { ...remaining, maxMilliseconds: Math.max(0, deadline - clock()) },
        clock,
      );
      const placements = outcome.placements;
      finalStatus = outcome.status;
      remaining.maxOperations -= outcome.stats.operations;
      remaining.maxCandidates -= outcome.stats.candidates;
      remaining.maxNodes -= outcome.stats.nodes;
      // An oversized request returns no partial placements. No old action may
      // remain exposed as if it had been checked against this measured view.
      if (placements.length !== labels.length) {
        hideUnverified('Label placement work budget exhausted', labels);
        diagnostics?.finish(false);
        return;
      }
      diagnostics?.output(placements);
      for (const result of placements) {
        charge();
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
        element.tabIndex =
          result.visible && options.interactive !== false ? 0 : -1;
        if (result.visible) element.removeAttribute('aria-hidden');
        else {
          suppressed += 1;
          if (options.mandatory && options.locationCode)
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
      // Force a final real measurement even when the chosen CSS variant stayed
      // unchanged. A subsequent size-dependent pass is required after a change.
      const after = measure();
      finalLabels = after;
      if (measurementExhausted) break;
      const dimensionsStable =
        labels.length === after.length &&
        labels.every(
          (label, index) =>
            Math.abs(label.width - after[index].width) <= DIMENSION_NOISE &&
            Math.abs(label.height - after[index].height) <= DIMENSION_NOISE,
        );
      if (!variantChanged && dimensionsStable) {
        settled = true;
        break;
      }
    }
    diagnostics?.finish(settled);
    if (!settled) {
      hideUnverified(
        measurementExhausted
          ? 'Label remeasurement work budget exhausted'
          : 'Unstable label dimensions after four placement passes',
        finalLabels,
      );
      return;
    }
    if (canvas) canvas.dataset.labelLayoutStatus = finalStatus;
    if (finalStatus === 'complete') {
      failedMeasurement = '';
      reportIssue([]);
    } else {
      failedMeasurement = measuredKey(finalLabels);
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
  };
  const schedule = () => {
    if (canvas && pending === null) {
      canvas.dataset.labelLayoutPending = 'true';
      pending = requestAnimationFrame(place);
    }
  };
  return {
    schedule,
    hide(id: string) {
      const entry = entries.get(id);
      if (entry) hideEntry(entry);
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
        entries.delete(id);
        observer?.unobserve(element);
        schedule();
      };
    },
    connect(element: HTMLCanvasElement, invalidateGeometry?: () => void) {
      canvas = element;
      let connected = true;
      const changed = () => {
        if (!connected) return;
        invalidateGeometry?.();
        schedule();
      };
      observer = new ResizeObserver(changed);
      observer.observe(element);
      for (const entry of entries.values()) observer.observe(entry.element);
      const surface = element.closest('[data-room-surface]');
      const observeOverlays = () => {
        surface
          ?.querySelectorAll('[data-room-obstruction]')
          .forEach((panel) => observer?.observe(panel));
        changed();
      };
      if (surface) {
        overlays = new MutationObserver(observeOverlays);
        overlays.observe(surface, { childList: true, subtree: true });
        observeOverlays();
      }
      document.fonts?.addEventListener('loadingdone', changed);
      void document.fonts?.ready.then(changed);
      schedule();
      return () => {
        connected = false;
        delete element.dataset.labelLayoutPending;
        delete element.dataset.labelLayoutRevision;
        delete element.dataset.labelLayoutError;
        delete element.dataset.labelLayoutStatus;
        canvas = null;
        observer?.disconnect();
        observer = null;
        overlays?.disconnect();
        overlays = null;
        document.fonts?.removeEventListener('loadingdone', changed);
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
  const { gl, invalidate } = useThree();
  useFrame(registry.schedule);
  useEffect(
    () => registry.connect(gl.domElement, invalidate),
    [registry, gl, invalidate],
  );
  return null;
}
