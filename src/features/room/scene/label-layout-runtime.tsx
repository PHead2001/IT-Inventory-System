'use client';
import { useFrame, useThree } from '@react-three/fiber';
import { createContext, useContext, useEffect, type ReactNode } from 'react';
import { layoutLabels, type LabelRect } from './label-layout';

export type LabelOptions = {
  priority: number;
  locationCode?: string;
  interactive?: boolean;
};
type Entry = {
  element: HTMLElement;
  leader: HTMLElement;
  options: LabelOptions;
  dx: number;
  dy: number;
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
  onSuppressionChange: (count: number) => void,
) {
  const entries = new Map<string, Entry>();
  let canvas: HTMLCanvasElement | null = null;
  let observer: ResizeObserver | null = null;
  let pending: number | null = null;
  let lastSuppressed = -1;
  let revision = 0;
  const place = () => {
    pending = null;
    if (canvas) canvas.dataset.labelLayoutPending = 'false';
    const host = canvas?.parentElement;
    const viewport = canvas?.getBoundingClientRect();
    if (!host || !viewport || viewport.width <= 0 || viewport.height <= 0)
      return;
    const labels: LabelRect[] = [];
    for (const [id, entry] of entries) {
      if (!sceneLabelVisible(entry.element, host)) continue;
      const rect = entry.element.getBoundingClientRect();
      labels.push({
        id,
        selected: entry.options.priority === 3,
        priority: entry.options.priority,
        locationCode: entry.options.locationCode,
        left: rect.left - entry.dx,
        top: rect.top - entry.dy,
        width: rect.width,
        height: rect.height,
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
    for (const result of layoutLabels(labels, viewport, reserved)) {
      const entry = entries.get(result.id);
      if (!entry) continue;
      const { element, leader, options } = entry;
      entry.dx = result.dx;
      entry.dy = result.dy;
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
    if (suppressed !== lastSuppressed) {
      lastSuppressed = suppressed;
      onSuppressionChange(suppressed);
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
      };
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
    connect(element: HTMLCanvasElement) {
      canvas = element;
      observer = new ResizeObserver(schedule);
      observer.observe(element);
      for (const entry of entries.values()) observer.observe(entry.element);
      document.fonts?.addEventListener('loadingdone', schedule);
      void document.fonts?.ready.then(schedule);
      schedule();
      return () => {
        delete element.dataset.labelLayoutPending;
        delete element.dataset.labelLayoutRevision;
        canvas = null;
        observer?.disconnect();
        observer = null;
        document.fonts?.removeEventListener('loadingdone', schedule);
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
  const { gl } = useThree();
  useFrame(registry.schedule);
  useEffect(() => registry.connect(gl.domElement), [registry, gl]);
  return null;
}
