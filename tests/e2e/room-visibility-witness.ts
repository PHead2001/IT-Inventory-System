import type { Page } from '@playwright/test';
import {
  Matrix4,
  Ray,
  Vector3,
  RGBAFormat,
  UnsignedByteType,
  type Scene,
  type Camera,
  type WebGLRenderer,
} from 'three';

type Store = {
  getState(): { scene: Scene; camera: Camera; gl: WebGLRenderer };
};
type Hook = Record<string, unknown> & {
  supportsFiber?: boolean;
  isDisabled?: boolean;
  inject?: (...args: unknown[]) => number;
  onCommitFiberRoot?: (...args: unknown[]) => void;
};
declare global {
  interface Window {
    __roomWitnessStores?: Set<Store>;
    __REACT_DEVTOOLS_GLOBAL_HOOK__?: Hook;
  }
}
export type WitnessTriangle = {
  code: string | null;
  side: number;
  vertices: number[];
  sourceMesh?: number;
};
export type WitnessSnapshot = {
  view: number[];
  projection: number[];
  frame: { x: number; y: number; width: number; height: number };
  masks: { left: number; top: number; right: number; bottom: number }[];
  triangles: WitnessTriangle[];
  meshes?: {
    index: number;
    topology: 'triangles';
    geometry: 'box' | 'buffer';
  }[];
};

/** Test-only observation. Existing hook callbacks retain their original receiver. */
export async function observeRoomScene(page: Page) {
  await page.addInitScript(() => {
    const prior = window.__REACT_DEVTOOLS_GLOBAL_HOOK__;
    if (prior?.isDisabled || (prior && prior.supportsFiber === false))
      throw new Error(
        'Room witness cannot use a disabled/incompatible DevTools hook',
      );
    const hook: Hook = {};
    if (prior)
      for (const key of Reflect.ownKeys(prior)) {
        const value: unknown = Reflect.get(prior, key);
        Reflect.set(
          hook,
          key,
          typeof value === 'function' ? value.bind(prior) : value,
        );
      }
    let nextId = 1;
    const stores = new Set<Store>();
    window.__roomWitnessStores = stores;
    hook.supportsFiber = true;
    hook.inject = (...args) =>
      prior?.inject ? prior.inject.call(prior, ...args) : nextId++;
    hook.onCommitFiberRoot = (...args) => {
      prior?.onCommitFiberRoot?.call(prior, ...args);
      const root = args[1] as { containerInfo?: Store } | undefined;
      const store = root?.containerInfo;
      if (typeof store?.getState !== 'function') return;
      const state = store.getState();
      if (
        state.scene &&
        state.camera &&
        state.gl?.domElement instanceof HTMLCanvasElement
      ) {
        stores.add(store);
        if (stores.size > 8)
          throw new Error('Room witness root bound exceeded');
      }
    };
    window.__REACT_DEVTOOLS_GLOBAL_HOOK__ = hook;
  });
}

