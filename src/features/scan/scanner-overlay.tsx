'use client';
import { scanReducedMotionNow } from '@/components/experience/scan-feedback';
import { useEffectiveReducedMotion } from '@/components/experience/motion-preference';
import {
  useStrictPresentation,
  strictPresentationCurrent,
} from '@/components/experience/strict-presentation';
import { usePrivacyReadiness } from '@/components/auth/privacy-readiness';
import {
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject,
} from 'react';
import {
  projectDecoderGeometry,
  type DecoderGeometry,
} from './decoder-geometry';
import styles from './scanner-overlay.module.css';

export type ScanVisualState =
  'searching' | 'locked' | 'inspecting' | 'resolved' | 'error';
export const DECODE_LOCK_MS = 130;
// A decorative lease only. Reads, errors, cancellation and focus never wait.
export function useDecodedLock() {
  const [locked, setLocked] = useState(false);
  const live = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clear = useCallback(() => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
  }, []);
  const cancel = useCallback(() => {
    clear();
    if (live.current) setLocked(false);
  }, [clear]);
  const begin = useCallback(() => {
    clear();
    if (!live.current || document.hidden || scanReducedMotionNow()) {
      if (live.current) setLocked(false);
      return;
    }
    setLocked(true);
    timer.current = setTimeout(() => {
      timer.current = null;
      setLocked(false);
    }, DECODE_LOCK_MS);
  }, [clear]);
  useLayoutEffect(() => {
    live.current = true;
    const reconcile = () => {
      if (live.current && (document.hidden || scanReducedMotionNow())) cancel();
    };
    const observer = new MutationObserver(reconcile);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-motion'],
    });
    const media =
      typeof window.matchMedia === 'function'
        ? window.matchMedia('(prefers-reduced-motion: reduce)')
        : null;
    media?.addEventListener('change', reconcile);
    document.addEventListener('visibilitychange', reconcile);
    window.addEventListener('pagehide', cancel);
    return () => {
      live.current = false;
      clear();
      observer.disconnect();
      media?.removeEventListener('change', reconcile);
      document.removeEventListener('visibilitychange', reconcile);
      window.removeEventListener('pagehide', cancel);
    };
  }, [clear, cancel]);
  return { locked, begin, cancel };
}
export function ScannerOverlay({
  state,
  geometry,
  video,
  announce = true,
}: {
  state: ScanVisualState;
  geometry?: DecoderGeometry | null;
  video: RefObject<HTMLVideoElement | null>;
  announce?: boolean;
}) {
  const host = useRef<HTMLDivElement>(null);
  const reduced = useEffectiveReducedMotion();
  const [present, setPresent] = useState(false);
  const privacy = usePrivacyReadiness();
  useStrictPresentation(
    host,
    'scanner-overlay',
    () => {
      // Withdraw CSS effects synchronously, before React can commit a later render.
      host.current?.setAttribute('data-current', 'false');
      setPresent(false);
    },
    () => setPresent(strictPresentationCurrent(privacy, host.current)),
  );
  const [box, setBox] = useState({ width: 0, height: 0 });
  useLayoutEffect(() => {
    const node = video.current;
    if (!node) return;
    const measure = () => {
      const { width, height } = node.getBoundingClientRect();
      setBox((old) =>
        old.width === width && old.height === height ? old : { width, height },
      );
    };
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    measure();
    return () => observer.disconnect();
  }, [video]);
  const projected = geometry
    ? projectDecoderGeometry(geometry, {
        ...box,
        fit: 'contain',
        mirrored: false,
      })
    : null;
  const points = projected?.points ?? [];
  const outline =
    state !== 'searching' && projected?.corners && points.length === 4;
  const left = outline ? Math.min(...points.map((point) => point.x)) : 22;
  const right = outline ? Math.max(...points.map((point) => point.x)) : 78;
  const top = outline ? Math.min(...points.map((point) => point.y)) : 22;
  const bottom = outline ? Math.max(...points.map((point) => point.y)) : 78;
  const arm = Math.min((right - left) / 4, (bottom - top) / 4, 13);
  const frame = `M${left} ${top + arm}V${top}H${left + arm} M${right - arm} ${top}H${right}V${top + arm} M${right} ${bottom - arm}V${bottom}H${right - arm} M${left + arm} ${bottom}H${left}V${bottom - arm}`;
  const labels = {
    searching: 'Searching for a label…',
    locked: 'Label decoded',
    inspecting: 'Inspecting equipment…',
    resolved: 'Label decoded · review the result',
    error: 'Check the scan message below',
  };
  // Only jsQR's actual four corners form a polygon. ZXing landmarks remain dots/line.
  return (
    <div
      ref={host}
      className={styles.overlay}
      data-state={state}
      data-reduced={reduced}
      data-current={present}
    >
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
        <path d={frame} className={styles.frame} />
        {state !== 'searching' && points.length > 0 && (
          <g className={styles.decoded}>
            {projected?.corners && points.length === 4 ? (
              <polygon
                points={points
                  .map((point) => `${point.x},${point.y}`)
                  .join(' ')}
              />
            ) : points.length === 2 ? (
              <line
                x1={points[0].x}
                y1={points[0].y}
                x2={points[1].x}
                y2={points[1].y}
              />
            ) : (
              points.map((point, i) => (
                <circle key={i} cx={point.x} cy={point.y} r="1" />
              ))
            )}
          </g>
        )}
      </svg>
      {state === 'searching' && (
        <span className={styles.laser} aria-hidden="true" />
      )}
      <span
        role={announce && present ? 'status' : undefined}
        className={styles.status}
      >
        {labels[state]}
      </span>
    </div>
  );
}
