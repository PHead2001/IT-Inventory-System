import { events } from '@react-three/fiber';

/** Use the same live canvas/client origin as the room's authoritative owner ray. */
export const roomCanvasEvents: typeof events = (store) => ({
  ...events(store),
  compute(event, state) {
    const canvas = state.gl.domElement;
    // Fiber uses null to disable this event ray; Three types omit the sentinel.
    const raycaster: Omit<typeof state.raycaster, 'camera'> & {
      camera: typeof state.raycaster.camera | null;
    } = state.raycaster;
    // The event host also contains Html controls. Their DOM actions must not
    // introduce a second room-mesh selection through the canvas underneath.
    if (event.target !== canvas) {
      raycaster.camera = null;
      return;
    }
    const rect = canvas.getBoundingClientRect();
    if (
      ![
        event.clientX,
        event.clientY,
        rect.left,
        rect.top,
        rect.width,
        rect.height,
      ].every(Number.isFinite) ||
      rect.width <= 0 ||
      rect.height <= 0
    ) {
      raycaster.camera = null;
      return;
    }
    state.pointer.set(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      1 - ((event.clientY - rect.top) / rect.height) * 2,
    );
    raycaster.setFromCamera(state.pointer, state.camera);
  },
});