/** Capture once after settling: no frame subscriptions, scene/camera writes or flags. */
export async function captureRoomWitness(page: Page): Promise<WitnessSnapshot> {
  return page.evaluate(
    ({ rgbaFormat, unsignedByteType }) => {
      if ((window.__roomWitnessStores?.size ?? 0) > 8)
        throw new Error('Room witness root bound exceeded');
      const canvas = document.querySelector('[data-room-surface] canvas');
      const states = [...(window.__roomWitnessStores ?? [])]
        .map((store) => store.getState())
        .filter((state) => state.gl.domElement === canvas);
      if (states.length !== 1)
        throw new Error(
          'Actual R3F scene capture unavailable: expected one committed canvas store',
        );
      const { scene, camera } = states[0];
      const triangles: WitnessTriangle[] = [];
      const meshes: NonNullable<WitnessSnapshot['meshes']> = [];
      let objects = 0;
      let alphaTexels = 0;
      const alphaBounds = new Map<import('three').Texture, [number, number]>();
      const textureAlpha = (
        texture: import('three').Texture,
      ): [number, number] => {
        const previous = alphaBounds.get(texture);
        if (previous) return previous;
        const image = texture.image as
          { width?: number; height?: number; data?: unknown } | undefined;
        const width = image?.width ?? 0,
          height = image?.height ?? 0;
        const texels = width * height;
        if (
          !('isDataTexture' in texture) ||
          !texture.isDataTexture ||
          texture.format !== rgbaFormat ||
          texture.type !== unsignedByteType ||
          !Number.isSafeInteger(width) ||
          !Number.isSafeInteger(height) ||
          width <= 0 ||
          height <= 0 ||
          texels > 262144 ||
          alphaTexels + texels > 262144 ||
          !(image?.data instanceof Uint8Array) ||
          image.data.length !== texels * 4 ||
          texture.mipmaps.length
        )
          throw new Error(
            'Room witness alpha coverage resource is unsupported or exceeds bounds',
          );
        alphaTexels += texels;
        let min = 255,
          max = 0;
        for (let offset = 3; offset < image.data.length; offset += 4) {
          min = Math.min(min, image.data[offset]);
          max = Math.max(max, image.data[offset]);
        }
        const bounds: [number, number] = [min / 255, max / 255];
        alphaBounds.set(texture, bounds);
        return bounds;
      };
      scene.traverse((object) => {
        if (++objects > 5000)
          throw new Error('Room witness object bound exceeded');
        if (!('isMesh' in object) || !object.isMesh) return;
        // Independent renderer classification: wide-line position attributes
        // are extrusion templates, not the rendered segments' world vertices.
        if ('isLineSegments2' in object && object.isLineSegments2 === true)
          return;
        for (
          let parent: import('three').Object3D | null = object;
          parent;
          parent = parent.parent
        )
          if (!parent.visible) return;
        const mesh = object as import('three').Mesh;
        if ('isInstancedMesh' in mesh || 'isSkinnedMesh' in mesh)
          throw new Error(
            'Room witness requires supported unskinned noninstanced geometry',
          );
        const position = mesh.geometry.getAttribute('position');
        const sourceMesh = meshes.length;
        meshes.push({
          index: sourceMesh,
          topology: 'triangles',
          geometry: mesh.geometry.type === 'BoxGeometry' ? 'box' : 'buffer',
        });
        if (!position || position.itemSize !== 3)
          throw new Error('Room witness position geometry unavailable');
        const materials = Array.isArray(mesh.material)
          ? mesh.material
          : [mesh.material];
        const groups = mesh.geometry.groups.length
          ? mesh.geometry.groups
          : Array.isArray(mesh.material)
            ? [] // Three draws material arrays only through geometry groups.
            : [
                {
                  start: 0,
                  count: mesh.geometry.index?.count ?? position.count,
                  materialIndex: 0,
                },
              ];
        let code: string | null = null;
        for (
          let parent: import('three').Object3D | null = mesh;
          parent;
          parent = parent.parent
        ) {
          const owner = parent.userData.roomHoverTarget as
            { code?: string } | undefined;
          if (owner?.code) {
            code = owner.code;
            break;
          }
        }
        const matrix = mesh.matrixWorld.elements;
        const point = (index: number) => {
          const x = position.getX(index),
            y = position.getY(index),
            z = position.getZ(index);
          return [
            matrix[0] * x + matrix[4] * y + matrix[8] * z + matrix[12],
            matrix[1] * x + matrix[5] * y + matrix[9] * z + matrix[13],
            matrix[2] * x + matrix[6] * y + matrix[10] * z + matrix[14],
          ];
        };
        const drawStart = mesh.geometry.drawRange.start;
        const drawEnd = Math.min(
          mesh.geometry.index?.count ?? position.count,
          drawStart + mesh.geometry.drawRange.count,
        );
        for (const group of groups) {
          const material = Array.isArray(mesh.material)
            ? materials[group.materialIndex ?? 0]
            : mesh.material;
          if (!material)
            throw new Error('Room witness material group unavailable');
          if (
            !material.visible ||
            material.opacity <= 0 ||
            (material.transparent && material.opacity < 0.99)
          )
            continue;
          if ('wireframe' in material && material.wireframe) continue;
          if (
            ('alphaMap' in material && material.alphaMap) ||
            material.alphaTest > 0
          )
            throw new Error(
              'Room witness opaque alpha coverage is unsupported',
            );
          if (material.transparent && 'map' in material && material.map) {
            const [min, max] = textureAlpha(
              material.map as import('three').Texture,
            );
            // Filtered alpha cannot exceed the maximum actual texel alpha. Mixed
            // opaque/nonopaque coverage needs a pixel oracle this helper lacks.
            if (max * material.opacity < 0.99) continue;
            if (min * material.opacity < 0.99)
              throw new Error(
                'Room witness mixed alpha coverage is unsupported',
              );
          }
          if (![0, 1, 2].includes(material.side))
            throw new Error('Room witness material side is unsupported');
          const start = Math.max(group.start, drawStart),
            end = Math.min(group.start + group.count, drawEnd);
          if (start % 3 || (end - start) % 3)
            throw new Error('Room witness nontriangle draw range');
          for (let offset = start; offset < end; offset += 3) {
            const vertices = (
              mesh.matrixWorld.determinant() < 0 ? [0, 2, 1] : [0, 1, 2]
            ).flatMap((delta) =>
              point(
                mesh.geometry.index?.getX(offset + delta) ?? offset + delta,
              ),
            );
            if (vertices.some((value) => !Number.isFinite(value)))
              throw new Error('Room witness nonfinite vertex');
            triangles.push({ code, side: material.side, vertices, sourceMesh });
            if (triangles.length > 25000)
              throw new Error('Room witness triangle bound exceeded');
          }
        }
      });
      if (!triangles.length)
        throw new Error('Room witness captured no opaque triangles');
      const rect = canvas!.getBoundingClientRect();
      const snapshot = {
        triangles,
        meshes,
        view: [...camera.matrixWorldInverse.elements],
        projection: [...camera.projectionMatrix.elements],
        frame: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
        masks: [
          ...document.querySelectorAll<HTMLElement>('[data-room-obstruction]'),
        ]
          .filter((element) => element.getClientRects().length > 0)
          .map((element) => {
            const rect = element.getBoundingClientRect();
            return {
              left: rect.left,
              top: rect.top,
              right: rect.right,
              bottom: rect.bottom,
            };
          }),
      };
      if (
        new TextEncoder().encode(JSON.stringify(snapshot)).byteLength >
        8 * 1024 * 1024
      )
        throw new Error('Room witness serialized byte bound exceeded');
      return snapshot;
    },
    { rgbaFormat: RGBAFormat, unsignedByteType: UnsignedByteType },
  );
}

