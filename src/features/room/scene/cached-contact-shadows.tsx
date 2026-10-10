/* eslint-disable react-hooks/immutability -- Owned WebGL capture and receiver lifetime boundary. */
'use client';
import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useRef } from 'react';
import { DoubleSide, Mesh, type MeshBasicMaterial } from 'three';
import type { RoomDefinition } from '../schema';
import { createContactCapture, type ContactCapture } from './contact-capture';
import { useSceneEffects } from './scene-effects-context';
import {
  contactCacheKey,
  SCENE_EFFECTS,
  type EffectsQuality,
} from './scene-effects-state';
import { useScenePalette, useScenePaletteRevision } from './scene-palette';

export function CachedContactShadows({
  room,
  quality,
}: {
  room: RoomDefinition;
  quality: EffectsQuality;
}) {
  const { gl, scene, invalidate } = useThree();
  const effects = useSceneEffects();
  const palette = useScenePalette();
  const paletteRevision = useScenePaletteRevision();
  const receiver = useRef<Mesh>(null);
  const material = useRef<MeshBasicMaterial>(null);
  const resources = useRef<ContactCapture | null>(null);
  const cachedKey = useRef<string | null>(null);
  const failed = useRef(false);
  const readyFrames = useRef(0);
  const [width, depth, height] = room.dimensions;
  useEffect(() => {
    const ownedReceiver = receiver.current;
    failed.current = false;
    cachedKey.current = null;
    readyFrames.current = 0;
    if (quality === 'off') return;
    let owned: ContactCapture | null = null;
    try {
      owned = createContactCapture(
        width,
        depth,
        height,
        SCENE_EFFECTS.shadowResolution,
      );
      resources.current = owned;
      if (material.current) {
        material.current.map = owned.texture;
        material.current.needsUpdate = true;
      }
      invalidate();
    } catch {
      failed.current = true;
      gl.domElement.dataset.contactStatus = 'allocation-failed';
    }
    return () => {
      if (resources.current === owned) {
        resources.current = null;
        owned?.dispose();
      }
      if (ownedReceiver) ownedReceiver.visible = false;
    };
  }, [width, depth, height, quality, gl, invalidate]);
  useEffect(
    () =>
      effects.subscribe(() => {
        if (effects.getSnapshot().casterMotions > 0 && receiver.current)
          receiver.current.visible = false;
      }),
    [effects],
  );
  useEffect(() => {
    if (receiver.current) receiver.current.visible = false;
    invalidate();
  }, [paletteRevision, quality, invalidate]);
  useFrame(() => {
    if (!receiver.current) return;
    const state = effects.getSnapshot();
    const key = contactCacheKey(effects, paletteRevision, quality);
    if (quality === 'off' || state.casterMotions > 0 || failed.current) {
      receiver.current.visible = false;
      gl.domElement.dataset.contactStatus =
        quality === 'off' ? 'off' : failed.current ? 'failed' : 'moving';
      return;
    }
    if (cachedKey.current === key) return;
    // Wait for the furniture commit and one normal scene frame, never an idle probe.
    if (++readyFrames.current < 2) {
      invalidate();
      return;
    }
    if (!resources.current || !effects.getCasters().length) return;
    const started = performance.now();
    try {
      scene.updateMatrixWorld(true);
      resources.current.capture(
        gl,
        effects.getCasters(),
        palette.grid.clone().multiplyScalar(0.12),
      );
      cachedKey.current = key;
      receiver.current.visible = true;
      effects.recordCapture(performance.now() - started);
      gl.domElement.dataset.contactStatus = 'cached';
      gl.domElement.dataset.contactCacheKey = key;
      invalidate();
    } catch {
      failed.current = true;
      receiver.current.visible = false;
      resources.current.dispose();
      resources.current = null;
      gl.domElement.dataset.contactStatus = 'capture-failed';
    }
  }, -0.5);
  const light = palette.background.getHSL({ h: 0, s: 0, l: 0 }).l > 0.5;
  return (
    <mesh
      ref={receiver}
      position={[width / 2, 0.035, -depth / 2]}
      rotation={[-Math.PI / 2, 0, 0]}
      scale={[1, -1, 1]}
      visible={false}
      raycast={() => {}}
      userData={{
        roomEffectHelper: true,
        hoverPassThrough: true,
        roomContactReceiver: true,
      }}
    >
      <planeGeometry args={[width, depth]} />
      <meshBasicMaterial
        ref={material}
        transparent
        depthWrite={false}
        side={DoubleSide}
        toneMapped={false}
        opacity={(light ? 0.22 : 0.32) * SCENE_EFFECTS.intensity}
      />
    </mesh>
  );
}
