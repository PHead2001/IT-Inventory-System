import {
  AddEquation,
  Color,
  CustomBlending,
  Mesh,
  OneFactor,
  OrthographicCamera,
  PlaneGeometry,
  Scene,
  ShaderMaterial,
  Vector4,
  ZeroFactor,
  type Camera,
  type Texture,
  type WebGLRenderer,
  type WebGLRenderTarget,
} from 'three';

type Composer = { render(delta: number): void; inputBuffer: WebGLRenderTarget };
export type RawSceneColor = Pick<
  WebGLRenderer,
  'toneMapping' | 'toneMappingExposure' | 'outputColorSpace'
>;

/** Read before the lazy wrapper mounts and changes renderer tone mapping. */
export function captureRawSceneColor(gl: WebGLRenderer): RawSceneColor {
  return {
    toneMapping: gl.toneMapping,
    toneMappingExposure: gl.toneMappingExposure,
    outputColorSpace: gl.outputColorSpace,
  };
}
function captureFrameState(gl: WebGLRenderer, scene: Scene, camera: Camera) {
  return {
    target: gl.getRenderTarget(),
    face: gl.getActiveCubeFace(),
    mip: gl.getActiveMipmapLevel(),
    viewport: gl.getViewport(new Vector4()),
    scissor: gl.getScissor(new Vector4()),
    scissorTest: gl.getScissorTest(),
    clearColor: gl.getClearColor(new Color()),
    clearAlpha: gl.getClearAlpha(),
    autoClear: gl.autoClear,
    autoClearColor: gl.autoClearColor,
    autoClearDepth: gl.autoClearDepth,
    autoClearStencil: gl.autoClearStencil,
    color: captureRawSceneColor(gl),
    layers: camera.layers.mask,
    background: scene.background,
    overrideMaterial: scene.overrideMaterial,
    shadowEnabled: gl.shadowMap.enabled,
    shadowAutoUpdate: gl.shadowMap.autoUpdate,
    xr: gl.xr.enabled,
  };
}
function restoreFrameState(
  gl: WebGLRenderer,
  scene: Scene,
  camera: Camera,
  state: ReturnType<typeof captureFrameState>,
) {
  gl.setRenderTarget(state.target, state.face, state.mip);
  gl.setViewport(state.viewport);
  gl.setScissor(state.scissor);
  gl.setScissorTest(state.scissorTest);
  gl.setClearColor(state.clearColor, state.clearAlpha);
  gl.autoClear = state.autoClear;
  gl.autoClearColor = state.autoClearColor;
  gl.autoClearDepth = state.autoClearDepth;
  gl.autoClearStencil = state.autoClearStencil;
  Object.assign(gl, state.color);
  camera.layers.mask = state.layers;
  scene.background = state.background;
  scene.overrideMaterial = state.overrideMaterial;
  gl.shadowMap.enabled = state.shadowEnabled;
  gl.shadowMap.autoUpdate = state.shadowAutoUpdate;
  gl.xr.enabled = state.xr;
}