/** Read actual visual transforms and draw count without subscribing or changing the scene. */
export async function captureRoomReveal(page: Page) {
  return page.evaluate(() => {
    const canvas = document.querySelector('[data-room-surface] canvas');
    const states = [...(window.__roomWitnessStores ?? [])]
      .map((store) => store.getState())
      .filter((state) => state.gl.domElement === canvas);
    if (states.length !== 1)
      throw new Error('Expected one committed reveal scene');
    const offsets: Record<string, number[]> = {};
    states[0].scene.traverse((object) => {
      const id: unknown = object.userData.roomRevealNode;
      if (typeof id === 'string') offsets[id] = object.position.toArray();
    });
    return { offsets, drawFrame: states[0].gl.info.render.frame };
  });
}

/** Selection-only stationary triangles; never add proxies to hover witnesses. */
export async function captureRoomSelectionWitness(
  page: Page,
): Promise<WitnessSnapshot> {
  const snapshot = await captureRoomWitness(page);
  const proxies = await page.evaluate(() => {
    const canvas = document.querySelector('[data-room-surface] canvas');
    const states = [...(window.__roomWitnessStores ?? [])]
      .map((store) => store.getState())
      .filter((state) => state.gl.domElement === canvas);
    if (states.length !== 1)
      throw new Error('Expected one selection witness scene');
    const triangles: WitnessTriangle[] = [];
    let volumes = 0;
    states[0].scene.traverse((object) => {
      const target: unknown = object.userData.roomSelectionTarget;
      if (
        !target ||
        typeof target !== 'object' ||
        !('code' in target) ||
        typeof target.code !== 'string' ||
        !('isMesh' in object) ||
        !object.isMesh
      )
        return;
      for (
        let current: import('three').Object3D | null = object;
        current;
        current = current.parent
      )
        if (!current.visible) return;
      if (++volumes > 96) throw new Error('Selection volume witness bound');
      const mesh = object as import('three').Mesh;
      const geometry = mesh.geometry,
        position = geometry.getAttribute('position'),
        index = geometry.getIndex();
      if (!index || index.count > 36 || position.itemSize !== 3)
        throw new Error('Expected bounded selection box');
      for (let offset = 0; offset < index.count; offset += 3) {
        const vertices: number[] = [];
        for (let corner = 0; corner < 3; corner++) {
          const i = index.getX(offset + corner),
            m = mesh.matrixWorld.elements;
          const x = position.getX(i),
            y = position.getY(i),
            z = position.getZ(i);
          vertices.push(
            m[0] * x + m[4] * y + m[8] * z + m[12],
            m[1] * x + m[5] * y + m[9] * z + m[13],
            m[2] * x + m[6] * y + m[10] * z + m[14],
          );
        }
        if (!vertices.every(Number.isFinite))
          throw new Error('Nonfinite selection witness');
        triangles.push({ code: target.code, side: 0, vertices });
      }
    });
    return triangles;
  });
  // Actual physical surfaces precede proxies for equal-depth intersections.
  return { ...snapshot, triangles: [...snapshot.triangles, ...proxies] };
}

