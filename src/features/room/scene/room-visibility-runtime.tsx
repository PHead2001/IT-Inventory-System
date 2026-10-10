'use client';
import { useFrame, useThree } from '@react-three/fiber';
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  type ReactNode,
  type RefObject,
} from 'react';
import type { Camera, Group, Object3D, Vector3 } from 'three';
import {
  resolveExposedTargetAnchor,
  type ExposedAnchorResult,
} from './exposed-anchor';
import { ProjectedVisibleSurface } from './projected-visible-surface';
import type { LabelArea } from './label-layout';

/** One actual scene revision and cooperative work budget for the whole batch.
 * DOM masks are part of the measured revision, including viewport scrolling.
 * Pending queries resume on bounded demand frames; terminal results stay latched
 * until the measured revision changes or a user retries.
 */
export class RoomVisibilityBatch {
  private measuredKey = '';
  private domKey = '';
  private results = new Map<
    Group,
    { code: string; result: ExposedAnchorResult }
  >();
  private active = new Set<Group>();
  private pendingCodes = new Set<string>();
  needsFrame = false;
  private viewport: LabelArea | undefined;
  private obstructions: LabelArea[] = [];
  private failure: string | null = 'viewport not measured';
  readonly projection: ProjectedVisibleSurface;
  constructor(
    scene: Object3D,
    camera: Camera,
    projection = new ProjectedVisibleSurface(scene, camera),
  ) {
    this.projection = projection;
  }
  refresh(viewport: LabelArea, obstructions: LabelArea[]) {
    this.active.clear();
    this.pendingCodes.clear();
    this.viewport = viewport;
    this.obstructions = obstructions;
    const domKey = JSON.stringify([viewport, obstructions]);
    if (this.domKey && domKey !== this.domKey) this.projection.retry();
    this.domKey = domKey;
    this.projection.refresh();
    this.failure =
      Object.values(viewport).every(Number.isFinite) &&
      viewport.right > viewport.left &&
      viewport.bottom > viewport.top
        ? null
        : 'viewport not measured';
    const key = JSON.stringify([
      this.projection.revision,
      viewport,
      obstructions,
    ]);
    if (key !== this.measuredKey) {
      this.measuredKey = key;
      this.results.clear();
    }
  }
  resolve(
    origin: Group,
    code: string,
    preferred: Vector3,
  ): ExposedAnchorResult {
    this.active.add(origin);
    if (!this.failure && !this.projection.revisionChecked) {
      this.pendingCodes.add(code);
      return {
        status: this.projection.pending ? 'pending' : 'unresolved',
        reason: 'scene revision pending',
        stats: this.projection.stats,
      };
    }
    const previous = this.results.get(origin);
    if (previous?.code === code) return previous.result;
    const result: ExposedAnchorResult = this.failure
      ? {
          status: 'unresolved',
          reason: this.failure,
          stats: this.projection.stats,
        }
      : resolveExposedTargetAnchor(
          this.projection.scene,
          this.projection.camera,
          origin,
          code,
          preferred,
          this.viewport,
          this.obstructions,
          this.projection,
        );
    if (result.status !== 'pending') this.results.set(origin, { code, result });
    else this.pendingCodes.add(code);
    return result;
  }
  finish() {
    for (const origin of this.results.keys())
      if (!this.active.has(origin)) this.results.delete(origin);
    const activeCodes = new Set(this.pendingCodes);
    for (const origin of this.active) {
      const entry = this.results.get(origin);
      if (entry) activeCodes.add(entry.code);
    }
    this.needsFrame =
      !this.failure &&
      this.active.size > 0 &&
      this.projection.finishFrame(activeCodes, this.pendingCodes.size > 0);
    return [
      ...new Set([
        ...this.pendingCodes,
        ...[...this.active].flatMap((origin) => {
          const entry = this.results.get(origin);
          return entry?.result.status === 'unresolved' ? [entry.code] : [];
        }),
      ]),
    ].sort();
  }
  retry() {
    this.projection.retry();
    this.results.clear();
    this.measuredKey = '';
  }
}

const VisibilityContext = createContext<RoomVisibilityBatch | null>(null);
export function useRoomVisibilityBatch() {
  const batch = useContext(VisibilityContext);
  if (!batch) throw new Error('Room labels need a visibility provider');
  return batch;
}
export function RoomVisibilityProvider({
  children,
  onUnresolvedChange,
  retryRef,
}: {
  children: ReactNode;
  onUnresolvedChange: (codes: string[]) => void;
  retryRef: RefObject<(() => void) | null>;
}) {
  const { scene, camera, gl, invalidate } = useThree();
  const batch = useMemo(
    () => new RoomVisibilityBatch(scene, camera),
    [scene, camera],
  );
  const publication = useRef('');
  // Drei controls run at -1; CameraRig runs at -.75.
  useFrame(() => {
    const viewport = gl.domElement.getBoundingClientRect();
    const obstructions = Array.from(
      gl.domElement
        .closest('[data-room-surface]')
        ?.querySelectorAll<HTMLElement>('[data-room-obstruction]') ?? [],
    )
      .filter((element) => element.getClientRects().length > 0)
      .map((element) => element.getBoundingClientRect());
    batch.refresh(
      {
        left: viewport.left,
        top: viewport.top,
        right: viewport.right,
        bottom: viewport.bottom,
      },
      obstructions,
    );
  }, -0.5);
  // All anchor queries run at -.25; publish once after the complete batch.
  useFrame(() => {
    const codes = batch.finish(),
      key = codes.join('|');
    if (key !== publication.current) {
      publication.current = key;
      onUnresolvedChange(codes);
    }
    if (batch.needsFrame) invalidate();
  }, 0);
  useEffect(() => {
    const retry = () => {
      batch.retry();
      invalidate();
    };
    retryRef.current = retry;
    return () => {
      if (retryRef.current === retry) retryRef.current = null;
    };
  }, [batch, invalidate, retryRef]);
  return (
    <VisibilityContext.Provider value={batch}>
      {children}
    </VisibilityContext.Provider>
  );
}