/** Owns only fullscreen geometry/material. Bloom texture remains effect-owned. */
export function createBloomOverlay(current: () => boolean = () => true) {
  if (!current()) throw new Error('Retired bloom overlay owner');
  let geometry: PlaneGeometry | null = null;
  let material: ShaderMaterial | null = null;
  try {
    geometry = new PlaneGeometry(2, 2);
    if (!current()) throw new Error('Retired bloom overlay owner');
    material = new ShaderMaterial({
      uniforms: {
        bloomMap: { value: null as Texture | null },
        intensity: { value: 0 },
      },
      vertexShader:
        'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: `uniform sampler2D bloomMap; uniform float intensity; varying vec2 vUv;
      void main() { gl_FragColor = vec4(texture2D(bloomMap, vUv).rgb * intensity, 0.0);
        #include <colorspace_fragment>
      }`,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
      transparent: true,
      blending: CustomBlending,
      blendEquation: AddEquation,
      blendSrc: OneFactor,
      blendDst: OneFactor,
      blendEquationAlpha: AddEquation,
      blendSrcAlpha: ZeroFactor,
      blendDstAlpha: OneFactor,
    });
    const ownedGeometry = geometry;
    const ownedMaterial = material;
    const scene = new Scene();
    scene.add(new Mesh(ownedGeometry, ownedMaterial));
    const camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
    let disposed = false;
    return {
      draw(gl: WebGLRenderer, texture: Texture, intensity: number) {
        if (disposed || !current()) return;
        ownedMaterial.uniforms.bloomMap.value = texture;
        ownedMaterial.uniforms.intensity.value = intensity;
        gl.autoClear =
          gl.autoClearColor =
          gl.autoClearDepth =
          gl.autoClearStencil =
            false;
        gl.xr.enabled = false;
        gl.render(scene, camera);
      },
      dispose() {
        if (disposed) return;
        disposed = true;
        scene.clear();
        ownedMaterial.uniforms.bloomMap.value = null;
        try {
          ownedGeometry.dispose();
        } finally {
          ownedMaterial.dispose();
        }
      },
    };
  } catch (error) {
    try {
      geometry?.dispose();
    } finally {
      material?.dispose();
    }
    throw error;
  }
}
export type BloomOverlay = ReturnType<typeof createBloomOverlay>;

/** Priority 1 is offscreen only; priority 2 consumes this frame's marker once. */
export function createSceneBloomFrames(
  gl: WebGLRenderer,
  scene: Scene,
  camera: Camera,
  rawColor: RawSceneColor,
  overlay: BloomOverlay,
  onFailure: (reason: string) => void,
  current: () => boolean = () => true,
) {
  let attached = false;
  let detachActive: (() => void) | null = null;
  let failed = false,
    successfulFrame = false;
  const fail = (reason: string) => {
    successfulFrame = false;
    if (!failed && current()) {
      failed = true;
      onFailure(reason);
    }
  };
  return {
    attach(composer: Composer, supported: () => boolean, onFrame: () => void) {
      if (!current()) return () => {};
      detachActive?.();
      let retired = false;
      attached = true;
      const render = composer.render;
      const shaderError = gl.debug.onShaderError;
      const guardedShaderError: NonNullable<typeof shaderError> = (...args) => {
        if (retired || !current()) return;
        fail('shader-program');
        shaderError?.(...args);
      };
      gl.debug.onShaderError = guardedShaderError;
      const probeState = captureFrameState(gl, scene, camera);
      try {
        if (!supported()) fail('unsupported-material-workaround');
        else {
          gl.setRenderTarget(composer.inputBuffer);
          const context = gl.getContext();
          if (
            context.checkFramebufferStatus(context.FRAMEBUFFER) !==
            context.FRAMEBUFFER_COMPLETE
          )
            fail('incomplete-framebuffer');
        }
      } catch {
        fail('framebuffer-allocation');
      } finally {
        restoreFrameState(gl, scene, camera, probeState);
      }
      const guardedRender = (delta: number) => {
        if (retired || !current() || failed) return;
        successfulFrame = false;
        const entry = captureFrameState(gl, scene, camera);
        try {
          if (!supported()) {
            fail('unsupported-material-workaround');
            return;
          }
          render.call(composer, delta);
          if (!failed && current()) {
            successfulFrame = true;
            onFrame();
          }
        } catch {
          fail('composer-render');
        } finally {
          restoreFrameState(gl, scene, camera, entry);
        }
      };
      composer.render = guardedRender;
      const cleanup = () => {
        if (retired) return;
        retired = true;
        if (detachActive === cleanup) {
          detachActive = null;
          attached = false;
          successfulFrame = false;
        }
        if (composer.render === guardedRender) composer.render = render;
        if (gl.debug.onShaderError === guardedShaderError)
          gl.debug.onShaderError = shaderError;
      };
      detachActive = cleanup;
      return cleanup;
    },
    draw(texture: Texture | null, intensity: number) {
      if (!current() || !attached) return;
      const completed = successfulFrame && !failed;
      successfulFrame = false;
      const entry = captureFrameState(gl, scene, camera);
      try {
        gl.setRenderTarget(null);
        Object.assign(gl, rawColor);
        // Exactly one unchanged raw scene render; no composed base is sampled.
        gl.render(scene, camera);
        if (
          completed &&
          current() &&
          !failed &&
          texture &&
          Number.isFinite(intensity) &&
          intensity > 0
        )
          overlay.draw(gl, texture, intensity);
      } catch {
        fail('screen-render');
      } finally {
        restoreFrameState(gl, scene, camera, entry);
      }
    },
  };
}