/** Passive effects/ref/resource observation; never renders or mutates the scene. */
export async function captureRoomEffects(page: Page) {
  return page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>(
      '[data-room-surface] canvas',
    );
    const states = [...(window.__roomWitnessStores ?? [])]
      .map((store) => store.getState())
      .filter((state) => state.gl.domElement === canvas);
    if (states.length !== 1 || !canvas)
      throw new Error('Expected one committed effects scene');
    const { scene, gl } = states[0];
    const hoverOffsets: Record<string, number[]> = {};
    const bloomCodes = new Set<string>();
    let bloomMeshes = 0,
      contactVisible = false;
    scene.traverse((object) => {
      const hoverId: unknown = object.userData.roomHoverVisualNode;
      if (typeof hoverId === 'string')
        hoverOffsets[hoverId] = object.position.toArray();
      if (object.userData.roomContactReceiver) contactVisible = object.visible;
      if (
        !('isMesh' in object) ||
        !object.isMesh ||
        !(object.layers.mask & (1 << 11))
      )
        return;
      bloomMeshes++;
      for (
        let parent: import('three').Object3D | null = object;
        parent;
        parent = parent.parent
      ) {
        const code: unknown = parent.userData.roomHoverTarget?.code;
        if (typeof code === 'string') {
          bloomCodes.add(code);
          break;
        }
      }
    });
    return {
      hoverOffsets,
      bloomCodes: [...bloomCodes].sort(),
      bloomMeshes,
      contactVisible,
      contactCaptures: Number(canvas.dataset.contactCaptures ?? 0),
      contactCaptureMs: canvas.dataset.contactCaptureMs
        ? Number(canvas.dataset.contactCaptureMs)
        : null,
      contactStatus: canvas.dataset.contactStatus ?? '',
      bloomStatus: canvas.dataset.bloomStatus ?? '',
      paletteRevision: Number(canvas.dataset.paletteRevision ?? 0),
      sceneFrames: Number(canvas.dataset.sceneEffectFrames ?? 0),
      composerFrames: Number(canvas.dataset.composerFrames ?? 0),
      drawFrame: gl.info.render.frame,
      memory: {
        geometries: gl.info.memory.geometries,
        textures: gl.info.memory.textures,
        programs: gl.info.programs?.length ?? 0,
      },
      qualityEvidence: canvas.dataset.effectsQualityEvidence ?? '',
      runtime: {
        userAgent: navigator.userAgent,
        renderer: (() => {
          const context = gl.getContext();
          const extension = context.getExtension('WEBGL_debug_renderer_info');
          return {
            unmaskedAvailable: extension !== null,
            vendor: String(
              context.getParameter(
                extension?.UNMASKED_VENDOR_WEBGL ?? context.VENDOR,
              ),
            ),
            name: String(
              context.getParameter(
                extension?.UNMASKED_RENDERER_WEBGL ?? context.RENDERER,
              ),
            ),
            version: String(context.getParameter(context.VERSION)),
          };
        })(),
        dpr: gl.getPixelRatio(),
        width: gl.domElement.width,
        height: gl.domElement.height,
        exposure: gl.toneMappingExposure,
        toneMapping: gl.toneMapping,
        outputColorSpace: gl.outputColorSpace,
        rawToneMapping: canvas.dataset.rawSceneToneMapping,
        rawExposure: canvas.dataset.rawSceneExposure,
        rawOutputColorSpace: canvas.dataset.rawSceneOutputColorSpace,
      },
    };
  });
}

