'use client';
import { recordRoomDemand } from './room-demand-diagnostics';
import { useSceneCurrent } from './scene-current';
import { useFrame, useThree } from '@react-three/fiber';
import {
  useEffect,
  useCallback,
  useLayoutEffect,
  useRef,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { Group, Vector3 } from 'three';
import { useEffectiveReducedMotion } from '@/components/experience/motion-preference';
import type { RoomNode } from '../schema';
import { SCENE_EFFECTS } from './scene-effects-state';
import {
  useOptionalSceneEffects,
  useVisualHoverCode,
} from './scene-effects-context';

const fineHoverQuery = '(hover: hover) and (pointer: fine)';
function subscribeFineHover(listener: () => void) {
  const media =
    typeof window.matchMedia === 'function'
      ? window.matchMedia(fineHoverQuery)
      : null;
  media?.addEventListener('change', listener);
  return () => media?.removeEventListener('change', listener);
}
function fineHoverSnapshot() {
  return (
    typeof window.matchMedia === 'function' &&
    window.matchMedia(fineHoverQuery).matches
  );
}
export function useFineHoverPointer() {
  const isCurrent = useSceneCurrent();
  const subscribe = useCallback(
    (listener: () => void) =>
      subscribeFineHover(() => {
        if (isCurrent()) listener();
      }),
    [isCurrent],
  );
  return useSyncExternalStore(subscribe, fineHoverSnapshot, () => false);
}

/** Only this visual child lifts; measured parents, logical hitboxes and child nodes stay put. */
export function HoveredBody({
  node,
  children,
}: {
  node: RoomNode;
  children: ReactNode;
}) {
  const group = useRef<Group>(null);
  const motion = useRef<{
    from: Vector3;
    to: Vector3;
    started: number;
    finish: () => void;
  } | null>(null);
  const effects = useOptionalSceneEffects();
  const isCurrent = useSceneCurrent(effects);
  const hoveredCode = useVisualHoverCode();
  const fine = useFineHoverPointer();
  const reduced = useEffectiveReducedMotion();
  const { scene, invalidate } = useThree();
  const hovered =
    !!node.interaction?.selectable && node.locationCode === hoveredCode;
  useLayoutEffect(() => {
    if (!isCurrent() || !effects || !group.current) return;
    return effects.registerVisual(
      node.id,
      node.locationCode ?? null,
      group.current,
    );
  }, [effects, node.id, node.locationCode, isCurrent]);
  useEffect(() => {
    motion.current?.finish();
    motion.current = null;
    if (!isCurrent() || !group.current) return;
    const to = new Vector3(
      0,
      hovered && fine && !reduced
        ? SCENE_EFFECTS.hoverLiftInches * SCENE_EFFECTS.intensity
        : 0,
      0,
    );
    if (group.current.position.distanceToSquared(to) <= 1e-8) return;
    const finish =
      effects?.beginCasterMotion(`hover:${node.id}`, node.id, true) ??
      (() => {});
    if (reduced || !fine) {
      group.current.position.copy(to);
      scene.updateMatrixWorld(true);
      finish();
    } else {
      motion.current = {
        from: group.current.position.clone(),
        to,
        started: performance.now(),
        finish,
      };
    }
    recordRoomDemand(invalidate, 'hover-effect');
    invalidate();
  }, [effects, node.id, hovered, fine, reduced, scene, invalidate, isCurrent]);
  useEffect(
    () => () => {
      motion.current?.finish();
      motion.current = null;
    },
    [],
  );
  useFrame(() => {
    if (!isCurrent() || !group.current || !motion.current) return;
    const current = motion.current;
    const t = Math.min(
      1,
      (performance.now() - current.started) / SCENE_EFFECTS.hoverMs,
    );
    group.current.position.lerpVectors(
      current.from,
      current.to,
      1 - Math.pow(1 - t, 3),
    );
    scene.updateMatrixWorld(true);
    if (t === 1) {
      motion.current = null;
      current.finish();
    }
    recordRoomDemand(invalidate, 'hover-frame');
    invalidate();
  }, -1.9);
  return (
    <group ref={group} userData={{ roomHoverVisualNode: node.id }}>
      {children}
    </group>
  );
}
