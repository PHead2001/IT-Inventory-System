import {
  BackSide,
  DoubleSide,
  Mesh,
  OrthographicCamera,
  Vector3,
  type Camera,
  type Object3D,
} from 'three';
import { visibleRoomMeshTarget } from './visible-hover';
import type { LabelArea } from './label-layout';

type Point = {
  x: number;
  y: number;
  z: number;
  boundaries?: ReadonlySet<string>;
};
type Plane = { x: number; y: number; c: number; boundary?: string };
type Polygon = Point[];
type Surface = {
  polygon: Polygon;
  constraints: Plane[];
  depth: Plane;
  code?: string;
  bounds: LabelArea;
};
export type SurfaceWork = {
  triangles: number;
  overlaps: number;
  fragments: number;
  operations: number;
  revisionReused: boolean;
  rays: number;
  elapsedMilliseconds: number;
};
export type SurfaceLimits = {
  maxTriangles: number;
  maxOperations: number;
  maxFragments: number;
  maxMilliseconds: number;
};
// Safety ceilings, not measured room performance acceptance criteria.
export const defaultSurfaceLimits: SurfaceLimits = {
  maxTriangles: 50_000,
  maxOperations: 250_000,
  maxFragments: 10_000,
  maxMilliseconds: 8,
};
export type SurfaceResult =
  | { status: 'visible'; point: Point; stats: SurfaceWork }
  | { status: 'hidden'; stats: SurfaceWork }
  | { status: 'unresolved'; reason: string; stats: SurfaceWork };

class Exhausted extends Error {}
class Work {
  stats: SurfaceWork = {
    triangles: 0,
    overlaps: 0,
    fragments: 0,
    operations: 0,
    revisionReused: false,
    rays: 0,
    elapsedMilliseconds: 0,
  };
  start = performance.now();
  constructor(
    readonly limits: SurfaceLimits,
    readonly signal?: AbortSignal,
  ) {}
  tick(amount = 1) {
    this.stats.operations += amount;
    if (this.signal?.aborted) throw new Exhausted('cancelled');
    if (
      this.stats.operations > this.limits.maxOperations ||
      this.stats.triangles > this.limits.maxTriangles ||
      this.stats.fragments > this.limits.maxFragments ||
      performance.now() - this.start > this.limits.maxMilliseconds
    )
      throw new Exhausted('work budget exhausted');
  }
}

function area(p: Polygon) {
  if (p.length < 3) return 0;
  const origin = p[0];
  return (
    p.slice(1, -1).reduce((sum, a, i) => {
      const b = p[i + 2];
      return (
        sum +
        (a.x - origin.x) * (b.y - origin.y) -
        (b.x - origin.x) * (a.y - origin.y)
      );
    }, 0) / 2
  );
}
/** Opposite orientations of exactly the same source edge share a boundary.
 * No normalization, rounding or epsilon merges distinct nearby boundaries. */
