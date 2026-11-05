'use client';

import { useEffect, useRef } from 'react';
import { useEffectiveReducedMotion } from './motion-preference';

export function AmbientLight({
  className = '',
  blueprint = false,
}: {
  className?: string;
  blueprint?: boolean;
}) {
  const reduced = useEffectiveReducedMotion();
  const host = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const element = host.current;
    if (!element) return;
    let inView = true;
    const update = () => {
      element.dataset.active = String(
        !reduced && inView && document.visibilityState === 'visible',
      );
    };
    const observer =
      typeof IntersectionObserver === 'undefined'
        ? null
        : new IntersectionObserver(([entry]) => {
            inView = entry.isIntersecting;
            update();
          });
    observer?.observe(element);
    document.addEventListener('visibilitychange', update);
    update();
    return () => {
      observer?.disconnect();
      document.removeEventListener('visibilitychange', update);
    };
  }, [reduced]);

  return (
    <span
      ref={host}
      aria-hidden="true"
      className={`experience-ambient ${className}`}
    >
      {blueprint && <span className="experience-blueprint" />}
    </span>
  );
}
