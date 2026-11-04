'use client';
import { Html } from '@react-three/drei';
import { useThree } from '@react-three/fiber';
import type { ComponentProps, CSSProperties } from 'react';
import styles from '../room-visual.module.css';
import {
  LabelLayoutProvider,
  useRoomLabelRegistry,
} from './label-layout-runtime';

/** Drei Html renders children in an independent React DOM root. Capture the
 * scene registry before that boundary and explicitly provide it inside it.
 */
export function RoomLabelHtml({
  children,
  wrapperClass,
  selected = false,
  ...props
}: ComponentProps<typeof Html> & { selected?: boolean }) {
  const registry = useRoomLabelRegistry();
  const canvasWidth = useThree((state) => state.size.width);
  // R3F size is the actual canvas CSS box, independent of device pixel ratio.
  // Keep 15px per side where possible and the original 44px action minimum.
  const selectedWidth = Math.max(
    44,
    Math.min(298, (Number.isFinite(canvasWidth) ? canvasWidth : 0) - 30),
  );
  const labelStyle = {
    ...props.style,
    width: 'max-content',
    maxWidth: selected
      ? selectedWidth + 'px'
      : 'min(240px, calc(100vw - 80px))',
    ...(selected
      ? {
          '--room-selected-label-width': selectedWidth + 'px',
          // Existing inline padding (16px) and border (2px) remain unchanged.
          '--room-selected-label-text-width': selectedWidth - 18 + 'px',
        }
      : {}),
  } as CSSProperties;
  return (
    <Html
      {...props}
      wrapperClass={[styles.labelProjection, wrapperClass]
        .filter(Boolean)
        .join(' ')}
      // Orbit can change occluders while a selected label stays at the same
      // projected pixel. Recheck occlusion on every demanded frame; this does
      // not request frames or change genuine opaque-furniture occlusion.
      eps={-1}
      style={labelStyle}
    >
      <LabelLayoutProvider registry={registry}>{children}</LabelLayoutProvider>
    </Html>
  );
}