function boundaryKey(plane: Plane): string | undefined {
  if (plane.x === 0 && plane.y === 0) return undefined;
  if (plane.boundary) return plane.boundary;
  const sign = (plane.x || plane.y) < 0 ? -1 : 1;
  return `plane:${sign * plane.x}|${sign * plane.y}|${sign * plane.c}`;
}
function edges(polygon: Polygon): Plane[] {
  return polygon.map((a, i) => {
    const b = polygon[(i + 1) % polygon.length];
    // Preserve source endpoints, not just their rounded cross product. Two
    // distinct very close edges must not acquire the same provenance merely
    // because computing their coefficients loses a low-order bit.
    const endpoints = [`${a.x}|${a.y}`, `${b.x}|${b.y}`].sort();
    return {
      x: a.y - b.y,
      y: b.x - a.x,
      c: b.y * a.x - b.x * a.y,
      boundary: `edge:${endpoints.join(';')}`,
    };
  });
}
function positiveArea(polygon: Polygon): boolean {
  if (polygon.length < 3) return false;
  // These vertices were constructed on the same mathematical constraint.
  // A rounded shoelace residue cannot make this boundary-only region an area.
  for (const key of polygon[0].boundaries ?? [])
    if (polygon.every((point) => point.boundaries?.has(key))) return false;
  return area(polygon) > 0;
}
function clip(p: Polygon, plane: Plane, work: Work): Polygon {
  work.tick(p.length);
  const result: Polygon = [],
    key = boundaryKey(plane);
  const distance = (point: Point) =>
    key && point.boundaries?.has(key)
      ? 0
      : plane.x * point.x + plane.y * point.y + plane.c;
  for (let i = 0; i < p.length; i++) {
    const a = p[i],
      b = p[(i + 1) % p.length];
    const da = distance(a),
      db = distance(b);
    if (da >= 0)
      result.push(
        da === 0 && key
          ? { ...a, boundaries: new Set([...(a.boundaries ?? []), key]) }
          : a,
      );
    if (da < 0 !== db < 0) {
      const t = da / (da - db);
      const boundaries = new Set(
        [...(a.boundaries ?? [])].filter((value) => b.boundaries?.has(value)),
      );
      if (key) boundaries.add(key);
      // Retain an existing endpoint and all of its proven memberships.
      if (da === 0)
        result.push({
          ...a,
          boundaries: new Set([...(a.boundaries ?? []), ...boundaries]),
        });
      else if (db === 0)
        result.push({
          ...b,
          boundaries: new Set([...(b.boundaries ?? []), ...boundaries]),
        });
      else
        result.push({
          x: a.x + t * (b.x - a.x),
          y: a.y + t * (b.y - a.y),
          z: a.z + t * (b.z - a.z),
          boundaries,
        });
    }
  }
  return result;
}
function bounds(p: Polygon): LabelArea {
  return {
    left: Math.min(...p.map((v) => v.x)),
    right: Math.max(...p.map((v) => v.x)),
    top: Math.min(...p.map((v) => v.y)),
    bottom: Math.max(...p.map((v) => v.y)),
  };
}
function overlaps(a: LabelArea, b: LabelArea) {
  return (
    a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom
  );
}
function subtract(
  subject: Polygon,
  cutter: Polygon,
  constraints: Plane[],
  work: Work,
): Polygon[] {
  if (!positiveArea(cutter)) return [subject];
  const outside: Polygon[] = [];
  let inside = subject;
  for (const edge of constraints) {
    if (inside.length < 3) break;
    // Constant constraints either clipped the cutter away already or impose
    // no boundary. In particular 0 >= 0 has no outside region.
    if (edge.x === 0 && edge.y === 0) continue;
    const piece = clip(
      inside,
      { x: -edge.x, y: -edge.y, c: -edge.c, boundary: edge.boundary },
      work,
    );
    if (positiveArea(piece)) {
      outside.push(piece);
      work.stats.fragments++;
      work.tick();
    }
    inside = clip(inside, edge, work);
  }
  return outside;
}
function planeOf(p: Polygon): Plane | null {
  const [a, b, c] = p;
  const determinant = (b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y);
  if (determinant === 0) return null;
  const x =
    ((b.z - a.z) * (c.y - a.y) - (c.z - a.z) * (b.y - a.y)) / determinant;
  const y =
    ((b.x - a.x) * (c.z - a.z) - (c.x - a.x) * (b.z - a.z)) / determinant;
  return { x, y, c: a.z - x * a.x - y * a.y };
}

/** A shared revision cache. refresh() must run before label queries, after world
 * transforms are updated. It checks actual scene state, not a caller's guessed
 * revision number. Buffer edits follow Three's needsUpdate/version contract. */
