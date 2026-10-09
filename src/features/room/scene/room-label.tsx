'use client';
import { useEffect, useRef } from 'react';
import { useRoomLabelLayout } from './label-layout-runtime';
import styles from '../room-visual.module.css';

export function knownOccupiedCount(count: string | undefined) {
  return count !== undefined && /^[1-9][0-9]*$/.test(count) ? count : null;
}
export function RoomLabel({
  id,
  label,
  code,
  priority,
  selected = false,
  count,
  onSelect,
}: {
  id: string;
  label: string;
  code?: string;
  priority: number;
  selected?: boolean;
  count?: string;
  onSelect?: (code: string) => void;
}) {
  const element = useRef<HTMLButtonElement & HTMLSpanElement>(null);
  const leader = useRef<HTMLSpanElement>(null);
  const register = useRoomLabelLayout();
  const interactive = !!code && !!onSelect;
  const occupied = knownOccupiedCount(count);
  useEffect(() => {
    if (!element.current || !leader.current) return;
    return register(id, element.current, leader.current, {
      priority,
      locationCode: code,
      interactive,
    });
  }, [register, id, priority, code, interactive, label, occupied]);
  const content = (
    <>
      {label}
      {occupied !== null && (
        <span className={styles.countBadge}>
          {' '}
          · {occupied} {occupied === '1' ? 'item' : 'items'}
        </span>
      )}
    </>
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
          aria-label={`Select ${label} (${code})${occupied !== null ? `; ${occupied} active inventory entries: positive-stock quantity items and active individual assets at this destination` : ''}`}
          aria-pressed={selected}
          onClick={(event) => {
            event.stopPropagation();
            onSelect?.(code!);
          }}
          onDoubleClick={(event) => event.stopPropagation()}
        >
          {content}
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
