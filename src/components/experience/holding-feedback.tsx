'use client';

import { animate } from 'motion/mini';
import { useCallback, useLayoutEffect, useRef, type ReactNode } from 'react';
import { useEffectiveReducedMotion } from './motion-preference';
import { useStrictPresentation } from './strict-presentation';
import { ListEntrance } from './list-feedback';
import { guardRenderedMotion, renderedPresentation } from './rendered-motion';

/** Current verified snapshot comparison; never an event or an attribution. */
export function changedHoldings(
  previous: Map<string, string> | null,
  current: { id: string; value: string }[],
) {
  return previous
    ? current
        .filter((row) => previous.get(row.id) !== row.value)
        .map((row) => row.id)
    : [];
}

/** One observer/authority subscription for the whole semantic list. */
export function HoldingSnapshotList({
  snapshot,
  children,
  className,
  entrance = false,
  scope = 'holdings',
}: {
  snapshot: { id: string; value: string }[];
  children: ReactNode;
  className?: string;
  entrance?: boolean;
  scope?: string;
}) {
  const host = useRef<HTMLUListElement>(null);
  const previous = useRef<Map<string, string> | null>(null);
  const stop = useRef<(() => void) | undefined>(undefined);
  const admission = useRef<() => boolean>(() => false);
  const key = JSON.stringify(snapshot);
  const withdraw = useCallback(() => {
    stop.current?.();
    stop.current = undefined;
    previous.current = null;
  }, []);
  // Re-admission can occur without a snapshot render/effect. Rebase statically
  // under the existing live grant, so the *next* change is not swallowed.
  const reseed = useCallback(() => {
    if (previous.current !== null || !admission.current()) return;
    const rows = JSON.parse(key) as { id: string; value: string }[];
    if (new Set(rows.map((row) => row.id)).size !== rows.length) return;
    previous.current = new Map(rows.map(({ id, value }) => [id, value]));
  }, [key]);
  const current = useStrictPresentation(
    host,
    'holding-snapshots:' + scope,
    withdraw,
    reseed,
  );
  useLayoutEffect(() => {
    admission.current = current;
    return () => {
      admission.current = () => false;
    };
  }, [current]);
  const reduced = useEffectiveReducedMotion();
  useLayoutEffect(() => {
    stop.current?.();
    stop.current = undefined;
    if (!current()) {
      previous.current = null;
      return;
    }
    const snapshot = JSON.parse(key) as { id: string; value: string }[];
    if (new Set(snapshot.map((row) => row.id)).size !== snapshot.length) {
      previous.current = null;
      return;
    }
    const changed = new Set(changedHoldings(previous.current, snapshot));
    previous.current = new Map(snapshot.map(({ id, value }) => [id, value]));
    if (
      reduced ||
      document.documentElement.dataset.motion !== 'full' ||
      !host.current
    )
      return;
    const entries: { element: Element; stop: () => void }[] = [];
    Array.from(host.current.children).forEach((row, index) => {
      if (!snapshot[index] || !changed.has(snapshot[index].id)) return;
      const pulse = row.querySelector<HTMLElement>('[data-holding-pulse]');
      if (
        !pulse ||
        typeof pulse.animate !== 'function' ||
        !renderedPresentation(pulse)
      )
        return;
      const opacity = pulse.style.opacity;
      const animation = animate(
        pulse,
        { opacity: [0, 0.65, 0] },
        { duration: 0.14 },
      );
      entries.push({
        element: pulse,
        stop: () => {
          animation.cancel();
          pulse.style.opacity = opacity;
        },
      });
    });
    stop.current = guardRenderedMotion(entries, current, 140);
    return () => {
      stop.current?.();
      stop.current = undefined;
    };
  }, [current, key, reduced]);
  if (entrance)
    return (
      <ListEntrance
        elementRef={host}
        identities={snapshot.map((row) => row.id)}
        className={className}
      >
        {children}
      </ListEntrance>
    );
  return (
    <ul ref={host} className={className}>
      {children}
    </ul>
  );
}
export function HoldingPulseGraphic() {
  return (
    <span
      data-holding-pulse
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 rounded opacity-0"
      style={{
        backgroundColor: 'color-mix(in srgb, var(--accent) 20%, transparent)',
      }}
    />
  );
}
export function HoldingFeedback({
  rows,
  className,
  rowClassName,
}: {
  rows: { id: string; value: string; content: ReactNode }[];
  className?: string;
  rowClassName?: string;
}) {
  return (
    <HoldingSnapshotList
      snapshot={rows.map(({ id, value }) => ({ id, value }))}
      className={className}
    >
      {rows.map((row) => (
        <li
          key={row.id}
          className={rowClassName}
          style={{ position: 'relative' }}
        >
          <HoldingPulseGraphic />
          {row.content}
        </li>
      ))}
    </HoldingSnapshotList>
  );
}
