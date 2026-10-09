'use client';
import { Html } from '@react-three/drei';
import type { ComponentProps } from 'react';
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
  ...props
}: ComponentProps<typeof Html>) {
  const registry = useRoomLabelRegistry();
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
      style={{
        ...props.style,
        width: 'max-content',
        maxWidth: 'min(240px, calc(100vw - 80px))',
      }}
    >
      <LabelLayoutProvider registry={registry}>{children}</LabelLayoutProvider>
    </Html>
  );
}