export class ProjectedVisibleSurface {
  private signature = '';
  private surfaces: Surface[] = [];
  private failure: string | null = 'projection not prepared';
  private fingerprintFailed = false;
  private work: Work;
  private meshes: Mesh[] = [];
  private projected = false;
  private outcomes = new Map<string, { key: string; result: SurfaceResult }>();
  private identities = new WeakMap<object, number>();
  private identityCounter = 0;
  private identity(object: object | null) {
    if (!object) return 0;
    let identity = this.identities.get(object);
    if (!identity) {
      identity = ++this.identityCounter;
      this.identities.set(object, identity);
    }
    return identity;
  }
  revision = 0;
  constructor(
    readonly scene: Object3D,
    readonly camera: Camera,
    readonly limits: SurfaceLimits = defaultSurfaceLimits,
  ) {
    this.work = new Work(limits);
  }

  /** Explicit user retry; demand frames alone do not restart exhausted searches. */
  retry() {
    this.signature = '';
    this.outcomes.clear();
    this.fingerprintFailed = false;
  }

  refresh(signal?: AbortSignal): SurfaceWork {
    const work = (this.work = new Work(this.limits, signal));
    if (this.fingerprintFailed) return this.stats;
    try {
      work.tick();
      this.scene.updateWorldMatrix(true, true);
      this.camera.updateWorldMatrix(true, false);
      work.tick();
      if (!(this.camera instanceof OrthographicCamera))
        throw new Exhausted('orthographic camera required');
      const values: string[] = [];
      let signatureUnits = 0;
      const append = (...fields: (string | number | boolean | undefined)[]) => {
        for (const field of fields) {
          const value = field === undefined ? '' : String(field);
          const units = value.length + (values.length ? 1 : 0);
          // String.length counts UTF-16 code units, including both units of
          // surrogate pairs. Charge the value, separator and array entry
          // BEFORE retaining it; input strings are reused, scalar conversions
          // are bounded. maxOperations therefore also bounds accumulation.
          work.tick(units + 1);
          signatureUnits += units;
          values.push(value);
        }
      };
      append(
        ...this.camera.matrixWorld.elements,
        ...this.camera.projectionMatrix.elements,
        this.camera.layers.mask,
      );
      const meshes: Mesh[] = [];
      this.scene.traverse((object) => {
        work.tick();
        if (!(object instanceof Mesh)) return;
        // The eligibility helper can inspect every array material. Reserve
        // that bounded scan before entering its synchronous every() call.
        if (Array.isArray(object.material)) work.tick(object.material.length);
        // Reuse the authoritative pointer filter and logical ancestor lookup.
        const visible = visibleRoomMeshTarget(object);
        append(
          object.id,
          visible?.target?.code,
          !!visible,
          object.layers.mask,
          ...object.matrixWorld.elements,
        );
        if (!visible || !object.layers.test(this.camera.layers)) return;
        if (
          'isInstancedMesh' in object ||
          'isSkinnedMesh' in object ||
          object.geometry.morphAttributes.position?.length
        )
          throw new Exhausted(
            'deformed or instanced geometry requires a projection adapter',
          );
        const geometry = object.geometry,
          position = geometry.getAttribute('position');
        if (!position) return;
        append(
          geometry.id,
          this.identity(position),
          this.identity(geometry.index),
          position.count,
          position.itemSize,
          'version' in position ? position.version : position.data.version,
          geometry.index?.version,
          geometry.index?.count,
          geometry.drawRange.start,
          geometry.drawRange.count,
        );
        for (const group of geometry.groups) {
          work.tick();
          append(group.start, group.count, group.materialIndex);
        }
        for (const material of Array.isArray(object.material)
          ? object.material
          : [object.material]) {
          work.tick();
          append(
            material.id,
            material.visible,
            material.opacity,
            material.side,
          );
        }
        meshes.push(object);
      });
      // Reserve the output allocation and assembly work before join, then
      // check elapsed time afterwards before accepting or reusing a revision.
      work.tick(signatureUnits);
      const signature = values.join('|');
      work.tick();
      if (signature === this.signature) {
        work.stats.revisionReused = true;
        return work.stats;
      }
      this.signature = signature;
      this.outcomes.clear();
      this.revision++;
      this.meshes = meshes;
      this.projected = false;
      this.surfaces = [];
      this.failure = null;
    } catch (error) {
      if (!(error instanceof Exhausted)) throw error;
      this.failure = `fingerprint incomplete: ${error.message}`;
      this.fingerprintFailed = true;
      this.surfaces = [];
      this.outcomes.clear();
      this.signature = '';
    }
    return { ...work.stats };
  }

