/* eslint-disable react-hooks/immutability -- Three.js camera objects are intentionally mutated inside effects/frame callbacks at this imperative graphics boundary. */
'use client';
import { useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import { Edges, Html, OrbitControls } from '@react-three/drei';
import { useEffect, useMemo, useRef, useState, type ComponentRef } from 'react';
import { MathUtils, OrthographicCamera, Vector3 } from 'three';
import { Button } from '@/components/ui/button';
import type { RoomDefinition, RoomNode } from '../schema';
import type { RoomBinding } from '../bindings';
import { toScenePosition, toSceneSize } from '../coordinates';
import { rotatedOffset } from './camera-math';
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
};
type ViewCommand = {
  kind:
    | 'fit'
    | 'zoom-in'
    | 'zoom-out'
    | 'left'
    | 'right'
    | 'up'
    | 'down'
    | 'rotate-left'
    | 'rotate-right';
  id: number;
};
function Solid({
  position,
  size,
  color = '#1e293b',
}: {
  position: [number, number, number];
  size: [number, number, number];
  color?: string;
}) {
  return (
    <mesh position={toScenePosition(position)}>
      <boxGeometry args={toSceneSize(size)} />
      <meshStandardMaterial color={color} roughness={0.85} />
    </mesh>
  );
}
function Envelope({ room }: { room: RoomDefinition }) {
  const [width, depth, height] = room.dimensions,
    thickness = room.envelope.wallThickness;
  // Low perimeter rails retain room proportions without hiding lower storage.
  return (
    <group>
      <Solid
        position={[width / 2, depth / 2, -thickness / 2]}
        size={[width, depth, thickness]}
        color="#172337"
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
        const frontBack = opening.wall === 'front' || opening.wall === 'back';
        const origin: [number, number, number] = frontBack
          ? [opening.offset, opening.wall === 'front' ? 0 : depth, 0]
          : [opening.wall === 'left' ? 0 : width, opening.offset, 0];
        // The opening stays measured; its floor outline avoids a tall slab occluding inventory.
        const angle =
          opening.wall === 'front'
            ? 0
            : opening.wall === 'back'
              ? Math.PI
              : opening.wall === 'left'
                ? -Math.PI / 2
                : Math.PI / 2;
        return (
          <group
            key={opening.id}
            position={toScenePosition(origin)}
            rotation={[0, angle, 0]}
          >
            <mesh position={[opening.width / 2, 0.5, 0]}>
              <boxGeometry args={[opening.width, 1, 2]} />
              <meshStandardMaterial color="#64748b" />
            </mesh>
            <Html
              center
              position={[opening.width / 2, 2, 8]}
              style={{
                pointerEvents: 'none',
                whiteSpace: 'nowrap',
                fontSize: 11,
                color: '#94a3b8',
              }}
            >
              Door · {opening.width}″
            </Html>
          </group>
        );
      })}
    </group>
  );
}
function NodeVisual({
  node,
  selectedCode,
  highlighted,
  onSelect,
  profiles,
}: {
  profiles: RoomDefinition['rackFaceProfiles'];
  node: RoomNode;
  selectedCode: string | null;
  highlighted: Set<string>;
  onSelect: (code: string) => void;
}) {
  const [hover, setHover] = useState(false);
  const selected =
    !!node.locationCode &&
    (node.locationCode === selectedCode || highlighted.has(node.locationCode));
  const interactive = !!node.locationCode && !!node.interaction?.selectable;
  const click = (event: ThreeEvent<MouseEvent>) => {
    if (interactive && event.delta <= 5) {
      event.stopPropagation();
      onSelect(node.locationCode!);
    }
  };
  return (
    <group
      position={toScenePosition(node.position)}
      rotation={[0, MathUtils.degToRad(node.rotationZDegrees), 0]}
    >
      {node.kind === 'box' && node.size && (
        <group onClick={click}>
          <mesh
            onClick={click}
            onPointerOver={(event) => {
              if (interactive) {
                event.stopPropagation();
                setHover(true);
              }
            }}
            onPointerOut={() => setHover(false)}
          >
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
          {interactive && (
            <Html
              center
              position={
                node.interaction?.labelAnchor
                  ? toScenePosition(node.interaction.labelAnchor)
                  : [0, node.size[2] / 2 + 0.15, 0]
              }
              occlude
              style={{ pointerEvents: 'none', whiteSpace: 'nowrap' }}
              zIndexRange={[20, 0]}
            >
              <span
                data-location-code={node.locationCode}
                style={{
                  display: 'block',
                  padding: '2px 4px',
                  borderRadius: 4,
                  fontSize: 10,
                  lineHeight: '14px',
                  background: selected ? '#083344e8' : '#020617b8',
                  color: selected ? '#cffafe' : '#e2e8f0',
                  border: selected
                    ? '1px solid #22d3ee'
                    : '1px solid #47556970',
                }}
              >
                {node.interaction!.label}
              </span>
            </Html>
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
}: Pick<
  RoomSceneProps,
  | 'room'
  | 'bindings'
  | 'focusRequest'
  | 'onFocusComplete'
  | 'onReady'
  | 'onFailure'
> & { command: ViewCommand }) {
  const { camera, gl, size, invalidate } = useThree();
  const controls = useRef<ComponentRef<typeof OrbitControls>>(null);
  const animation = useRef<Animation | null>(null);
  const fitZoom = useRef(1);
  const fitTarget = useRef(new Vector3());
  const ready = useRef(false);
  const renderedOnce = useRef(false);
  const reduced = useRef(false);
  const initialTarget = useMemo(
    () => new Vector3(...toScenePosition(room.camera.target)),
    [room],
  );
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
    const azimuth = MathUtils.degToRad(room.camera.azimuthDegrees),
      elevation = MathUtils.degToRad(room.camera.elevationDegrees),
      distance = Math.max(...room.dimensions) * 3;
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
    camera.updateMatrixWorld();
    const right = new Vector3().setFromMatrixColumn(camera.matrixWorld, 0),
      up = new Vector3().setFromMatrixColumn(camera.matrixWorld, 1);
    let minX = Infinity,
      maxX = -Infinity,
      minY = Infinity,
      maxY = -Infinity;
    const boxes = bindings
      .filter((binding) => binding.primary)
      .map((binding) => binding.bounds);
    boxes.push({
      min: [0, 0, 0],
      max: [room.dimensions[0], room.dimensions[1], 0],
    });
    for (const bounds of boxes)
      for (const x of [bounds.min[0], bounds.max[0]])
        for (const y of [bounds.min[1], bounds.max[1]])
          for (const z of [bounds.min[2], bounds.max[2]]) {
            const delta = new Vector3(...toScenePosition([x, y, z])).sub(
              initialTarget,
            );
            const px = delta.dot(right),
              py = delta.dot(up);
            minX = Math.min(minX, px);
            maxX = Math.max(maxX, px);
            minY = Math.min(minY, py);
            maxY = Math.max(maxY, py);
          }
    fitTarget.current
      .copy(initialTarget)
      .addScaledVector(right, (minX + maxX) / 2)
      .addScaledVector(up, (minY + maxY) / 2);
    camera.position.add(fitTarget.current.clone().sub(initialTarget));
    fitZoom.current =
      Math.min(size.width / (maxX - minX), size.height / (maxY - minY)) /
      room.camera.fitPadding;
    camera.zoom = fitZoom.current;
    camera.updateProjectionMatrix();
    controls.current.target.copy(fitTarget.current);
    controls.current.minZoom = fitZoom.current * room.camera.zoomLimits[0];
    controls.current.maxZoom = fitZoom.current * room.camera.zoomLimits[1];
    controls.current.update();
    animation.current = null;
    invalidate();
  }, [
    camera,
    initialTarget,
    room,
    bindings,
    size.width,
    size.height,
    invalidate,
  ]);
  useEffect(() => {
    if (!(camera instanceof OrthographicCamera) || !controls.current) return;
    const binding = bindings.find((entry) => entry.code === focusRequest.code);
    if (focusRequest.code && !binding) {
      onFocusComplete(null);
      return;
    }
    const target = binding
      ? new Vector3(...toScenePosition(binding.focusPoint))
      : fitTarget.current.clone();
    const zoom =
      fitZoom.current *
      (binding ? Math.min(1.6, room.camera.zoomLimits[1]) : 1);
    const offset = camera.position.clone().sub(controls.current.target);
    if (reduced.current) {
      controls.current.target.copy(target);
      camera.position.copy(target).add(offset);
      camera.zoom = zoom;
      camera.updateProjectionMatrix();
      controls.current.update();
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
    focusRequest.requestId,
    focusRequest.code,
    bindings,
    camera,
    initialTarget,
    room,
    onFocusComplete,
    invalidate,
  ]);
  useEffect(() => {
    if (
      !command.id ||
      !(camera instanceof OrthographicCamera) ||
      !controls.current
    )
      return;
    animation.current = null;
    const control = controls.current;
    if (command.kind === 'fit') {
      const azimuth = MathUtils.degToRad(room.camera.azimuthDegrees),
        elevation = MathUtils.degToRad(room.camera.elevationDegrees),
        distance = Math.max(...room.dimensions) * 3;
      control.target.copy(fitTarget.current);
      camera.position
        .copy(fitTarget.current)
        .add(
          new Vector3(
            Math.sin(azimuth) * Math.cos(elevation) * distance,
            Math.sin(elevation) * distance,
            Math.cos(azimuth) * Math.cos(elevation) * distance,
          ),
        );
      camera.zoom = fitZoom.current;
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
    invalidate();
  }, [command, camera, initialTarget, room, invalidate]);
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
      minAzimuthAngle={MathUtils.degToRad(room.camera.azimuthLimitsDegrees[0])}
      maxAzimuthAngle={MathUtils.degToRad(room.camera.azimuthLimitsDegrees[1])}
      minPolarAngle={MathUtils.degToRad(
        90 - room.camera.elevationLimitsDegrees[1],
      )}
      maxPolarAngle={MathUtils.degToRad(
        90 - room.camera.elevationLimitsDegrees[0],
      )}
      enablePan
      enableZoom
      screenSpacePanning
      zoomSpeed={0.7}
      onStart={() => {
        animation.current = null;
      }}
    />
  );
}
export default function RoomScene(props: RoomSceneProps) {
  const [command, setCommand] = useState<ViewCommand>({ kind: 'fit', id: 0 });
  const highlighted = useMemo(
    () => new Set(props.highlightedCodes),
    [props.highlightedCodes],
  );
  const controls: [ViewCommand['kind'], string][] = [
    ['fit', 'Fit room'],
    ['zoom-in', 'Zoom in'],
    ['zoom-out', 'Zoom out'],
    ['left', 'Pan left'],
    ['right', 'Pan right'],
    ['up', 'Pan up'],
    ['down', 'Pan down'],
    ['rotate-left', 'Rotate left'],
    ['rotate-right', 'Rotate right'],
  ];
  return (
    <div className="space-y-3">
      <div
        role="toolbar"
        aria-label="Room camera controls"
        className="flex flex-wrap gap-2"
      >
        {controls.map(([kind, label]) => (
          <Button
            key={kind}
            type="button"
            variant="outline"
            onClick={() => setCommand((old) => ({ kind, id: old.id + 1 }))}
          >
            {label}
          </Button>
        ))}
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
          <Envelope room={props.room} />
          {props.room.nodes.map((node) => (
            <NodeVisual
              key={node.id}
              node={node}
              selectedCode={props.selectedCode}
              highlighted={highlighted}
              onSelect={props.onSelect}
              profiles={props.room.rackFaceProfiles}
            />
          ))}
          <CameraRig {...props} command={command} />
        </Canvas>
      </div>
      <p className="text-xs text-slate-400">
        Drag to rotate within the room view. Right-drag to pan; scroll or pinch
        to zoom. Use the camera buttons and location list for keyboard
        navigation.
      </p>
    </div>
  );
}
