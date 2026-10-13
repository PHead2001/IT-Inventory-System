/* eslint-disable react-hooks/immutability -- Three.js camera objects are intentionally mutated inside effects/frame callbacks at this imperative graphics boundary. */
'use client';
import { useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import {
  useCallback,
  useContext,
  useInsertionEffect,
  useEffect,
  useMemo,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ComponentRef,
} from 'react';
import {
  Group,
  ACESFilmicToneMapping,
  MathUtils,
  OrthographicCamera,
  Raycaster,
  Vector2,
  Vector3,
} from 'three';
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
import {
  ScenePaletteProvider,
  ScenePaletteLighting,
  SelectionEdges,
} from './scene-palette';
import { SceneDepth } from './scene-depth';
import {
  SceneEffectsProvider,
  useOptionalSceneEffects,
  useVisualHoverCode,
} from './scene-effects-context';
import { SceneEffectsOwner } from './scene-effects-owner';
import { HoveredBody } from './hovered-body';
import type { EffectsQuality } from './scene-effects-state';
import { useRoomEffectsQuality } from '@/components/experience/room-effects-preference';
import { useSceneCurrent } from './scene-current';
import { RoomLabel } from './room-label';
import {
  occupiedLocation,
  occupancyText,
  type RoomOccupancy,
  type LocationOccupancy,
} from '../occupancy-contract';
import {
  RoomVisibilityProvider,
  useRoomVisibilityBatch,
} from './room-visibility-runtime';
import { createInitialFramePolicy, hasMeasuredViewport } from './initial-frame';
import { RoomLabelHtml } from './room-label-html';
import { SafeCanvas as Canvas } from './safe-canvas';
import {
  VisibleHoverTracker,
  type VisibleHover,
} from './visible-hover-runtime';
import { placeHoverTooltip } from './visible-hover';
import {
  createRoomSelectionGesture,
  roomSelectionBox,
  roomSelectionTarget,
} from './room-selection';
import {
  createSpatialRevealController,
  focusToken,
  presentationBindings,
  revealOffset,
  sameFocusToken,
  SPATIAL_MOTION,
  type FocusRequest,
  type FocusToken,
  type SpatialRevealController,
} from './spatial-reveal';
import { validCameraView, type CameraView } from './camera-view';
import styles from '../room-visual.module.css';
import { usePrivacyReadiness } from '@/components/auth/privacy-readiness';
import { freshPresentationGrant } from '@/components/experience/presentation-privacy';
import { SceneSessionContext } from './scene-budget-provider';
import {
  subscribePrivacyRevocation,
  subscribeAssignmentInvalidation,
  subscribeAuthoritativeCleanup,
} from '@/features/scan/assign-batch';

export type RoomSceneProps = {
  onGraphicsActiveChange?: (active: boolean) => void;
  compact?: boolean;
  permittedCodes?: readonly string[];
  selectionAllowed?: () => boolean;
  selectionMode?: 'select' | 'preview';
  room: RoomDefinition;
  locationNames?: Record<string, string>;
  locationOccupancy?: RoomOccupancy;
  showCounts?: boolean;
  effectsQuality?: EffectsQuality;
  onCountsChange?: (show: boolean) => void;
  bindings: RoomBinding[];
  selectedCode: string | null;
  highlightedCodes: string[];
  focusRequest: FocusRequest;
  focusOnRestore?: boolean;
  onSelect(code: string): void;
  onReady(): void;
  onFocusComplete(code: string | null, token?: FocusToken): void;
  onFocusCancel?(token?: FocusToken): void;
  onFailure(message: string): void;
  canFocusSelected: boolean;
  onRequestFocus(): void;
  initialView?: CameraView | null;
  initialViewReady?: boolean;
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
  passSelection = false,
}: {
  position: [number, number, number];
  size: [number, number, number];
  color?: string;
  onDoubleClick?: (event: ThreeEvent<MouseEvent>) => void;
  passSelection?: boolean;
}) {
  return (
    <mesh
      position={toScenePosition(position)}
      onClick={passSelection ? undefined : (event) => event.stopPropagation()}
      onDoubleClick={
        passSelection
          ? undefined
          : (event) => {
              event.stopPropagation();
              onDoubleClick?.(event);
            }
      }
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
    <group onDoubleClick={(event) => event.stopPropagation()}>
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
  occupancy,
  label,
  onSelect,
}: {
  node: RoomNode;
  size: [number, number, number];
  prioritySelected: boolean;
  hovered: boolean;
  occupancy?: LocationOccupancy;
  label: string;
  onSelect?: (code: string) => void;
}) {
  const { camera, invalidate } = useThree();
  const visibility = useRoomVisibilityBatch();
  const registry = useRoomLabelRegistry();
  const exposed = useRef(false);
  const isVisible = useCallback(() => exposed.current, []);
  const origin = useRef<Group>(null);
  const anchor = useRef<Group>(null);
  const labelAnchor = node.interaction?.labelAnchor;
  useFrame(() => {
    if (!origin.current || !anchor.current) return;
    const localView = cameraFacingDirectionInLocalSpace(camera, origin.current);
    const preferred = labelAnchor
      ? cameraFacingLabelPosition(size, localView, labelAnchor)
      : ([0, size[2] / 2 + 0.15, 0] as [number, number, number]);
    const result = visibility.resolve(
      origin.current,
      node.locationCode!,
      new Vector3(...preferred),
    );
    exposed.current = result.status === 'visible';
    if (result.status !== 'visible') {
      registry.hide(node.id);
      return;
    }
    const next = result.anchor.toArray();
    if (
      anchor.current.position.distanceToSquared(new Vector3(...next)) > 1e-6
    ) {
      anchor.current.position.set(...next);
      invalidate();
    }
  }, -0.25);
  const initial = labelAnchor
    ? toScenePosition(labelAnchor)
    : ([0, size[2] / 2 + 0.15, 0] as [number, number, number]);
  return (
    <group ref={origin}>
      <group ref={anchor} position={initial}>
        <RoomLabelHtml
          center
          style={{ pointerEvents: 'none', whiteSpace: 'nowrap' }}
          zIndexRange={[20, 0]}
        >
          <RoomLabel
            id={node.id}
            code={node.locationCode}
            label={label}
            selected={prioritySelected}
            priority={prioritySelected ? 3 : hovered ? 2 : 1}
            occupancy={occupancy}
            isVisible={isVisible}
            onSelect={onSelect}
          />
        </RoomLabelHtml>
      </group>
    </group>
  );
}
export function RevealedBody({
  node,
  open,
  settle,
  children,
}: {
  node: RoomNode;
  open: boolean;
  settle: boolean;
  children: React.ReactNode;
}) {
  const group = useRef<Group>(null);
  const { scene, invalidate } = useThree();
  const reduced = useEffectiveReducedMotion();
  const effects = useOptionalSceneEffects();
  const isCurrent = useSceneCurrent(effects);
  const finishMotion = useRef<(() => void) | null>(null);
  const motion = useRef<{ from: Vector3; to: Vector3; started: number } | null>(
    null,
  );
  const offset = useMemo(
    () => new Vector3(...toScenePosition(revealOffset(node))),
    [node],
  );
  useEffect(() => {
    // A reconciled endpoint always supersedes the previous animation, even
    // when it already equals the body's current position before its first frame.
    motion.current = null;
    finishMotion.current?.();
    finishMotion.current = null;
    if (!isCurrent() || !group.current) return;
    const to = open ? offset : new Vector3();
    const moves = group.current.position.distanceToSquared(to) > 1e-8;
    if (reduced || (open && settle)) {
      const finish = moves
        ? effects?.beginCasterMotion(`reveal:${node.id}`, node.id)
        : null;
      group.current.position.copy(to);
      scene.updateMatrixWorld(true);
      finish?.();
    } else if (moves) {
      finishMotion.current =
        effects?.beginCasterMotion(`reveal:${node.id}`, node.id) ?? null;
      motion.current = {
        from: group.current.position.clone(),
        to,
        started: performance.now(),
      };
    }
    invalidate();
  }, [
    open,
    settle,
    reduced,
    offset,
    scene,
    invalidate,
    effects,
    node.id,
    isCurrent,
  ]);
  useEffect(
    () => () => {
      motion.current = null;
      finishMotion.current?.();
    },
    [],
  );
  useFrame(() => {
    if (!isCurrent() || !motion.current || !group.current) return;
    const current = motion.current;
    const t = Math.min(
      1,
      (performance.now() - current.started) / SPATIAL_MOTION.revealMs,
    );
    group.current.position.lerpVectors(
      current.from,
      current.to,
      1 - Math.pow(1 - t, 3),
    );
    scene.updateMatrixWorld(true);
    if (t === 1) {
      motion.current = null;
      finishMotion.current?.();
      finishMotion.current = null;
    }
    // One last frame permits hover/label drivers to observe the endpoint.
    invalidate();
  }, -2);
  return (
    <group ref={group} userData={{ roomRevealNode: node.id }}>
      {children}
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
  locationOccupancy,
  showCounts,
  canSelect,
  openCode,
  revealSettled,
  selectionEnabled = true,
  isSelectable = () => true,
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
  locationOccupancy?: RoomOccupancy;
  showCounts: boolean;
  canSelect: () => boolean;
  openCode: string | null;
  revealSettled: boolean;
  selectionEnabled?: boolean;
  isSelectable?: (code: string) => boolean;
}) {
  const { camera, scene, gl } = useThree();
  const visualHoverCode = useVisualHoverCode();
  const [pointerOwner] = useState(createRoomSelectionGesture);
  useLayoutEffect(() => {
    pointerOwner.cancel();
  }, [pointerOwner, selectionEnabled]);
  const actualOwner = (event: ThreeEvent<PointerEvent | MouseEvent>) => {
    const rect = gl.domElement.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    scene.updateMatrixWorld(true);
    camera.updateMatrixWorld();
    const ray = new Raycaster();
    ray.setFromCamera(
      new Vector2(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        1 - ((event.clientY - rect.top) / rect.height) * 2,
      ),
      camera,
    );
    return (
      roomSelectionTarget(
        ray.intersectObjects(scene.children, true),
        isSelectable,
      )?.code ?? null
    );
  };
  const label =
    (node.locationCode && locationNames?.[node.locationCode]) ||
    node.interaction?.label ||
    node.locationCode ||
    node.id;
  const selected =
    !!node.locationCode &&
    (node.locationCode === selectedCode || highlighted.has(node.locationCode));
  const interactive = !!node.locationCode && !!node.interaction?.selectable;
  const proxy = selectionEnabled ? roomSelectionBox(node) : null;
  const click = (event: ThreeEvent<MouseEvent>) => {
    event.stopPropagation();
    const code = actualOwner(event);
    if (
      pointerOwner.click(
        code,
        event.delta,
        interactive && code === node.locationCode && canSelect(),
      )
    )
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
          onClick={selectionEnabled ? click : undefined}
          onPointerDown={
            selectionEnabled
              ? (event) => {
                  event.stopPropagation();
                  pointerOwner.down(actualOwner(event), event.pointerId);
                }
              : undefined
          }
          onPointerUp={
            selectionEnabled
              ? (event) => {
                  pointerOwner.up(actualOwner(event), event.pointerId);
                }
              : undefined
          }
          onPointerCancel={
            selectionEnabled
              ? () => {
                  pointerOwner.cancel();
                }
              : undefined
          }
          onDoubleClick={
            selectionEnabled ? (event) => event.stopPropagation() : undefined
          }
        >
          {proxy && (
            <mesh
              position={toScenePosition(proxy.center)}
              userData={{
                roomSelectionTarget: { code: node.locationCode, label },
                hoverPassThrough: true,
              }}
            >
              <boxGeometry args={toSceneSize(proxy.size)} />
              <meshBasicMaterial
                transparent
                opacity={0}
                depthWrite={false}
                colorWrite={false}
              />
            </mesh>
          )}
          <RevealedBody
            node={node}
            open={node.locationCode === openCode}
            settle={revealSettled}
          >
            <HoveredBody node={node}>
              <mesh>
                <boxGeometry args={toSceneSize(node.size)} />
                <SelectionMaterial
                  color={node.visual?.color ?? '#475569'}
                  selected={selected}
                  dimmed={hasRenderedSelection && !selected}
                  hovered={hoveredCode === node.locationCode}
                  opacity={node.visual?.opacity ?? 1}
                />
                {(node.visual?.edges || selected) && (
                  <SelectionEdges
                    selected={selected}
                    dimmed={hasRenderedSelection}
                    hovered={node.locationCode === visualHoverCode}
                  />
                )}
              </mesh>
              {node.visual?.style === 'drawer' && (
                <Solid
                  passSelection
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
                  passSelection
                  position={[0, 0, node.size[2] / 2 - 0.4]}
                  size={[node.size[0], node.size[1], 0.8]}
                  color={node.visual.color}
                />
              )}
              {node.visual?.style === 'rack' && (
                <group>
                  <Solid
                    passSelection
                    position={[0, -node.size[1] / 2 - 0.15, 0]}
                    size={[node.size[0] - 3, 0.3, node.size[2] - 4]}
                    color="#334155"
                  />
                  {profiles.map((profile, index) => (
                    <Solid
                      passSelection
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
                      passSelection
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
              {interactive &&
                (node.locationCode === selectedCode ||
                  showAllLabels ||
                  (showCounts &&
                    occupiedLocation(
                      locationOccupancy?.[node.locationCode!],
                    ) !== null)) && (
                  <CameraFacingLabel
                    node={node}
                    label={label}
                    size={node.size}
                    prioritySelected={node.locationCode === selectedCode}
                    hovered={node.locationCode === hoveredCode}
                    occupancy={
                      showCounts || node.locationCode === openCode
                        ? locationOccupancy?.[node.locationCode!]
                        : undefined
                    }
                    onSelect={selectionEnabled ? onSelect : undefined}
                  />
                )}
            </HoveredBody>
          </RevealedBody>
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
          locationOccupancy={locationOccupancy}
          showCounts={showCounts}
          canSelect={canSelect}
          openCode={openCode}
          revealSettled={revealSettled}
          selectionEnabled={selectionEnabled}
          isSelectable={isSelectable}
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
  token: FocusToken;
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
export function CameraRig({
  room,
  bindings,
  focusRequest,
  onFocusComplete,
  onFocusCancel,
  onReady,
  onFailure,
  initialView,
  initialViewReady = true,
  focusOnRestore,
  onViewChange,
  command,
  orbitMode,
  manualGesture,
  active,
  selectionGesture,
  onDraggingChange,
  onPassiveDrag,
  revealController: suppliedRevealController,
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
  | 'initialViewReady'
  | 'focusOnRestore'
  | 'onViewChange'
> & {
  command: ViewCommand;
  orbitMode: OrbitMode;
  manualGesture: { current: { active: boolean; lastMotionAt: number } };
  active: boolean;
  selectionGesture: { current: { suppressSelection: boolean } };
  onDraggingChange: (dragging: boolean) => void;
  onPassiveDrag: () => void;
  revealController?: SpatialRevealController;
}) {
  const suppliedSession = useContext(SceneSessionContext);
  // This rig belongs to the original renderer session, including late controls
  // callbacks. A fresh provider wrapper cannot replace that owner's lifetime.
  const [sceneSession] = useState(() => suppliedSession);
  const { camera, gl, size, invalidate } = useThree();
  const ownRevealController = useMemo(
    () => createSpatialRevealController(),
    [],
  );
  const revealController = suppliedRevealController ?? ownRevealController;
  const requestToken = useMemo(
    () => focusToken(focusRequest, room.roomId),
    [focusRequest, room.roomId],
  );
  const revealState = useSyncExternalStore(
    revealController.subscribe,
    revealController.getSnapshot,
    revealController.getSnapshot,
  );
  useEffect(() => {
    gl.domElement.dataset.spatialPhase = revealState.phase;
    gl.domElement.dataset.spatialOpenCode = revealState.openCode ?? '';
    gl.domElement.dataset.spatialRequest = revealState.token
      ? JSON.stringify(revealState.token)
      : '';
  }, [gl, revealState]);
  const currentToken = useRef(requestToken);
  useLayoutEffect(() => {
    currentToken.current = requestToken;
  }, [requestToken]);
  const labelRegistry = useRoomLabelRegistry();
  const controls = useRef<ComponentRef<typeof OrbitControls>>(null);
  useEffect(
    () =>
      attachMapInput(gl.domElement, active, selectionGesture, onPassiveDrag),
    [gl, active, selectionGesture, onPassiveDrag],
  );
  const animation = useRef<Animation | null>(null);
  const fitZoom = useRef(1);
  const fitTarget = useRef(new Vector3());
  type CameraResource = {
    room: RoomDefinition;
    camera: typeof camera;
    control: ComponentRef<typeof OrbitControls>;
  };
  const [resource, setResource] = useState<CameraResource | null>(null);
  const [renderedResource, setRenderedResource] =
    useState<CameraResource | null>(null);
  const sceneCommitted = resource !== null && renderedResource === resource;
  const committedResource = useRef<CameraResource | null>(null);
  const initializedResource = useRef<CameraResource | null>(null);
  const commitControls = useCallback(
    (control: ComponentRef<typeof OrbitControls> | null) => {
      if (!control || !sceneSession.current()) return;
      controls.current = control;
      const owner = { room, camera, control };
      // Ref attachment commits the actual resource. Retire before passive
      // cleanup can emit an outgoing camera through replacement controls.
      committedResource.current = owner;
      setResource(owner);
      return () => {
        if (committedResource.current !== owner) return;
        controls.current = null;
        committedResource.current = null;
        setResource((current) => (current === owner ? null : current));
      };
    },
    [room, camera, sceneSession],
  );
  const resourceCurrent = useCallback(() => {
    const current = committedResource.current;
    const initialized = initializedResource.current;
    return (
      sceneSession.current() &&
      current?.room === room &&
      current.camera === camera &&
      current.control === controls.current &&
      resource?.room === room &&
      resource.camera === camera &&
      resource.control === controls.current &&
      initialized === resource
    );
  }, [room, camera, resource, sceneSession]);
  const lastCommandId = useRef(0);
  const lastFocusRequest = useRef<{
    code: string | null;
    requestId: number;
    room: RoomDefinition;
    token?: FocusToken;
  } | null>(null);
  const lastAzimuth = useRef<number | null>(null);
  const unwrappedAzimuth = useRef(0);
  const manualStart = useRef<{
    position: Vector3;
    target: Vector3;
    zoom: number;
  } | null>(null);
  const initialFrame = useRef(createInitialFramePolicy());
  const ready = useRef(false);
  const renderedOnce = useRef(false);
  const viewCallback = useRef(onViewChange);
  const modeValue = useRef(orbitMode);
  const appliedMode = useRef(orbitMode);
  useEffect(() => {
    viewCallback.current = onViewChange;
  }, [onViewChange]);
  useEffect(() => {
    if (
      modeValue.current !== orbitMode &&
      hasMeasuredViewport(size.width, size.height) &&
      resourceCurrent()
    )
      initialFrame.current.manual();
    // Retain the newest mode while the first measured frame is still pending.
    modeValue.current = orbitMode;
  }, [orbitMode, room, size.width, size.height, resourceCurrent]);
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
  const focusBindings = useMemo(
    () => presentationBindings(room, bindings),
    [room, bindings],
  );
  useEffect(() => {
    if (
      animation.current &&
      !sameFocusToken(animation.current.token, requestToken)
    )
      animation.current = null;
    const state = revealController.getSnapshot();
    if (!sameFocusToken(state.token, requestToken))
      revealController.begin(
        requestToken,
        !!findFocusBinding(focusBindings, requestToken.code),
        performance.now(),
      );
  }, [requestToken, focusBindings, revealController]);
  const interruptFocus = useCallback(() => {
    const token =
      animation.current?.token ?? revealController.getSnapshot().token;
    animation.current = null;
    revealController.interrupt(token);
    if (token) onFocusCancel?.(token);
    invalidate();
  }, [revealController, onFocusCancel, invalidate]);
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
    if (
      !controls.current ||
      !(camera instanceof OrthographicCamera) ||
      !resourceCurrent()
    )
      return;
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
  }, [camera, gl, labelRegistry, resourceCurrent]);
  const emitView = useCallback(() => {
    if (
      !sceneSession.current() ||
      !controls.current ||
      !(camera instanceof OrthographicCamera) ||
      !resourceCurrent()
    )
      return;
    const view: CameraView = {
      position: camera.position.toArray() as [number, number, number],
      target: controls.current.target.toArray() as [number, number, number],
      zoom: camera.zoom,
      mode: modeValue.current,
    };
    if (!validCameraView(view)) return;
    gl.domElement.dataset.cameraView = JSON.stringify(view);
    viewCallback.current?.(view);
  }, [camera, gl, resourceCurrent, sceneSession]);
  useEffect(
    () => () => {
      if (!animation.current) emitView();
      animation.current = null;
    },
    [emitView],
  );
  useEffect(() => () => revealController.dispose(), [revealController]);
  useEffect(() => {
    const motion = animation.current;
    if (
      !reduced ||
      !motion ||
      !controls.current ||
      !(camera instanceof OrthographicCamera) ||
      !resourceCurrent()
    )
      return;
    animation.current = null;
    if (
      !sameFocusToken(currentToken.current, motion.token) ||
      !revealController.valid(motion.token)
    )
      return;
    finishFocusAnimation(camera, controls.current.target, motion);
    controls.current.update();
    writeTelemetry();
    emitView();
    revealController.finishFlight(motion.token, performance.now(), true);
    onFocusComplete(motion.token.code, motion.token);
    invalidate();
  }, [
    reduced,
    camera,
    writeTelemetry,
    emitView,
    onFocusComplete,
    invalidate,
    revealController,
    resourceCurrent,
  ]);
  useEffect(() => {
    if (reduced) {
      const state = revealController.getSnapshot();
      if (state.token) revealController.settle(state.token);
      invalidate();
    }
  }, [reduced, revealController, invalidate]);
  useEffect(() => {
    const canvas = gl.domElement;
    const lost = (event: Event) => {
      event.preventDefault();
      animation.current = null;
      revealController.dispose();
      onFailure(
        'The graphics context was lost. Use the location list or retry the room.',
      );
    };
    canvas.addEventListener('webglcontextlost', lost);
    return () => canvas.removeEventListener('webglcontextlost', lost);
  }, [gl, onFailure, revealController]);
  useEffect(() => {
    if (
      !(camera instanceof OrthographicCamera) ||
      !controls.current ||
      !hasMeasuredViewport(size.width, size.height)
    )
      return;
    if (
      !sceneSession.current() ||
      resource?.room !== room ||
      resource.camera !== camera ||
      resource.control !== controls.current
    )
      return;
    const freshRoom = !resourceCurrent();
    // A withheld snapshot is not an authorized empty snapshot. Do not consume
    // the first measured frame or publish its default pose before restoration
    // and its committed writer are available. An existing camera stays intact.
    if (freshRoom && !initialViewReady) return;
    if (freshRoom && initializedResource.current !== null)
      initialFrame.current.reset();
    const initialAction = initialFrame.current.measure(
      size.width,
      size.height,
      validCameraView(initialView),
    );
    if (freshRoom) {
      const azimuth = MathUtils.degToRad(room.camera.azimuthDegrees);
      const elevation = MathUtils.degToRad(room.camera.elevationDegrees);
      const distance = Math.max(...room.dimensions) * 3;
      if (initialAction !== 'preserve')
        camera.position
          .copy(initialTarget)
          .add(
            new Vector3(
              Math.sin(azimuth) * Math.cos(elevation) * distance,
              Math.sin(elevation) * distance,
              Math.cos(azimuth) * Math.cos(elevation) * distance,
            ),
          );
      if (initialAction !== 'preserve') {
        camera.lookAt(initialTarget);
        controls.current.target.copy(initialTarget);
      }
      initializedResource.current = resource;
      animation.current = null;
      manualStart.current = null;
      lastFocusRequest.current = null;
      ready.current = false;
      renderedOnce.current = false;
    }
    const frame = currentFrame();
    fitTarget.current.copy(frame.target);
    fitZoom.current = frame.zoom;
    controls.current.minZoom = fitZoom.current * room.camera.zoomLimits[0];
    controls.current.maxZoom = fitZoom.current * room.camera.zoomLimits[1];
    if (initialAction === 'fit' || initialAction === 'restore') {
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
        if (!focusOnRestore) {
          lastFocusRequest.current = {
            ...focusRequest,
            room,
            token: requestToken,
          };
          revealController.begin(
            requestToken,
            !!findFocusBinding(focusBindings, requestToken.code),
            performance.now(),
          );
          revealController.finishFlight(requestToken, performance.now(), true);
        }
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
    initialViewReady,
    focusOnRestore,
    focusRequest,
    emitView,
    size.width,
    size.height,
    requestToken,
    focusBindings,
    revealController,
    resource,
    resourceCurrent,
    sceneSession,
  ]);
  useEffect(() => {
    gl.domElement.dataset.orbitMode = orbitMode;
    if (appliedMode.current !== orbitMode) interruptFocus();
    appliedMode.current = orbitMode;
    if (
      !(camera instanceof OrthographicCamera) ||
      !controls.current ||
      !hasMeasuredViewport(size.width, size.height) ||
      !resourceCurrent()
    )
      return;
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
    interruptFocus,
    size.width,
    size.height,
    resource,
    resourceCurrent,
  ]);
  useEffect(() => {
    if (!(camera instanceof OrthographicCamera) || !controls.current) return;
    if (
      sameFocusToken(lastFocusRequest.current?.token ?? null, requestToken) &&
      lastFocusRequest.current?.room === room
    )
      return;
    if (!hasMeasuredViewport(size.width, size.height) || !resourceCurrent())
      return;
    // Clear first, even when the next request is unbound or has no selection.
    animation.current = null;
    const binding = findFocusBinding(focusBindings, focusRequest.code);
    if (focusRequest.code && !sceneCommitted) return;
    lastFocusRequest.current = { ...focusRequest, room, token: requestToken };
    if (focusRequest.code || focusRequest.requestId > 0)
      initialFrame.current.manual();
    if (focusRequest.code && !binding) {
      onFocusComplete(null, requestToken);
      return;
    }
    if (focusRequest.code && !revealController.valid(requestToken)) return;
    if (!focusRequest.code || focusRequest.preserveView) {
      revealController.finishFlight(requestToken, performance.now(), true);
      onFocusComplete(focusRequest.code, requestToken);
      invalidate();
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
    if (focusRequest.fitBeforeFlight && !reduced) {
      controls.current.target.copy(frame.target);
      camera.position.copy(frame.target).add(offset);
      camera.zoom = frame.zoom;
      camera.updateProjectionMatrix();
      controls.current.update();
      writeTelemetry();
    }
    if (reduced) {
      controls.current.target.copy(target);
      camera.position.copy(target).add(offset);
      camera.zoom = zoom;
      camera.updateProjectionMatrix();
      controls.current.update();
      writeTelemetry();
      emitView();
      revealController.finishFlight(requestToken, performance.now(), true);
      onFocusComplete(focusRequest.code, requestToken);
    } else
      animation.current = {
        from: controls.current.target.clone(),
        to: target,
        offset,
        fromZoom: camera.zoom,
        toZoom: zoom,
        started: performance.now(),
        token: requestToken,
      };
    invalidate();
  }, [
    focusRequest,
    initialViewReady,
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
    focusBindings,
    requestToken,
    revealController,
    sceneCommitted,
    resource,
    resourceCurrent,
  ]);
  useEffect(() => {
    if (
      !command.id ||
      command.id === lastCommandId.current ||
      !(camera instanceof OrthographicCamera) ||
      !controls.current ||
      !hasMeasuredViewport(size.width, size.height) ||
      !resourceCurrent()
    )
      return;
    initialFrame.current.manual();
    lastCommandId.current = command.id;
    interruptFocus();
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
    initialViewReady,
    camera,
    size.width,
    size.height,
    initialTarget,
    room,
    currentFrame,
    invalidate,
    writeTelemetry,
    emitView,
    onFocusCancel,
    interruptFocus,
    resource,
    resourceCurrent,
  ]);
  useFrame(() => {
    // A retained outgoing frame must not cancel its replacement's animation.
    if (!resourceCurrent()) return;
    if (!ready.current) {
      if (renderedOnce.current && gl.info.render.calls > 0) {
        ready.current = true;
        setRenderedResource(resource);
        onReady();
      } else {
        renderedOnce.current = true;
        invalidate();
      }
    }
    const reveal = revealController.getSnapshot();
    if (reveal.phase === 'revealing' && reveal.token) {
      if (performance.now() - reveal.started >= SPATIAL_MOTION.revealMs)
        revealController.settle(reveal.token);
      else invalidate();
    }
    if (
      !animation.current ||
      !controls.current ||
      !(camera instanceof OrthographicCamera)
    )
      return;
    const motion = animation.current,
      t = Math.min(
        1,
        (performance.now() - motion.started) / SPATIAL_MOTION.flightMs,
      ),
      ease = 1 - Math.pow(1 - t, 3);
    if (
      !sameFocusToken(currentToken.current, motion.token) ||
      !revealController.valid(motion.token)
    ) {
      animation.current = null;
      return;
    }
    controls.current.target.lerpVectors(motion.from, motion.to, ease);
    camera.position.copy(controls.current.target).add(motion.offset);
    camera.zoom = MathUtils.lerp(motion.fromZoom, motion.toZoom, ease);
    camera.updateProjectionMatrix();
    controls.current.update();
    writeTelemetry();
    if (t === 1) {
      animation.current = null;
      emitView();
      revealController.finishFlight(motion.token, performance.now(), reduced);
      onFocusComplete(motion.token.code, motion.token);
      invalidate();
    } else invalidate();
  }, -0.75);
  return (
    <OrbitControls
      ref={commitControls}
      makeDefault
      domElement={gl.domElement}
      enabled={active && hasMeasuredViewport(size.width, size.height)}
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
        if (!hasMeasuredViewport(size.width, size.height) || !resourceCurrent())
          return;
        initialFrame.current.manual();
        interruptFocus();
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
        if (!hasMeasuredViewport(size.width, size.height) || !resourceCurrent())
          return;
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
        if (hasMeasuredViewport(size.width, size.height) && resourceCurrent())
          emitView();
      }}
    />
  );
}
export default function RoomScene(props: RoomSceneProps) {
  const browserQuality = useRoomEffectsQuality();
  const privacy = usePrivacyReadiness();
  const selectionAuthority = useRef({ props, privacy });
  useLayoutEffect(() => {
    selectionAuthority.current = { props, privacy };
  }, [props, privacy]);
  const isSelectable = useCallback((code: string) => {
    const { props, privacy } = selectionAuthority.current;
    if (props.selectionMode === 'preview') return false;
    if (props.permittedCodes && !props.permittedCodes.includes(code))
      return false;
    if (props.selectionAllowed && !props.selectionAllowed()) return false;
    if (privacy.generation !== 'unmanaged' && !freshPresentationGrant(privacy))
      return false;
    return true;
  }, []);
  const select = useCallback(
    (code: string) => {
      if (isSelectable(code)) selectionAuthority.current.props.onSelect(code);
    },
    [isSelectable],
  );
  const selectionEnabled = props.selectionMode !== 'preview';
  const HoverElement = selectionEnabled ? 'button' : 'span';
  const presentation = useMemo(
    () => ({ room: props.room, controller: createSpatialRevealController() }),
    [props.room],
  );
  const revealController = presentation.controller;
  const reveal = useSyncExternalStore(
    revealController.subscribe,
    revealController.getSnapshot,
    revealController.getSnapshot,
  );
  const onFailure = props.onFailure;
  const handleFailure = useCallback(
    (message: string) => {
      revealController.dispose();
      onFailure(message);
    },
    [revealController, onFailure],
  );
  const [command, setCommand] = useState<ViewCommand>({ kind: 'fit', id: 0 });
  const [hoverState, setHoverState] = useState<{
    room: RoomDefinition;
    hit: VisibleHover;
  } | null>(null);
  const activeHover = hoverState?.room === props.room ? hoverState.hit : null;
  const tooltipButton = useRef<HTMLButtonElement & HTMLSpanElement>(null);
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
  const [overflowCodes, setOverflowCodes] = useState<string[]>([]);
  const [unresolvedCodes, setUnresolvedCodes] = useState<string[]>([]);
  const [placementCodes, setPlacementCodes] = useState<string[]>([]);
  const visibilityRetry = useRef<(() => void) | null>(null);
  const [inspectedSummary, setInspectedSummary] = useState<string | null>(null);
  const onSuppressionChange = useCallback(
    (count: number, codes: string[] = []) => {
      setSuppressedLabels(count);
      setOverflowCodes(codes);
    },
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
  useInsertionEffect(() => {
    const mask = () => {
      if (surface.current) {
        surface.current.hidden = true;
        surface.current.inert = true;
        surface.current.setAttribute('inert', '');
      }
    };
    const remove = [
      subscribePrivacyRevocation(mask),
      subscribeAssignmentInvalidation(mask),
      subscribeAuthoritativeCleanup(mask),
    ];
    return () => remove.forEach((unsubscribe) => unsubscribe());
  }, []);
  const interactionButton = useRef<HTMLButtonElement>(null);
  const [dragHint, setDragHint] = useState(false);
  const hintTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showDragHint = useCallback(() => {
    setDragHint(true);
    if (hintTimer.current) clearTimeout(hintTimer.current);
    hintTimer.current = setTimeout(() => setDragHint(false), 3000);
  }, []);
  useEffect(
    () => () => {
      if (hintTimer.current) clearTimeout(hintTimer.current);
    },
    [],
  );
  const selectionGesture = useRef({ suppressSelection: false });
  const canSelect = useCallback(
    () => !selectionGesture.current.suppressSelection,
    [],
  );
  const registry = useMemo(
    () =>
      createRoomLabelRegistry(
        onSuppressionChange,
        setInspectedSummary,
        setPlacementCodes,
      ),
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
        priority: activeHover.target.code === props.selectedCode ? 4 : 2,
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
    document.addEventListener('pointerdown', leave, true);
    return () => {
      document.removeEventListener('pointerdown', leave, true);
    };
  }, [active, setActive]);
  const hoverCount =
    (showCounts || activeHover?.target.code === reveal.openCode) && activeHover
      ? occupiedLocation(props.locationOccupancy?.[activeHover.target.code])
      : null;
  return (
    <div
      ref={surface}
      data-room-surface="true"
      className={
        props.compact ? `${styles.scene} ${styles.compact}` : styles.scene
      }
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) {
          setActive(false);
          setDragging(false);
        }
      }}
    >
      <RoomToolbar
        selectionEnabled={selectionEnabled}
        interactionRef={interactionButton}
        onOverlayChange={registry.invalidateLayout}
        active={active}
        onActiveChange={(next) => {
          setActive(next);
          setDragging(false);
          if (!next) {
            selectionGesture.current.suppressSelection = true;
            manualGesture.current.active = false;
          }
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
          onLeaseChange={props.onGraphicsActiveChange}
          onFailure={handleFailure}
          orthographic
          frameloop="demand"
          dpr={[1, 1.5]}
          camera={{ near: 0.1, far: 3000, position: [200, 300, 300], zoom: 1 }}
          gl={{
            antialias: true,
            alpha: false,
            powerPreference: 'low-power',
            toneMapping: ACESFilmicToneMapping,
          }}
          fallback={
            <p>Graphics are unavailable. Use the location controls below.</p>
          }
        >
          <SceneEffectsProvider room={props.room}>
            <ScenePaletteProvider>
              <ScenePaletteLighting />
              <LabelLayoutProvider registry={registry}>
                <RoomVisibilityProvider
                  onUnresolvedChange={setUnresolvedCodes}
                  retryRef={visibilityRetry}
                >
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
                      onSelect={select}
                      profiles={props.room.rackFaceProfiles}
                      showAllLabels={showAllLabels}
                      hoveredCode={activeHover?.target.code ?? null}
                      locationOccupancy={props.locationOccupancy}
                      showCounts={showCounts}
                      canSelect={canSelect}
                      selectionEnabled={selectionEnabled}
                      isSelectable={isSelectable}
                      openCode={reveal.openCode}
                      revealSettled={reveal.phase === 'settled'}
                    />
                  ))}
                  <CameraRig
                    {...props}
                    onFailure={handleFailure}
                    revealController={revealController}
                    command={command}
                    orbitMode={orbitMode}
                    manualGesture={manualGesture}
                    active={active}
                    selectionGesture={selectionGesture}
                    onDraggingChange={setDragging}
                    onPassiveDrag={showDragHint}
                  />
                  <VisibleHoverTracker
                    selectionEnabled={selectionEnabled}
                    showAllLabels={showAllLabels}
                    active={active}
                    suspended={active && dragging}
                    retainDuringLabelHandoff={retainDuringLabelHandoff}
                    onHit={onVisibleHover}
                    onCanvasLeave={onCanvasHoverLeave}
                  />
                  <SceneEffectsOwner
                    room={props.room}
                    selectedCode={props.selectedCode}
                    highlightedCodes={props.highlightedCodes}
                    quality={props.effectsQuality ?? browserQuality}
                  />
                </RoomVisibilityProvider>
              </LabelLayoutProvider>
            </ScenePaletteProvider>
          </SceneEffectsProvider>
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
            <HoverElement
              ref={tooltipButton}
              type={selectionEnabled ? 'button' : undefined}
              data-hover-tooltip="true"
              data-location-code={activeHover.target.code}
              aria-label={
                selectionEnabled
                  ? `Select ${props.locationNames?.[activeHover.target.code] ?? activeHover.target.label} (${activeHover.target.code})${hoverCount !== null ? `; ${occupancyText(hoverCount)} at this location` : ''}`
                  : undefined
              }
              aria-pressed={
                selectionEnabled
                  ? props.selectedCode === activeHover.target.code
                  : undefined
              }
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
              onClick={
                selectionEnabled
                  ? (event) => {
                      event.stopPropagation();
                      select(activeHover.target.code);
                    }
                  : undefined
              }
              onDoubleClick={
                selectionEnabled
                  ? (event) => event.stopPropagation()
                  : undefined
              }
              className={
                selectionEnabled ? styles.locationLabel : styles.decorativeLabel
              }
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
                  · {occupancyText(hoverCount)}
                </span>
              )}
            </HoverElement>
          </div>
        )}
      </div>
      {selectedLabel && (
        <p role="status" className={styles.sceneStatus}>
          Selected location: {selectedLabel}
          {selectedLabel !== props.selectedCode && ` (${props.selectedCode})`}
        </p>
      )}
      {inspectedSummary && (
        <p className={styles.sceneStatus} data-room-inspected-summary="true">
          {inspectedSummary}
        </p>
      )}
      {(showAllLabels || showCounts) && suppressedLabels > 0 && (
        <p role="status" className={styles.sceneNote}>
          Some optional labels are unavailable in this view. Use the location
          browser or Center selected.
        </p>
      )}
      {(overflowCodes.length > 0 ||
        unresolvedCodes.length > 0 ||
        placementCodes.length > 0) && (
        <div className={styles.sceneNote}>
          <p role="status">
            Some room labels could not be checked or placed.{' '}
            {selectionEnabled
              ? 'Choose a location below.'
              : 'Recorded locations are listed below.'}
          </p>
          <button
            type="button"
            className={styles.commandButton}
            onClick={() => {
              visibilityRetry.current?.();
              registry.retry();
            }}
          >
            Retry label placement
          </button>
          <ul aria-label="Locations with unavailable room labels">
            {[
              ...new Set([
                ...overflowCodes,
                ...unresolvedCodes,
                ...placementCodes,
              ]),
            ]
              .sort()
              .map((code) => (
                <li key={code}>
                  {selectionEnabled ? (
                    <button
                      type="button"
                      className={styles.commandButton}
                      aria-pressed={props.selectedCode === code}
                      disabled={Boolean(
                        props.permittedCodes &&
                        !props.permittedCodes.includes(code),
                      )}
                      onClick={() => select(code)}
                    >
                      {props.locationNames?.[code] ?? code}
                      {props.locationOccupancy?.[code] &&
                        ` · ${occupancyText(props.locationOccupancy[code])}`}
                    </button>
                  ) : (
                    <span>
                      {props.locationNames?.[code] ?? code}
                      {props.locationOccupancy?.[code] &&
                        ` · ${occupancyText(props.locationOccupancy[code])}`}
                    </span>
                  )}
                </li>
              ))}
          </ul>
        </div>
      )}
      <p role="status" className={styles.sceneNote}>
        {active
          ? 'Map interaction is on. Ordinary wheel or direct pinch zooms the map.'
          : 'Map interaction off. Scroll moves the page.'}
      </p>
      {dragHint && !active && (
        <p role="status" className={styles.sceneNote}>
          Interact to rotate. Scroll moves the page.
        </p>
      )}
      {!props.selectedCode && (
        <p className={styles.sceneNote}>
          Select a location. Use More map controls for labels, counts and help.
        </p>
      )}
    </div>
  );
}
