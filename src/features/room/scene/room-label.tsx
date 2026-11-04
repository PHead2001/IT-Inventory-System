'use client';
import { useEffect, useRef, useState } from 'react';
import { Boxes } from 'lucide-react';
import {
  occupiedLocation,
  occupancyText,
  type LocationOccupancy,
} from '../occupancy-contract';
import { useRoomLabelLayout } from './label-layout-runtime';
import type { LabelArea } from './label-layout';
import styles from '../room-visual.module.css';

export function RoomLabel({
  id,
  label,
  code,
  priority,
  selected = false,
  presentation,
  occupancy,
  isVisible,
  pickReservation,
  onSelect,
}: {
  id: string;
  label: string;
  code?: string;
  priority: number;
  selected?: boolean;
  presentation?: 'occupied-marker';
  occupancy?: LocationOccupancy;
  isVisible?: () => boolean;
  pickReservation?: () => LabelArea | null;
  onSelect?: (code: string) => void;
}) {
  const buttonElement = useRef<HTMLButtonElement>(null);
  const spanElement = useRef<HTMLSpanElement>(null);
  const leader = useRef<HTMLSpanElement>(null);
  const pointer = useRef<{ x: number; y: number } | null>(null);
  const register = useRoomLabelLayout();
  const [focused, setFocused] = useState(false);
  const [hovered, setHovered] = useState(false);
  const expanded = focused || hovered;
  const occupied = occupiedLocation(occupancy);
  const markerEligible =
    presentation === 'occupied-marker' && !!occupied && !selected;
  // Retain the existing full DOM action through its current focus/hover handoff.
  const retainedFull = markerEligible && expanded;
  const marker = markerEligible && !expanded;
  const interactive = !marker && !!code && !!onSelect;
  const counts =
    occupancy && (selected || occupied)
      ? occupancyText(occupancy, selected)
      : null;
  useEffect(() => {
    const element = interactive ? buttonElement.current : spanElement.current;
    if (!element || !leader.current) return;
    return register(id, element, leader.current, {
      priority: selected ? 4 : occupied ? 3 : priority,
      locationCode: code,
      presentation: marker ? 'occupied-marker' : undefined,
      interactive,
      mandatory: selected || !!occupied,
      compact: !!occupied && !selected && !retainedFull,
      preferFull: !marker && expanded,
      inspection: !marker
        ? focused
          ? 'focus'
          : hovered
            ? 'hover'
            : null
        : null,
      pointer: () => pointer.current,
      readableSummary: `${label}${code ? ` (${code})` : ''}${counts ? ` · ${counts}` : ''}`,
      isVisible,
      pickReservation,
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
    marker,
    retainedFull,
    expanded,
    focused,
    hovered,
    isVisible,
    pickReservation,
  ]);
  const content = (
    <span data-room-label-full="true" className={styles.labelFull}>
      {label}
      {counts !== null && <span className={styles.countBadge}>{counts}</span>}
    </span>
  );
  return (
    <div
      className={styles.labelAnchor}
      data-room-passive-wrapper={marker || undefined}
    >
      <span ref={leader} className={styles.labelLeader} aria-hidden="true" />
      {marker ? (
        <span
          ref={spanElement}
          className={styles.occupiedMarker}
          data-room-occupied-marker="true"
          data-room-occupied="true"
          data-room-label-code={code}
          data-room-representation-code={code}
          role="img"
          aria-label={`${label} (${code}) · Occupied${counts ? `; ${counts}` : ''}`}
          style={{ pointerEvents: 'none' }}
        >
          <Boxes size={22} aria-hidden="true" />
        </span>
      ) : interactive ? (
        <button
          ref={buttonElement}
          type="button"
          className={[styles.locationLabel, selected && styles.selectedLabel]
            .filter(Boolean)
            .join(' ')}
          data-location-code={code}
          data-room-label-code={code}
          data-room-representation-code={code}
          aria-label={`Select ${label} (${code})${counts !== null ? `; ${counts} at this location` : ''}`}
          aria-pressed={selected}
          data-room-occupied={!!occupied}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onPointerEnter={(event) => {
            if (event.nativeEvent.isTrusted)
              pointer.current = { x: event.clientX, y: event.clientY };
            setHovered(true);
          }}
          onPointerMove={(event) => {
            if (event.nativeEvent.isTrusted)
              pointer.current = { x: event.clientX, y: event.clientY };
          }}
          onPointerLeave={() => {
            pointer.current = null;
            setHovered(false);
          }}
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
          ref={spanElement}
          className={[styles.decorativeLabel, selected && styles.selectedLabel]
            .filter(Boolean)
            .join(' ')}
          data-room-decorative-label="true"
          data-room-representation-code={code}
        >
          {content}
        </span>
      )}
    </div>
  );
}
