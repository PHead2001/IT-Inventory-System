'use client';

import { animate } from 'motion/mini';
import {
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  type ReactNode,
  type RefObject,
} from 'react';
import { useStrictPresentation } from './strict-presentation';
import { useEffectiveReducedMotion } from './motion-preference';
import { guardRenderedMotion, renderedPresentation } from './rendered-motion';

/** Presentation memory only: one recent identity per fixed channel/task owner. */
export function createFeedbackOwner() {
  let active = true;
  const latest = new Map<string, string>();
  return {
    claim(channel: 'receipt' | 'pulse' | 'addition', id: string) {
      if (!active || latest.get(channel) === id) return false;
      latest.set(channel, id);
      return true;
    },
    activate() {
      active = true;
    },
    retire() {
      active = false;
    },
  };
}
export type FeedbackOwner = ReturnType<typeof createFeedbackOwner>;
export function useFeedbackOwner(actorKey = 'local') {
  const owner = useMemo(
    () => ({ actorKey, ...createFeedbackOwner() }),
    [actorKey],
  );
  useLayoutEffect(() => {
    owner.activate();
    return () => owner.retire();
  }, [owner]);
  return owner;
}

type Visual = 'receipt' | 'pulse' | 'addition';
function useSuccessVisual(
  host: RefObject<HTMLElement | SVGSVGElement | null>,
  id: string | undefined | null,
  owner: FeedbackOwner,
  kind: Visual,
  restored = false,
) {
  const stop = useRef<(() => void) | undefined>(undefined);
  const withdraw = useCallback(() => {
    stop.current?.();
    stop.current = undefined;
  }, []);
  const current = useStrictPresentation(host, 'confirmed-' + kind, withdraw);
  const reduced = useEffectiveReducedMotion();
  useLayoutEffect(() => {
    withdraw();
    // Claim even suppressed outcomes: revealing a hidden/Reduced result is not a new success.
    if (
      !id ||
      !owner.claim(kind, id) ||
      restored ||
      !current() ||
      reduced ||
      document.documentElement.dataset.motion !== 'full'
    )
      return;
    const node = host.current;
    if (!node || typeof node.animate !== 'function') return;
    const entries: { element: Element; stop: () => void }[] = [];
    const play = (
      element: HTMLElement | SVGElement,
      frames: Record<string, string[] | number[]>,
      duration: number,
      delay = 0,
    ) => {
      if (!renderedPresentation(element)) return;
      const transform = element.style.transform;
      const opacity = element.style.opacity;
      const control = animate(element, frames, { duration, delay });
      entries.push({
        element,
        stop: () => {
          control.cancel();
          element.style.transform = transform;
          element.style.opacity = opacity;
        },
      });
    };
    if (kind === 'receipt') {
      node
        .querySelectorAll<SVGElement>('[data-success-stroke]')
        .forEach((segment, index) =>
          play(
            segment,
            { transform: ['scaleX(0)', 'scaleX(1)'] },
            index ? 0.14 : 0.08,
            index ? 0.08 : 0,
          ),
        );
    } else if (kind === 'pulse') play(node, { opacity: [0, 0.65, 0] }, 0.14);
    else
      play(node, { transform: ['scale(1)', 'scale(1.08)', 'scale(1)'] }, 0.14);
    stop.current = guardRenderedMotion(
      entries,
      current,
      kind === 'receipt' ? 220 : 140,
    );
    return withdraw;
  }, [id, owner, kind, restored, current, reduced, host, withdraw]);
}

/** The SVG's two real strokes extend progressively; only transform is animated. */
export function ConfirmedSuccess({
  eventId,
  changed = true,
  restored = false,
  owner: suppliedOwner,
}: {
  eventId?: string;
  changed?: boolean;
  restored?: boolean;
  owner?: FeedbackOwner;
}) {
  const local = useFeedbackOwner();
  const ref = useRef<SVGSVGElement>(null);
  useSuccessVisual(
    ref,
    changed ? eventId : undefined,
    suppliedOwner ?? local,
    'receipt',
    restored,
  );
  if (!eventId || !changed) return null;
  return (
    <svg
      ref={ref}
      aria-hidden="true"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      style={{ color: 'var(--accent)' }}
      data-confirmed-success
    >
      <g transform="translate(5 12) rotate(45)">
        <g data-success-stroke style={{ transformOrigin: '0px 0px' }}>
          <path
            d="M0 0H5.657"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          />
        </g>
      </g>
      <g transform="translate(9 16) rotate(-45)">
        <g data-success-stroke style={{ transformOrigin: '0px 0px' }}>
          <path
            d="M0 0H14.142"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          />
        </g>
      </g>
    </svg>
  );
}

export function AddedBump({
  additionId,
  owner: suppliedOwner,
  children,
}: {
  additionId: string | null;
  owner?: FeedbackOwner;
  children: ReactNode;
}) {
  const local = useFeedbackOwner();
  const ref = useRef<HTMLSpanElement>(null);
  useSuccessVisual(ref, additionId, suppliedOwner ?? local, 'addition');
  return (
    <span ref={ref} className="inline-block" data-added-bump>
      {children}
    </span>
  );
}

export function ConfirmedPulse({
  eventId,
  restored = false,
  owner: suppliedOwner,
}: {
  eventId?: string;
  restored?: boolean;
  owner?: FeedbackOwner;
}) {
  const local = useFeedbackOwner();
  const ref = useRef<HTMLSpanElement>(null);
  useSuccessVisual(ref, eventId, suppliedOwner ?? local, 'pulse', restored);
  return (
    <span
      ref={ref}
      aria-hidden="true"
      data-holding-pulse
      className="pointer-events-none absolute inset-0 rounded opacity-0"
      style={{
        backgroundColor: 'color-mix(in srgb, var(--accent) 20%, transparent)',
      }}
    />
  );
}