/** Independent first actual triangle at one stationary screen point, including unbound blockers. */
export function roomWitnessCodeAtPoint(
  snapshot: WitnessSnapshot,
  point: { x: number; y: number },
) {
  const inverse = new Matrix4()
    .multiplyMatrices(
      new Matrix4().fromArray(snapshot.projection),
      new Matrix4().fromArray(snapshot.view),
    )
    .invert();
  const x = ((point.x - snapshot.frame.x) / snapshot.frame.width) * 2 - 1;
  const y = 1 - ((point.y - snapshot.frame.y) / snapshot.frame.height) * 2;
  const near = new Vector3(x, y, -1).applyMatrix4(inverse),
    far = new Vector3(x, y, 1).applyMatrix4(inverse);
  const ray = new Ray(near, far.clone().sub(near).normalize());
  let distance = Infinity,
    code: string | null = null;
  for (const face of snapshot.triangles) {
    const a = new Vector3().fromArray(face.vertices, 0),
      b = new Vector3().fromArray(face.vertices, 3),
      c = new Vector3().fromArray(face.vertices, 6);
    const hit =
      face.side === 1
        ? ray.intersectTriangle(c, b, a, true, new Vector3())
        : ray.intersectTriangle(a, b, c, face.side !== 2, new Vector3());
    if (!hit) continue;
    const measured = near.distanceTo(hit);
    if (measured <= near.distanceTo(far) && measured < distance) {
      distance = measured;
      code = face.code;
    }
  }
  return code;
}

