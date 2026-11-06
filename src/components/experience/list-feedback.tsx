'use client';

import { animate } from 'motion/mini';
import { useRef, type HTMLAttributes, type RefObject } from 'react';
import { usePresentationAdmission } from './presentation-admission';
import { feedbackEase } from './feedback-motion';
import { renderedPresentation, guardRenderedMotion } from './rendered-motion';

export const listArrival = { duration: 0.1, stagger: 0.03, limit: 10 };

/** Retain only the preceding visible identities, never a session-long registry. */
export function newListIdentities(previous: Set<string>, current: string[]) {
  return current.slice(0, listArrival.limit).filter((id) => !previous.has(id));
}

export function ListEntrance({
  as: Tag = 'ul',
  identities,
  pending = false,
  elementRef,
  children,
  ...props
}: HTMLAttributes<HTMLElement> & {
  as?: 'ul' | 'ol' | 'div' | 'dl';
  identities: string[];
  pending?: boolean;
  elementRef?: RefObject<HTMLElement | null>;
}) {
  const ref = useRef<HTMLElement>(null);
  const previous = useRef(new Set<string>());
  const identityKey = JSON.stringify(identities);
  usePresentationAdmission(
    ref,
    JSON.stringify([identityKey, pending]),
    ({ animate: allowed, current: admittedNow }) => {
      if (pending) return;
      const current = JSON.parse(identityKey) as string[];
      const arriving = newListIdentities(previous.current, current);
      previous.current = new Set(current);
      if (!allowed || !ref.current) return;
      const animations = arriving.flatMap((id, index) => {
        const child = ref.current?.children[current.indexOf(id)];
        if (
          !(child instanceof HTMLElement) ||
          typeof child.animate !== 'function' ||
          !renderedPresentation(child)
        )
          return [];
        const original = {
          opacity: child.style.opacity,
          transform: child.style.transform,
        };
        const animation = animate(
          child,
          {
            opacity: [0, 1],
            transform: ['translateY(8px)', 'translateY(0px)'],
          },
          {
            duration: listArrival.duration,
            delay: index * listArrival.stagger,
            ease: feedbackEase(),
          },
        );
        return [
          {
            element: child,
            stop: () => {
              animation.cancel();
              Object.assign(child.style, original);
            },
          },
        ];
      });
      return guardRenderedMotion(
        animations,
        admittedNow,
        (listArrival.duration +
          Math.max(0, arriving.length - 1) * listArrival.stagger) *
          1000,
      );
    },
    () => {
      previous.current = new Set();
    },
    undefined,
    !pending,
  );
  // Content is visible before JS and while Reduced is active.
  return (
    <Tag
      {...props}
      ref={(node: HTMLElement | null) => {
        ref.current = node;
        if (elementRef) elementRef.current = node;
      }}
    >
      {children}
    </Tag>
  );
}
