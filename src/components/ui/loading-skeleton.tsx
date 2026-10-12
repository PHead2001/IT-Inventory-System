'use client';

import { useEffect, useRef, type ReactNode } from 'react';
import { useEffectiveReducedMotion } from '@/components/experience/motion-preference';
import styles from './loading-skeleton.module.css';

export type LoadingShape =
  | 'rows'
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
}: {
  busy: boolean;
  reveal?: boolean;
  children: ReactNode;
  className?: string;
  announcement?: string;
  announcementActive?: boolean;
}) {
  const reduced = useEffectiveReducedMotion();
  const host = useRef<HTMLDivElement>(null);
  const wasBusy = useRef(busy);
  const animation = useRef<Animation | null>(null);
  useEffect(() => {
    animation.current?.cancel();
    animation.current = null;
    if (
      wasBusy.current &&
      !busy &&
      reveal &&
      !reduced &&
      document.visibilityState === 'visible' &&
      typeof host.current?.animate === 'function'
    )
      animation.current = host.current.animate(
        [{ opacity: 0.65 }, { opacity: 1 }],
        { duration: 130, easing: 'ease-out' },
      );
    wasBusy.current = busy;
    return () => animation.current?.cancel();
  }, [busy, reduced, reveal]);
  useEffect(() => {
    const pause = () => {
      if (document.visibilityState !== 'visible') {
        animation.current?.cancel();
        animation.current = null;
      }
    };
    document.addEventListener('visibilitychange', pause);
    return () => document.removeEventListener('visibilitychange', pause);
  }, []);
  return (
    <>
      {announcement && (
        <LoadingAnnouncement label={announcement} active={announcementActive} />
      )}
      <div ref={host} className={className} aria-busy={busy}>
        {children}
      </div>
    </>
  );
}
