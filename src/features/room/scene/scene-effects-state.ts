import { Mesh, type Light, type Object3D } from 'three';

/** Initial visual defaults; measurements and logical room bindings are unchanged. */
export const SCENE_EFFECTS = Object.freeze({
  intensity: 1,
  hoverLiftInches: 0.1,
  hoverMs: 120,
  shadowResolution: 512,
  bloomLayer: 11,
  bloomIntensityDark: 0.22,
  bloomIntensityLight: 0.12,
  qualityWindow: 60,
  degradedWindows: 2,
  degradedP95Ms: 25,
  startupActiveFrames: 10,
});
export type EffectsQuality = 'standard' | 'low' | 'off';
export type EffectMesh = Readonly<{
  sceneGeneration: string;
  nodeId: string;
  locationCode: string | null;
  mesh: Mesh;
}>;
export type EffectsSnapshot = Readonly<{
  revision: number;
  geometryRevision: number;
  lightRevision: number;
  settledRevision: number;
  hoverEpoch: number;
  hoverCode: string | null;
  casterMotions: number;
  activities: number;
  bloomFailure: string | null;
  bloomReady: boolean;
  captures: number;
  captureMs: number | null;
}>;

/**
 * Demand gaps are never samples. The owner supplies only adjacent active frames
 * with observed render-loop continuity. Partial windows span separate bursts;
 * inactivity does not discard their already eligible intervals.
 */
export function createEffectsQualityMonitor(
  current: () => boolean = () => true,
) {
  let warmup = SCENE_EFFECTS.startupActiveFrames;
  let samples: number[] = [];
  let badWindows = 0;
  let disabled = false;
  let windows = 0;
  let lastP95: number | null = null;
  let disposed = false;
  return {
    sample(ms: number, eligible: boolean) {
      if (disposed || !current()) return disabled;
      if (disabled || !eligible || !Number.isFinite(ms) || ms <= 0)
        return disabled;
      if (warmup > 0) {
        warmup--;
        return false;
      }
      samples.push(ms);
      if (samples.length === SCENE_EFFECTS.qualityWindow) {
        const sorted = [...samples].sort((a, b) => a - b);
        lastP95 = sorted[Math.ceil(sorted.length * 0.95) - 1];
        badWindows = lastP95 > SCENE_EFFECTS.degradedP95Ms ? badWindows + 1 : 0;
        windows++;
        samples = [];
        disabled = badWindows >= SCENE_EFFECTS.degradedWindows;
      }
      return disabled;
    },
    resetWindow() {
      if (disposed || !current()) return;
      samples = [];
    },
    restartWarmup() {
      if (disposed || !current()) return;
      warmup = SCENE_EFFECTS.startupActiveFrames;
      samples = [];
    },
    dispose() {
      disposed = true;
      samples = [];
    },
    evidence: () => ({
      windows,
      lastP95,
      badWindows,
      disabled,
      pending: samples.length,
    }),
  };
}

function actualVisualMesh(object: Object3D): object is Mesh {
  for (
    let ancestor: Object3D | null = object;
    ancestor;
    ancestor = ancestor.parent
  ) {
    if (
      ancestor.userData.hoverPassThrough ||
      ancestor.userData.roomEffectHelper
    )
      return false;
  }
  return (
    object instanceof Mesh &&
    !object.userData.hoverPassThrough &&
    !object.userData.roomEffectHelper &&
    !('isLineSegments2' in object) &&
    object.type !== 'LineSegments2'
  );
}

