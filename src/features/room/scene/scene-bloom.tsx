/* eslint-disable react-hooks/immutability -- Owned imperative composer and renderer telemetry boundary. */
'use client';
import { useFrame, useThree } from '@react-three/fiber';
import { EffectComposer, SelectiveBloom } from '@react-three/postprocessing';
import {
  KernelSize,
  OverrideMaterialManager,
  type EffectComposer as Composer,
  type SelectiveBloomEffect,
} from 'postprocessing';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import type { Light, Mesh } from 'three';
import { useScenePalette, useScenePaletteRevision } from './scene-palette';
import { useSceneCurrent } from './scene-current';
import { SCENE_EFFECTS } from './scene-effects-state';
import { useSceneEffects } from './scene-effects-context';
import {
  createBloomOverlay,
  createSceneBloomFrames,
  type BloomOverlay,
  type RawSceneColor,
} from './scene-bloom-runtime';

const alwaysCurrent = () => true;

export default function SceneBloom({
  selection,
  lights,
  rawColor,
  current = alwaysCurrent,
}: {
  selection: Mesh[];
  lights: Light[];
  rawColor: RawSceneColor;
  current?: () => boolean;
}) {
  const { gl, scene, camera, invalidate } = useThree();
  const effects = useSceneEffects();
  const ownedCurrent = useSceneCurrent(effects);
  const isCurrent = useCallback(
    () => ownedCurrent() && current(),
    [ownedCurrent, current],
  );
  const palette = useScenePalette();
  const paletteRevision = useScenePaletteRevision();
  const attachment = useRef<{
    frames: ReturnType<typeof createSceneBloomFrames>;
    composer: Composer;
    release: () => void;
  } | null>(null);
  const composedFrames = useRef(0);
  const bloom = useRef<SelectiveBloomEffect>(null);
  const overlay = useRef<BloomOverlay | null>(null);
  const frames = useMemo(
    () =>
      createSceneBloomFrames(
        gl,
        scene,
        camera,
        rawColor,
        // eslint-disable-next-line react-hooks/refs -- Factory retains this callback; only priority-2 frames invoke it.
        {
          draw: (renderer, texture, intensity) =>
            overlay.current?.draw(renderer, texture, intensity),
          dispose: () => {},
        },
        (reason) => {
          if (isCurrent()) effects.failBloom(reason);
        },
        isCurrent,
      ),
    [gl, scene, camera, rawColor, effects, isCurrent],
  );
  useEffect(() => {
    if (!isCurrent()) return;
    let owned: BloomOverlay | null = null;
    try {
      owned = createBloomOverlay(isCurrent);
      overlay.current = owned;
      invalidate();
    } catch {
      if (isCurrent()) {
        effects.failBloom('overlay-allocation');
        invalidate();
      }
    }
    return () => {
      owned?.dispose();
      if (overlay.current === owned) overlay.current = null;
    };
  }, [effects, invalidate, isCurrent]);
  const attach = useCallback(
    (composer: Composer | null) => {
      const previous = attachment.current;
      if (!composer) {
        if (previous?.frames !== frames) return;
        previous.release();
        if (attachment.current === previous) attachment.current = null;
      }
      if (!isCurrent()) return;
      if (!composer) {
        effects.setBloomReady(false);
        return;
      }
      attachment.current?.release();
      // Lazy composer creation may compile shaders; exclude its first active frames.
      effects.quality.restartWarmup();
      const release = frames.attach(
        composer,
        () => OverrideMaterialManager.workaroundEnabled === false,
        () => {
          if (!isCurrent()) return;
          gl.domElement.dataset.composerFrames = String(
            ++composedFrames.current,
          );
        },
      );
      gl.domElement.dataset.bloomStatus = effects.getSnapshot().bloomFailure
        ? 'failed'
        : 'active';
      const owned = { frames, composer, release };
      attachment.current = owned;
      effects.setBloomReady(true);
      invalidate();
      return () => {
        release();
        if (attachment.current !== owned) return;
        attachment.current = null;
        if (isCurrent()) effects.setBloomReady(false);
      };
    },
    [gl, frames, effects, invalidate, isCurrent],
  );
  useEffect(
    () => () => {
      const owned = attachment.current;
      if (owned?.frames !== frames) return;
      owned.release();
      if (attachment.current === owned) attachment.current = null;
    },
    [frames],
  );
  useEffect(() => {
    if (isCurrent()) invalidate();
  }, [selection, lights, paletteRevision, invalidate, isCurrent]);
  const light = palette.background.getHSL({ h: 0, s: 0, l: 0 }).l > 0.5;
  const intensity =
    (light
      ? SCENE_EFFECTS.bloomIntensityLight
      : SCENE_EFFECTS.bloomIntensityDark) * SCENE_EFFECTS.intensity;
  useFrame(() => {
    if (!isCurrent()) return;
    frames.draw(bloom.current?.texture ?? null, intensity);
  }, 2);
  // Fence before the library renders its allocation-owning composer child.
  if (!isCurrent()) return null;
  return (
    <EffectComposer
      key={effects.sceneGeneration}
      ownerCurrent={isCurrent}
      ref={attach}
      multisampling={0}
      enableNormalPass={false}
      depthBuffer
      renderPriority={1}
      autoRenderToScreen={false}
    >
      <SelectiveBloom
        ownerCurrent={isCurrent}
        ref={bloom}
        selection={selection}
        lights={lights}
        selectionLayer={SCENE_EFFECTS.bloomLayer}
        inverted={false}
        ignoreBackground
        mipmapBlur={false}
        resolutionScale={0.5}
        kernelSize={KernelSize.SMALL}
        luminanceThreshold={0.15}
        luminanceSmoothing={0.2}
        intensity={1}
      />
    </EffectComposer>
  );
}
