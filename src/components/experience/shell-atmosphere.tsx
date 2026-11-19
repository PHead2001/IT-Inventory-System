'use client';

import {
  useCallback,
  useInsertionEffect,
  useLayoutEffect,
  useRef,
  type ReactNode,
} from 'react';
import { usePathname } from 'next/navigation';
import { attachSurfaceEffects, surfaceTargetCurrent } from './surface-effects';
import { useStrictPresentation } from './strict-presentation';
import { useRouteMotion } from './route-motion';
import { observeRouteSnapshotWithdrawal } from './route-motion-state';

/** Decorative state has no route lease, record payload or business authority. */
export function ShellAtmosphere({
  children,
  actorId,
  backend,
}: {
  children: ReactNode;
  actorId: string;
  backend: string;
}) {
  const host = useRef<HTMLDivElement>(null);
  const effects = useRef<ReturnType<typeof attachSurfaceEffects> | null>(null);
  const withdraw = useCallback(() => effects.current?.withdraw(), []);
  const changed = useCallback(() => effects.current?.reconcile(), []);
  const admitted = useStrictPresentation(
    host,
    `${backend}:${actorId}`,
    withdraw,
    changed,
  );
  const route = useRouteMotion();
  const routeCurrent = useRef(route.validNow);
  useInsertionEffect(() => {
    routeCurrent.current = route.validNow;
  });
  // Route presentation can veto decorations after terminal action denial, but
  // cannot supply admission. The fresh original-binding grant remains required.
  const current = useCallback(
    () => admitted() && routeCurrent.current(),
    [admitted],
  );
  const pathname = usePathname();
  useLayoutEffect(() => {
    if (!host.current) return;
    const element = host.current;
    const controller = attachSurfaceEffects(
      element,
      (target) => current() && surfaceTargetCurrent(element, target),
    );
    effects.current = controller;
    const unbind = observeRouteSnapshotWithdrawal(() => {
      controller.withdraw();
      // A normal theme/capture cancellation can retain ambient presentation;
      // terminal route state and stale privacy still veto this reconciliation.
      controller.reconcile();
    });
    return () => {
      unbind();
      controller();
      effects.current = null;
    };
  }, [current]);
  return (
    <div
      ref={host}
      className="experience-app"
      data-room-atmosphere={pathname === '/room' || undefined}
    >
      <span
        aria-hidden="true"
        className="experience-ambient experience-ambient-shell"
        data-active="false"
      >
        <span className="experience-blueprint" />
      </span>
      {children}
    </div>
  );
}
