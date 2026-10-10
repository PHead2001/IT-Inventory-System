import { describe, expect, it, vi } from 'vitest';
import {
  BoxGeometry,
  BufferGeometry,
  Float32BufferAttribute,
  Group,
  Mesh,
  MeshBasicMaterial,
  OrthographicCamera,
  PlaneGeometry,
  Raycaster,
  Vector2,
  Vector3,
  DoubleSide,
} from 'three';
import { resolveExposedTargetAnchor } from './exposed-anchor';
import {
  ProjectedVisibleSurface,
  defaultSurfaceLimits,
} from './projected-visible-surface';
import { visibleRoomHit } from './visible-hover';

const viewport = { left: 0, top: 0, right: 320, bottom: 320 };
function setup() {
  const scene = new Group(),
    owner = new Group(),
    origin = new Group();
  owner.userData.roomHoverTarget = { code: 'TARGET', label: 'Target' };
  const target = new Mesh(new BoxGeometry(4, 4, 2), new MeshBasicMaterial());
  owner.add(target, origin);
  scene.add(owner);
  const camera = new OrthographicCamera(-4, 4, 4, -4, 0.1, 100);
  camera.position.z = 20;
  camera.lookAt(0, 0, 0);
  camera.updateProjectionMatrix();
  const projection = new ProjectedVisibleSurface(scene, camera, {
    ...defaultSurfaceLimits,
    maxMilliseconds: Infinity,
  });
  const run = (
    obstructions: (typeof viewport)[] = [],
    preferred = new Vector3(0, 0, 1),
  ) => {
    projection.refresh();
    return resolveExposedTargetAnchor(
      scene,
      camera,
      origin,
      'TARGET',
      preferred,
      viewport,
      obstructions,
      projection,
    );
  };
  const blocker = (left: number, right: number) => {
    const mesh = new Mesh(
      new BoxGeometry(right - left, 10, 1),
      new MeshBasicMaterial(),
    );
    mesh.position.set((left + right) / 2, 0, 4);
    scene.add(mesh);
    return mesh;
  };
  return { scene, owner, origin, target, camera, projection, run, blocker };
}
function rayOwner(f: ReturnType<typeof setup>, x: number, y = 0) {
  f.scene.updateWorldMatrix(true, true);
  f.camera.updateWorldMatrix(true, false);
  const ray = new Raycaster();
  ray.setFromCamera(new Vector2(x / 4, y / 4), f.camera);
  return visibleRoomHit(ray.intersectObject(f.scene, true))?.target?.code;
}

