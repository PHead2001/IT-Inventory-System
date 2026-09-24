/* eslint-disable react-hooks/immutability -- Canvas pointer telemetry and raycasting are imperative graphics operations. */
'use client';
import { useFrame, useThree } from '@react-three/fiber';
import { useCallback, useEffect, useRef } from 'react';
import { Raycaster, Vector2 } from 'three';
import { visibleRoomTarget, type VisibleRoomTarget } from './visible-hover';

export type VisibleHover = {
  target: VisibleRoomTarget;
  x: number;
  y: number;
  width: number;
  height: number;
  needsTooltip: boolean;
};

function anchoredLabelUsable(host: HTMLElement, code: string) {
  const button = Array.from(
    host.querySelectorAll<HTMLButtonElement>('[data-room-label-code]'),
  ).find((candidate) => candidate.dataset.roomLabelCode === code);
  if (!button || button.dataset.labelSuppressed === 'true') return false;
  for (
    let parent: HTMLElement | null = button;
    parent;
    parent = parent.parentElement
  )
    if (parent.style.display === 'none' || parent.style.visibility === 'hidden')
      return false;
  const rect = button.getBoundingClientRect();
  if (!rect.width || !rect.height) return false;
  const onTop = document.elementFromPoint(
    rect.left + rect.width / 2,
    rect.top + rect.height / 2,
  );
  return !!onTop && button.contains(onTop);
}

/** Scene-facing picking stays separate from the screen-space DOM tooltip. */
export function VisibleHoverTracker({
  showAllLabels,
  retainDuringLabelHandoff,
  onHit,
  onCanvasLeave,
}: {
  showAllLabels: boolean;
  retainDuringLabelHandoff: boolean;
  onHit: (hit: VisibleHover | null) => void;
  onCanvasLeave: () => void;
}) {
  const { camera, gl, scene, invalidate } = useThree();
  const raycaster = useRef(new Raycaster());
  const ndc = useRef(new Vector2());
  const pointer = useRef({
    clientX: 0,
    clientY: 0,
    inside: false,
    known: false,
  });
  const sample = useCallback(() => {
    if (!pointer.current.known) return;
    if (!pointer.current.inside && !retainDuringLabelHandoff) return;
    const canvas = gl.domElement;
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const x = pointer.current.clientX - rect.left;
    const y = pointer.current.clientY - rect.top;
    if (x < 0 || y < 0 || x > rect.width || y > rect.height) {
      canvas.dataset.hoverVisibleCode = '';
      onHit(null);
      return;
    }
    ndc.current.set((x / rect.width) * 2 - 1, 1 - (y / rect.height) * 2);
    raycaster.current.setFromCamera(ndc.current, camera);
    const target = visibleRoomTarget(
      raycaster.current.intersectObjects(scene.children, true),
    );
    canvas.dataset.hoverVisibleCode = target?.code ?? '';
    onHit(
      target
        ? {
            target,
            x,
            y,
            width: rect.width,
            height: rect.height,
            needsTooltip:
              !showAllLabels ||
              !canvas.parentElement ||
              !anchoredLabelUsable(canvas.parentElement, target.code),
          }
        : null,
    );
  }, [camera, gl, scene, onHit, retainDuringLabelHandoff, showAllLabels]);
  useEffect(() => {
    const canvas = gl.domElement;
    const move = (event: PointerEvent) => {
      if (event.pointerType === 'touch') return;
      pointer.current = {
        clientX: event.clientX,
        clientY: event.clientY,
        inside: true,
        known: true,
      };
      sample();
      invalidate();
    };
    const leave = () => {
      pointer.current.inside = false;
      onCanvasLeave();
    };
    canvas.addEventListener('pointerenter', move);
    canvas.addEventListener('pointermove', move);
    canvas.addEventListener('pointerleave', leave);
    return () => {
      canvas.removeEventListener('pointerenter', move);
      canvas.removeEventListener('pointermove', move);
      canvas.removeEventListener('pointerleave', leave);
      delete canvas.dataset.hoverVisibleCode;
    };
  }, [gl, invalidate, onCanvasLeave, sample]);
  // OrbitControls and the focus rig invalidate demand frames even if the pointer
  // stays motionless. Recheck the visible surface after each camera update.
  useFrame(sample);
  return null;
}
