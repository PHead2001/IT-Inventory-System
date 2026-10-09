/** Canvas-only ownership. Browser scrolling and keyboard zoom remain native. */
export function attachMapInput(
  canvas: HTMLCanvasElement,
  active: boolean,
  gesture: { current: { suppressSelection: boolean } },
) {
  const previousTouchAction = canvas.style.touchAction;
  const previousTabIndex = canvas.getAttribute('tabindex');
  const previousLabel = canvas.getAttribute('aria-label');
  // Native pointer focus must stay inside the room after toolbar activation.
  // A nonfocusable canvas otherwise blurs the toolbar to the document body.
  canvas.tabIndex = 0;
  canvas.setAttribute('aria-label', 'Room map');
  canvas.style.touchAction = active ? 'none' : 'auto';
  canvas.dataset.mapActive = String(active);
  const starts = new Map<number, { x: number; y: number }>();
  const wheel = (event: WheelEvent) => {
    // OrbitControls owns pinch through pointer events. Its wheel listener must
    // never cancel page scroll, even while the map is activated.
    event.stopImmediatePropagation();
  };
  const down = (event: PointerEvent) => {
    if (active) canvas.focus({ preventScroll: true });
    if (starts.size === 0) gesture.current.suppressSelection = false;
    starts.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (starts.size > 1) gesture.current.suppressSelection = true;
  };
  const move = (event: PointerEvent) => {
    const start = starts.get(event.pointerId);
    if (
      start &&
      Math.hypot(event.clientX - start.x, event.clientY - start.y) > 5
    )
      gesture.current.suppressSelection = true;
  };
  const up = (event: PointerEvent) => {
    move(event);
    starts.delete(event.pointerId);
  };
  const cancel = (event: PointerEvent) => {
    gesture.current.suppressSelection = true;
    starts.delete(event.pointerId);
  };
  canvas.addEventListener('wheel', wheel, { capture: true, passive: true });
  canvas.addEventListener('pointerdown', down, true);
  canvas.ownerDocument.addEventListener('pointermove', move, true);
  canvas.ownerDocument.addEventListener('pointerup', up, true);
  canvas.addEventListener('pointercancel', cancel, true);
  return () => {
    canvas.style.touchAction = previousTouchAction;
    if (previousTabIndex === null) canvas.removeAttribute('tabindex');
    else canvas.setAttribute('tabindex', previousTabIndex);
    if (previousLabel === null) canvas.removeAttribute('aria-label');
    else canvas.setAttribute('aria-label', previousLabel);
    delete canvas.dataset.mapActive;
    canvas.removeEventListener('wheel', wheel, true);
    canvas.removeEventListener('pointerdown', down, true);
    canvas.ownerDocument.removeEventListener('pointermove', move, true);
    canvas.ownerDocument.removeEventListener('pointerup', up, true);
    canvas.removeEventListener('pointercancel', cancel, true);
  };
}
