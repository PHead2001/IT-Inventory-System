import { unmountComponentAtNode, type createRoot } from '@react-three/fiber';

/** Fiber 9.8.1 public unmount handles failed or pending configuration, null scene
 * and factory-owned async renderer disposal. Do not render a rejected root or
 * release the lease before Fiber reports its actual teardown completion. */
export function teardownFailedCanvas(
  _root: ReturnType<typeof createRoot>,
  canvas: HTMLCanvasElement,
  complete: () => void,
) {
  unmountComponentAtNode(canvas, complete);
}