describe('projected actual visible regions', () => {
  it('finds an arbitrary thin slit missed by every old fixed face sample, then proves closure', () => {
    const f = setup();
    f.blocker(-5, 0.31);
    const right = f.blocker(0.33, 5);
    expect(rayOwner(f, 0.32)).toBe('TARGET');
    const result = f.run();
    expect(result.status).toBe('visible');
    if (result.status !== 'visible') throw new Error(result.status);
    expect(result.anchor.x).toBeGreaterThan(0.31);
    expect(result.anchor.x).toBeLessThan(0.33);
    expect(result.stats.overlaps).toBeGreaterThan(0);
    right.position.x -= 0.021;
    expect(f.run().status).toBe('hidden');
  });
  it('uses actual transformed child decorations outside the nominal body', () => {
    const f = setup();
    f.blocker(-5, 2.2);
    const decoration = new Mesh(
      new BoxGeometry(0.2, 0.2, 0.2),
      new MeshBasicMaterial(),
    );
    decoration.position.x = 3;
    f.owner.add(decoration);
    f.owner.rotation.z = 0.07;
    f.owner.scale.set(1, 0.8, 1);
    f.origin.position.set(0.2, 0.3, 0);
    const result = f.run();
    expect(result.status).toBe('visible');
    if (result.status !== 'visible') throw new Error(result.status);
    expect(f.origin.localToWorld(result.anchor.clone()).x).toBeGreaterThan(2.2);
    decoration.visible = false;
    expect(f.run().status).toBe('hidden');
  });
  it('subtracts DOM rectangles leaving an off-sample strip and honors viewport clipping', () => {
    const f = setup();
    const result = f.run([
      { left: 0, top: 0, right: 173, bottom: 320 },
      { left: 174, top: 0, right: 320, bottom: 320 },
    ]);
    expect(result.status).toBe('visible');
    if (result.status !== 'visible') throw new Error(result.status);
    expect(result.anchor.x).toBeGreaterThan(0.325);
    expect(result.anchor.x).toBeLessThan(0.35);
    f.owner.position.x = 5.9;
    expect(f.run([], new Vector3(0, 0, 1)).status).toBe('visible');
    f.owner.position.x = 6.1;
    expect(f.run().status).toBe('hidden');
    f.owner.position.set(0, 0, 21);
    expect(f.run().status).toBe('hidden');
  });
  it('clips depth-crossing occluders instead of subtracting their whole projected triangle', () => {
    const f = setup();
    f.owner.remove(f.target);
    f.owner.add(
      new Mesh(
        new PlaneGeometry(4, 4),
        new MeshBasicMaterial({ side: DoubleSide }),
      ),
    );
    const crossing = new Mesh(
      new PlaneGeometry(6, 6),
      new MeshBasicMaterial({ side: DoubleSide }),
    );
    crossing.rotation.y = -Math.PI / 4;
    crossing.position.z = 0.2;
    f.scene.add(crossing);
    const result = f.run([], new Vector3(1, 0, 0));
    expect(result.status).toBe('visible');
    if (result.status !== 'visible') throw new Error(result.status);
    expect(result.anchor.x).toBeLessThan(-0.2);
  });
  it('preserves hidden, pass-through, transparent, and logical-owner pointer rules', () => {
    const f = setup();
    const blocker = f.blocker(-5, 5);
    blocker.userData.hoverPassThrough = true;
    expect(f.run().status).toBe('visible');
    blocker.userData.hoverPassThrough = false;
    blocker.material.opacity = 0;
    expect(f.run().status).toBe('visible');
    blocker.material.opacity = 1;
    expect(f.run().status).toBe('hidden');
    const parent = new Group();
    f.scene.add(parent);
    parent.add(blocker);
    parent.visible = false;
    expect(f.run().status).toBe('visible');
  });
  it('reuses projections and invalidates for camera, parent, mesh, attributes, materials and owner changes', () => {
    const f = setup();
    expect(f.projection.refresh().revisionReused).toBe(false);
    expect(f.projection.refresh().revisionReused).toBe(true);
    for (const change of [
      () => {
        f.camera.position.x += 1;
      },
      () => {
        f.owner.rotation.y += 0.1;
      },
      () => {
        f.target.position.x += 0.1;
      },
      () => {
        f.target.geometry.getAttribute('position').needsUpdate = true;
      },
      () => {
        f.target.geometry.setAttribute(
          'position',
          f.target.geometry.getAttribute('position').clone(),
        );
      },
      () => {
        f.target.material.side = DoubleSide;
      },
      () => {
        f.owner.userData.roomHoverTarget.code = 'OTHER';
      },
    ]) {
      change();
      expect(f.projection.refresh().revisionReused).toBe(false);
      expect(f.projection.refresh().revisionReused).toBe(true);
    }
  });
  it('returns unresolved for budget exhaustion and cancellation, memoizes exhaustion until revision/retry', () => {
    const f = setup();
    f.blocker(-5, 0.31);
    f.blocker(0.33, 5);
    const projection = new ProjectedVisibleSurface(f.scene, f.camera, {
      ...defaultSurfaceLimits,
      maxMilliseconds: Infinity,
      maxTriangles: 0,
    });
    projection.refresh();
    const result = resolveExposedTargetAnchor(
      f.scene,
      f.camera,
      f.origin,
      'TARGET',
      new Vector3(),
      viewport,
      [],
      projection,
    );
    expect(result.status).toBe('unresolved');
    expect(projection.refresh().revisionReused).toBe(true);
    projection.retry();
    expect(projection.refresh().revisionReused).toBe(false);
    const controller = new AbortController();
    controller.abort();
    expect(
      resolveExposedTargetAnchor(
        f.scene,
        f.camera,
        f.origin,
        'TARGET',
        new Vector3(),
        viewport,
        [],
        undefined,
        controller.signal,
      ).status,
    ).toBe('unresolved');
  });
  it('shares a single batch budget across labels and skips projection for preferred witnesses', () => {
    const f = setup();
    const limits = { ...defaultSurfaceLimits, maxMilliseconds: Infinity };
    const projection = new ProjectedVisibleSurface(f.scene, f.camera, limits);
    projection.refresh();
    limits.maxOperations = projection.stats.operations + 4;
    const first = resolveExposedTargetAnchor(
      f.scene,
      f.camera,
      f.origin,
      'TARGET',
      new Vector3(),
      viewport,
      [],
      projection,
    );
    expect(first.status).toBe('visible');
    expect(first.stats.triangles).toBe(0);
    const second = resolveExposedTargetAnchor(
      f.scene,
      f.camera,
      f.origin,
      'TARGET',
      new Vector3(),
      viewport,
      [],
      projection,
    );
    expect(second.status).toBe('unresolved');
    expect(second.stats.operations).toBeGreaterThan(first.stats.operations);
  });
  it('latches incomplete fingerprints until explicit retry without rescanning or returning stale results', () => {
    const f = setup();
    const limits = {
      ...defaultSurfaceLimits,
      maxMilliseconds: Infinity,
      maxOperations: 1,
    };
    const projection = new ProjectedVisibleSurface(f.scene, f.camera, limits);
    const scan = vi.spyOn(f.scene, 'traverse');
    projection.refresh();
    expect(scan).not.toHaveBeenCalled();
    expect(projection.checkpoint()).toMatch(/^fingerprint incomplete:/);
    projection.refresh();
    projection.refresh();
    expect(scan).not.toHaveBeenCalled();
    expect(
      resolveExposedTargetAnchor(
        f.scene,
        f.camera,
        f.origin,
        'TARGET',
        new Vector3(),
        viewport,
        [],
        projection,
      ).status,
    ).toBe('unresolved');
    limits.maxOperations = defaultSurfaceLimits.maxOperations;
    projection.retry();
    projection.refresh();
    expect(scan).toHaveBeenCalledTimes(1);
    expect(
      resolveExposedTargetAnchor(
        f.scene,
        f.camera,
        f.origin,
        'TARGET',
        new Vector3(),
        viewport,
        [],
        projection,
      ).status,
    ).toBe('visible');
    scan.mockRestore();
  });
  it.each(['groups', 'materials'])(
    'bounds the last mesh with many %s and latches the incomplete fingerprint',
    (kind) => {
      const f = setup();
      const materials = Array.from(
        { length: kind === 'materials' ? 256 : 1 },
        () => new MeshBasicMaterial(),
      );
      const last = new Mesh(new BoxGeometry(1, 1, 1), materials);
      let firstRead = 0,
        finalRead = 0;
      if (kind === 'groups') {
        last.geometry.clearGroups();
        for (let i = 0; i < 1000; i++) last.geometry.addGroup(0, 3, 0);
        Object.defineProperty(last.geometry.groups[0], 'start', {
          get: () => {
            firstRead++;
            return 0;
          },
        });
        Object.defineProperty(last.geometry.groups[999], 'start', {
          get: () => {
            finalRead++;
            return 0;
          },
        });
      } else {
        Object.defineProperty(materials[0], 'side', {
          get: () => {
            firstRead++;
            return 0;
          },
        });
        Object.defineProperty(materials[255], 'side', {
          get: () => {
            finalRead++;
            return 0;
          },
        });
      }
      f.scene.add(last);
      const limits = {
        ...defaultSurfaceLimits,
        maxMilliseconds: Infinity,
        maxOperations: 2000,
      };
      const projection = new ProjectedVisibleSurface(f.scene, f.camera, limits);
      const scan = vi.spyOn(f.scene, 'traverse');
      const result = projection.refresh();
      expect(firstRead).toBeGreaterThan(0);
      expect(finalRead).toBe(0);
      expect(result.revisionReused).toBe(false);
      expect(projection.revision).toBe(0);
      expect(projection.checkpoint()).toMatch(
        /^fingerprint incomplete: work budget exhausted/,
      );
      expect(projection.find('TARGET', () => true).status).toBe('unresolved');
      const reads = firstRead;
      projection.refresh();
      projection.refresh();
      expect(scan).toHaveBeenCalledTimes(1);
      expect(firstRead).toBe(reads);
      expect(projection.stats.revisionReused).toBe(false);
      limits.maxOperations = defaultSurfaceLimits.maxOperations;
      projection.retry();
      projection.refresh();
      expect(scan).toHaveBeenCalledTimes(2);
      expect(finalRead).toBeGreaterThan(0);
      expect(projection.revision).toBe(1);
      scan.mockRestore();
    },
  );
  it('rejects and latches a fingerprint when its final signature assembly exceeds elapsed budget', () => {
    const f = setup();
    let now = 0,
      expireDuringAssembly = true,
      assemblies = 0;
    const clock = vi.spyOn(performance, 'now').mockImplementation(() => now);
    const originalJoin = Array.prototype.join;
    const join = vi.spyOn(Array.prototype, 'join').mockImplementation(function (
      this: unknown[],
      separator?: string,
    ) {
      const result = originalJoin.call(this, separator);
      if (
        separator === '|' &&
        this.length >= 33 &&
        this.every((value) => typeof value === 'string')
      ) {
        assemblies++;
        if (expireDuringAssembly) now = 9;
      }
      return result;
    });
    try {
      const projection = new ProjectedVisibleSurface(f.scene, f.camera);
      projection.refresh();
      expect(assemblies).toBe(1);
      expect(projection.revision).toBe(0);
      expect(projection.checkpoint()).toMatch(
        /^fingerprint incomplete: work budget exhausted/,
      );
      projection.refresh();
      projection.refresh();
      expect(assemblies).toBe(1);
      expect(projection.stats.revisionReused).toBe(false);
      expireDuringAssembly = false;
      now = 0;
      projection.retry();
      projection.refresh();
      expect(assemblies).toBe(2);
      expect(projection.revision).toBe(1);
    } finally {
      join.mockRestore();
      clock.mockRestore();
    }
  });
  it('charges UTF-16 values before retaining oversized fingerprint fields', () => {
    const f = setup();
    // An astral character occupies two UTF-16 units, not one code point.
    f.owner.userData.roomHoverTarget.code = '😀'.repeat(1001);
    const projection = new ProjectedVisibleSurface(f.scene, f.camera, {
      ...defaultSurfaceLimits,
      maxMilliseconds: Infinity,
      maxOperations: 2000,
    });
    projection.refresh();
    expect(projection.revision).toBe(0);
    expect(projection.checkpoint()).toMatch(
      /^fingerprint incomplete: work budget exhausted/,
    );
    projection.refresh();
    expect(projection.stats.operations).toBe(0);
  });
  it.each([false, true])(
    'keeps shared seams closed with reversed winding and duplicated source vertices=%s',
    (duplicated) => {
      const f = setup();
      let geometry: BufferGeometry = new BoxGeometry(10, 10, 1);
      if (duplicated) geometry = geometry.toNonIndexed();
      const source = geometry.index;
      const count = source?.count ?? geometry.getAttribute('position').count;
      const reversed: number[] = [];
      for (let i = 0; i < count; i += 3)
        reversed.push(
          source ? source.getX(i) : i,
          source ? source.getX(i + 2) : i + 2,
          source ? source.getX(i + 1) : i + 1,
        );
      geometry.setIndex(reversed);
      const blocker = new Mesh(
        geometry,
        new MeshBasicMaterial({ side: DoubleSide }),
      );
      blocker.position.z = 4;
      blocker.scale.x = -1;
      f.scene.add(blocker);
      expect(f.run().status).toBe('hidden');
    },
  );
  it('does not erase a tiny but representable actual positive slit as a shared seam', () => {
    const f = setup();
    const gap = 1e-10;
    for (const x of [-2 + 0.31, 2 + 0.31 + gap]) {
      const blocker = new Mesh(
        new BoxGeometry(4, 10, 1),
        new MeshBasicMaterial(),
      );
      blocker.position.set(x, 0, 4);
      f.scene.add(blocker);
    }
    expect(rayOwner(f, 0.31 + gap / 2)).toBe('TARGET');
    expect(f.run().status).not.toBe('hidden');
  });
  it.each(['hidden', 'zero-opacity'])(
    'matches the visible pointer owner through a %s material group',
    (mode) => {
      const f = setup();
      const materials = Array.from(
        { length: 6 },
        () => new MeshBasicMaterial(),
      );
      const front = materials[4];
      if (mode === 'hidden') front.visible = false;
      else front.opacity = 0;
      const blocker = new Mesh(new BoxGeometry(10, 10, 1), materials);
      blocker.position.z = 4;
      f.scene.add(blocker);
      expect(rayOwner(f, 0)).toBe('TARGET');
      expect(f.run([], new Vector3(10, 10, 0)).status).toBe('visible');
      front.visible = true;
      front.opacity = 1;
      expect(f.run().status).toBe('hidden');
    },
  );
  it('does not invent visibility for degenerate triangles and reports coplanar witness ambiguity honestly', () => {
    const f = setup();
    f.owner.remove(f.target);
    const geometry = new BufferGeometry();
    geometry.setAttribute(
      'position',
      new Float32BufferAttribute([0, 0, 0, 1, 0, 0, 2, 0, 0], 3),
    );
    f.owner.add(
      new Mesh(geometry, new MeshBasicMaterial({ side: DoubleSide })),
    );
    expect(f.run().status).toBe('hidden');
    const target = new Mesh(new PlaneGeometry(4, 4), new MeshBasicMaterial());
    const cover = new Mesh(new PlaneGeometry(4, 4), new MeshBasicMaterial());
    f.scene.clear();
    f.scene.add(cover, f.owner);
    f.owner.add(target);
    expect(f.run().status).toBe('unresolved');
  });
});
