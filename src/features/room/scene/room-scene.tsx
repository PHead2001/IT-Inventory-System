/* eslint-disable react-hooks/immutability -- Three.js camera objects are intentionally mutated inside effects/frame callbacks at this imperative graphics boundary. */
'use client';
import { useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import { Edges, Html, OrbitControls } from '@react-three/drei';
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
import { Button } from '@/components/ui/button';
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
  useRoomLabelLayout,
} from './label-layout-runtime';
import { SafeCanvas as Canvas } from './safe-canvas';

export type RoomSceneProps = {
  room: RoomDefinition;
  bindings: RoomBinding[];
  selectedCode: string | null;
  highlightedCodes: string[];
  focusRequest: { code: string | null; requestId: number };
  onSelect(code: string): void;
  onReady(): void;
  onFocusComplete(code: string | null): void;
  onFailure(message: string): void;
  canFocusSelected: boolean;
  onRequestFocus(): void;
};
type ViewCommand = {
  kind:
    | 'fit'
    | 'recenter'
    | 'zoom-in'
    | 'zoom-out'
    | 'left'
    | 'right'
    | 'up'
    | 'down'
    | 'rotate-left'
    | 'rotate-right'
    | 'tilt-up'
    | 'tilt-down';
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
  const [hover, setHover] = useState(false);
  const hoverExit = useRef<ReturnType<typeof setTimeout> | null>(null);
  const labelHover = useRef(false);
  useEffect(
    () => () => {
      if (hoverExit.current !== null) clearTimeout(hoverExit.current);
    },
    [],
  );
  const beginHover = () => {
    if (hoverExit.current !== null) clearTimeout(hoverExit.current);
    hoverExit.current = null;
    setHover(true);
  };
  const endHover = () => {
    if (hoverExit.current !== null) clearTimeout(hoverExit.current);
    hoverExit.current = setTimeout(() => {
      hoverExit.current = null;
      if (!labelHover.current) setHover(false);
    }, 80);
  };
  return (
    <group
      position={toScenePosition(origin)}
      rotation={[0, rotationY, 0]}
      onPointerOver={beginHover}
      onPointerOut={endHover}
      onDoubleClick={(event) => event.stopPropagation()}
    >
      <mesh position={[width / 2, 0.5, 0]}>
        <boxGeometry args={[width, 1, 2]} />
        <meshStandardMaterial color="#64748b" />
      </mesh>
      {(hover || showAllLabels) && (
        <Html
          center
          position={[width / 2, 2, 8]}
          zIndexRange={[20, 0]}
          style={{
            pointerEvents: 'auto',
            whiteSpace: 'nowrap',
            fontSize: 11,
            color: '#94a3b8',
          }}
        >
          <span
            onPointerEnter={() => {
              labelHover.current = true;
              beginHover();
            }}
            onPointerLeave={() => {
              labelHover.current = false;
              endHover();
            }}
            onDoubleClick={(event) => event.stopPropagation()}
          >
            Door · {width}″
          </span>
        </Html>
      )}
    </group>
  );
}
function CameraFacingLabel({
  node,
  size,
  selected,
  prioritySelected,
  onSelect,
  onHoverStart,
  onHoverEnd,
}: {
  node: RoomNode;
  size: [number, number, number];
  selected: boolean;
  prioritySelected: boolean;
  onSelect: (code: string) => void;
  onHoverStart: () => void;
  onHoverEnd: () => void;
}) {
  const { camera, invalidate } = useThree();
  const registerLabel = useRoomLabelLayout();
  const origin = useRef<Group>(null);
  const anchor = useRef<Group>(null);
  const button = useRef<HTMLButtonElement | null>(null);
  const leader = useRef<HTMLSpanElement | null>(null);
  const unregister = useRef<(() => void) | null>(null);
  const labelAnchor = node.interaction?.labelAnchor;
  const syncRegistration = useCallback(() => {
    unregister.current?.();
    unregister.current = null;
    if (button.current && leader.current)
      unregister.current = registerLabel(
        node.id,
        button.current,
        leader.current,
        prioritySelected,
      );
  }, [registerLabel, node.id, prioritySelected]);
  const buttonRef = useCallback(
    (element: HTMLButtonElement | null) => {
      button.current = element;
      syncRegistration();
    },
    [syncRegistration],
  );
  const leaderRef = useCallback(
    (element: HTMLSpanElement | null) => {
      leader.current = element;
      syncRegistration();
    },
    [syncRegistration],
  );
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
        <Html
          center
          occlude
          style={{ pointerEvents: 'none', whiteSpace: 'nowrap' }}
          zIndexRange={[20, 0]}
        >
          <div style={{ position: 'relative', pointerEvents: 'none' }}>
            <span
              ref={leaderRef}
              aria-hidden="true"
              style={{
                display: 'none',
                position: 'absolute',
                left: '50%',
                top: '50%',
                height: 1,
                background: '#67e8f9a6',
                transformOrigin: 'left center',
                pointerEvents: 'none',
              }}
            />
            <button
              ref={buttonRef}
              type="button"
              data-location-code={node.locationCode}
              aria-label={`Select ${node.interaction!.label} (${node.locationCode})`}
              aria-pressed={prioritySelected}
              onPointerEnter={onHoverStart}
              onPointerLeave={onHoverEnd}
              onClick={(event) => {
                event.stopPropagation();
                onSelect(node.locationCode!);
              }}
              onDoubleClick={(event) => event.stopPropagation()}
              style={{
                display: 'block',
                padding: '2px 4px',
                borderRadius: 4,
                fontSize: 10,
                lineHeight: '14px',
                background: selected ? '#083344e8' : '#020617b8',
                color: selected ? '#cffafe' : '#e2e8f0',
                border: selected ? '1px solid #22d3ee' : '1px solid #47556970',
                cursor: 'pointer',
                position: 'relative',
                pointerEvents: 'auto',
              }}
            >
              {node.interaction!.label}
            </button>
          </div>
        </Html>
      </group>
    </group>
  );
}
function NodeVisual({
  node,
  selectedCode,
  highlighted,
  onSelect,
  profiles,
  showAllLabels,
}: {
  profiles: RoomDefinition['rackFaceProfiles'];
  node: RoomNode;
  selectedCode: string | null;
  highlighted: Set<string>;
  onSelect: (code: string) => void;
  showAllLabels: boolean;
}) {
  const [hover, setHover] = useState(false);
  const hoverExit = useRef<ReturnType<typeof setTimeout> | null>(null);
  const labelHover = useRef(false);
  useEffect(
    () => () => {
      if (hoverExit.current !== null) clearTimeout(hoverExit.current);
    },
    [],
  );
  const beginHover = () => {
    if (hoverExit.current !== null) clearTimeout(hoverExit.current);
    hoverExit.current = null;
    setHover(true);
  };
  const endHover = () => {
    if (hoverExit.current !== null) clearTimeout(hoverExit.current);
    // The HTML label can take the pointer from the raycast mesh. Let its
    // pointer-enter event retain the label before clearing mesh hover.
    hoverExit.current = setTimeout(() => {
      hoverExit.current = null;
      if (!labelHover.current) setHover(false);
    }, 80);
  };
  const beginLabelHover = () => {
    labelHover.current = true;
    beginHover();
  };
  const endLabelHover = () => {
    labelHover.current = false;
    endHover();
  };
  const selected =
    !!node.locationCode &&
    (node.locationCode === selectedCode || highlighted.has(node.locationCode));
  const interactive = !!node.locationCode && !!node.interaction?.selectable;
  const click = (event: ThreeEvent<MouseEvent>) => {
    event.stopPropagation();
    if (interactive && event.delta <= 5) onSelect(node.locationCode!);
  };
  return (
    <group
      position={toScenePosition(node.position)}
      rotation={[0, MathUtils.degToRad(node.rotationZDegrees), 0]}
    >
      {node.kind === 'box' && node.size && (
        <group
          onClick={click}
          onDoubleClick={(event) => event.stopPropagation()}
          onPointerOver={(event) => {
            if (interactive) {
              event.stopPropagation();
              beginHover();
            }
          }}
          onPointerOut={(event) => {
            if (interactive) {
              event.stopPropagation();
              endHover();
            }
          }}
        >
          <mesh onClick={click}>
            <boxGeometry args={toSceneSize(node.size)} />
            <meshStandardMaterial
              color={
                selected
                  ? '#0891b2'
                  : hover
                    ? '#64748b'
                    : (node.visual?.color ?? '#475569')
              }
              emissive={selected ? '#06b6d4' : '#000000'}
              emissiveIntensity={selected ? 0.3 : 0}
              roughness={0.7}
              transparent={(node.visual?.opacity ?? 1) < 1}
              opacity={node.visual?.opacity ?? 1}
            />
            {(node.visual?.edges || selected) && (
              <Edges color={selected ? '#a5f3fc' : '#94a3b8'} threshold={15} />
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
              onClick={click}
            >
              <boxGeometry args={toSceneSize(node.interaction.hitBox.size)} />
              <meshBasicMaterial transparent opacity={0} depthWrite={false} />
            </mesh>
          )}
          {interactive && (hover || showAllLabels) && (
            <CameraFacingLabel
              node={node}
              size={node.size}
              selected={selected}
              prioritySelected={node.locationCode === selectedCode}
              onSelect={onSelect}
              onHoverStart={beginLabelHover}
              onHoverEnd={endLabelHover}
            />
          )}
        </group>
      )}
      {node.children?.map((child) => (
        <NodeVisual
          key={child.id}
          node={child}
          selectedCode={selectedCode}
          highlighted={highlighted}
          onSelect={onSelect}
          profiles={profiles}
          showAllLabels={showAllLabels}
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
function CameraRig({
  room,
  bindings,
  focusRequest,
  onFocusComplete,
  onReady,
  onFailure,
  command,
  orbitMode,
  manualGesture,
}: Pick<
  RoomSceneProps,
  | 'room'
  | 'bindings'
  | 'focusRequest'
  | 'onFocusComplete'
  | 'onReady'
  | 'onFailure'
> & {
  command: ViewCommand;
  orbitMode: OrbitMode;
  manualGesture: { current: { active: boolean; lastMotionAt: number } };
}) {
  const { camera, gl, size, invalidate } = useThree();
  const controls = useRef<ComponentRef<typeof OrbitControls>>(null);
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
  const reduced = useRef(false);
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
  }, [camera, gl]);
  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => {
      reduced.current = media.matches;
    };
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
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
      camera.updateProjectionMatrix();
    }
    controls.current.update();
    writeTelemetry();
    invalidate();
  }, [camera, currentFrame, initialTarget, room, invalidate, writeTelemetry]);
  useEffect(() => {
    gl.domElement.dataset.orbitMode = orbitMode;
    animation.current = null;
    if (
      !(camera instanceof OrthographicCamera) ||
      !controls.current ||
      orbitMode !== 'guided'
    )
      return;
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
      invalidate();
    }
  }, [orbitMode, camera, gl, invalidate, room, writeTelemetry]);
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
    if (reduced.current) {
      controls.current.target.copy(target);
      camera.position.copy(target).add(offset);
      camera.zoom = zoom;
      camera.updateProjectionMatrix();
      controls.current.update();
      writeTelemetry();
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
    invalidate();
  }, [
    command,
    camera,
    initialTarget,
    room,
    currentFrame,
    invalidate,
    writeTelemetry,
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
      onFocusComplete(motion.code);
    } else invalidate();
  });
  return (
    <OrbitControls
      ref={controls}
      makeDefault
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
        animation.current = null;
        manualGesture.current.active = true;
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
        manualStart.current = null;
      }}
    />
  );
}
export default function RoomScene(props: RoomSceneProps) {
  const [command, setCommand] = useState<ViewCommand>({ kind: 'fit', id: 0 });
  const [labelPreference, setLabelPreference] = useState({
    room: props.room,
    showAll: false,
  });
  const showAllLabels =
    labelPreference.room === props.room && labelPreference.showAll;
  const selectedLabel =
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
  const orbitMode = ephemeralMode ?? persistedMode;
  const chooseMode = (mode: OrbitMode) => {
    try {
      window.localStorage.setItem(ORBIT_MODE_KEY, mode);
      window.dispatchEvent(new Event('room-orbit-mode-change'));
    } catch {
      setEphemeralMode(mode);
    }
  };
  const requestCommand = useCallback((kind: ViewCommand['kind']) => {
    setCommand((old) => ({ kind, id: old.id + 1 }));
  }, []);
  const highlighted = useMemo(
    () => new Set(props.highlightedCodes),
    [props.highlightedCodes],
  );
  const secondaryControls: [ViewCommand['kind'], string][] = [
    ['left', 'Pan left'],
    ['right', 'Pan right'],
    ['up', 'Pan up'],
    ['down', 'Pan down'],
    ['rotate-left', 'Rotate left'],
    ['rotate-right', 'Rotate right'],
    ['tilt-up', 'Tilt up'],
    ['tilt-down', 'Tilt down'],
  ];
  return (
    <div className="space-y-3">
      <div
        role="toolbar"
        aria-label="Room camera controls"
        className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-700 bg-slate-900/70 p-2"
      >
        {(
          [
            ['recenter', 'Recenter'],
            ['fit', 'Fit room'],
          ] as const
        ).map(([kind, label]) => (
          <Button
            key={kind}
            type="button"
            variant="outline"
            className="min-h-11"
            onClick={() => requestCommand(kind)}
          >
            {label}
          </Button>
        ))}
        <Button
          type="button"
          variant="outline"
          className="min-h-11"
          disabled={!props.canFocusSelected}
          onClick={props.onRequestFocus}
        >
          Center selected
        </Button>
        <div
          role="group"
          aria-label="Orbit mode"
          className="flex rounded-md border border-slate-600 p-0.5"
        >
          {(['guided', 'free'] as const).map((mode) => (
            <Button
              key={mode}
              type="button"
              variant={orbitMode === mode ? 'default' : 'outline'}
              className="min-h-10 px-3"
              aria-pressed={orbitMode === mode}
              onClick={() => chooseMode(mode)}
            >
              {mode === 'guided' ? 'Guided' : 'Free Orbit'}
            </Button>
          ))}
        </div>
        <div role="group" aria-label="Room zoom" className="flex gap-1">
          <Button
            type="button"
            variant="outline"
            className="min-h-11"
            aria-label="Zoom out"
            onClick={() => requestCommand('zoom-out')}
          >
            −
          </Button>
          <Button
            type="button"
            variant="outline"
            className="min-h-11"
            aria-label="Zoom in"
            onClick={() => requestCommand('zoom-in')}
          >
            +
          </Button>
        </div>
        <Button
          type="button"
          variant={showAllLabels ? 'default' : 'outline'}
          className="min-h-11"
          aria-pressed={showAllLabels}
          onClick={() =>
            setLabelPreference({ room: props.room, showAll: !showAllLabels })
          }
        >
          Show all labels
        </Button>
        <details className="relative">
          <summary className="flex min-h-11 cursor-pointer list-none items-center rounded-md border border-slate-600 px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-cyan-300">
            Pan and rotate
          </summary>
          <div className="absolute left-0 top-full z-30 mt-1 grid w-48 grid-cols-2 gap-1 rounded-md border border-slate-600 bg-slate-900 p-2 shadow-xl">
            {secondaryControls.map(([kind, label]) => (
              <Button
                key={kind}
                type="button"
                variant="outline"
                className="min-h-11 text-xs"
                onClick={() => requestCommand(kind)}
              >
                {label}
              </Button>
            ))}
          </div>
        </details>
      </div>
      <div
        className="h-[440px] overflow-hidden rounded-xl border border-slate-700 bg-slate-950 sm:h-[580px]"
        aria-label="Interactive room canvas"
      >
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
          <LabelLayoutProvider onSuppressionChange={onSuppressionChange}>
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
                selectedCode={props.selectedCode}
                highlighted={highlighted}
                onSelect={props.onSelect}
                profiles={props.room.rackFaceProfiles}
                showAllLabels={showAllLabels}
              />
            ))}
            <CameraRig
              {...props}
              command={command}
              orbitMode={orbitMode}
              manualGesture={manualGesture}
            />
          </LabelLayoutProvider>
        </Canvas>
      </div>
      {selectedLabel && (
        <p role="status" className="text-sm text-cyan-200">
          Selected location: {selectedLabel}
          {selectedLabel !== props.selectedCode && ` (${props.selectedCode})`}
        </p>
      )}
      {showAllLabels && suppressedLabels > 0 && (
        <p role="status" className="text-xs text-slate-400">
          Some room labels are hidden at this view. Zoom in or use the location
          picker.
        </p>
      )}
      <p className="text-xs text-slate-400">
        Drag to rotate; right-drag to pan; scroll or pinch to zoom. Double-click
        exposed floor to recenter. Guided keeps the operational view; Free Orbit
        rotates around and above or below the room. Hover an object to see its
        label, or use Show all labels. Pan, rotate and tilt buttons and the
        location list support keyboard and touch navigation.
      </p>
    </div>
  );
}
