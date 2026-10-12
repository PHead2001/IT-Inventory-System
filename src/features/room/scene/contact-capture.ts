import {
  Color,
  LinearFilter,
  Mesh,
  MeshDepthMaterial,
  OrthographicCamera,
  PlaneGeometry,
  Scene,
  ShaderMaterial,
  Vector2,
  Vector4,
  WebGLRenderTarget,
  type WebGLRenderer,
} from 'three';
import type { EffectMesh } from './scene-effects-state';

const blurVertex =
  'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';
const blurFragment = `uniform sampler2D source; uniform vec2 direction; varying vec2 vUv;
void main() {
  vec2 uv = vUv;
  vec4 sum = texture2D(source, uv) * 0.227027;
  sum += texture2D(source, uv + direction * 1.384615) * 0.316216;
  sum += texture2D(source, uv - direction * 1.384615) * 0.316216;
  sum += texture2D(source, uv + direction * 3.230769) * 0.070270;
  sum += texture2D(source, uv - direction * 3.230769) * 0.070270;
  gl_FragColor = sum;
}`;

/** Owned depth + separable blur adapter. Source geometries remain scene-owned. */
export function createContactCapture(
  width: number,
  depth: number,
  height: number,
  resolution: number,
) {
  const owned: { dispose(): void }[] = [];
  const own = <T extends { dispose(): void }>(resource: T): T => {
    owned.push(resource);
    return resource;
  };
  const disposeOwned = () => {
    // Attempt every release even if a disposal listener throws.
    let failure: unknown;
    for (const resource of owned.splice(0).reverse()) {
      try {
        resource.dispose();
      } catch (error) {
        failure ??= error;
      }
    }
    if (failure) throw failure;
  };
  try {
    const target = own(
      new WebGLRenderTarget(resolution, resolution, {
        depthBuffer: true,
        stencilBuffer: false,
        minFilter: LinearFilter,
        magFilter: LinearFilter,
      }),
    );
    const intermediate = own(
      new WebGLRenderTarget(resolution, resolution, {
        depthBuffer: false,
        stencilBuffer: false,
        minFilter: LinearFilter,
        magFilter: LinearFilter,
      }),
    );
    target.texture.generateMipmaps =
      intermediate.texture.generateMipmaps = false;
    const camera = new OrthographicCamera(
      -width / 2,
      width / 2,
      depth / 2,
      -depth / 2,
      0.1,
      height + 2,
    );
    camera.position.set(width / 2, -0.15, -depth / 2);
    camera.rotation.x = Math.PI / 2;
    camera.updateMatrixWorld(true);
    const captureScene = new Scene();
    const depthMaterial = own(
      new MeshDepthMaterial({
        depthTest: true,
        depthWrite: true,
      }),
    );
    depthMaterial.toneMapped = false;
    const color = new Color('#000000');
    let depthShaderSupported = true;
    depthMaterial.onBeforeCompile = (shader) => {
      if (
        !shader.fragmentShader.includes('void main() {') ||
        !shader.fragmentShader.includes(
          'vec4( vec3( 1.0 - fragCoordZ ), opacity );',
        )
      ) {
        // Report after render returns, preserving Three's render bookkeeping.
        depthShaderSupported = false;
        return;
      }
      shader.uniforms.contactColor = { value: color };
      shader.fragmentShader = shader.fragmentShader.replace(
        'void main() {',
        'uniform vec3 contactColor; void main() {',
      );
      shader.fragmentShader = shader.fragmentShader.replace(
        'vec4( vec3( 1.0 - fragCoordZ ), opacity );',
        'vec4(contactColor, pow(1.0 - fragCoordZ, 2.0));',
      );
    };
    const blurGeometry = own(new PlaneGeometry(2, 2));
    const blurMaterial = own(
      new ShaderMaterial({
        vertexShader: blurVertex,
        fragmentShader: blurFragment,
        uniforms: {
          source: { value: target.texture },
          direction: { value: new Vector2() },
        },
        depthTest: false,
        depthWrite: false,
        toneMapped: false,
      }),
    );
    const blurScene = new Scene();
    blurScene.add(new Mesh(blurGeometry, blurMaterial));
    const blurCamera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
    let disposed = false;
    return {
      texture: target.texture,
      capture(
        gl: WebGLRenderer,
        casters: readonly EffectMesh[],
        shadowColor: Color,
      ) {
        if (disposed) throw new Error('Disposed room contact capture');
        const previousTarget = gl.getRenderTarget();
        const previousFace = gl.getActiveCubeFace();
        const previousMip = gl.getActiveMipmapLevel();
        const viewport = gl.getViewport(new Vector4());
        const scissor = gl.getScissor(new Vector4());
        const scissorTest = gl.getScissorTest();
        const clearColor = gl.getClearColor(new Color());
        const clearAlpha = gl.getClearAlpha();
        const autoClear = gl.autoClear;
        const autoClearColor = gl.autoClearColor;
        const autoClearDepth = gl.autoClearDepth;
        const autoClearStencil = gl.autoClearStencil;
        const xr = gl.xr.enabled;
        const checkShaderErrors = gl.debug.checkShaderErrors;
        const onShaderError = gl.debug.onShaderError;
        let shaderFailed = false;
        const context = gl.getContext();
        const renderPass = (
          destination: WebGLRenderTarget,
          scene: Scene,
          camera: OrthographicCamera,
        ) => {
          if (context.isContextLost())
            throw new Error('Lost room contact context');
          gl.setRenderTarget(destination);
          // setRenderTarget binds the owned framebuffer. Do not drain unrelated
          // GL errors or inspect Three's private framebuffer/program properties.
          if (
            context.getParameter(context.FRAMEBUFFER_BINDING) === null ||
            context.checkFramebufferStatus(context.FRAMEBUFFER) !==
              context.FRAMEBUFFER_COMPLETE
          )
            throw new Error('Incomplete room contact framebuffer');
          gl.render(scene, camera);
          if (!depthShaderSupported)
            throw new Error('Unsupported room contact depth shader');
          if (shaderFailed) throw new Error('Failed room contact shader');
          if (context.isContextLost())
            throw new Error('Lost room contact context');
        };
        try {
          color.copy(shadowColor);
          captureScene.clear();
          for (const { mesh: source } of casters) {
            let visible = source.visible;
            for (let parent = source.parent; parent; parent = parent.parent)
              visible &&= parent.visible;
            if (!visible) continue;
            const copy = new Mesh(source.geometry, depthMaterial);
            copy.matrixAutoUpdate = false;
            copy.matrix.copy(source.matrixWorld);
            captureScene.add(copy);
          }
          // Three checks linkage on first program use, not compile() alone.
          // Only the two owned materials render inside this synchronous scope.
          gl.debug.checkShaderErrors = true;
          gl.debug.onShaderError = () => {
            shaderFailed = true;
          };
          gl.xr.enabled = false;
          gl.autoClear = true;
          gl.autoClearColor = gl.autoClearDepth = gl.autoClearStencil = true;
          gl.setScissorTest(false);
          gl.setClearColor('#000000', 0);
          renderPass(target, captureScene, camera);
          blurMaterial.uniforms.source.value = target.texture;
          blurMaterial.uniforms.direction.value.set(1.4 / resolution, 0);
          renderPass(intermediate, blurScene, blurCamera);
          blurMaterial.uniforms.source.value = intermediate.texture;
          blurMaterial.uniforms.direction.value.set(0, 1.4 / resolution);
          renderPass(target, blurScene, blurCamera);
        } finally {
          captureScene.clear();
          gl.debug.checkShaderErrors = checkShaderErrors;
          gl.debug.onShaderError = onShaderError;
          gl.autoClear = autoClear;
          gl.autoClearColor = autoClearColor;
          gl.autoClearDepth = autoClearDepth;
          gl.autoClearStencil = autoClearStencil;
          gl.xr.enabled = xr;
          gl.setRenderTarget(previousTarget, previousFace, previousMip);
          gl.setViewport(viewport);
          gl.setScissor(scissor);
          gl.setScissorTest(scissorTest);
          gl.setClearColor(clearColor, clearAlpha);
        }
      },
      dispose() {
        if (disposed) return;
        disposed = true;
        captureScene.clear();
        blurScene.clear();
        disposeOwned();
      },
    };
  } catch (error) {
    try {
      disposeOwned();
    } catch {
      /* Preserve the construction failure. */
    }
    throw error;
  }
}
export type ContactCapture = ReturnType<typeof createContactCapture>;
