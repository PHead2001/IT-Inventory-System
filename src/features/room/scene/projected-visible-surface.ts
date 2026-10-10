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
  | { status: 'pending'; reason: string; stats: SurfaceWork }
  | { status: 'unresolved'; reason: string; stats: SurfaceWork };

class Exhausted extends Error {}
class Paused extends Error {}
export const maxSurfaceContinuationFrames = 64;
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
  frames = 1;
  constructor(
    readonly limits: SurfaceLimits,
    readonly signal?: AbortSignal,
  ) {}
  nextFrame() {
    this.start = performance.now();
    this.frames++;
    this.stats.revisionReused = true;
  }
  tick(amount = 1) {
    if (this.signal?.aborted) throw new Exhausted('cancelled');
    if (performance.now() - this.start > this.limits.maxMilliseconds)
      throw new Paused('frame time allowance exhausted');
    this.stats.operations += amount;
    if (
      this.stats.operations > this.limits.maxOperations ||
      this.stats.triangles > this.limits.maxTriangles ||
      this.stats.fragments > this.limits.maxFragments
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
function* clip(p: Polygon, plane: Plane): Generator<number, Polygon> {
  yield p.length;
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
function* subtract(
  subject: Polygon,
  cutter: Polygon,
  constraints: Plane[],
  work: Work,
): Generator<number, Polygon[]> {
  if (!positiveArea(cutter)) return [subject];
  const outside: Polygon[] = [];
  let inside = subject;
  for (const edge of constraints) {
    if (inside.length < 3) break;
    // Constant constraints either clipped the cutter away already or impose
    // no boundary. In particular 0 >= 0 has no outside region.
    if (edge.x === 0 && edge.y === 0) continue;
    const piece = yield* clip(inside, {
      x: -edge.x,
      y: -edge.y,
      c: -edge.c,
      boundary: edge.boundary,
    });
    if (positiveArea(piece)) {
      outside.push(piece);
      work.stats.fragments++;
      yield 1;
    }
    inside = yield* clip(inside, edge);
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

type Task<T> = {
  generator: Generator<number, T>;
  cursor?: IteratorResult<number, T>;
};
type Guard = {
  read: () => unknown[];
  measure: () => number;
  scanCost: () => number;
  size: number;
  values: unknown[];
  cost: number;
};
type Query = {
  key: string;
  proof: { verify: (point: Point) => boolean };
  task: Task<SurfaceResult>;
};
function visibleRoomOwnerCodeLength(object: Object3D) {
  for (let current: Object3D | null = object; current; current = current.parent)
    if (current.userData.roomHoverTarget)
      return current.userData.roomHoverTarget.code?.length ?? 0;
  return 0;
}

/** Same-revision work survives cooperative frame yields. Every frame first
 * synchronously validates the captured structured state; an incomplete guard
 * never authorizes cached visibility. Buffer changes follow needsUpdate/version.
 */
export class ProjectedVisibleSurface {
  private guards: Guard[] = [];
  private staged: Guard | null = null;
  private fingerprint: Task<void> | null = null;
  private projection: Task<void> | null = null;
  private surfaces: Surface[] = [];
  private meshes: Mesh[] = [];
  private queries = new Map<string, Query>();
  private outcomes = new Map<string, { key: string; result: SurfaceResult }>();
  private failure: string | null = null;
  private validated = false;
  private observed = false;
  private prepared = false;
  private projected = false;
  private work: Work;
  private requested = false;
  private hasFrame = false;
  revision = 0;
  constructor(
    readonly scene: Object3D,
    readonly camera: Camera,
    readonly limits: SurfaceLimits = defaultSurfaceLimits,
  ) {
    this.work = new Work(limits);
  }

  private reset(signal?: AbortSignal) {
    this.work = new Work(this.limits, signal);
    this.revision++;
    this.guards = [];
    this.staged = null;
    this.meshes = [];
    this.surfaces = [];
    this.queries.clear();
    this.outcomes.clear();
    this.failure = null;
    this.validated = false;
    this.observed = false;
    this.prepared = false;
    this.projected = false;
    this.projection = null;
    this.fingerprint = { generator: this.capture() };
  }
  /** An explicit retry starts one new bounded attempt. */
  retry() {
    this.reset();
    this.hasFrame = false;
  }
  private *retain(
    read: () => unknown[],
    measure: () => number,
    scanCost: () => number = () => 1,
  ): Generator<number, void> {
    let size: number, cost: number;
    for (;;) {
      size = measure();
      cost = size * 2 + scanCost();
      // Reserve the output allocation, comparisons and eligibility scan before
      // touching collection elements. Recheck after a suspended reservation:
      // a now-grown collection cannot consume a previously smaller allowance.
      yield cost;
      if (measure() === size && size * 2 + scanCost() === cost) break;
    }
    const values = read();
    // A read that exhausts the current time slice is still guarded before its
    // pending reservation resumes. Otherwise it could commit an old value.
    this.staged = { read, measure, scanCost, size, values, cost };
    yield 0;
    this.guards.push(this.staged);
    this.staged = null;
  }
  private *capture(): Generator<number, void> {
    if (!(this.camera instanceof OrthographicCamera))
      throw new Exhausted('orthographic camera required');
    yield* this.retain(
      () => [
        ...this.camera.matrixWorld.elements,
        ...this.camera.projectionMatrix.elements,
        this.camera.layers.mask,
      ],
      () =>
        this.camera.matrixWorld.elements.length +
        this.camera.projectionMatrix.elements.length +
        1,
    );
    const stack = [this.scene];
    while (stack.length) {
      yield 1;
      const object = stack.pop()!;
      yield* this.retain(
        () => [
          object.parent,
          object.visible,
          object.layers.mask,
          object.userData.hoverPassThrough,
          object.userData.roomHoverTarget?.code,
          ...object.children,
          // Label anchor groups move as a consequence of this computation. Only
          // rendered mesh transforms affect its physical visibility revision.
          ...(object instanceof Mesh ? object.matrixWorld.elements : []),
        ],
        () =>
          5 +
          object.children.length +
          (object instanceof Mesh ? object.matrixWorld.elements.length : 0) +
          (object.userData.roomHoverTarget?.code?.length ?? 0),
      );
      yield object.children.length;
      for (const child of object.children) stack.push(child);
      if (!(object instanceof Mesh)) continue;
      // Budget the material eligibility scan before the synchronous helper.
      yield* this.retain(
        () => {
          const current = visibleRoomMeshTarget(object);
          return [
            !!current,
            current?.target?.code,
            object.geometry,
            object.material,
          ];
        },
        () => 4 + visibleRoomOwnerCodeLength(object),
        () => (Array.isArray(object.material) ? object.material.length : 1),
      );
      const visible = visibleRoomMeshTarget(object);
      if (!visible || !object.layers.test(this.camera.layers)) continue;
      if (
        'isInstancedMesh' in object ||
        'isSkinnedMesh' in object ||
        object.geometry.morphAttributes.position?.length
      )
        throw new Exhausted(
          'deformed or instanced geometry requires a projection adapter',
        );
      const geometry = object.geometry;
      yield* this.retain(
        () => {
          const position = geometry.getAttribute('position');
          return [
            position,
            geometry.index,
            position?.count,
            position?.itemSize,
            position &&
              ('version' in position
                ? position.version
                : position.data.version),
            geometry.index?.version,
            geometry.index?.count,
            geometry.drawRange.start,
            geometry.drawRange.count,
            geometry.morphAttributes.position,
            geometry.morphAttributes.position?.length,
            geometry.groups.length,
            ...(Array.isArray(object.material)
              ? object.material
              : [object.material]),
          ];
        },
        () =>
          13 + (Array.isArray(object.material) ? object.material.length : 1),
      );
      if (!geometry.getAttribute('position')) continue;
      // Retain group identity/order as well as each group's scalar state.
      yield* this.retain(
        () => [...geometry.groups],
        () => geometry.groups.length,
      );
      for (const group of geometry.groups)
        yield* this.retain(
          () => [group.start, group.count, group.materialIndex],
          () => 3,
        );
      for (const material of Array.isArray(object.material)
        ? object.material
        : [object.material])
        yield* this.retain(
          () => [
            material.id,
            material.visible,
            material.opacity,
            material.side,
          ],
          () => 4,
        );
      this.meshes.push(object);
    }
    this.prepared = true;
  }
  private run<T>(task: Task<T>): T | undefined {
    for (;;) {
      // cursor preserves the next reservation across a yield; no completed
      // triangle, clipping edge or fragment is replayed on the next frame.
      task.cursor ??= task.generator.next();
      if (task.cursor.done) return task.cursor.value;
      this.work.tick(task.cursor.value);
      task.cursor = task.generator.next();
    }
  }
  private guard(work: Work) {
    const count = this.guards.length + (this.staged ? 1 : 0);
    for (let index = 0; index < count; index++) {
      const { read, measure, scanCost, size, values, cost } =
        index < this.guards.length ? this.guards[index] : this.staged!;
      // Length changes invalidate before copying/scanning the changed input.
      // Its replacement capture must reserve its actual new size separately.
      if (measure() !== size || size * 2 + scanCost() !== cost) return false;
      work.tick(cost);
      const current = read();
      if (
        current.length !== values.length ||
        current.some((value, i) => !Object.is(value, values[i]))
      )
        return false;
    }
    // Includes time consumed by the last read, not just its reservation.
    work.tick();
    return true;
  }
  refresh(signal?: AbortSignal): SurfaceWork {
    const continuing = this.hasFrame && this.pending;
    this.requested = false;
    this.validated = false;
    this.observed = false;
    if (continuing) this.work.nextFrame();
    else this.work.start = performance.now();
    this.hasFrame = true;
    try {
      // World updates and guard share the same frame deadline. Complete or
      // terminal attempts may observe a later externally triggered revision
      // using a separate bounded observation allowance, without restarting it.
      const observation = continuing
        ? this.work
        : new Work(this.limits, signal);
      observation.start = this.work.start;
      const previousOperations = observation.stats.operations;
      observation.tick();
      this.scene.updateWorldMatrix(true, true);
      this.camera.updateWorldMatrix(true, false);
      observation.tick();
      const same = this.guard(observation);
      this.observed = same;
      if (!this.fingerprint || !same) {
        const start = observation.start;
        this.reset(signal);
        this.work.start = start;
        this.work.stats.operations =
          observation.stats.operations - previousOperations;
      } else this.work.stats.revisionReused = this.prepared;
      if (this.failure) return this.stats;
      if (this.work.frames > maxSurfaceContinuationFrames)
        throw new Exhausted('continuation frame limit reached');
      if (!this.prepared) this.run(this.fingerprint!);
      // All capture reads in this synchronous frame are coherent. Earlier
      // retained reads have just passed the complete guard above.
      this.work.tick();
      this.validated = this.prepared;
      this.observed = this.prepared;
    } catch (error) {
      if (error instanceof Paused) {
        if (this.work.frames >= maxSurfaceContinuationFrames)
          this.terminate('continuation frame limit reached');
      } else if (error instanceof Exhausted) {
        this.terminate(
          !this.prepared && error.message === 'work budget exhausted'
            ? `fingerprint unsupported within structural limits: ${error.message}`
            : `fingerprint incomplete: ${error.message}`,
        );
      } else throw error;
    }
    return this.stats;
  }
  private terminate(reason: string) {
    this.failure = reason;
    this.fingerprint ??= { generator: (function* () {})() };
    this.projection = null;
    this.queries.clear();
    this.outcomes.clear();
  }
  get pending() {
    return (
      !this.failure &&
      (!this.prepared ||
        !this.validated ||
        !!this.projection ||
        this.queries.size > 0 ||
        this.requested)
    );
  }
  get ready() {
    return this.validated && !this.failure;
  }
  get revisionChecked() {
    return this.observed;
  }
  hasPendingQuery(code: string) {
    return this.queries.has(code);
  }
  /** Called once after every label has had a turn. No frame is requested for
   * settled or terminal work, and the frame ceiling covers repeated no-progress. */
  finishFrame(activeCodes?: ReadonlySet<string>, hasPendingLabels = true) {
    if (activeCodes)
      for (const code of this.queries.keys())
        if (!activeCodes.has(code)) this.queries.delete(code);
    // A removed query must not keep otherwise settled active labels rendering.
    // Preserve its shared projection cursor for a future externally requested
    // query, while requesting no frame for unused work.
    if (activeCodes && !hasPendingLabels && this.queries.size === 0)
      return false;
    if (this.pending && this.work.frames >= maxSurfaceContinuationFrames) {
      this.terminate('continuation frame limit reached');
      return false;
    }
    return this.pending;
  }
  checkpoint(ray = false): string | null {
    if (this.failure) return this.failure;
    if (!this.validated) {
      this.requested = true;
      return 'scene revision pending';
    }
    try {
      this.work.tick();
      if (ray) this.work.stats.rays++;
      return null;
    } catch (error) {
      if (error instanceof Paused) {
        this.requested = true;
        return error.message;
      }
      if (!(error instanceof Exhausted)) throw error;
      this.terminate(error.message);
      return error.message;
    }
  }
  get stats(): SurfaceWork {
    return {
      ...this.work.stats,
      elapsedMilliseconds: performance.now() - this.work.start,
    };
  }
  private *project(): Generator<number, void> {
    const work = this.work;
    for (const mesh of this.meshes) {
      const geometry = mesh.geometry,
        index = geometry.index;
      const count = index?.count ?? geometry.getAttribute('position').count;
      const ranges = Array.isArray(mesh.material)
        ? geometry.groups
        : [{ start: 0, count, materialIndex: 0 }];
      const code = visibleRoomMeshTarget(mesh)?.target?.code;
      for (const range of ranges) {
        yield 1;
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
          yield 1;
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
          for (const plane of clipping) polygon = yield* clip(polygon, plane);
          if (positiveArea(polygon))
            this.surfaces.push({
              polygon,
              constraints: [...originalEdges, ...clipping],
              depth,
              code,
              bounds: bounds(polygon),
            });
        }
      }
    }
    this.projected = true;
  }
  private *query(
    code: string,
    query: Query['proof'],
    viewport?: LabelArea,
    obstructions: LabelArea[] = [],
  ): Generator<number, SurfaceResult> {
    const work = this.work;
    yield 1;
    const rectangles: Polygon[] = [];
    if (viewport) {
      const width = viewport.right - viewport.left,
        height = viewport.bottom - viewport.top;
      if (!(width > 0 && height > 0)) throw new Exhausted('empty viewport');
      for (const r of obstructions) {
        yield 1;
        const left = (2 * (r.left - viewport.left)) / width - 1,
          right = (2 * (r.right - viewport.left)) / width - 1,
          bottom = 1 - (2 * (r.bottom - viewport.top)) / height,
          top = 1 - (2 * (r.top - viewport.top)) / height;
        rectangles.push([
          { x: left, y: bottom, z: 0 },
          { x: right, y: bottom, z: 0 },
          { x: right, y: top, z: 0 },
          { x: left, y: top, z: 0 },
        ]);
      }
    }
    let rejected = false;
    for (const target of this.surfaces) {
      yield 1;
      if (target.code !== code) continue;
      work.stats.triangles++;
      yield 1;
      let fragments = [target.polygon];
      for (const occluder of this.surfaces) {
        yield 1;
        if (
          occluder === target ||
          occluder.code === code ||
          !overlaps(target.bounds, occluder.bounds)
        )
          continue;
        work.stats.overlaps++;
        const nearer = {
          x: target.depth.x - occluder.depth.x,
          y: target.depth.y - occluder.depth.y,
          c: target.depth.c - occluder.depth.c - 1e-10,
        };
        const cutter = yield* clip(occluder.polygon, nearer);
        const next: Polygon[] = [];
        for (const fragment of fragments)
          next.push(
            ...(yield* subtract(
              fragment,
              cutter,
              [...occluder.constraints, nearer],
              work,
            )),
          );
        fragments = next;
        if (!fragments.length) break;
      }
      for (const rectangle of rectangles) {
        const next: Polygon[] = [];
        for (const fragment of fragments)
          next.push(
            ...(yield* subtract(fragment, rectangle, edges(rectangle), work)),
          );
        fragments = next;
      }
      for (const fragment of fragments) {
        yield fragment.length;
        const point = fragment.reduce(
          (sum, p) => ({
            x: sum.x + p.x / fragment.length,
            y: sum.y + p.y / fragment.length,
            z: sum.z + p.z / fragment.length,
          }),
          { x: 0, y: 0, z: 0 },
        );
        // A ray is atomic. Its post-ray deadline may yield; retain the exact
        // fragment and try its owner proof again rather than classify it hidden.
        if (query.verify(point))
          return { status: 'visible', point, stats: this.stats };
        while (this.requested) {
          yield 1;
          if (query.verify(point))
            return { status: 'visible', point, stats: this.stats };
        }
        if (this.failure) throw new Exhausted(this.failure);
        rejected = true;
      }
    }
    return rejected
      ? {
          status: 'unresolved',
          reason: 'surface witness rejected by authoritative ray',
          stats: this.stats,
        }
      : { status: 'hidden', stats: this.stats };
  }
  find(
    code: string,
    verify: (point: Point) => boolean,
    viewport?: LabelArea,
    obstructions: LabelArea[] = [],
    signal?: AbortSignal,
  ): SurfaceResult {
    if (signal?.aborted)
      return { status: 'unresolved', reason: 'cancelled', stats: this.stats };
    if (this.failure)
      return { status: 'unresolved', reason: this.failure, stats: this.stats };
    if (!this.validated)
      return {
        status: 'pending',
        reason: 'scene revision pending',
        stats: this.stats,
      };
    const key = JSON.stringify([code, viewport, obstructions]);
    const previous = this.outcomes.get(code);
    if (previous?.key === key) {
      if (previous.result.status !== 'visible' || verify(previous.result.point))
        return { ...previous.result, stats: this.stats };
      return {
        status: this.pending ? 'pending' : 'unresolved',
        reason: this.pending
          ? 'surface proof pending'
          : 'surface witness rejected by authoritative ray',
        stats: this.stats,
      };
    }
    try {
      if (!this.projected) {
        this.projection ??= { generator: this.project() };
        this.run(this.projection);
        this.projection = null;
      }
      let query = this.queries.get(code);
      if (!query || query.key !== key) {
        const proof = { verify };
        query = {
          key,
          proof,
          task: { generator: this.query(code, proof, viewport, obstructions) },
        };
        this.queries.set(code, query);
      }
      query.proof.verify = verify;
      const result = this.run(query.task)!;
      this.queries.delete(code);
      this.outcomes.set(code, { key, result });
      return result;
    } catch (error) {
      if (error instanceof Paused) {
        this.requested = true;
        return { status: 'pending', reason: error.message, stats: this.stats };
      }
      if (!(error instanceof Exhausted)) throw error;
      this.terminate(error.message);
      return { status: 'unresolved', reason: error.message, stats: this.stats };
    }
  }
}
