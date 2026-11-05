'use client';

import { useEffect, useRef, type ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import { AmbientLight } from './ambient-light';
import { attachSurfaceEffects } from './surface-effects';

export function ShellAtmosphere({ children }: { children: ReactNode }) {
  const host = useRef<HTMLDivElement>(null);
  const pathname = usePathname();
  useEffect(() => {
    if (host.current) return attachSurfaceEffects(host.current);
  }, []);
  return (
    <div
      ref={host}
      className="experience-app"
      data-room-atmosphere={pathname === '/room' || undefined}
    >
      <AmbientLight className="experience-ambient-shell" blueprint />
      {children}
    </div>
  );
}