  /** Shares the entire demand-frame budget, including authoritative rays. */
  checkpoint(ray = false): string | null {
    if (this.fingerprintFailed) return this.failure;
    if (ray) this.work.stats.rays++;
    try {
      this.work.tick();
      return null;
    } catch (error) {
      if (!(error instanceof Exhausted)) throw error;
      return error.message;
    }
  }
  get stats(): SurfaceWork {
    return {
      ...this.work.stats,
      elapsedMilliseconds: performance.now() - this.work.start,
    };
  }

  private project() {
    if (this.projected) return;
    const work = this.work;
    try {
      const surfaces: Surface[] = [];
      for (const mesh of this.meshes) {
        const geometry = mesh.geometry,
          index = geometry.index;
        const count = index?.count ?? geometry.getAttribute('position').count;
        const ranges = Array.isArray(mesh.material)
          ? geometry.groups
          : [{ start: 0, count, materialIndex: 0 }];
        const code = visibleRoomMeshTarget(mesh)?.target?.code;
        for (const range of ranges) {
          const material = Array.isArray(mesh.material)
            ? mesh.material[range.materialIndex ?? 0]
            : mesh.material;
          if (!material || !material.visible || material.opacity <= 0) continue;
          const start = Math.max(range.start, geometry.drawRange.start);
          const end = Math.min(
            count,
            range.start + range.count,
            geometry.drawRange.start + geometry.drawRange.count,
          );
          for (let i = start; i < end; i += 3) {
            work.stats.triangles++;
            work.tick();
            let polygon = [0, 1, 2].map((offset) =>
              mesh
                .getVertexPosition(
                  index ? index.getX(i + offset) : i + offset,
                  new Vector3(),
                )
                .applyMatrix4(mesh.matrixWorld)
                .project(this.camera),
            ) as Polygon;
            const signedArea = area(polygon);
            if (!Number.isFinite(signedArea))
              throw new Exhausted('non-finite projected geometry');
            if (signedArea === 0) continue;
            const front =
              signedArea * Math.sign(mesh.matrixWorld.determinant()) > 0;
            if (
              material.side !== DoubleSide &&
              (material.side === BackSide ? front : !front)
            )
              continue;
            const depth = planeOf(polygon);
            if (!depth) continue;
            if (signedArea < 0) polygon.reverse();
            const originalEdges = edges(polygon);
            polygon = polygon.map((point, i) => ({
              ...point,
              boundaries: new Set(
                [
                  boundaryKey(originalEdges[i]),
                  boundaryKey(originalEdges[(i + 2) % 3]),
                ].filter((key): key is string => key !== undefined),
              ),
            }));
            const clipping = [
              { x: depth.x, y: depth.y, c: depth.c + 1 },
              { x: -depth.x, y: -depth.y, c: 1 - depth.c },
              { x: 1, y: 0, c: 1 },
              { x: -1, y: 0, c: 1 },
              { x: 0, y: 1, c: 1 },
              { x: 0, y: -1, c: 1 },
            ];
            for (const plane of clipping) polygon = clip(polygon, plane, work);
            if (positiveArea(polygon))
              surfaces.push({
                polygon,
                constraints: [...originalEdges, ...clipping],
                depth,
                code,
                bounds: bounds(polygon),
              });
          }
        }
      }
      this.surfaces = surfaces;
      this.failure = null;
    } catch (error) {
      if (!(error instanceof Exhausted)) throw error;
      this.failure = error.message;
      this.surfaces = [];
    }
    this.projected = true;
  }