/** One scene-session owner; refs and animation bookkeeping never enter inventory state. */
export function createSceneEffectsStore(
  sceneGeneration: string,
  sessionCurrent: () => boolean = () => true,
) {
  const meshes = new Map<string, EffectMesh[]>();
  const lights = new Map<string, Light>();
  const motions = new Map<string, { nodeId: string; hover: boolean }>();
  const activities = new Set<string>();
  const listeners = new Set<() => void>();
  const quality = createEffectsQualityMonitor(() => isCurrent());
  let snapshot: EffectsSnapshot = Object.freeze({
    revision: 0,
    geometryRevision: 0,
    lightRevision: 0,
    settledRevision: 0,
    hoverEpoch: 0,
    hoverCode: null,
    casterMotions: 0,
    activities: 0,
    bloomFailure: null,
    bloomReady: false,
    captures: 0,
    captureMs: null,
  });
  let disposed = false;
  const isCurrent = () => !disposed && sessionCurrent();
  const publish = (patch: Partial<EffectsSnapshot>) => {
    if (!isCurrent()) return;
    snapshot = Object.freeze({
      ...snapshot,
      ...patch,
      revision: snapshot.revision + 1,
    });
    listeners.forEach((listener) => listener());
  };
  const ownerCode = (nodeId: string) =>
    meshes.get(nodeId)?.[0]?.locationCode ?? null;
  return {
    sceneGeneration,
    quality,
    isDisposed: () => disposed,
    isCurrent,
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) {
      if (!isCurrent()) return () => {};
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    registerVisual(
      nodeId: string,
      locationCode: string | null,
      root: Object3D,
    ) {
      if (!isCurrent()) return () => {};
      const entries: EffectMesh[] = [];
      root.traverse((object) => {
        if (actualVisualMesh(object))
          entries.push(
            Object.freeze({
              sceneGeneration,
              nodeId,
              locationCode,
              mesh: object,
            }),
          );
      });
      meshes.set(nodeId, entries);
      publish({
        geometryRevision: snapshot.geometryRevision + 1,
        hoverEpoch: snapshot.hoverEpoch + 1,
      });
      return () => {
        if (meshes.get(nodeId) !== entries) return;
        meshes.delete(nodeId);
        publish({
          geometryRevision: snapshot.geometryRevision + 1,
          hoverEpoch: snapshot.hoverEpoch + 1,
        });
      };
    },
    setLight(key: string, light: Light | null) {
      if (!isCurrent()) return;
      if (lights.get(key) === light || (!light && !lights.has(key))) return;
      if (light) lights.set(key, light);
      else lights.delete(key);
      publish({ lightRevision: snapshot.lightRevision + 1 });
    },
    getLights: () => [...lights.values()],
    getCasters: () => [...meshes.values()].flat(),
    selectedMeshes(code: string | null, highlighted: ReadonlySet<string>) {
      if (!isCurrent() || !code) return [];
      return [...meshes.values()]
        .flat()
        .filter(
          (entry) =>
            entry.locationCode !== null &&
            (entry.locationCode === code ||
              highlighted.has(entry.locationCode)),
        )
        .map((entry) => entry.mesh);
    },
    reconcileHover(actualCode: string | null, refresh: boolean) {
      // A visual-only latch prevents the lifted edge from oscillating. Actual
      // surface identification, tooltip visibility and click eligibility stay separate.
      if (!isCurrent()) return;
      const next =
        refresh || snapshot.hoverCode === null
          ? actualCode
          : snapshot.hoverCode;
      if (next !== snapshot.hoverCode) publish({ hoverCode: next });
    },
    clearHover() {
      if (snapshot.hoverCode !== null) publish({ hoverCode: null });
    },
    invalidateHover() {
      publish({ hoverEpoch: snapshot.hoverEpoch + 1 });
    },
    beginCasterMotion(key: string, nodeId: string, hover = false) {
      if (!isCurrent()) return () => {};
      const identity = { nodeId, hover };
      motions.set(key, identity);
      const otherGeometry = !hover || ownerCode(nodeId) !== snapshot.hoverCode;
      publish({
        casterMotions: motions.size,
        hoverEpoch: snapshot.hoverEpoch + Number(otherGeometry),
      });
      return () => {
        if (motions.get(key) !== identity) return;
        motions.delete(key);
        publish({
          casterMotions: motions.size,
          settledRevision: snapshot.settledRevision + 1,
          hoverEpoch: snapshot.hoverEpoch + Number(otherGeometry),
        });
      };
    },
    beginActivity(key: string) {
      if (!isCurrent()) return () => {};
      activities.add(key);
      publish({ activities: activities.size });
      return () => {
        if (!activities.delete(key)) return;
        publish({ activities: activities.size });
      };
    },
    failBloom(reason: string) {
      if (snapshot.bloomFailure === null) publish({ bloomFailure: reason });
    },
    setBloomReady(ready: boolean) {
      if (snapshot.bloomReady !== ready) publish({ bloomReady: ready });
    },
    recordFrame(ms: number, eligible: boolean) {
      if (!isCurrent()) return;
      if (quality.sample(ms, eligible)) this.failBloom('sustained-frame-time');
    },
    recordCapture(ms: number) {
      publish({ captures: snapshot.captures + 1, captureMs: ms });
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      quality.dispose();
      meshes.clear();
      lights.clear();
      motions.clear();
      activities.clear();
      listeners.clear();
    },
  };
}
export type SceneEffectsStore = ReturnType<typeof createSceneEffectsStore>;

export function contactCacheKey(
  store: SceneEffectsStore,
  paletteRevision: number,
  quality: EffectsQuality,
) {
  const state = store.getSnapshot();
  return [
    store.sceneGeneration,
    state.geometryRevision,
    state.settledRevision,
    paletteRevision,
    quality,
  ].join(':');
}
