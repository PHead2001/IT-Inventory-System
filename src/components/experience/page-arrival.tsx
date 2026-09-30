'use client';

import { useEffect, useRef, useSyncExternalStore } from 'react';
import { usePathname } from 'next/navigation';
import { useEffectiveReducedMotion } from './motion-preference';

const subscribeHydration = () => () => {};
const clientReady = () => true;
const serverReady = () => false;

/** A persistent surface: the router continues to own and stream server children. */
export function PageArrival({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const reduced = useEffectiveReducedMotion();
  const hydrated = useSyncExternalStore(
    subscribeHydration,
    clientReady,
    serverReady,
  );
  const surface = useRef<HTMLDivElement>(null);
  const previousPath = useRef<string | null>(null);
  const animation = useRef<Animation | null>(null);

  useEffect(() => {
    // The server snapshot deliberately starts reduced. It is not the client's
    // actual choice and must not consume the first route arrival.
    if (!hydrated) return;
    if (reduced) {
      animation.current?.cancel();
      animation.current = null;
      previousPath.current = pathname;
      return;
    }
    if (!pathname || previousPath.current === pathname) return;
    previousPath.current = pathname;
    animation.current?.cancel();
    animation.current =
      typeof surface.current?.animate === 'function'
        ? surface.current.animate(
            [
              { opacity: 0.55, transform: 'translateY(12px)' },
              { opacity: 1, transform: 'translateY(0)' },
            ],
            { duration: 230, easing: 'cubic-bezier(.2,.8,.2,1)' },
          )
        : null;
  }, [pathname, reduced, hydrated]);

  useEffect(() => () => animation.current?.cancel(), []);

  return (
    <div ref={surface} className="experience-page-arrival">
      {children}
    </div>
  );
}
