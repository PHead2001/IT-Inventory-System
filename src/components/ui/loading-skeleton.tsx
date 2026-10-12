'use client';

import { useEffect, useRef, type ReactNode, type RefObject } from 'react';
import { useEffectiveReducedMotion } from '@/components/experience/motion-preference';
import styles from './loading-skeleton.module.css';

export type LoadingShape =
  | 'rows'
  | 'queue-row'
  | 'files'
  | 'fields'
  | 'inventory'
  | 'history'
  | 'labels'
  | 'record'
  | 'form'
  | 'form-list'
  | 'designer'
  | 'room'
  | 'contents'
  | 'inspection'
  | 'occupancy';

function Block({ className = '' }: { className?: string }) {
  return <span className={`${styles.block} ${className}`} />;
}

function Rows({ count, files = false }: { count: number; files?: boolean }) {
  return Array.from({ length: count }, (_, index) => (
    <div key={index} className={files ? styles.fileRow : styles.row}>
      {files && <Block className={styles.thumbnail} />}
      <div className={styles.lines}>
        <Block className={styles.title} />
        <Block className={styles.description} />
        <Block className={styles.detail} />
      </div>
      <Block className={styles.action} />
    </div>
  ));
}

function Fields({ count }: { count: number }) {
  return (
    <div className={styles.fields}>
      {Array.from({ length: count }, (_, index) => (
        <div key={index} className={styles.lines}>
          <Block className={styles.detail} />
          <Block className={styles.input} />
        </div>
      ))}
    </div>
  );
}

/** Decorative geometry is separate from the single polite announcement. */
export function LoadingAnnouncement({
  label,
  active = true,
}: {
  label: string;
  active?: boolean;
}) {
  return (
    <p role="status" aria-live="polite" className="sr-only">
      {active ? label : ''}
    </p>
  );
}

export function LoadingSkeleton({
  label,
  shape = 'rows',
  rows = 3,
  className = '',
  announce = true,
}: {
  label: string;
  shape?: LoadingShape;
  rows?: number;
  className?: string;
  announce?: boolean;
}) {
  const reduced = useEffectiveReducedMotion();
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const update = () => {
      if (host.current)
        host.current.dataset.active = String(
          document.visibilityState === 'visible',
        );
    };
    update();
    document.addEventListener('visibilitychange', update);
    return () => document.removeEventListener('visibilitychange', update);
  }, []);
  const count = Math.max(1, Math.min(6, rows));
  const route = [
    'inventory',
    'history',
    'labels',
    'record',
    'form',
    'form-list',
    'designer',
  ].includes(shape);
  return (
    <div
      ref={host}
      className={`${styles.host} ${className}`}
      data-shimmer={!reduced}
      data-active="false"
      data-loading-shape={shape}
    >
      {announce && <LoadingAnnouncement label={label} />}
      <div aria-busy="true">
        <div aria-hidden="true" className={styles.layout}>
          {route && (
            <div className={styles.lines}>
              <Block className={styles.heading} />
              <Block className={styles.description} />
            </div>
          )}
          {(shape === 'inventory' || shape === 'history') && (
            <Fields count={3} />
          )}
          {shape === 'form' ? (
            <div className={styles.hero}>
              <Fields count={count} />
              <Block className={styles.action} />
            </div>
          ) : shape === 'form-list' ? (
            <div className={styles.columns}>
              <Rows count={count} />
            </div>
          ) : shape === 'designer' ? (
            <div className={styles.designer}>
              <div className={styles.lines}>
                <Rows count={2} />
              </div>
              <div className={styles.hero}>
                <Fields count={count} />
              </div>
              <Fields count={3} />
            </div>
          ) : shape === 'labels' ? (
            <div className={styles.columns}>
              <Fields count={3} />
              <div className={styles.paper}>
                <Rows count={2} />
              </div>
            </div>
          ) : shape === 'record' ? (
            <>
              <div className={styles.hero}>
                <Block className={styles.heading} />
                <Fields count={3} />
              </div>
              <Rows count={2} />
            </>
          ) : shape === 'room' ? (
            <div className={styles.room}>
              <Block className={styles.scene} />
              <div className={styles.lines}>
                <Rows count={3} />
              </div>
            </div>
          ) : shape === 'fields' || shape === 'inspection' ? (
            <Fields count={count} />
          ) : shape === 'queue-row' ? (
            <Block className={styles.description} />
          ) : shape === 'occupancy' ? (
            <Block className={styles.counter} />
          ) : (
            <Rows count={count} files={shape === 'files'} />
          )}
        </div>
      </div>
    </div>
  );
}

