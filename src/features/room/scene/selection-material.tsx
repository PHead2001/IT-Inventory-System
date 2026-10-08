'use client';
import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import { Color, MeshStandardMaterial } from 'three';
import { useEffectiveReducedMotion } from '@/components/experience/motion-preference';
import { useScenePalette } from './scene-palette';

export function SelectionMaterial({
  color,
  opacity = 1,
  selected,
  dimmed,
  hovered,
}: {
  color: string;
  opacity?: number;
  selected: boolean;
  dimmed: boolean;
  hovered: boolean;
}) {
  const material = useRef<MeshStandardMaterial>(null);
  const pulse = useRef<number | null>(null);
  const reduced = useEffectiveReducedMotion();
  const palette = useScenePalette();
  const { invalidate, gl } = useThree();
  const physicalColor = useMemo(
    () => new Color(color).multiplyScalar(dimmed ? 0.72 : 1),
    [color, dimmed],
  );
  const baseEmissive = selected ? 0.18 : hovered ? 0.08 : 0;
  useEffect(() => {
    pulse.current = selected && !reduced ? performance.now() : null;
    if (material.current) material.current.emissiveIntensity = baseEmissive;
    invalidate();
  }, [selected, reduced, baseEmissive, invalidate]);
  useFrame(() => {
    if (pulse.current === null || !material.current) return;
    const viewport = gl.domElement.getBoundingClientRect();
    if (
      document.visibilityState === 'hidden' ||
      viewport.bottom <= 0 ||
      viewport.top >= window.innerHeight
    ) {
      pulse.current = null;
      material.current.emissiveIntensity = baseEmissive;
      return;
    }
    const t = Math.min(1, (performance.now() - pulse.current) / 600);
    material.current.emissiveIntensity =
      baseEmissive + Math.sin(t * Math.PI) * 0.28;
    if (t === 1) pulse.current = null;
    else invalidate();
  });
  return (
    <meshStandardMaterial
      ref={material}
      color={physicalColor}
      emissive={palette.selectionEmissive}
      emissiveIntensity={baseEmissive}
      roughness={0.8}
      transparent={opacity < 1}
      opacity={opacity}
    />
  );
}
