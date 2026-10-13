'use client';
import { afterTransitionCapture } from '@/components/forms/transition-capture';
import {
  useEffect,
  useLayoutEffect,
  useId,
  useRef,
  useState,
  type RefObject,
} from 'react';
import {
  Focus,
  Maximize,
  Minus,
  MoreHorizontal,
  MousePointer2,
  Plus,
  Check,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { OrbitMode } from './camera-math';
import styles from '../room-visual.module.css';

type ControlsArea = {
  left: number;
  top: number;
  right: number;
  bottom: number;
};
export function placeRoomControls(
  anchor: ControlsArea,
  viewport: ControlsArea,
  size: { width: number; height: number },
  preferAbove: boolean,
) {
  const gap = 5,
    inset = 4;
  const leftEdge = viewport.left + inset,
    rightEdge = viewport.right - inset;
  const topEdge = viewport.top + inset,
    bottomEdge = viewport.bottom - inset;
  const width = Math.max(0, Math.min(size.width, rightEdge - leftEdge));
  const height = Math.max(0, Math.min(size.height, bottomEdge - topEdge));
  const clamp = (value: number, min: number, max: number) =>
    Math.max(min, Math.min(value, max));
  let left = clamp(anchor.right - width, leftEdge, rightEdge - width);
  let top: number,
    maxHeight = height;
  let side: 'above' | 'below' | 'left' | 'right';
  const above = Math.max(0, anchor.top - gap - topEdge);
  const below = Math.max(0, bottomEdge - anchor.bottom - gap);
  if (preferAbove && above >= height) {
    side = 'above';
    top = anchor.top - gap - height;
  } else if (!preferAbove && below >= height) {
    side = 'below';
    top = anchor.bottom + gap;
  } else if (anchor.right + gap + width <= rightEdge) {
    side = 'right';
    left = anchor.right + gap;
    top = clamp(anchor.top, topEdge, bottomEdge - height);
  } else if (anchor.left - gap - width >= leftEdge) {
    side = 'left';
    left = anchor.left - gap - width;
    top = clamp(anchor.top, topEdge, bottomEdge - height);
  } else if (below >= above) {
    side = 'below';
    maxHeight = Math.min(height, below);
    top = clamp(anchor.bottom + gap, topEdge, bottomEdge - maxHeight);
  } else {
    side = 'above';
    maxHeight = Math.min(height, above);
    top = clamp(anchor.top - gap - maxHeight, topEdge, bottomEdge - maxHeight);
  }
  return {
    left: clamp(left, leftEdge, rightEdge - width),
    top: clamp(top, topEdge, bottomEdge - maxHeight),
    width,
    maxHeight,
    side,
  };
}

export type ViewCommandKind =
  | 'fit'
  | 'recenter'
  | 'zoom-in'
  | 'zoom-out'
  | 'left'
  | 'right'
  | 'up'
  | 'down'
  | 'rotate-left'
  | 'rotate-right'
  | 'tilt-up'
  | 'tilt-down';
export function RoomToolbar({
  active,
  onActiveChange,
  canFocusSelected,
  onRequestFocus,
  onCommand,
  mode,
  onModeChange,
  showLabels,
  onLabelsChange,
  showCounts,
  onCountsChange,
  interactionRef,
  onOverlayChange,
}: {
  active: boolean;
  onActiveChange(active: boolean): void;
  canFocusSelected: boolean;
  onRequestFocus(): void;
  onCommand(kind: ViewCommandKind): void;
  mode: OrbitMode;
  onModeChange(mode: OrbitMode): void;
  showLabels: boolean;
  onLabelsChange(): void;
  showCounts: boolean;
  onCountsChange(): void;
  interactionRef?: RefObject<HTMLButtonElement | null>;
  onOverlayChange?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [help, setHelp] = useState(false);
  const host = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const more = useRef<HTMLButtonElement>(null);
  const localInteraction = useRef<HTMLButtonElement>(null);
  const interact = interactionRef ?? localInteraction;
  const panelId = useId();
  // Keep the same native action nodes; only the open panel's envelope moves.
  useLayoutEffect(() => {
    if (!open) return;
    let frame: number | null = null;
    const visual = window.visualViewport;
    const measure = () => {
      frame = null;
      if (!host.current || !panel.current) return;
      const anchor = host.current.getBoundingClientRect();
      const viewport = {
        left: visual?.offsetLeft ?? 0,
        top: visual?.offsetTop ?? 0,
        right: (visual?.offsetLeft ?? 0) + (visual?.width ?? window.innerWidth),
        bottom:
          (visual?.offsetTop ?? 0) + (visual?.height ?? window.innerHeight),
      };
      const css = getComputedStyle(panel.current);
      const width = Math.min(
        anchor.width,
        parseFloat(css.getPropertyValue('--room-menu-width')) || 240,
      );
      const height = Math.min(
        parseFloat(css.getPropertyValue('--room-menu-height')) || 220,
        (viewport.bottom - viewport.top) * 0.35,
        panel.current.scrollHeight + 2,
      );
      const placement = placeRoomControls(
        anchor,
        viewport,
        { width, height },
        anchor.width <= 720,
      );
      const style = panel.current.style;
      const values = {
        left: placement.left - anchor.left,
        top: placement.top - anchor.top,
        width: placement.width,
        maxHeight: placement.maxHeight,
      };
      let changed = panel.current.dataset.placement !== placement.side;
      for (const [key, value] of Object.entries(values)) {
        const next = `${value}px`;
        if (
          style.getPropertyValue(key === 'maxHeight' ? 'max-height' : key) !==
          next
        ) {
          style.setProperty(key === 'maxHeight' ? 'max-height' : key, next);
          changed = true;
        }
      }
      panel.current.dataset.placement = placement.side;
      if (changed) onOverlayChange?.();
    };
    const schedule = () => {
      if (frame === null) frame = requestAnimationFrame(measure);
    };
    measure();
    const observer =
      typeof ResizeObserver === 'undefined'
        ? null
        : new ResizeObserver(schedule);
    if (host.current) observer?.observe(host.current);
    if (panel.current) observer?.observe(panel.current);
    window.addEventListener('resize', schedule);
    window.addEventListener('scroll', schedule, true);
    window.visualViewport?.addEventListener('resize', schedule);
    window.visualViewport?.addEventListener('scroll', schedule);
    return () => {
      if (frame !== null) cancelAnimationFrame(frame);
      observer?.disconnect();
      window.removeEventListener('resize', schedule);
      window.removeEventListener('scroll', schedule, true);
      visual?.removeEventListener('resize', schedule);
      visual?.removeEventListener('scroll', schedule);
    };
  }, [open, onOverlayChange]);
  const close = (restore = true) => {
    setOpen(false);
    setHelp(false);
    if (restore) more.current?.focus({ preventScroll: true });
  };
  useEffect(() => {
    onOverlayChange?.();
    if (!open) return;
    const cancelFocus = afterTransitionCapture(document, () =>
      panel.current
        ?.querySelector<HTMLButtonElement>('button')
        ?.focus({ preventScroll: true }),
    );
    const outside = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        !host.current?.contains(event.target)
      ) {
        setOpen(false);
        setHelp(false);
      }
    };
    document.addEventListener('pointerdown', outside, true);
    return () => {
      cancelFocus();
      document.removeEventListener('pointerdown', outside, true);
    };
  }, [open, onOverlayChange]);
  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || (!active && !open)) return;
      event.preventDefault();
      setOpen(false);
      setHelp(false);
      if (active) {
        onActiveChange(false);
        interact.current?.focus({ preventScroll: true });
      } else more.current?.focus({ preventScroll: true });
    };
    document.addEventListener('keydown', escape);
    return () => document.removeEventListener('keydown', escape);
  }, [active, open, onActiveChange, interact]);
  const control = (kind: ViewCommandKind, label: string) => (
    <Button key={kind} variant="outline" onClick={() => onCommand(kind)}>
      {label}
    </Button>
  );
  return (
    <div ref={host} className={styles.toolbarHost}>
      <div
        role="toolbar"
        aria-label="Room camera controls"
        className={styles.cameraToolbar}
      >
        <Button
          variant="outline"
          className={styles.iconButton}
          aria-label="Fit room"
          title="Fit room"
          onClick={(event) => {
            event.currentTarget.focus({ preventScroll: true });
            close(false);
            onCommand('fit');
          }}
        >
          <Maximize aria-hidden="true" size={19} />
        </Button>
        <Button
          variant="outline"
          className={styles.iconButton}
          aria-label="Center selected"
          title="Center selected"
          disabled={!canFocusSelected}
          onClick={(event) => {
            event.currentTarget.focus({ preventScroll: true });
            close(false);
            onRequestFocus();
          }}
        >
          <Focus aria-hidden="true" size={19} />
        </Button>
        <Button
          variant="outline"
          className={styles.iconButton}
          aria-label="Zoom out"
          title="Zoom out"
          onClick={() => onCommand('zoom-out')}
        >
          <Minus aria-hidden="true" size={19} />
        </Button>
        <Button
          variant="outline"
          className={styles.iconButton}
          aria-label="Zoom in"
          title="Zoom in"
          onClick={() => onCommand('zoom-in')}
        >
          <Plus aria-hidden="true" size={19} />
        </Button>
        <Button
          ref={interact}
          variant="outline"
          className={styles.iconButton}
          aria-label={
            active ? 'Done interacting with map' : 'Interact with map'
          }
          title={active ? 'Done interacting with map' : 'Interact with map'}
          aria-pressed={active}
          onClick={() => onActiveChange(!active)}
        >
          {active ? (
            <Check aria-hidden="true" size={19} />
          ) : (
            <MousePointer2 aria-hidden="true" size={19} />
          )}
        </Button>
        <Button
          ref={more}
          variant="outline"
          className={styles.iconButton}
          aria-label="More map controls"
          title="More map controls"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={() => {
            setOpen(!open);
            setHelp(false);
          }}
        >
          <MoreHorizontal aria-hidden="true" size={19} />
        </Button>
      </div>
      {open && (
        <div
          ref={panel}
          id={panelId}
          role="region"
          aria-label="More map controls"
          data-room-obstruction="true"
          className={styles.moreMenu}
        >
          <Button
            variant="outline"
            onClick={() => {
              close();
              onCommand('recenter');
            }}
          >
            Recenter
          </Button>
          <div
            role="group"
            aria-label="Orbit mode"
            className={styles.controlGroup}
          >
            {(['guided', 'free'] as const).map((value) => (
              <Button
                key={value}
                variant="outline"
                aria-pressed={mode === value}
                onClick={() => onModeChange(value)}
              >
                {value === 'guided' ? 'Guided' : 'Free Orbit'}
              </Button>
            ))}
          </div>
          <div role="group" aria-label="Pan" className={styles.panControls}>
            <span />
            {control('up', 'Pan up')}
            <span />
            {control('left', 'Pan left')}
            <span aria-hidden="true">Pan</span>
            {control('right', 'Pan right')}
            <span />
            {control('down', 'Pan down')}
            <span />
          </div>
          <div
            role="group"
            aria-label="Rotate"
            className={styles.secondaryControls}
          >
            {control('rotate-left', 'Rotate left')}
            {control('rotate-right', 'Rotate right')}
          </div>
          <div
            role="group"
            aria-label="Tilt"
            className={styles.secondaryControls}
          >
            {control('tilt-up', 'Tilt up')}
            {control('tilt-down', 'Tilt down')}
          </div>
          <Button
            variant="outline"
            aria-pressed={showLabels}
            onClick={onLabelsChange}
          >
            Show labels
          </Button>
          <Button
            variant="outline"
            aria-pressed={showCounts}
            onClick={onCountsChange}
          >
            Show item counts
          </Button>
          <Button
            variant="outline"
            aria-expanded={help}
            onClick={() => setHelp(!help)}
          >
            Controls
          </Button>
          {help && (
            <div className={styles.controlsHelp}>
              <p>
                Click or tap a location to select it. Outside Interact mode,
                scroll and swipe move the page.
              </p>
              <p>
                Choose Interact with map to rotate by dragging, or zoom with an
                ordinary wheel or direct two-finger pinch. Ctrl/Command+wheel
                and browser trackpad pinch remain browser zoom. Right-drag or
                the Pan buttons move the view. Done, Escape or leaving the map
                ends interaction.
              </p>
              <p>
                Guided limits rotation; Free Orbit also views above and below.
                Double-click exposed floor to recenter. Tab moves freely between
                controls and the map; Enter or Space activates a button. The
                location browser works without the map.
              </p>
              <p>
                Counts mark occupied visible locations. Focus or select a marker
                for its products, units and individual assets at that leaf
                location. Unknown counts are omitted. Hidden locations remain in
                the location browser.
              </p>
            </div>
          )}
          <Button variant="outline" onClick={() => close()}>
            Close controls
          </Button>
        </div>
      )}
    </div>
  );
}
