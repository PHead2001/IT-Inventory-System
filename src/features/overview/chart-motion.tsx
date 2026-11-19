'use client';

import { useRef, type ReactNode, type RefObject } from 'react';
import { animate } from 'motion/mini';
import { usePresentationAdmission } from '@/components/experience/presentation-admission';
import { feedbackEase } from '@/components/experience/feedback-motion';
import { guardRenderedMotion } from '@/components/experience/rendered-motion';

export const chartArrivalSeconds = 0.5;

/** Exact SVG geometry and daily tables render immediately, including SSR/Reduced.
 * Only admitted decorative marks receive a bounded reveal. */
export function ChartGraphic({
  children,
  identity,
}: {
  children: ReactNode;
  identity: string;
}) {
  const host = useRef<HTMLDivElement>(null);
  // Own admission beside the host ref so its layout effect sees the mounted div.
  // The mounted hook retains the withdrawal/reseed fence across privacy changes.
  useChartAnimation(host, identity);
  return (
    <div ref={host} data-overview-chart>
      {children}
    </div>
  );
}

function useChartAnimation(
  host: RefObject<HTMLDivElement | null>,
  identity: string,
) {
  const lastSnapshot = useRef<string | null>(null);
  usePresentationAdmission(
    host,
    identity,
    ({ animate: allowed, current }) => {
      // Admission may update when motion changes without new business data.
      // Reduced/readmitted snapshots seed comparison history without replay.
      const changed = lastSnapshot.current !== identity;
      lastSnapshot.current = identity;
      if (!allowed || !changed || !host.current) return;
      const marks = Array.from(
        host.current.querySelectorAll<SVGElement>('[data-chart-mark]'),
      );
      const effects = marks.flatMap((element) => {
        if (typeof element.animate !== 'function') return [];
        const original = {
          strokeDasharray: element.style.strokeDasharray,
          strokeDashoffset: element.style.strokeDashoffset,
          transform: element.style.transform,
          transformOrigin: element.style.transformOrigin,
          transformBox: element.style.transformBox,
        };
        const line = element.tagName.toLowerCase() === 'path';
        if (line) element.style.strokeDasharray = '1';
        else {
          element.style.transformBox = 'fill-box';
          element.style.transformOrigin = 'center bottom';
        }
        try {
          const animation = line
            ? animate(
                element,
                { strokeDashoffset: [1, 0] },
                { duration: chartArrivalSeconds, ease: feedbackEase() },
              )
            : animate(
                element,
                { transform: ['scaleY(0)', 'scaleY(1)'] },
                { duration: chartArrivalSeconds, ease: feedbackEase() },
              );
          return [
            {
              element,
              stop: () => {
                animation.cancel();
                Object.assign(element.style, original);
              },
            },
          ];
        } catch {
          Object.assign(element.style, original);
          return [];
        }
      });
      return guardRenderedMotion(effects, current, chartArrivalSeconds * 1000);
    },
    () => {},
  );
}