/** Fade resolved content without delaying it, moving it, or changing focus. */
export function LoadingReveal({
  busy,
  reveal = true,
  children,
  className = '',
  announcement,
  announcementActive = busy,
  motionReady = true,
}: {
  busy: boolean;
  reveal?: boolean;
  children: ReactNode;
  className?: string;
  announcement?: string;
  announcementActive?: boolean;
  motionReady?: boolean;
}) {
  const host = useRef<HTMLDivElement>(null);
  return (
    <>
      {announcement && (
        <LoadingAnnouncement label={announcement} active={announcementActive} />
      )}
      <div ref={host} className={className} aria-busy={busy}>
        {children}
      </div>
      {motionReady && <RevealMotion host={host} busy={busy} reveal={reveal} />}
    </>
  );
}

/** Motion admission does not change the host or remount its private children. */
function fullMotion() {
  return (
    document.documentElement.dataset.motion === 'full' &&
    typeof window.matchMedia === 'function' &&
    !window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

function feedbackTiming() {
  const style = getComputedStyle(document.documentElement);
  const time = /^([+-]?(?:\d+(?:\.\d+)?|\.\d+)(?:e[+-]?\d+)?)(ms|s)$/i.exec(
    style.getPropertyValue('--motion-feedback').trim(),
  );
  if (!time) return null;
  const duration = Number(time[1]) * (time[2].toLowerCase() === 's' ? 1000 : 1);
  if (!Number.isFinite(duration) || duration <= 0 || duration > 250)
    return null;
  const easing = style.getPropertyValue('--ease-workspace').trim();
  const number = '[+-]?(?:\\d+(?:\\.\\d+)?|\\.\\d+)(?:e[+-]?\\d+)?';
  const cubic = new RegExp(
    `^cubic-bezier\\(\\s*(${number})\\s*,\\s*(${number})\\s*,\\s*(${number})\\s*,\\s*(${number})\\s*\\)$`,
    'i',
  ).exec(easing);
  const validCubic =
    cubic &&
    cubic.slice(1).every((value) => Number.isFinite(Number(value))) &&
    Number(cubic[1]) >= 0 &&
    Number(cubic[1]) <= 1 &&
    Number(cubic[3]) >= 0 &&
    Number(cubic[3]) <= 1;
  if (
    !validCubic &&
    !/^(linear|ease|ease-in|ease-out|ease-in-out|step-start|step-end)$/.test(
      easing,
    )
  )
    return null;
  return { duration, easing };
}

function RevealMotion({
  host,
  busy,
  reveal,
}: {
  host: RefObject<HTMLDivElement | null>;
  busy: boolean;
  reveal: boolean;
}) {
  const wasBusy = useRef(busy);
  const animation = useRef<Animation | null>(null);
  useEffect(() => {
    animation.current?.cancel();
    animation.current = null;
    if (
      wasBusy.current &&
      !busy &&
      reveal &&
      fullMotion() &&
      document.visibilityState === 'visible' &&
      typeof host.current?.animate === 'function'
    ) {
      try {
        const timing = feedbackTiming();
        if (timing)
          animation.current = host.current.animate(
            [{ opacity: 0.65 }, { opacity: 1 }],
            timing,
          );
      } catch {
        // Unsupported timing/WAAPI leaves the already-resolved content static.
        animation.current = null;
      }
    }
    wasBusy.current = busy;
    return () => animation.current?.cancel();
  }, [busy, reveal, host]);
  useEffect(() => {
    const pause = () => {
      if (document.visibilityState !== 'visible' || !fullMotion()) {
        animation.current?.cancel();
        animation.current = null;
      }
    };
    const media =
      typeof window.matchMedia === 'function'
        ? window.matchMedia('(prefers-reduced-motion: reduce)')
        : null;
    const observer = new MutationObserver(pause);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-motion'],
    });
    media?.addEventListener('change', pause);
    document.addEventListener('visibilitychange', pause);
    return () => {
      observer.disconnect();
      media?.removeEventListener('change', pause);
      document.removeEventListener('visibilitychange', pause);
    };
  }, []);
  return null;
}
