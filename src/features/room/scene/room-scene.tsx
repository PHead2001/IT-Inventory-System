/* eslint-disable react-hooks/immutability -- Three.js camera objects are intentionally mutated inside effects/frame callbacks at this imperative graphics boundary. */
'use client';
import { useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import { Edges, OrbitControls } from '@react-three/drei';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ComponentRef,
} from 'react';
import { Group, MathUtils, OrthographicCamera, Vector3 } from 'three';
import { useEffectiveReducedMotion } from '@/components/experience/motion-preference';
import type { RoomDefinition, RoomNode } from '../schema';
import { findFocusBinding, type RoomBinding } from '../bindings';
import { toScenePosition, toSceneSize } from '../coordinates';
import {
  cameraFacingLabelPosition,
  cameraFacingDirectionInLocalSpace,
  FREE_POLAR_EPSILON,
  floorDoubleClickAllowed,
  focusZoomForBinding,
  frameBounds,
  guidedOffset,
  recenteredPosition,
  rotatedOffset,
  tiltedOffset,
  type OrbitMode,
} from './camera-math';
import { openingTransform } from './opening-transform';
import {
  LabelLayoutProvider,
  LabelLayoutDriver,
  createRoomLabelRegistry,
  useRoomLabelRegistry,
} from './label-layout-runtime';
import { attachMapInput } from './map-input';
import { RoomToolbar, type ViewCommandKind } from './room-toolbar';
import { SelectionMaterial } from './selection-material';
import { SceneDepth } from './scene-depth';
import { RoomLabel, knownOccupiedCount } from './room-label';
import { RoomLabelHtml } from './room-label-html';
import { SafeCanvas as Canvas } from './safe-canvas';
import {
  VisibleHoverTracker,
  type VisibleHover,
} from './visible-hover-runtime';
import { placeHoverTooltip } from './visible-hover';
import { validCameraView, type CameraView } from './camera-view';
import styles from '../room-visual.module.css';

