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
  const target = new WebGLRenderTarget(resolution, resolution, {
    depthBuffer: true,
    stencilBuffer: false,
    minFilter: LinearFilter,
    magFilter: LinearFilter,
  });
  const intermediate = new WebGLRenderTarget(resolution, resolution, {
    depthBuffer: false,
    stencilBuffer: false,
    minFilter: LinearFilter,
    magFilter: LinearFilter,
  });
  target.texture.generateMipmaps = intermediate.texture.generateMipmaps = false;
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
  const depthMaterial = new MeshDepthMaterial({
    depthTest: true,
    depthWrite: true,
  });
  depthMaterial.toneMapped = false;
  const color = new Color('#000000');
  depthMaterial.onBeforeCompile = (shader) => {
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
  const blurGeometry = new PlaneGeometry(2, 2);
  const blurMaterial = new ShaderMaterial({
    vertexShader: blurVertex,
    fragmentShader: blurFragment,
    uniforms: {
      source: { value: target.texture },
      direction: { value: new Vector2() },
    },
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  });
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
      const previousTarget = gl.getRenderTarget();
      const previousFace = gl.getActiveCubeFace();
      const previousMip = gl.getActiveMipmapLevel();
      const viewport = gl.getViewport(new Vector4());
      const scissor = gl.getScissor(new Vector4());
      const scissorTest = gl.getScissorTest();
      const clearColor = gl.getClearColor(new Color());
      const clearAlpha = gl.getClearAlpha();
      const autoClear = gl.autoClear;
      const xr = gl.xr.enabled;
      try {
        gl.xr.enabled = false;
        gl.autoClear = true;
        gl.setScissorTest(false);
        gl.setClearColor('#000000', 0);
        gl.setRenderTarget(target);
        gl.render(captureScene, camera);
        blurMaterial.uniforms.source.value = target.texture;
        blurMaterial.uniforms.direction.value.set(1.4 / resolution, 0);
        gl.setRenderTarget(intermediate);
        gl.render(blurScene, blurCamera);
        blurMaterial.uniforms.source.value = intermediate.texture;
        blurMaterial.uniforms.direction.value.set(0, 1.4 / resolution);
        gl.setRenderTarget(target);
        gl.render(blurScene, blurCamera);
      } finally {
        captureScene.clear();
        gl.setRenderTarget(previousTarget, previousFace, previousMip);
        gl.setViewport(viewport);
        gl.setScissor(scissor);
        gl.setScissorTest(scissorTest);
        gl.setClearColor(clearColor, clearAlpha);
        gl.autoClear = autoClear;
        gl.xr.enabled = xr;
      }
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      captureScene.clear();
      blurScene.clear();
      target.dispose();
      intermediate.dispose();
      depthMaterial.dispose();
      blurGeometry.dispose();
      blurMaterial.dispose();
    },
  };
}
export type ContactCapture = ReturnType<typeof createContactCapture>;
