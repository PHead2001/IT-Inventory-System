/* eslint-disable react-hooks/immutability -- Passive telemetry belongs to the owned imperative renderer boundary. */
'use client';
import { useFrame, useThree } from '@react-three/fiber';
import {
  Component,
  Suspense,
  lazy,
  useEffect,
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
  useState,
  type ReactNode,
} from 'react';
import { useSceneCurrent } from './scene-current';
import type { RoomDefinition } from '../schema';
import { useSceneEffects } from './scene-effects-context';
import { CachedContactShadows } from './cached-contact-shadows';
import type { EffectsQuality } from './scene-effects-state';
import { useScenePaletteRevision } from './scene-palette';
import { captureRawSceneColor } from './scene-bloom-runtime';

const LazyBloom = lazy(() => import('./scene-bloom'));
export class SceneEffectsBoundary extends Component<
  { children: ReactNode; onFailure: (reason: string) => void },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch() {
    this.props.onFailure('import-or-allocation');
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

export function SceneEffectsOwner({
  room,
  selectedCode,
  highlightedCodes,
  quality = 'standard',
}: {
  room: RoomDefinition;
  selectedCode: string | null;
  highlightedCodes: string[];
  quality?: EffectsQuality;
}) {
  const effects = useSceneEffects();
  const isCurrent = useSceneCurrent(effects);
  const state = useSyncExternalStore(
    effects.subscribe,
    effects.getSnapshot,
    effects.getSnapshot,
  );
  const { gl, camera, invalidate } = useThree();
  const [rawColor] = useState(() => captureRawSceneColor(gl));
  const paletteRevision = useScenePaletteRevision();
  const highlightedKey = [...highlightedCodes].sort().join('|');
  const selectedMeshes = useMemo(
    () =>
      state.geometryRevision === 0
        ? []
        : effects.selectedMeshes(
            selectedCode,
            new Set(highlightedKey.split('|').filter(Boolean)),
          ),
    [effects, selectedCode, highlightedKey, state.geometryRevision],
  );
  const lights = useMemo(
    () => (state.lightRevision === 0 ? [] : effects.getLights()),
    [effects, state.lightRevision],
  );
  const allowed =
    quality === 'standard' &&
    selectedMeshes.length > 0 &&
    lights.length > 0 &&
    !state.bloomFailure;
  const eligibility = useRef(allowed);
  useLayoutEffect(() => {
    eligibility.current = allowed;
  }, [allowed]);
  const bloomCurrent = useCallback(
    () => isCurrent() && eligibility.current,
    [isCurrent],
  );
  const failure = useCallback(
    (reason: string) => {
      if (bloomCurrent()) effects.failBloom(reason);
    },
    [effects, bloomCurrent],
  );
  const previous = useRef({ camera: '', active: false, captures: 0 });
  const sceneFrames = useRef(0);
  useEffect(() => {
    if (!isCurrent()) return;
    effects.clearHover();
    effects.invalidateHover();
    invalidate();
  }, [effects, selectedCode, invalidate, isCurrent]);
  useEffect(() => {
    if (!isCurrent()) return;
    gl.domElement.dataset.bloomStatus =
      state.bloomFailure ??
      (quality !== 'standard'
        ? 'quality-off'
        : allowed
          ? state.bloomReady
            ? 'active'
            : 'loading'
          : 'unselected');
    gl.domElement.dataset.bloomSelection = selectedMeshes
      .map((mesh) => mesh.uuid)
      .join(',');
    gl.domElement.dataset.effectsGeneration = effects.sceneGeneration;
    gl.domElement.dataset.rawSceneToneMapping = String(rawColor.toneMapping);
    gl.domElement.dataset.rawSceneExposure = String(
      rawColor.toneMappingExposure,
    );
    gl.domElement.dataset.rawSceneOutputColorSpace = rawColor.outputColorSpace;
    gl.domElement.dataset.paletteRevision = String(paletteRevision);
    gl.domElement.dataset.contactCaptures = String(state.captures);
    gl.domElement.dataset.contactCaptureMs = String(state.captureMs ?? '');
    invalidate();
  }, [
    gl,
    effects,
    allowed,
    quality,
    state.bloomFailure,
    state.bloomReady,
    state.captures,
    state.captureMs,
    paletteRevision,
    selectedMeshes,
    invalidate,
    rawColor,
    isCurrent,
  ]);
  useFrame((_frame, delta) => {
    if (!isCurrent()) return;
    const cameraKey = [
      ...camera.matrixWorld.elements,
      ...camera.projectionMatrix.elements,
    ].join(',');
    const current = effects.getSnapshot();
    const active =
      current.casterMotions > 0 ||
      current.activities > 0 ||
      cameraKey !== previous.current.camera;
    const captured = current.captures !== previous.current.captures;
    effects.recordFrame(
      delta * 1000,
      active &&
        previous.current.active &&
        !captured &&
        previous.current.captures === current.captures,
    );
    if (!active) effects.quality.resetWindow();
    previous.current = {
      camera: cameraKey,
      active: active && !captured,
      captures: current.captures,
    };
    gl.domElement.dataset.sceneEffectFrames = String(++sceneFrames.current);
    gl.domElement.dataset.visualHoverCode = current.hoverCode ?? '';
    gl.domElement.dataset.effectsQualityEvidence = JSON.stringify(
      effects.quality.evidence(),
    );
  });
  if (!isCurrent()) return null;
  return (
    <>
      <CachedContactShadows room={room} quality={quality} />
      {allowed && (
        <SceneEffectsBoundary key={effects.sceneGeneration} onFailure={failure}>
          <Suspense fallback={null}>
            <LazyBloom
              selection={selectedMeshes}
              lights={lights}
              rawColor={rawColor}
              current={bloomCurrent}
            />
          </Suspense>
        </SceneEffectsBoundary>
      )}
    </>
  );
}
