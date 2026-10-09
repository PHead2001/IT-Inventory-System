/** Canvas-only ownership. Browser scrolling and keyboard zoom remain native. */
export function attachMapInput(
  canvas: HTMLCanvasElement,
  active: boolean,
  gesture: { current: { suppressSelection: boolean } },
  onPassiveDrag?: () => void,
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
  let hinted = false;
  const wheel = (event: WheelEvent) => {
    // Ordinary active wheel belongs to Orbit. Browser zoom always stays native.
    if (!active || event.ctrlKey || event.metaKey)
      event.stopImmediatePropagation();
  };
  const down = (event: PointerEvent) => {
    if (active) canvas.focus({ preventScroll: true });
    if (starts.size === 0) {
      gesture.current.suppressSelection = false;
      hinted = false;
    }
    starts.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (starts.size > 1) gesture.current.suppressSelection = true;
  };
  const move = (event: PointerEvent) => {
    const start = starts.get(event.pointerId);
    if (
      start &&
      Math.hypot(event.clientX - start.x, event.clientY - start.y) > 5
    ) {
      gesture.current.suppressSelection = true;
      if (!active && !hinted) {
        hinted = true;
        onPassiveDrag?.();
      }
    }
  };
  const up = (event: PointerEvent) => {
    move(event);
    starts.delete(event.pointerId);
  };
  const cancel = (event: PointerEvent) => {
    // Touch implicit capture normally releases after pointerup, before click.
    // Only loss while this pointer is still down is gesture cancellation.
    if (event.type === 'lostpointercapture' && !starts.has(event.pointerId))
      return;
    gesture.current.suppressSelection = true;
    starts.delete(event.pointerId);
    if (event.type === 'lostpointercapture') {
      const cancelled = new Event('pointercancel', { bubbles: true });
      Object.defineProperty(cancelled, 'pointerId', { value: event.pointerId });
      canvas.dispatchEvent(cancelled);
    }
  };
  canvas.addEventListener('wheel', wheel, { capture: true, passive: true });
  canvas.addEventListener('pointerdown', down, true);
  canvas.ownerDocument.addEventListener('pointermove', move, true);
  canvas.ownerDocument.addEventListener('pointerup', up, true);
  canvas.addEventListener('pointercancel', cancel, true);
  canvas.addEventListener('lostpointercapture', cancel, true);
  // Drei reconnects OrbitControls in child effects and writes touchAction=none.
  // Reassert our gate once after those effects, without a render/idle loop.
  const reconnect = requestAnimationFrame(() => {
    canvas.style.touchAction = active ? 'none' : 'auto';
  });
  return () => {
    cancelAnimationFrame(reconnect);
    gesture.current.suppressSelection = true;
    // Orbit keeps a private pointer table even after enabled=false. Feed its
    // native cancellation path before removing our listeners so a new gesture
    // cannot inherit old pinch pointers after Done/Escape/focus leave.
    for (const pointerId of starts.keys()) {
      const cancelled = new Event('pointercancel', { bubbles: true });
      Object.defineProperty(cancelled, 'pointerId', { value: pointerId });
      canvas.dispatchEvent(cancelled);
    }
    starts.clear();
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
    canvas.removeEventListener('lostpointercapture', cancel, true);
  };
}
