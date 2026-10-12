import { unmountComponentAtNode, type createRoot } from '@react-three/fiber';
import { Scene } from 'three';

/** Fiber 9.8.1's public teardown assumes a non-null scene even when renderer
 * construction rejects before scene initialization. render(null) returns its
 * public store while that failed configure remains pending; it cannot commit a
 * frame. This failed root is terminal and must never be configured again. */
export function teardownFailedCanvas(
  root: ReturnType<typeof createRoot>,
  canvas: HTMLCanvasElement,
  complete: () => void,
) {
  const store = root.render(null);
  const state = store.getState();
  // Publishing via setState would run Fiber's invalidation subscriber, which
  // dereferences null gl.xr in this same failed-construction state. Populate
  // only the terminal snapshot's missing scene; never configure this root again.
  if (!state.scene) state.scene = new Scene();
  unmountComponentAtNode(canvas, complete);
}
