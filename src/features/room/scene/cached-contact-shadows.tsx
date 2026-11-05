/* eslint-disable react-hooks/immutability -- Owned WebGL capture and receiver lifetime boundary. */
'use client';
import { recordRoomDemand } from './room-demand-diagnostics';
import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useRef } from 'react';
import { DoubleSide, Mesh, type MeshBasicMaterial } from 'three';
import { useSceneCurrent } from './scene-current';
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
  const isCurrent = useSceneCurrent(effects);
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
    if (!isCurrent()) return;
    const ownedReceiver = receiver.current;
    const ownedMaterial = material.current;
    failed.current = false;
    cachedKey.current = null;
    readyFrames.current = 0;
    delete gl.domElement.dataset.contactCacheKey;
    if (quality === 'off') return;
    let owned: ContactCapture | null = null;
    try {
      owned = createContactCapture(
        width,
        depth,
        height,
        SCENE_EFFECTS.shadowResolution,
        isCurrent,
      );
      resources.current = owned;
      if (material.current) {
        material.current.map = owned.texture;
        material.current.needsUpdate = true;
      }
      recordRoomDemand(invalidate, 'contact-update');
      invalidate();
    } catch {
      failed.current = true;
      owned?.dispose();
      resources.current = null;
      if (ownedMaterial) {
        ownedMaterial.map = null;
        ownedMaterial.needsUpdate = true;
      }
      gl.domElement.dataset.contactStatus = 'allocation-failed';
    }
    return () => {
      if (resources.current === owned) {
        resources.current = null;
        owned?.dispose();
      }
      if (ownedMaterial && owned && ownedMaterial.map === owned.texture) {
        ownedMaterial.map = null;
        ownedMaterial.needsUpdate = true;
      }
      if (ownedReceiver) ownedReceiver.visible = false;
    };
  }, [width, depth, height, quality, gl, invalidate, effects, isCurrent]);
  useEffect(
    () =>
      effects.subscribe(() => {
        if (
          isCurrent() &&
          effects.getSnapshot().casterMotions > 0 &&
          receiver.current
        )
          receiver.current.visible = false;
      }),
    [effects, isCurrent],
  );
  useEffect(() => {
    if (!isCurrent()) return;
    if (receiver.current) receiver.current.visible = false;
    recordRoomDemand(invalidate, 'contact-update');
    invalidate();
  }, [paletteRevision, quality, invalidate, isCurrent]);
  useFrame(() => {
    if (!isCurrent() || !receiver.current) return;
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
      recordRoomDemand(invalidate, 'contact-wait');
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
      recordRoomDemand(invalidate, 'contact-capture');
      invalidate();
    } catch {
      failed.current = true;
      receiver.current.visible = false;
      if (material.current) {
        material.current.map = null;
        material.current.needsUpdate = true;
      }
      delete gl.domElement.dataset.contactCacheKey;
      resources.current.dispose();
      resources.current = null;
      gl.domElement.dataset.contactStatus = 'capture-failed';
    }
  }, -0.5);
  const light = palette.background.getHSL({ h: 0, s: 0, l: 0 }).l > 0.5;
  if (!isCurrent()) return null;
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
