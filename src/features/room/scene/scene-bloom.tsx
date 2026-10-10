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
import { SCENE_EFFECTS } from './scene-effects-state';
import { useSceneEffects } from './scene-effects-context';
import {
  createBloomOverlay,
  createSceneBloomFrames,
  type BloomOverlay,
  type RawSceneColor,
} from './scene-bloom-runtime';

export default function SceneBloom({
  selection,
  lights,
  rawColor,
}: {
  selection: Mesh[];
  lights: Light[];
  rawColor: RawSceneColor;
}) {
  const { gl, scene, camera, invalidate } = useThree();
  const effects = useSceneEffects();
  const palette = useScenePalette();
  const paletteRevision = useScenePaletteRevision();
  const cleanup = useRef<(() => void) | null>(null);
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
        effects.failBloom,
      ),
    [gl, scene, camera, rawColor, effects],
  );
  useEffect(() => {
    try {
      overlay.current = createBloomOverlay();
      invalidate();
    } catch {
      effects.failBloom('overlay-allocation');
      invalidate();
    }
    return () => {
      overlay.current?.dispose();
      overlay.current = null;
    };
  }, [effects, invalidate]);
  const attach = useCallback(
    (composer: Composer | null) => {
      cleanup.current?.();
      cleanup.current = null;
      if (!composer) {
        effects.setBloomReady(false);
        return;
      }
      // Lazy composer creation may compile shaders; exclude its first active frames.
      effects.quality.restartWarmup();
      cleanup.current = frames.attach(
        composer,
        () => OverrideMaterialManager.workaroundEnabled === false,
        () => {
          gl.domElement.dataset.composerFrames = String(
            ++composedFrames.current,
          );
        },
      );
      gl.domElement.dataset.bloomStatus = effects.getSnapshot().bloomFailure
        ? 'failed'
        : 'active';
      effects.setBloomReady(true);
      invalidate();
    },
    [gl, frames, effects, invalidate],
  );
  useEffect(
    () => () => {
      cleanup.current?.();
    },
    [],
  );
  useEffect(() => {
    invalidate();
  }, [selection, lights, paletteRevision, invalidate]);
  const light = palette.background.getHSL({ h: 0, s: 0, l: 0 }).l > 0.5;
  const intensity =
    (light
      ? SCENE_EFFECTS.bloomIntensityLight
      : SCENE_EFFECTS.bloomIntensityDark) * SCENE_EFFECTS.intensity;
  useFrame(() => {
    frames.draw(bloom.current?.texture ?? null, intensity);
  }, 2);
  return (
    <EffectComposer
      ref={attach}
      multisampling={0}
      enableNormalPass={false}
      depthBuffer
      renderPriority={1}
      autoRenderToScreen={false}
    >
      <SelectiveBloom
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
