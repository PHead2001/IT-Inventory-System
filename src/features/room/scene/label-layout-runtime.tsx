'use client';
import { useFrame, useThree } from '@react-three/fiber';
import { createContext, useContext, useEffect, type ReactNode } from 'react';
import { layoutLabels, type LabelRect } from './label-layout';

export type LabelOptions = {
  priority: number;
  locationCode?: string;
  interactive?: boolean;
  mandatory?: boolean;
  compact?: boolean;
  preferFull?: boolean;
  readableSummary?: string;
  inspection?: 'focus' | 'hover' | null;
  isVisible?: () => boolean;
};
type Entry = {
  element: HTMLElement;
  leader: HTMLElement;
  options: LabelOptions;
  dx: number;
  dy: number;
  placed: boolean;
  compact: boolean;
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
  const place = () => {
    pending = null;
    if (canvas) canvas.dataset.labelLayoutPending = 'false';
    const host = canvas?.parentElement;
    const viewport = canvas?.getBoundingClientRect();
    if (!host || !viewport || viewport.width <= 0 || viewport.height <= 0)
      return;
    const labels: LabelRect[] = [];
    for (const [id, entry] of entries) {
      if (
        !sceneLabelVisible(entry.element, host) ||
        entry.options.isVisible?.() === false
      ) {
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
      entry.element.dataset.roomExposed = 'true';
      const full = entry.element.querySelector<HTMLElement>(
        '[data-room-label-full]',
      );
      const fullRect = full?.getBoundingClientRect();
      labels.push({
        id,
        selected: entry.options.priority >= 4,
        priority: entry.options.priority,
        locationCode: entry.options.locationCode,
        left: rect.left - entry.dx,
        top: rect.top - entry.dy,
        width: fullRect?.width ? Math.max(44, fullRect.width + 18) : rect.width,
        height: fullRect?.height
          ? Math.max(44, fullRect.height + 12)
          : rect.height,
        mandatory: entry.options.mandatory,
        preferFull: entry.options.preferFull,
        compact: entry.options.compact ? { width: 44, height: 44 } : undefined,
        previous: entry.placed
          ? { dx: entry.dx, dy: entry.dy, compact: entry.compact }
          : undefined,
      });
    }
    const reserved = Array.from(
      host
        .closest('[data-room-surface]')
        ?.querySelectorAll<HTMLElement>('[data-room-obstruction]') ?? [],
    )
      .filter((element) => element.getClientRects().length > 0)
      .map((element) => element.getBoundingClientRect());
    let suppressed = 0;
    const missing: string[] = [];
    let summary: string | null = null;
    let focusedSummary = false;
    for (const result of layoutLabels(labels, viewport, reserved)) {
      const entry = entries.get(result.id);
      if (!entry) continue;
      const { element, leader, options } = entry;
      entry.dx = result.dx;
      entry.dy = result.dy;
      entry.placed = result.visible;
      entry.compact = result.compact ?? false;
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
        if (document.activeElement === element) element.blur();
        element.setAttribute('aria-hidden', 'true');
      }
      const distance = Math.hypot(result.dx, result.dy);
      leader.style.display = result.visible && distance >= 4 ? 'block' : 'none';
      if (distance >= 4) {
        leader.style.width = `${distance}px`;
        leader.style.transform = `rotate(${Math.atan2(result.dy, result.dx)}rad)`;
      }
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
    if (canvas) canvas.dataset.labelLayoutRevision = String(++revision);
  };
  const schedule = () => {
    if (canvas && pending === null) {
      canvas.dataset.labelLayoutPending = 'true';
      pending = requestAnimationFrame(place);
    }
  };
  return {
    schedule,
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
