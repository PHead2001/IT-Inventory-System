'use client';
import { useFrame, useThree } from '@react-three/fiber';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  type ReactNode,
} from 'react';
import { layoutLabels, type LabelRect } from './label-layout';

type Entry = {
  button: HTMLButtonElement;
  leader: HTMLSpanElement;
  selected: boolean;
  dx: number;
  dy: number;
};
type Register = (
  id: string,
  button: HTMLButtonElement,
  leader: HTMLSpanElement,
  selected: boolean,
) => () => void;
const LabelLayoutContext = createContext<Register | null>(null);

export function useRoomLabelLayout() {
  const register = useContext(LabelLayoutContext);
  if (!register) throw new Error('Room labels need a layout provider');
  return register;
}

function sceneLabelVisible(button: HTMLElement, host: HTMLElement) {
  for (
    let element: HTMLElement | null = button.parentElement;
    element && element !== host;
    element = element.parentElement
  )
    if (element.style.display === 'none') return false;
  return button.isConnected;
}

export function LabelLayoutProvider({
  children,
  onSuppressionChange,
}: {
  children: ReactNode;
  onSuppressionChange: (count: number) => void;
}) {
  const { gl } = useThree();
  const entries = useRef(new Map<string, Entry>());
  const pending = useRef<number | null>(null);
  const lastSuppressed = useRef(-1);
  const place = useCallback(() => {
    pending.current = null;
    const canvas = gl.domElement;
    const host = canvas.parentElement;
    const viewport = canvas.getBoundingClientRect();
    if (!host || viewport.width <= 0 || viewport.height <= 0) return;
    const labels: LabelRect[] = [];
    for (const [id, entry] of entries.current) {
      if (!sceneLabelVisible(entry.button, host)) continue;
      const rect = entry.button.getBoundingClientRect();
      labels.push({
        id,
        selected: entry.selected,
        left: rect.left - entry.dx,
        top: rect.top - entry.dy,
        width: rect.width,
        height: rect.height,
      });
    }
    const placements = layoutLabels(labels, viewport);
    let suppressed = 0;
    for (const result of placements) {
      const entry = entries.current.get(result.id);
      if (!entry) continue;
      const { button, leader } = entry;
      entry.dx = result.dx;
      entry.dy = result.dy;
      button.dataset.labelDx = String(result.dx);
      button.dataset.labelDy = String(result.dy);
      button.dataset.labelSuppressed = String(!result.visible);
      button.style.transform = `translate(${result.dx}px, ${result.dy}px)`;
      button.style.visibility = result.visible ? 'visible' : 'hidden';
      button.style.pointerEvents = result.visible ? 'auto' : 'none';
      button.tabIndex = result.visible ? 0 : -1;
      if (result.visible) button.removeAttribute('aria-hidden');
      else {
        suppressed += 1;
        if (document.activeElement === button) button.blur();
        button.setAttribute('aria-hidden', 'true');
      }
      const distance = Math.hypot(result.dx, result.dy);
      leader.style.display = result.visible && distance >= 4 ? 'block' : 'none';
      if (distance >= 4) {
        leader.style.width = `${distance}px`;
        leader.style.transform = `rotate(${Math.atan2(result.dy, result.dx)}rad)`;
      }
    }
    if (suppressed !== lastSuppressed.current) {
      lastSuppressed.current = suppressed;
      onSuppressionChange(suppressed);
    }
  }, [gl, onSuppressionChange]);
  const schedule = useCallback(() => {
    if (pending.current === null)
      pending.current = requestAnimationFrame(place);
  }, [place]);
  const register = useCallback<Register>(
    (id, button, leader, selected) => {
      entries.current.set(id, {
        button,
        leader,
        selected,
        dx: Number(button.dataset.labelDx ?? 0),
        dy: Number(button.dataset.labelDy ?? 0),
      });
      schedule();
      return () => {
        entries.current.delete(id);
        schedule();
      };
    },
    [schedule],
  );
  useFrame(schedule);
  useEffect(() => {
    const observer = new ResizeObserver(schedule);
    observer.observe(gl.domElement);
    schedule();
    return () => {
      observer.disconnect();
      if (pending.current !== null) cancelAnimationFrame(pending.current);
      pending.current = null;
    };
  }, [gl, schedule]);
  const value = useMemo(() => register, [register]);
  return (
    <LabelLayoutContext.Provider value={value}>
      {children}
    </LabelLayoutContext.Provider>
  );
}