/** Independent bounded ray/triangle oracle. No production visibility helper. */
export function roomVisibilityWitnessReport(snapshot: WitnessSnapshot) {
  const transform = new Matrix4().multiplyMatrices(
    new Matrix4().fromArray(snapshot.projection),
    new Matrix4().fromArray(snapshot.view),
  );
  const inverse = transform.clone().invert();
  const faces = snapshot.triangles.map((triangle) => ({
    ...triangle,
    a: new Vector3().fromArray(triangle.vertices, 0),
    b: new Vector3().fromArray(triangle.vertices, 3),
    c: new Vector3().fromArray(triangle.vertices, 6),
  }));
  const byCode = new Map<string, typeof faces>();
  for (const face of faces)
    if (face.code) {
      const list = byCode.get(face.code) ?? [];
      list.push(face);
      byCode.set(face.code, list);
    }
  const result = new Map<string, { x: number; y: number }[]>();
  const blockedFaces = new Set<string>();
  let rays = 0;
  const test = (
    code: string,
    ndc: Vector3,
    sampledFace?: (typeof faces)[number],
  ) => {
    if (
      Math.abs(ndc.x) > 0.995 ||
      Math.abs(ndc.y) > 0.995 ||
      Math.abs(ndc.z) > 1
    )
      return;
    const point = {
      x: snapshot.frame.x + ((ndc.x + 1) * snapshot.frame.width) / 2,
      y: snapshot.frame.y + ((1 - ndc.y) * snapshot.frame.height) / 2,
    };
    if (
      snapshot.masks.some(
        (mask) =>
          point.x >= mask.left &&
          point.x <= mask.right &&
          point.y >= mask.top &&
          point.y <= mask.bottom,
      )
    )
      return;
    if (++rays > 10000) throw new Error('Room witness ray bound exceeded');
    const origin = new Vector3(ndc.x, ndc.y, -1).applyMatrix4(inverse),
      far = new Vector3(ndc.x, ndc.y, 1).applyMatrix4(inverse);
    const ray = new Ray(origin, far.clone().sub(origin).normalize());
    const maximumDistance = origin.distanceTo(far);
    let firstCode: string | null = null,
      distance = Infinity;
    for (const face of faces) {
      const hit =
        face.side === 1
          ? ray.intersectTriangle(face.c, face.b, face.a, true, new Vector3())
          : ray.intersectTriangle(
              face.a,
              face.b,
              face.c,
              face.side !== 2,
              new Vector3(),
            );
      if (!hit) continue;
      const measured = origin.distanceTo(hit);
      if (measured <= maximumDistance && measured < distance) {
        distance = measured;
        firstCode = face.code;
      }
    }
    if (sampledFace && firstCode !== code && Number.isFinite(distance)) {
      const candidate =
        sampledFace.side === 1
          ? ray.intersectTriangle(
              sampledFace.c,
              sampledFace.b,
              sampledFace.a,
              true,
              new Vector3(),
            )
          : ray.intersectTriangle(
              sampledFace.a,
              sampledFace.b,
              sampledFace.c,
              sampledFace.side !== 2,
              new Vector3(),
            );
      if (candidate && origin.distanceTo(candidate) > distance + 1e-5)
        blockedFaces.add(code);
    }
    if (firstCode === code) {
      const list = result.get(code) ?? [];
      if (
        !list.some(
          (existing) =>
            Math.hypot(existing.x - point.x, existing.y - point.y) < 1,
        )
      )
        list.push(point);
      result.set(code, list);
    }
  };
  for (const [code, targetFaces] of byCode) {
    // Samples include edge/corner-adjacent patches and a 9x9 projected raster;
    // representative partial visibility proof, not exhaustive pixel coverage.
    const projected = targetFaces.flatMap((face) =>
      [face.a, face.b, face.c].map((point) =>
        point.clone().applyMatrix4(transform),
      ),
    );
    const minX = Math.max(
        -0.99,
        Math.min(...projected.map((point) => point.x)),
      ),
      maxX = Math.min(0.99, Math.max(...projected.map((point) => point.x)));
    const minY = Math.max(
        -0.99,
        Math.min(...projected.map((point) => point.y)),
      ),
      maxY = Math.min(0.99, Math.max(...projected.map((point) => point.y)));
    if (minX <= maxX && minY <= maxY)
      for (let row = 0; row < 9; row++)
        for (let col = 0; col < 9; col++)
          test(
            code,
            new Vector3(
              minX + ((maxX - minX) * (col + 0.5)) / 9,
              minY + ((maxY - minY) * (row + 0.5)) / 9,
              0,
            ),
          );
    for (const face of targetFaces)
      for (const weights of [
        [1 / 3, 1 / 3, 1 / 3],
        [0.8, 0.1, 0.1],
        [0.1, 0.8, 0.1],
        [0.1, 0.1, 0.8],
        [0.48, 0.48, 0.04],
        [0.48, 0.04, 0.48],
        [0.04, 0.48, 0.48],
      ])
        test(
          code,
          face.a
            .clone()
            .multiplyScalar(weights[0])
            .addScaledVector(face.b, weights[1])
            .addScaledVector(face.c, weights[2])
            .applyMatrix4(transform),
          face,
        );
  }
  return {
    witnesses: result,
    partiallyExposedCodes: [...blockedFaces]
      .filter((code) => result.has(code))
      .sort(),
    rays,
  };
}

