'use client';
import { createContext, useContext } from 'react';
import styles from './room-visual.module.css';
export const CompactRoomContext = createContext<{
  code: string | null;
  label: string | null;
}>({ code: null, label: null });
/** Matches the compact toolbar, canvas and ordinary status footprint without actions. */
export function CompactRoomPlaceholder({
  bordered = false,
}: {
  bordered?: boolean;
}) {
  const { code, label } = useContext(CompactRoomContext);
  return (
    <div
      aria-busy="true"
      data-loading-shape="compact-room"
      className={bordered ? styles.compactLoadingBoundary : undefined}
    >
      <div aria-hidden="true" className={`${styles.scene} ${styles.compact}`}>
        <div className={styles.compactToolbarPlaceholder} />
        <div
          className={`${styles.canvasFrame} ${styles.compactCanvasPlaceholder}`}
        />
        <div className={styles.sceneMessages}>
          {label && (
            <p className={styles.sceneStatus}>
              Selected location: {label}
              {label !== code && ` (${code})`}
            </p>
          )}
          <p className={styles.compactCountStatus} />
          <p className={styles.sceneNote}>
            Map interaction off. Scroll moves the page.
          </p>
          {!code && (
            <p className={styles.sceneNote}>
              Select a location. Use More map controls for labels, counts and
              help.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