  find(
    code: string,
    verify: (point: Point) => boolean,
    viewport?: LabelArea,
    obstructions: LabelArea[] = [],
    signal?: AbortSignal,
  ): SurfaceResult {
    const work = this.work;
    if (signal?.aborted)
      return { status: 'unresolved', reason: 'cancelled', stats: this.stats };
    const key = JSON.stringify([
      code,
      viewport && [
        viewport.left,
        viewport.top,
        viewport.right,
        viewport.bottom,
      ],
      obstructions.map((r) => [r.left, r.top, r.right, r.bottom]),
    ]);
    const previous = this.outcomes.get(code);
    if (previous?.key === key && !signal?.aborted)
      return { ...previous.result, stats: this.stats };
    if (!this.failure) this.project();
    if (this.failure)
      return { status: 'unresolved', reason: this.failure, stats: this.stats };
    let rejected = false;
    try {
      work.tick();
      const rectangles: Polygon[] = [];
      if (viewport) {
        const width = viewport.right - viewport.left,
          height = viewport.bottom - viewport.top;
        if (!(width > 0 && height > 0)) throw new Exhausted('empty viewport');
        for (const r of obstructions) {
          const left = (2 * (r.left - viewport.left)) / width - 1,
            right = (2 * (r.right - viewport.left)) / width - 1;
          const bottom = 1 - (2 * (r.bottom - viewport.top)) / height,
            top = 1 - (2 * (r.top - viewport.top)) / height;
          rectangles.push([
            { x: left, y: bottom, z: 0 },
            { x: right, y: bottom, z: 0 },
            { x: right, y: top, z: 0 },
            { x: left, y: top, z: 0 },
          ]);
        }
      }
      for (const target of this.surfaces) {
        work.tick();
        if (target.code !== code) continue;
        work.stats.triangles++;
        let fragments = [target.polygon];
        for (const occluder of this.surfaces) {
          work.tick();
          if (
            occluder === target ||
            occluder.code === code ||
            !overlaps(target.bounds, occluder.bounds)
          )
            continue;
          work.stats.overlaps++;
          // Orthographic projected depth is affine. Cut only the portion in
          // front of this target plane, including depth-crossing triangles.
          const nearer = {
            x: target.depth.x - occluder.depth.x,
            y: target.depth.y - occluder.depth.y,
            c: target.depth.c - occluder.depth.c - 1e-10,
          };
          const cutter = clip(occluder.polygon, nearer, work);
          fragments = fragments.flatMap((fragment) =>
            subtract(fragment, cutter, [...occluder.constraints, nearer], work),
          );
          if (!fragments.length) break;
        }
        for (const rectangle of rectangles)
          fragments = fragments.flatMap((fragment) =>
            subtract(fragment, rectangle, edges(rectangle), work),
          );
        for (const fragment of fragments) {
          work.tick(fragment.length);
          const point = fragment.reduce(
            (sum, p) => ({
              x: sum.x + p.x / fragment.length,
              y: sum.y + p.y / fragment.length,
              z: sum.z + p.z / fragment.length,
            }),
            { x: 0, y: 0, z: 0 },
          );
          if (verify(point))
            return { status: 'visible', point, stats: this.stats };
          // A surviving polygon whose witness fails the authoritative ray is
          // numerical/coplanar ambiguity, never proof that the owner is hidden.
          rejected = true;
        }
      }
      const result: SurfaceResult = rejected
        ? {
            status: 'unresolved',
            reason: 'surface witness rejected by authoritative ray',
            stats: this.stats,
          }
        : { status: 'hidden', stats: this.stats };
      this.outcomes.set(code, { key, result });
      return result;
    } catch (error) {
      if (!(error instanceof Exhausted)) throw error;
      const result: SurfaceResult = {
        status: 'unresolved',
        reason: error.message,
        stats: this.stats,
      };
      if (!signal?.aborted) this.outcomes.set(code, { key, result });
      return result;
    }
  }
}