export function roomVisibilityWitnesses(snapshot: WitnessSnapshot) {
  return roomVisibilityWitnessReport(snapshot).witnesses;
}

/** Current diagnostic ray at the requested/actual pixel, independent of picking
 * telemetry. Return only canonical surface identity and distance, no scene data. */
export function roomRayWitnessAt(
  snapshot: WitnessSnapshot,
  point: { x: number; y: number },
) {
  if (
    snapshot.triangles.length > 25000 ||
    ![
      point.x,
      point.y,
      snapshot.frame.x,
      snapshot.frame.y,
      snapshot.frame.width,
      snapshot.frame.height,
    ].every(Number.isFinite) ||
    snapshot.frame.width <= 0 ||
    snapshot.frame.height <= 0
  )
    throw new Error('Room diagnostic ray input bound');
  const x = ((point.x - snapshot.frame.x) / snapshot.frame.width) * 2 - 1;
  const y = 1 - ((point.y - snapshot.frame.y) / snapshot.frame.height) * 2;
  if (Math.abs(x) > 1 || Math.abs(y) > 1)
    return { code: null, distance: null, inside: false };
  const inverse = new Matrix4()
    .multiplyMatrices(
      new Matrix4().fromArray(snapshot.projection),
      new Matrix4().fromArray(snapshot.view),
    )
    .invert();
  const origin = new Vector3(x, y, -1).applyMatrix4(inverse);
  const far = new Vector3(x, y, 1).applyMatrix4(inverse);
  const ray = new Ray(origin, far.clone().sub(origin).normalize());
  const maximum = origin.distanceTo(far);
  let code: string | null = null,
    distance = Infinity;
  let sourceMesh: number | null = null;
  for (const face of snapshot.triangles) {
    const a = new Vector3().fromArray(face.vertices, 0),
      b = new Vector3().fromArray(face.vertices, 3),
      c = new Vector3().fromArray(face.vertices, 6);
    const hit =
      face.side === 1
        ? ray.intersectTriangle(c, b, a, true, new Vector3())
        : ray.intersectTriangle(a, b, c, face.side !== 2, new Vector3());
    if (!hit) continue;
    const measured = origin.distanceTo(hit);
    if (measured <= maximum && measured < distance) {
      code = face.code;
      sourceMesh = face.sourceMesh ?? null;
      distance = measured;
    }
  }
  return {
    code,
    distance: Number.isFinite(distance) ? distance : null,
    inside: true,
    sourceMesh,
  };
}

/** Actual DOM overlay/action coverage decides where a real mesh journey can start. */
export async function uncoveredRoomWitnesses(
  page: Page,
  witnesses: Map<string, { x: number; y: number }[]>,
  selectionSnapshot?: WitnessSnapshot,
) {
  const samples = [...witnesses].flatMap(([code, points]) =>
    points.map((point) => ({ code, ...point })),
  );
  if (samples.length > 10000)
    throw new Error('Room pointer witness bound exceeded');
  const uncovered = await page.evaluate((points) => {
    const canvas = document.querySelector('[data-room-surface] canvas');
    return points.filter(
      ({ x, y }) => document.elementFromPoint(x, y) === canvas,
    );
  }, samples);
  const result = new Map<string, { x: number; y: number }>();
  for (const point of uncovered)
    if (
      !result.has(point.code) &&
      (!selectionSnapshot ||
        roomWitnessCodeAtPoint(selectionSnapshot, point) === point.code)
    )
      result.set(point.code, { x: point.x, y: point.y });
  return result;
}