export type RoomSceneProps = {
  room: RoomDefinition;
  locationNames?: Record<string, string>;
  locationEntryCounts?: Record<string, string>;
  showCounts?: boolean;
  onCountsChange?: (show: boolean) => void;
  bindings: RoomBinding[];
  selectedCode: string | null;
  highlightedCodes: string[];
  focusRequest: { code: string | null; requestId: number };
  focusOnRestore?: boolean;
  onSelect(code: string): void;
  onReady(): void;
  onFocusComplete(code: string | null): void;
  onFocusCancel?(): void;
  onFailure(message: string): void;
  canFocusSelected: boolean;
  onRequestFocus(): void;
  initialView?: CameraView | null;
  onViewChange?: (view: CameraView) => void;
};
type ViewCommand = {
  kind: ViewCommandKind;
  id: number;
};
const ORBIT_MODE_KEY = 'room-orbit-mode';
function readOrbitMode(): OrbitMode {
  try {
    return window.localStorage.getItem(ORBIT_MODE_KEY) === 'free'
      ? 'free'
      : 'guided';
  } catch {
    return 'guided';
  }
}
function subscribeOrbitMode(onChange: () => void) {
  window.addEventListener('storage', onChange);
  window.addEventListener('room-orbit-mode-change', onChange);
  return () => {
    window.removeEventListener('storage', onChange);
    window.removeEventListener('room-orbit-mode-change', onChange);
  };
}
function selectedSceneLabel(
  nodes: RoomNode[],
  code: string | null,
): string | null {
  if (!code) return null;
  for (const node of nodes) {
    if (node.locationCode === code) return node.interaction?.label ?? code;
    const child = selectedSceneLabel(node.children ?? [], code);
    if (child) return child;
  }
  return null;
}
export function hasRenderedSelection(
  nodes: RoomNode[],
  selectedCode: string | null,
  highlighted: ReadonlySet<string>,
): boolean {
  return nodes.some(
    (node) =>
      (node.kind === 'box' &&
        !!node.size &&
        !!node.locationCode &&
        (node.locationCode === selectedCode ||
          highlighted.has(node.locationCode))) ||
      hasRenderedSelection(node.children ?? [], selectedCode, highlighted),
  );
}
function Solid({
  position,
  size,
  color = '#1e293b',
  onDoubleClick,
}: {
  position: [number, number, number];
  size: [number, number, number];
  color?: string;
  onDoubleClick?: (event: ThreeEvent<MouseEvent>) => void;
}) {
  return (
    <mesh
      position={toScenePosition(position)}
      onDoubleClick={(event) => {
        event.stopPropagation();
        onDoubleClick?.(event);
      }}
    >
      <boxGeometry args={toSceneSize(size)} />
      <meshStandardMaterial color={color} roughness={0.85} />
    </mesh>
  );
}
function Envelope({
  room,
  onRecenter,
  canRecenter,
  showAllLabels,
}: {
  room: RoomDefinition;
  onRecenter: () => void;
  canRecenter: (pointerDelta: number) => boolean;
  showAllLabels: boolean;
}) {
  const [width, depth, height] = room.dimensions,
    thickness = room.envelope.wallThickness;
  // Low perimeter rails retain room proportions without hiding lower storage.
  return (
    <group
      onClick={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
    >
      <Solid
        position={[width / 2, depth / 2, -thickness / 2]}
        size={[width, depth, thickness]}
        color="#172337"
        onDoubleClick={(event) => {
          if (canRecenter(event.delta)) onRecenter();
        }}
      />
      <Solid
        position={[-thickness / 2, depth / 2, 3]}
        size={[thickness, depth, 6]}
      />
      <Solid
        position={[width + thickness / 2, depth / 2, 3]}
        size={[thickness, depth, 6]}
      />
      <Solid
        position={[width / 2, depth + thickness / 2, 3]}
        size={[width, thickness, 6]}
      />
      {room.envelope.showCeiling && (
        <Solid
          position={[width / 2, depth / 2, height + thickness / 2]}
          size={[width, depth, thickness]}
        />
      )}
      {room.envelope.frontWallMode === 'solid' && (
        <Solid
          position={[width / 2, -thickness / 2, height / 2]}
          size={[width, thickness, height]}
        />
      )}
      {room.openings.map((opening) => {
        // Keep measured intervals while preserving outward-facing labels on every wall.
        const { origin, rotationY } = openingTransform(
          opening,
          room.dimensions,
        );
        return (
          <OpeningVisual
            key={opening.id}
            origin={origin}
            rotationY={rotationY}
            width={opening.width}
            showAllLabels={showAllLabels}
          />
        );
      })}
    </group>
  );
}
function OpeningVisual({
  origin,
  rotationY,
  width,
  showAllLabels,
}: {
  origin: [number, number, number];
  rotationY: number;
  width: number;
  showAllLabels: boolean;
}) {
  return (
    <group
      position={toScenePosition(origin)}
      rotation={[0, rotationY, 0]}
      onDoubleClick={(event) => event.stopPropagation()}
    >
      <mesh position={[width / 2, 0.5, 0]}>
        <boxGeometry args={[width, 1, 2]} />
        <meshStandardMaterial color="#64748b" />
      </mesh>
      {showAllLabels && (
        <RoomLabelHtml
          center
          occlude
          position={[width / 2, 2, 8]}
          zIndexRange={[20, 0]}
          style={{ pointerEvents: 'none', whiteSpace: 'nowrap' }}
        >
          <RoomLabel
            id={`opening-${origin.join('-')}`}
            label={`Door · ${width}″`}
            priority={0}
          />
        </RoomLabelHtml>
      )}
    </group>
  );
}

function CameraFacingLabel({
  node,
  size,
  prioritySelected,
  hovered,
  count,
  label,
  onSelect,
}: {
  node: RoomNode;
  size: [number, number, number];
  prioritySelected: boolean;
  hovered: boolean;
  count?: string;
  label: string;
  onSelect: (code: string) => void;
}) {
  const { camera, invalidate } = useThree();
  const origin = useRef<Group>(null);
  const anchor = useRef<Group>(null);
  const labelAnchor = node.interaction?.labelAnchor;
  useFrame(() => {
    if (!labelAnchor || !origin.current || !anchor.current) return;
    const localView = cameraFacingDirectionInLocalSpace(camera, origin.current);
    const next = cameraFacingLabelPosition(size, localView, labelAnchor);
    if (
      anchor.current.position.distanceToSquared(new Vector3(...next)) > 1e-6
    ) {
      anchor.current.position.set(...next);
      invalidate();
    }
  });
  const initial = labelAnchor
    ? toScenePosition(labelAnchor)
    : ([0, size[2] / 2 + 0.15, 0] as [number, number, number]);
  return (
    <group ref={origin}>
      <group ref={anchor} position={initial}>
        <RoomLabelHtml
          center
          occlude
          style={{ pointerEvents: 'none', whiteSpace: 'nowrap' }}
          zIndexRange={[20, 0]}
        >
          <RoomLabel
            id={node.id}
            code={node.locationCode}
            label={label}
            selected={prioritySelected}
            priority={prioritySelected ? 3 : hovered ? 2 : 1}
            count={count}
            onSelect={onSelect}
          />
        </RoomLabelHtml>
      </group>
    </group>
  );
}
function NodeVisual({
  node,
  locationNames,
  selectedCode,
  hasRenderedSelection,
  highlighted,
  onSelect,
  profiles,
  showAllLabels,
  hoveredCode,
  locationEntryCounts,
  showCounts,
  canSelect,
}: {
  locationNames?: Record<string, string>;
  profiles: RoomDefinition['rackFaceProfiles'];
  node: RoomNode;
  selectedCode: string | null;
  hasRenderedSelection: boolean;
  highlighted: Set<string>;
  onSelect: (code: string) => void;
  showAllLabels: boolean;
  hoveredCode: string | null;
  locationEntryCounts?: Record<string, string>;
  showCounts: boolean;
  canSelect: () => boolean;
}) {
  const label =
    (node.locationCode && locationNames?.[node.locationCode]) ||
    node.interaction?.label ||
    node.locationCode ||
    node.id;
  const selected =
    !!node.locationCode &&
    (node.locationCode === selectedCode || highlighted.has(node.locationCode));
  const interactive = !!node.locationCode && !!node.interaction?.selectable;
  const click = (event: ThreeEvent<MouseEvent>) => {
    event.stopPropagation();
    if (interactive && event.delta <= 5 && canSelect())
      onSelect(node.locationCode!);
  };
  return (
    <group
      position={toScenePosition(node.position)}
      rotation={[0, MathUtils.degToRad(node.rotationZDegrees), 0]}
    >
      {node.kind === 'box' && node.size && (
        <group
          userData={
            interactive
              ? {
                  roomHoverTarget: {
                    code: node.locationCode,
                    label,
                  },
                }
              : undefined
          }
          onClick={click}
          onDoubleClick={(event) => event.stopPropagation()}
        >
          <mesh onClick={click}>
            <boxGeometry args={toSceneSize(node.size)} />
            <SelectionMaterial
              color={node.visual?.color ?? '#475569'}
              selected={selected}
              dimmed={hasRenderedSelection && !selected}
              hovered={hoveredCode === node.locationCode}
              opacity={node.visual?.opacity ?? 1}
            />
            {(node.visual?.edges || selected) && (
              <Edges
                color={
                  selected
                    ? '#a5f3fc'
                    : hasRenderedSelection
                      ? '#64748b'
                      : '#94a3b8'
                }
                threshold={15}
              />
            )}
          </mesh>
          {node.visual?.style === 'drawer' && (
            <Solid
              position={[
                (node.interaction?.labelAnchor?.[0] ?? 1) > 0
                  ? node.size[0] / 2 + 0.3
                  : -node.size[0] / 2 - 0.3,
                0,
                0,
              ]}
              size={[0.6, node.size[1] * 0.3, 0.6]}
              color="#cbd5e1"
            />
          )}
          {node.visual?.style === 'container' && (
            <Solid
              position={[0, 0, node.size[2] / 2 - 0.4]}
              size={[node.size[0], node.size[1], 0.8]}
              color={node.visual.color}
            />
          )}
          {node.visual?.style === 'rack' && (
            <group>
              <Solid
                position={[0, -node.size[1] / 2 - 0.15, 0]}
                size={[node.size[0] - 3, 0.3, node.size[2] - 4]}
                color="#334155"
              />
              {profiles.map((profile, index) => (
                <Solid
                  key={profile.id}
                  position={[
                    0,
                    -node.size![1] / 2 - 0.35,
                    node.size![2] / 2 - 8 - index * 8,
                  ]}
                  size={[
                    Math.min(profile.width, node.size![0] - 2),
                    0.5,
                    profile.height,
                  ]}
                  color={index % 2 === 0 ? '#94a3b8' : '#64748b'}
                />
              ))}
              {[0, 1, 2, 3, 4, 5].map((index) => (
                <Solid
                  key={index}
                  position={[
                    0,
                    -node.size![1] / 2 - 0.35,
                    -node.size![2] / 2 + 8 + index * 4,
                  ]}
                  size={[node.size![0] - 6, 0.5, 1]}
                  color="#0f172a"
                />
              ))}
            </group>
          )}
          {interactive && node.interaction?.hitBox && (
            <mesh
              position={toScenePosition(node.interaction.hitBox.center)}
              userData={{ hoverPassThrough: true }}
              onClick={click}
            >
              <boxGeometry args={toSceneSize(node.interaction.hitBox.size)} />
              <meshBasicMaterial transparent opacity={0} depthWrite={false} />
            </mesh>
          )}
          {interactive &&
            (showAllLabels ||
              (showCounts &&
                knownOccupiedCount(
                  locationEntryCounts?.[node.locationCode!],
                ) !== null)) && (
              <CameraFacingLabel
                node={node}
                label={label}
                size={node.size}
                prioritySelected={node.locationCode === selectedCode}
                hovered={node.locationCode === hoveredCode}
                count={
                  showCounts
                    ? locationEntryCounts?.[node.locationCode!]
                    : undefined
                }
                onSelect={onSelect}
              />
            )}
        </group>
      )}
      {node.children?.map((child) => (
        <NodeVisual
          key={child.id}
          node={child}
          locationNames={locationNames}
          selectedCode={selectedCode}
          hasRenderedSelection={hasRenderedSelection}
          highlighted={highlighted}
          onSelect={onSelect}
          profiles={profiles}
          showAllLabels={showAllLabels}
          hoveredCode={hoveredCode}
          locationEntryCounts={locationEntryCounts}
          showCounts={showCounts}
          canSelect={canSelect}
        />
      ))}
    </group>
  );
}
type Animation = {
  from: Vector3;
  to: Vector3;
  offset: Vector3;
  fromZoom: number;
  toZoom: number;
  started: number;
  code: string | null;
};
export function finishFocusAnimation(
  camera: OrthographicCamera,
  target: Vector3,
  motion: Pick<Animation, 'to' | 'offset' | 'toZoom'>,
) {
  target.copy(motion.to);
  camera.position.copy(motion.to).add(motion.offset);
  camera.zoom = motion.toZoom;
  camera.updateProjectionMatrix();
}
function CameraRig({
  room,
  bindings,
  focusRequest,
  onFocusComplete,
  onFocusCancel,
  onReady,
  onFailure,
  initialView,
  focusOnRestore,
  onViewChange,
  command,
  orbitMode,
  manualGesture,
  active,
  selectionGesture,
  onDraggingChange,
}: Pick<
  RoomSceneProps,
  | 'room'
  | 'bindings'
  | 'focusRequest'
  | 'onFocusComplete'
  | 'onFocusCancel'
  | 'onReady'
  | 'onFailure'
  | 'initialView'
  | 'focusOnRestore'
  | 'onViewChange'
> & {
  command: ViewCommand;
  orbitMode: OrbitMode;
  manualGesture: { current: { active: boolean; lastMotionAt: number } };
  active: boolean;
  selectionGesture: { current: { suppressSelection: boolean } };
  onDraggingChange: (dragging: boolean) => void;
}) {
  const { camera, gl, size, invalidate } = useThree();
  const labelRegistry = useRoomLabelRegistry();
  const controls = useRef<ComponentRef<typeof OrbitControls>>(null);
  useEffect(
    () => attachMapInput(gl.domElement, active, selectionGesture),
    [gl, active, selectionGesture],
  );
  const animation = useRef<Animation | null>(null);
  const fitZoom = useRef(1);
  const fitTarget = useRef(new Vector3());
  const initializedRoom = useRef<RoomDefinition | null>(null);
  const lastCommandId = useRef(0);
  const lastFocusRequest = useRef<{
    code: string | null;
    requestId: number;
    room: RoomDefinition;
  } | null>(null);
  const lastAzimuth = useRef<number | null>(null);
  const unwrappedAzimuth = useRef(0);
  const manualStart = useRef<{
    position: Vector3;
    target: Vector3;
    zoom: number;
  } | null>(null);
  const ready = useRef(false);
  const renderedOnce = useRef(false);
  const viewCallback = useRef(onViewChange);
  const modeValue = useRef(orbitMode);
  useEffect(() => {
    viewCallback.current = onViewChange;
  }, [onViewChange]);
  useEffect(() => {
    modeValue.current = orbitMode;
  }, [orbitMode]);
  const reduced = useEffectiveReducedMotion();
  const initialTarget = useMemo(
    () => new Vector3(...toScenePosition(room.camera.target)),
    [room],
  );
  const roomBounds = useMemo(
    () => [
      {
        min: [0, 0, 0] as [number, number, number],
        max: [...room.dimensions] as [number, number, number],
      },
      ...bindings.map((binding) => binding.bounds),
    ],
    [room, bindings],
  );
  const currentFrame = useCallback(() => {
    camera.updateMatrixWorld();
    const right = new Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
    const up = new Vector3().setFromMatrixColumn(camera.matrixWorld, 1);
    return frameBounds(
      roomBounds,
      initialTarget,
      right,
      up,
      size,
      room.camera.fitPadding,
    );
  }, [camera, roomBounds, initialTarget, size, room.camera.fitPadding]);
  const writeTelemetry = useCallback(() => {
    if (!controls.current || !(camera instanceof OrthographicCamera)) return;
    const offset = camera.position.clone().sub(controls.current.target);
    const azimuth = Math.atan2(offset.x, offset.z);
    if (lastAzimuth.current === null) unwrappedAzimuth.current = azimuth;
    else {
      const change = azimuth - lastAzimuth.current;
      unwrappedAzimuth.current += Math.atan2(
        Math.sin(change),
        Math.cos(change),
      );
    }
    lastAzimuth.current = azimuth;
    const canvas = gl.domElement;
    canvas.dataset.cameraAzimuth = String(azimuth);
    canvas.dataset.cameraAzimuthUnwrapped = String(unwrappedAzimuth.current);
    canvas.dataset.cameraElevation = String(
      Math.asin(MathUtils.clamp(offset.y / offset.length(), -1, 1)),
    );
    canvas.dataset.cameraZoom = String(camera.zoom);
    canvas.dataset.cameraTarget = JSON.stringify(
      controls.current.target.toArray(),
    );
    canvas.dataset.cameraPosition = JSON.stringify(camera.position.toArray());
    camera.updateMatrixWorld();
    canvas.dataset.cameraViewMatrix = JSON.stringify(
      camera.matrixWorldInverse.elements,
    );
    canvas.dataset.cameraProjectionMatrix = JSON.stringify(
      camera.projectionMatrix.elements,
    );
    // Mark placement pending in the same turn as the camera transform, before
    // a caller can treat the previous projected labels as settled.
    labelRegistry.schedule();
  }, [camera, gl, labelRegistry]);
  const emitView = useCallback(() => {
    if (!controls.current || !(camera instanceof OrthographicCamera)) return;
    const view: CameraView = {
      position: camera.position.toArray() as [number, number, number],
      target: controls.current.target.toArray() as [number, number, number],
      zoom: camera.zoom,
      mode: modeValue.current,
    };
    if (!validCameraView(view)) return;
    gl.domElement.dataset.cameraView = JSON.stringify(view);
    viewCallback.current?.(view);
  }, [camera, gl]);
  useEffect(
    () => () => {
      if (!animation.current) emitView();
    },
    [emitView],
  );
  useEffect(() => {
    const motion = animation.current;
    if (
      !reduced ||
      !motion ||
      !controls.current ||
      !(camera instanceof OrthographicCamera)
    )
      return;
    animation.current = null;
    finishFocusAnimation(camera, controls.current.target, motion);
    controls.current.update();
    writeTelemetry();
    emitView();
    onFocusComplete(motion.code);
    invalidate();
  }, [reduced, camera, writeTelemetry, emitView, onFocusComplete, invalidate]);
  useEffect(() => {
    const canvas = gl.domElement;
    const lost = (event: Event) => {
      event.preventDefault();
      animation.current = null;
      onFailure(
        'The graphics context was lost. Use the location list or retry the room.',
      );
    };
    canvas.addEventListener('webglcontextlost', lost);
    return () => canvas.removeEventListener('webglcontextlost', lost);
  }, [gl, onFailure]);
  useEffect(() => {
    if (!(camera instanceof OrthographicCamera) || !controls.current) return;
    const freshRoom = initializedRoom.current !== room;
    if (freshRoom) {
      const azimuth = MathUtils.degToRad(room.camera.azimuthDegrees);
      const elevation = MathUtils.degToRad(room.camera.elevationDegrees);
      const distance = Math.max(...room.dimensions) * 3;
      camera.position
        .copy(initialTarget)
        .add(
          new Vector3(
            Math.sin(azimuth) * Math.cos(elevation) * distance,
            Math.sin(elevation) * distance,
            Math.cos(azimuth) * Math.cos(elevation) * distance,
          ),
        );
      camera.lookAt(initialTarget);
      controls.current.target.copy(initialTarget);
      initializedRoom.current = room;
      animation.current = null;
    }
    const frame = currentFrame();
    fitTarget.current.copy(frame.target);
    fitZoom.current = frame.zoom;
    controls.current.minZoom = fitZoom.current * room.camera.zoomLimits[0];
    controls.current.maxZoom = fitZoom.current * room.camera.zoomLimits[1];
    if (freshRoom) {
      camera.position.add(frame.target.clone().sub(controls.current.target));
      controls.current.target.copy(frame.target);
      camera.zoom = frame.zoom;
      if (validCameraView(initialView)) {
        camera.position.set(...initialView.position);
        controls.current.target.set(...initialView.target);
        camera.zoom = MathUtils.clamp(
          initialView.zoom,
          controls.current.minZoom,
          controls.current.maxZoom,
        );
        if (!focusOnRestore)
          lastFocusRequest.current = { ...focusRequest, room };
      }
      camera.updateProjectionMatrix();
    }
    controls.current.update();
    writeTelemetry();
    emitView();
    invalidate();
  }, [
    camera,
    currentFrame,
    initialTarget,
    room,
    invalidate,
    writeTelemetry,
    initialView,
    focusOnRestore,
    focusRequest,
    emitView,
  ]);
  useEffect(() => {
    gl.domElement.dataset.orbitMode = orbitMode;
    if (animation.current) onFocusCancel?.();
    animation.current = null;
    if (!(camera instanceof OrthographicCamera) || !controls.current) return;
    if (orbitMode !== 'guided') {
      emitView();
      return;
    }
    const control = controls.current;
    const constrained = guidedOffset(
      camera.position,
      control.target,
      [
        MathUtils.degToRad(room.camera.azimuthLimitsDegrees[0]),
        MathUtils.degToRad(room.camera.azimuthLimitsDegrees[1]),
      ],
      room.camera.elevationLimitsDegrees,
    );
    if (
      camera.position
        .clone()
        .sub(control.target)
        .distanceToSquared(constrained) > 1e-8
    ) {
      animation.current = null;
      camera.position.copy(control.target).add(constrained);
      control.update();
      writeTelemetry();
      emitView();
      invalidate();
    } else emitView();
  }, [
    orbitMode,
    camera,
    gl,
    invalidate,
    room,
    writeTelemetry,
    emitView,
    onFocusCancel,
  ]);
  useEffect(() => {
    if (!(camera instanceof OrthographicCamera) || !controls.current) return;
    if (
      lastFocusRequest.current?.code === focusRequest.code &&
      lastFocusRequest.current.requestId === focusRequest.requestId &&
      lastFocusRequest.current.room === room
    )
      return;
    lastFocusRequest.current = { ...focusRequest, room };
    const binding = findFocusBinding(bindings, focusRequest.code);
    if (focusRequest.code && !binding) {
      onFocusComplete(null);
      return;
    }
    // Guided/Free rotation changes the projected room width. Refresh the zoom
    // limits before fitting a binding, including a room-wide aggregate.
    const frame = currentFrame();
    fitTarget.current.copy(frame.target);
    fitZoom.current = frame.zoom;
    controls.current.minZoom = frame.zoom * room.camera.zoomLimits[0];
    controls.current.maxZoom = frame.zoom * room.camera.zoomLimits[1];
    const target = binding
      ? new Vector3(...toScenePosition(binding.focusPoint))
      : fitTarget.current.clone();
    camera.updateMatrixWorld();
    const right = new Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
    const up = new Vector3().setFromMatrixColumn(camera.matrixWorld, 1);
    const zoom = binding
      ? focusZoomForBinding(
          binding.bounds,
          target,
          right,
          up,
          size,
          room.camera.fitPadding,
          fitZoom.current,
          room.camera.zoomLimits,
        )
      : fitZoom.current;
    const offset = camera.position.clone().sub(controls.current.target);
    if (reduced) {
      controls.current.target.copy(target);
      camera.position.copy(target).add(offset);
      camera.zoom = zoom;
      camera.updateProjectionMatrix();
      controls.current.update();
      writeTelemetry();
      emitView();
      onFocusComplete(focusRequest.code);
    } else
      animation.current = {
        from: controls.current.target.clone(),
        to: target,
        offset,
        fromZoom: camera.zoom,
        toZoom: zoom,
        started: performance.now(),
        code: focusRequest.code,
      };
    invalidate();
  }, [
    focusRequest,
    focusRequest.requestId,
    focusRequest.code,
    bindings,
    camera,
    currentFrame,
    size,
    room,
    onFocusComplete,
    invalidate,
    writeTelemetry,
    emitView,
    reduced,
  ]);
  useEffect(() => {
    if (
      !command.id ||
      command.id === lastCommandId.current ||
      !(camera instanceof OrthographicCamera) ||
      !controls.current
    )
      return;
    lastCommandId.current = command.id;
    if (animation.current) onFocusCancel?.();
    animation.current = null;
    const control = controls.current;
    if (command.kind === 'fit') {
      const frame = currentFrame();
      const offset = camera.position.clone().sub(control.target);
      control.target.copy(frame.target);
      camera.position.copy(frame.target).add(offset);
      fitTarget.current.copy(frame.target);
      fitZoom.current = frame.zoom;
      control.minZoom = frame.zoom * room.camera.zoomLimits[0];
      control.maxZoom = frame.zoom * room.camera.zoomLimits[1];
      camera.zoom = frame.zoom;
    } else if (command.kind === 'recenter') {
      const position = recenteredPosition(
        camera.position,
        control.target,
        initialTarget,
      );
      control.target.copy(initialTarget);
      camera.position.copy(position);
    } else if (command.kind === 'zoom-in' || command.kind === 'zoom-out')
      camera.zoom = MathUtils.clamp(
        camera.zoom * (command.kind === 'zoom-in' ? 1.2 : 1 / 1.2),
        control.minZoom,
        control.maxZoom,
      );
    else if (
      command.kind === 'rotate-left' ||
      command.kind === 'rotate-right'
    ) {
      const offset = rotatedOffset(
        camera.position,
        control.target,
        MathUtils.degToRad(command.kind === 'rotate-left' ? -10 : 10),
        [control.minAzimuthAngle, control.maxAzimuthAngle],
      );
      camera.position.copy(control.target).add(offset);
    } else if (command.kind === 'tilt-up' || command.kind === 'tilt-down') {
      const offset = tiltedOffset(
        camera.position,
        control.target,
        MathUtils.degToRad(command.kind === 'tilt-up' ? -10 : 10),
        [control.minPolarAngle, control.maxPolarAngle],
      );
      camera.position.copy(control.target).add(offset);
    } else {
      const shift = new Vector3();
      if (command.kind === 'left' || command.kind === 'right')
        shift
          .setFromMatrixColumn(camera.matrixWorld, 0)
          .multiplyScalar(command.kind === 'left' ? -12 : 12);
      else
        shift
          .setFromMatrixColumn(camera.matrixWorld, 1)
          .multiplyScalar(command.kind === 'up' ? 12 : -12);
      control.target.add(shift);
      camera.position.add(shift);
    }
    camera.updateProjectionMatrix();
    control.update();
    writeTelemetry();
    emitView();
    invalidate();
  }, [
    command,
    camera,
    initialTarget,
    room,
    currentFrame,
    invalidate,
    writeTelemetry,
    emitView,
    onFocusCancel,
  ]);
  useFrame(() => {
    if (!ready.current) {
      if (renderedOnce.current && gl.info.render.calls > 0) {
        ready.current = true;
        onReady();
      } else {
        renderedOnce.current = true;
        invalidate();
      }
    }
    if (
      !animation.current ||
      !controls.current ||
      !(camera instanceof OrthographicCamera)
    )
      return;
    const motion = animation.current,
      t = Math.min(1, (performance.now() - motion.started) / 300),
      ease = 1 - Math.pow(1 - t, 3);
    controls.current.target.lerpVectors(motion.from, motion.to, ease);
    camera.position.copy(controls.current.target).add(motion.offset);
    camera.zoom = MathUtils.lerp(motion.fromZoom, motion.toZoom, ease);
    camera.updateProjectionMatrix();
    controls.current.update();
    writeTelemetry();
    if (t === 1) {
      animation.current = null;
      emitView();
      onFocusComplete(motion.code);
    } else invalidate();
  });
  return (
    <OrbitControls
      ref={controls}
      makeDefault
      domElement={gl.domElement}
      enabled={active}
      enableDamping={false}
      minAzimuthAngle={
        orbitMode === 'free'
          ? -Infinity
          : MathUtils.degToRad(room.camera.azimuthLimitsDegrees[0])
      }
      maxAzimuthAngle={
        orbitMode === 'free'
          ? Infinity
          : MathUtils.degToRad(room.camera.azimuthLimitsDegrees[1])
      }
      minPolarAngle={
        orbitMode === 'free'
          ? FREE_POLAR_EPSILON
          : MathUtils.degToRad(90 - room.camera.elevationLimitsDegrees[1])
      }
      maxPolarAngle={
        orbitMode === 'free'
          ? Math.PI - FREE_POLAR_EPSILON
          : MathUtils.degToRad(90 - room.camera.elevationLimitsDegrees[0])
      }
      enablePan
      enableZoom
      screenSpacePanning
      zoomSpeed={0.7}
      onStart={() => {
        if (animation.current) onFocusCancel?.();
        animation.current = null;
        manualGesture.current.active = true;
        onDraggingChange(true);
        if (controls.current)
          manualStart.current = {
            position: camera.position.clone(),
            target: controls.current.target.clone(),
            zoom: camera.zoom,
          };
      }}
      onChange={() => {
        if (
          manualStart.current &&
          controls.current &&
          (camera.position.distanceToSquared(manualStart.current.position) >
            1e-6 ||
            controls.current.target.distanceToSquared(
              manualStart.current.target,
            ) > 1e-6 ||
            Math.abs(camera.zoom - manualStart.current.zoom) > 1e-6)
        )
          manualGesture.current.lastMotionAt = performance.now();
        writeTelemetry();
      }}
      onEnd={() => {
        manualGesture.current.active = false;
        onDraggingChange(false);
        manualStart.current = null;
        emitView();
      }}
    />
  );
}
export default function RoomScene(props: RoomSceneProps) {
  const [command, setCommand] = useState<ViewCommand>({ kind: 'fit', id: 0 });
  const [hoverState, setHoverState] = useState<{
    room: RoomDefinition;
    hit: VisibleHover;
  } | null>(null);
  const activeHover = hoverState?.room === props.room ? hoverState.hit : null;
  const tooltipButton = useRef<HTMLButtonElement>(null);
  const [tooltipSize, setTooltipSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const element = tooltipButton.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return;
      setTooltipSize({
        width: entry.borderBoxSize[0]?.inlineSize ?? element.offsetWidth,
        height: entry.borderBoxSize[0]?.blockSize ?? element.offsetHeight,
      });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [activeHover?.needsTooltip, activeHover?.target.code]);
  const tooltipPosition = activeHover
    ? placeHoverTooltip(activeHover, activeHover, tooltipSize)
    : null;
  const labelPointer = useRef(false);
  const [retainDuringLabelHandoff, setRetainDuringLabelHandoff] =
    useState(false);
  const hoverExit = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (hoverExit.current !== null) clearTimeout(hoverExit.current);
    },
    [],
  );
  const cancelHoverExit = useCallback(() => {
    if (hoverExit.current !== null) clearTimeout(hoverExit.current);
    hoverExit.current = null;
  }, []);
  const onVisibleHover = useCallback(
    (hit: VisibleHover | null) => {
      cancelHoverExit();
      if (!hit) {
        setHoverState(null);
        return;
      }
      setHoverState((current) =>
        current?.room === props.room &&
        current.hit.target.code === hit.target.code &&
        current.hit.needsTooltip === hit.needsTooltip &&
        current.hit.width === hit.width &&
        current.hit.height === hit.height &&
        current.hit.x === hit.x &&
        current.hit.y === hit.y
          ? current
          : { room: props.room, hit },
      );
    },
    [cancelHoverExit, props.room],
  );
  const onCanvasHoverLeave = useCallback(() => {
    cancelHoverExit();
    if (labelPointer.current) return;
    hoverExit.current = setTimeout(() => {
      hoverExit.current = null;
      if (!labelPointer.current) setHoverState(null);
    }, 80);
  }, [cancelHoverExit]);
  const [labelPreference, setLabelPreference] = useState({
    room: props.room,
    showAll: false,
  });
  const showAllLabels =
    labelPreference.room === props.room && labelPreference.showAll;
  const selectedLabel =
    (props.selectedCode ? props.locationNames?.[props.selectedCode] : null) ??
    selectedSceneLabel(props.room.nodes, props.selectedCode) ??
    props.selectedCode;
  const [suppressedLabels, setSuppressedLabels] = useState(0);
  const onSuppressionChange = useCallback(
    (count: number) => setSuppressedLabels(count),
    [],
  );
  const manualGesture = useRef({ active: false, lastMotionAt: -Infinity });
  const persistedMode = useSyncExternalStore(
    subscribeOrbitMode,
    readOrbitMode,
    (): OrbitMode => 'guided',
  );
  const [ephemeralMode, setEphemeralMode] = useState<OrbitMode | null>(null);
  const orbitMode =
    ephemeralMode ??
    (validCameraView(props.initialView)
      ? props.initialView.mode
      : persistedMode);
  const chooseMode = (mode: OrbitMode) => {
    setEphemeralMode(mode);
    try {
      window.localStorage.setItem(ORBIT_MODE_KEY, mode);
      window.dispatchEvent(new Event('room-orbit-mode-change'));
    } catch {
      /* Local room mode remains usable without storage. */
    }
  };
  const requestCommand = useCallback((kind: ViewCommand['kind']) => {
    setCommand((old) => ({ kind, id: old.id + 1 }));
  }, []);
  const highlighted = useMemo(
    () => new Set(props.highlightedCodes),
    [props.highlightedCodes],
  );
  // Logical selections can have no represented mesh. Only a highlighted box
  // should dim its physical neighbors, including descendants of aggregates.
  const renderedSelection = useMemo(
    () =>
      hasRenderedSelection(props.room.nodes, props.selectedCode, highlighted),
    [props.room.nodes, props.selectedCode, highlighted],
  );
  const [interaction, setInteraction] = useState({
    room: props.room,
    active: false,
  });
  const active = interaction.room === props.room && interaction.active;
  const setActive = useCallback(
    (next: boolean) => setInteraction({ room: props.room, active: next }),
    [props.room],
  );
  const [dragging, setDragging] = useState(false);
  const [localShowCounts, setShowCounts] = useState(false);
  const showCounts = props.showCounts ?? localShowCounts;
  const surface = useRef<HTMLDivElement>(null);
  const selectionGesture = useRef({ suppressSelection: false });
  const canSelect = useCallback(
    () => !selectionGesture.current.suppressSelection,
    [],
  );
  const registry = useMemo(
    () => createRoomLabelRegistry(onSuppressionChange),
    [onSuppressionChange],
  );
  const hoverLeader = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (
      !activeHover?.needsTooltip ||
      !tooltipButton.current ||
      !hoverLeader.current
    )
      return;
    return registry.register(
      'hover-tooltip',
      tooltipButton.current,
      hoverLeader.current,
      {
        priority: activeHover.target.code === props.selectedCode ? 3 : 2,
        locationCode: activeHover.target.code,
      },
    );
  }, [
    registry,
    activeHover?.needsTooltip,
    activeHover?.target.code,
    props.selectedCode,
    tooltipSize,
  ]);
  useEffect(() => {
    if (!active) return;
    const leave = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        !surface.current?.contains(event.target)
      ) {
        setActive(false);
        setDragging(false);
      }
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setActive(false);
        setDragging(false);
      }
    };
    document.addEventListener('pointerdown', leave, true);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', leave, true);
      document.removeEventListener('keydown', escape);
    };
  }, [active, setActive]);
  const hoverCount =
    showCounts && activeHover
      ? knownOccupiedCount(props.locationEntryCounts?.[activeHover.target.code])
      : null;
  return (
    <div
      ref={surface}
      data-room-surface="true"
      className={styles.scene}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) {
          setActive(false);
          setDragging(false);
        }
      }}
    >
      <RoomToolbar
        active={active}
        onActiveChange={(next) => {
          setActive(next);
          setDragging(false);
        }}
        canFocusSelected={props.canFocusSelected}
        onRequestFocus={props.onRequestFocus}
        onCommand={requestCommand}
        mode={orbitMode}
        onModeChange={chooseMode}
        showLabels={showAllLabels}
        onLabelsChange={() =>
          setLabelPreference({ room: props.room, showAll: !showAllLabels })
        }
        showCounts={showCounts}
        onCountsChange={() => {
          setShowCounts(!showCounts);
          props.onCountsChange?.(!showCounts);
        }}
      />
      <div className={styles.canvasFrame} aria-label="Interactive room canvas">
        <Canvas
          onFailure={props.onFailure}
          orthographic
          frameloop="demand"
          dpr={[1, 1.5]}
          camera={{ near: 0.1, far: 3000, position: [200, 300, 300], zoom: 1 }}
          gl={{ antialias: true, alpha: false, powerPreference: 'low-power' }}
          fallback={
            <p>Graphics are unavailable. Use the location controls below.</p>
          }
        >
          <color attach="background" args={['#07111f']} />
          <ambientLight intensity={1.1} />
          <directionalLight position={[100, 220, 100]} intensity={2} />
          <directionalLight
            position={[-80, 100, -100]}
            intensity={0.7}
            color="#bae6fd"
          />
          <LabelLayoutProvider registry={registry}>
            <LabelLayoutDriver registry={registry} />
            <SceneDepth room={props.room} />
            <Envelope
              room={props.room}
              onRecenter={() => requestCommand('recenter')}
              canRecenter={(delta) =>
                floorDoubleClickAllowed(
                  delta,
                  manualGesture.current.active,
                  manualGesture.current.lastMotionAt,
                  performance.now(),
                )
              }
              showAllLabels={showAllLabels}
            />
            {props.room.nodes.map((node) => (
              <NodeVisual
                key={node.id}
                node={node}
                locationNames={props.locationNames}
                selectedCode={props.selectedCode}
                hasRenderedSelection={renderedSelection}
                highlighted={highlighted}
                onSelect={props.onSelect}
                profiles={props.room.rackFaceProfiles}
                showAllLabels={showAllLabels}
                hoveredCode={activeHover?.target.code ?? null}
                locationEntryCounts={props.locationEntryCounts}
                showCounts={showCounts}
                canSelect={canSelect}
              />
            ))}
            <CameraRig
              {...props}
              command={command}
              orbitMode={orbitMode}
              manualGesture={manualGesture}
              active={active}
              selectionGesture={selectionGesture}
              onDraggingChange={setDragging}
            />
            <VisibleHoverTracker
              showAllLabels={showAllLabels}
              active={active}
              suspended={active && dragging}
              retainDuringLabelHandoff={retainDuringLabelHandoff}
              onHit={onVisibleHover}
              onCanvasLeave={onCanvasHoverLeave}
            />
          </LabelLayoutProvider>
        </Canvas>
        {activeHover?.needsTooltip && (
          <div
            className={styles.hoverAnchor}
            style={{ left: tooltipPosition?.left, top: tooltipPosition?.top }}
          >
            <span
              ref={hoverLeader}
              className={styles.labelLeader}
              aria-hidden="true"
            />
            <button
              ref={tooltipButton}
              type="button"
              data-hover-tooltip="true"
              data-location-code={activeHover.target.code}
              aria-label={`Select ${props.locationNames?.[activeHover.target.code] ?? activeHover.target.label} (${activeHover.target.code})${hoverCount !== null ? `; ${hoverCount} active inventory entries: positive-stock quantity items and active individual assets at this destination` : ''}`}
              aria-pressed={props.selectedCode === activeHover.target.code}
              onPointerEnter={() => {
                labelPointer.current = true;
                setRetainDuringLabelHandoff(true);
                cancelHoverExit();
              }}
              onPointerLeave={() => {
                labelPointer.current = false;
                setRetainDuringLabelHandoff(false);
                onCanvasHoverLeave();
              }}
              onClick={(event) => {
                event.stopPropagation();
                props.onSelect(activeHover.target.code);
              }}
              onDoubleClick={(event) => event.stopPropagation()}
              className={styles.locationLabel}
              style={{
                maxWidth: Math.max(0, Math.min(208, activeHover.width - 16)),
                overflowWrap: 'anywhere',
              }}
            >
              {props.locationNames?.[activeHover.target.code] ??
                activeHover.target.label}
              {hoverCount !== null && (
                <span className={styles.countBadge}>
                  {' '}
                  · {hoverCount} {hoverCount === '1' ? 'item' : 'items'}
                </span>
              )}
            </button>
          </div>
        )}
      </div>
      {selectedLabel && (
        <p role="status" className={styles.sceneStatus}>
          Selected location: {selectedLabel}
          {selectedLabel !== props.selectedCode && ` (${props.selectedCode})`}
        </p>
      )}
      {(showAllLabels || showCounts) && suppressedLabels > 0 && (
        <p role="status" className={styles.sceneNote}>
          Some room labels are hidden at this view. Zoom in or use the location
          picker.
        </p>
      )}
      <p className={styles.sceneNote}>
        {active
          ? 'Map interaction is on. Done or Escape returns to page scrolling.'
          : 'Select a location. Use More map controls to interact or get help.'}
      </p>
    </div>
  );
}
