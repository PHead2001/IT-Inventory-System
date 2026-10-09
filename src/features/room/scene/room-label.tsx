'use client';
import { useEffect, useRef, useState } from 'react';
import { Boxes } from 'lucide-react';
import {
  occupiedLocation,
  occupancyText,
  type LocationOccupancy,
} from '../occupancy-contract';
import { useRoomLabelLayout } from './label-layout-runtime';
import styles from '../room-visual.module.css';

export function RoomLabel({
  id,
  label,
  code,
  priority,
  selected = false,
  occupancy,
  isVisible,
  onSelect,
}: {
  id: string;
  label: string;
  code?: string;
  priority: number;
  selected?: boolean;
  occupancy?: LocationOccupancy;
  isVisible?: () => boolean;
  onSelect?: (code: string) => void;
}) {
  const element = useRef<HTMLButtonElement & HTMLSpanElement>(null);
  const leader = useRef<HTMLSpanElement>(null);
  const register = useRoomLabelLayout();
  const interactive = !!code && !!onSelect;
  const occupied = occupiedLocation(occupancy);
  const counts = occupied ? occupancyText(occupied) : null;
  const [focused, setFocused] = useState(false);
  const [hovered, setHovered] = useState(false);
  const expanded = focused || hovered;
  useEffect(() => {
    if (!element.current || !leader.current) return;
    return register(id, element.current, leader.current, {
      priority: selected ? 4 : occupied ? 3 : priority,
      locationCode: code,
      interactive,
      mandatory: selected || !!occupied,
      compact: !!occupied && !selected,
      preferFull: expanded,
      inspection: focused ? 'focus' : hovered ? 'hover' : null,
      readableSummary: `${label}${code ? ` (${code})` : ''}${counts ? ` · ${counts}` : ''}`,
      isVisible,
    });
  }, [
    register,
    id,
    priority,
    code,
    interactive,
    label,
    counts,
    occupied,
    selected,
    expanded,
    focused,
    hovered,
    isVisible,
  ]);
  const content = (
    <span data-room-label-full="true" className={styles.labelFull}>
      {label}
      {counts !== null && (
        <span className={styles.countBadge}> · {counts}</span>
      )}
    </span>
  );
  return (
    <div className={styles.labelAnchor}>
      <span ref={leader} className={styles.labelLeader} aria-hidden="true" />
      {interactive ? (
        <button
          ref={element}
          type="button"
          className={styles.locationLabel}
          data-location-code={code}
          data-room-label-code={code}
          aria-label={`Select ${label} (${code})${counts !== null ? `; ${counts} at this location` : ''}`}
          aria-pressed={selected}
          data-room-occupied={!!occupied}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onPointerEnter={() => setHovered(true)}
          onPointerLeave={() => setHovered(false)}
          onClick={(event) => {
            event.stopPropagation();
            onSelect?.(code!);
          }}
          onDoubleClick={(event) => event.stopPropagation()}
        >
          {content}
          {occupied && (
            <span className={styles.labelCompact} aria-hidden="true">
              <Boxes size={22} />
            </span>
          )}
        </button>
      ) : (
        <span
          ref={element}
          className={styles.decorativeLabel}
          data-room-decorative-label="true"
        >
          {content}
        </span>
      )}
    </div>
  );
}
