'use client';
import { useEffect, useId, useRef, useState, type RefObject } from 'react';
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
  const close = (restore = true) => {
    setOpen(false);
    setHelp(false);
    if (restore) more.current?.focus({ preventScroll: true });
  };
  useEffect(() => {
    onOverlayChange?.();
    if (!open) return;
    panel.current
      ?.querySelector<HTMLButtonElement>('button')
      ?.focus({ preventScroll: true });
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
    return () => document.removeEventListener('pointerdown', outside, true);
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
          onClick={() => onCommand('fit')}
        >
          <Maximize aria-hidden="true" size={19} />
        </Button>
        <Button
          variant="outline"
          className={styles.iconButton}
          aria-label="Center selected"
          title="Center selected"
          disabled={!canFocusSelected}
          onClick={onRequestFocus}
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
          {control('recenter', 'Recenter')}
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
