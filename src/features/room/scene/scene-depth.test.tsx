import { act, render } from '@testing-library/react';
import {
  Fragment,
  useEffect,
  useMemo,
  type ReactElement,
  type ReactNode,
} from 'react';
import { describe, expect, it, vi } from 'vitest';
import {
  Group,
  Mesh,
  MeshBasicMaterial,
  OrthographicCamera,
  PlaneGeometry,
  Raycaster,
  Vector2,
  Vector3,
  type MeshBasicMaterialParameters,
} from 'three';
import { loadItCloset } from '../load';
import { SceneDepth } from './scene-depth';
import { resolveExposedTargetAnchor } from './exposed-anchor';
import {
  ProjectedVisibleSurface,
  defaultSurfaceLimits,
} from './projected-visible-surface';
import { visibleRoomHit } from './visible-hover';

const state = vi.hoisted(() => ({
  footprints: [] as Mesh<PlaneGeometry, MeshBasicMaterial>[],
}));
vi.mock('./scene-palette', () => ({
  useScenePalette: () => ({ grid: '#ffffff' }),
}));

// Mount the actual component with real Three meshes in place of the R3F host.
// Preserve its geometry, alpha texture, transforms, metadata and raycast contract.
function FootprintProbe(props: {
  position: [number, number, number];
  rotation: [number, number, number];
  raycast: Mesh['raycast'];
  userData?: Mesh['userData'];
  children: ReactNode;
}) {
  const mesh = useMemo(() => {
    const [geometry, material] = props.children as [
      ReactElement<{ args: [number, number] }>,
      ReactElement<MeshBasicMaterialParameters>,
    ];
    const result = new Mesh(
      new PlaneGeometry(...geometry.props.args),
      new MeshBasicMaterial(material.props),
    );
    result.position.fromArray(props.position);
    result.rotation.set(...props.rotation);
    result.raycast = props.raycast;
    result.userData = props.userData ?? {};
    return result;
  }, [props]);
  useEffect(() => {
    state.footprints.push(mesh);
    return () => {
      mesh.removeFromParent();
      mesh.geometry.dispose();
      mesh.material.dispose();
      state.footprints.splice(state.footprints.indexOf(mesh), 1);
    };
  }, [mesh]);
  return null;
}
function IgnoreGrid() {
  return null;
}
vi.mock('react/jsx-runtime', async () => {
  const actual =
    await vi.importActual<typeof import('react/jsx-runtime')>(
      'react/jsx-runtime',
    );
  return {
    ...actual,
    jsx: (...args: Parameters<typeof actual.jsx>) => {
      if (args[0] === 'mesh') args[0] = FootprintProbe;
      if (args[0] === 'group') args[0] = Fragment;
      if (args[0] === 'lineSegments') args[0] = IgnoreGrid;
      return actual.jsx(...args);
    },
  };
});
vi.mock('react/jsx-dev-runtime', async () => {
  const actual = await vi.importActual<typeof import('react/jsx-dev-runtime')>(
    'react/jsx-dev-runtime',
  );
  return {
    ...actual,
    jsxDEV: (...args: Parameters<typeof actual.jsxDEV>) => {
      if (args[0] === 'mesh') args[0] = FootprintProbe;
      if (args[0] === 'group') args[0] = Fragment;
      if (args[0] === 'lineSegments') args[0] = IgnoreGrid;
      return actual.jsxDEV(...args);
    },
  };
});

describe('baked footprint visibility', () => {
  it.each([0, 0.5])(
    'keeps an exposed target with footprint overlap offset %s visible in projected fallback',
    (offset) => {
      const view = render(<SceneDepth room={loadItCloset()} />);
      try {
        expect(state.footprints).toHaveLength(6);
        const scene = new Group(),
          owner = new Group(),
          origin = new Group();
        owner.userData.roomHoverTarget = { code: 'TARGET', label: 'Target' };
        const target = new Mesh(
          new PlaneGeometry(2, 2),
          new MeshBasicMaterial(),
        );
        owner.add(target, origin);
        scene.add(owner);
        const footprint = state.footprints[0];
        const { width, height } = footprint.geometry.parameters;
        // View the generated floor footprint from directly above. Put a target
        // just below it, wholly inside or extending through its projected edge.
        owner.rotation.copy(footprint.rotation);
        owner.position.copy(footprint.position);
        owner.position.y -= 1;
        owner.position.x += width * offset;
        const camera = new OrthographicCamera(
          -width,
          width,
          height,
          -height,
          0.1,
          100,
        );
        camera.position.copy(footprint.position).add(new Vector3(0, 20, 0));
        camera.up.set(0, 0, -1);
        camera.lookAt(footprint.position);
        camera.updateProjectionMatrix();
        scene.add(footprint);
        const projection = new ProjectedVisibleSurface(scene, camera, {
          ...defaultSurfaceLimits,
          maxMilliseconds: Infinity,
        });
        const run = () => {
          projection.refresh();
          return resolveExposedTargetAnchor(
            scene,
            camera,
            origin,
            'TARGET',
            new Vector3(width * 10, height * 10, 0),
            undefined,
            [],
            projection,
          );
        };
        scene.updateWorldMatrix(true, true);
        camera.updateWorldMatrix(true, false);
        const ray = new Raycaster();
        const point = owner.position.clone().project(camera);
        ray.setFromCamera(new Vector2(point.x, point.y), camera);
        expect(
          visibleRoomHit(ray.intersectObject(scene, true))?.target?.code,
        ).toBe('TARGET');
        const result = run();
        expect(result.status).toBe('visible');
        expect(result.stats.triangles).toBeGreaterThan(0);
        expect(result.stats.overlaps).toBe(0);
        if (result.status !== 'visible') throw new Error(result.status);
        expect(Math.abs(result.anchor.x)).toBeCloseTo(1 / 3);
        expect(Math.abs(result.anchor.y)).toBeCloseTo(1 / 3);
        expect(projection.refresh().revisionReused).toBe(true);

        // A real plane still blocks. Transparency or a custom raycast alone
        // must not exempt furniture; only the explicit pass-through semantic does.
        const opaque = new Mesh(
          new PlaneGeometry(width * 3, height * 3),
          new MeshBasicMaterial(),
        );
        opaque.position.copy(footprint.position);
        opaque.rotation.copy(footprint.rotation);
        opaque.raycast = function (raycaster, hits) {
          Mesh.prototype.raycast.call(this, raycaster, hits);
        };
        scene.add(opaque);
        expect(run().status).toBe('hidden');
        opaque.material.transparent = true;
        opaque.material.opacity = 0.8;
        expect(run().status).toBe('hidden');
        expect(projection.refresh().revisionReused).toBe(true);
        opaque.userData.hoverPassThrough = true;
        expect(projection.refresh().revisionReused).toBe(false);
        expect(run().status).toBe('visible');
        opaque.userData.hoverPassThrough = false;
        expect(projection.refresh().revisionReused).toBe(false);
        expect(run().status).toBe('hidden');
        opaque.geometry.dispose();
        opaque.material.dispose();
        target.geometry.dispose();
        target.material.dispose();
      } finally {
        act(() => view.unmount());
      }
    },
  );
});
