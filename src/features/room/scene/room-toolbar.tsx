'use client';
import { useId, useRef, useState } from 'react';
import {
  Focus,
  Maximize,
  Minus,
  MoreHorizontal,
  MousePointer2,
  Plus,
  Tags,
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
}) {
  const [open, setOpen] = useState(false);
  const [help, setHelp] = useState(false);
  const more = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const close = () => {
    setOpen(false);
    setHelp(false);
    more.current?.focus();
  };
  const secondary: [ViewCommandKind, string][] = [
    ['recenter', 'Recenter'],
    ['left', 'Pan left'],
    ['right', 'Pan right'],
    ['up', 'Pan up'],
    ['down', 'Pan down'],
    ['rotate-left', 'Rotate left'],
    ['rotate-right', 'Rotate right'],
    ['tilt-up', 'Tilt up'],
    ['tilt-down', 'Tilt down'],
  ];
  return (
    <>
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
          aria-label="Show all labels"
          title="Show all labels"
          aria-pressed={showLabels}
          onClick={onLabelsChange}
        >
          <Tags aria-hidden="true" size={19} />
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
          variant="outline"
          className={`${styles.iconButton} ${styles.activationPrimary}`}
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
          id={panelId}
          role="region"
          aria-label="More map controls"
          className={styles.moreMenu}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.stopPropagation();
              onActiveChange(false);
              close();
            }
          }}
        >
          <Button
            variant="outline"
            className={styles.activationOverflow}
            aria-pressed={active}
            onClick={() => onActiveChange(!active)}
          >
            {active ? 'Done interacting with map' : 'Interact with map'}
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
          <div className={styles.secondaryControls}>
            {secondary.map(([kind, label]) => (
              <Button
                key={kind}
                variant="outline"
                onClick={() => onCommand(kind)}
              >
                {label}
              </Button>
            ))}
          </div>
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
                Click or tap a location to select it. Scroll normally over the
                map.
              </p>
              <p>
                Choose Interact with map to drag with one finger or the left
                mouse button to rotate. Pinch or use + and − to zoom. Right-drag
                or use the pan buttons to pan. Done, Escape or leaving the map
                ends interaction.
              </p>
              <p>
                Guided limits rotation; Free Orbit also views above and below.
                Double-click exposed floor to recenter. Every camera action has
                a keyboard button here; Tab moves between controls, and Enter or
                Space activates a button. The location browser works without the
                map.
              </p>
              <p>
                Item counts are active inventory entries at each destination:
                one per quantity item with positive stock and one per active
                individual asset. They do not add unrelated stock units.
                Unavailable counts are omitted.
              </p>
            </div>
          )}
          <Button variant="outline" onClick={close}>
            Close controls
          </Button>
        </div>
      )}
    </>
  );
}
