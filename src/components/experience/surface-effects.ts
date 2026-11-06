/** Pointer effects mutate only decorative CSS properties, never application state. */
export function attachSurfaceEffects(host: HTMLElement) {
  if (
    typeof window.matchMedia !== 'function' ||
    typeof requestAnimationFrame !== 'function'
  )
    return () => {};
  const media = window.matchMedia('(hover: hover) and (pointer: fine)');
  let current: HTMLElement | null = null;
  let bounds: DOMRect | null = null;
  let invalid = false;
  let frame: number | null = null;
  let point = { x: 0, y: 0 };
  let down: {
    target: EventTarget | null;
    x: number;
    y: number;
    pointerId: number;
  } | null = null;
  let ripple: Animation | null = null;
  const ring = document.createElement('span');
  ring.className = 'experience-background-ripple';
  ring.setAttribute('aria-hidden', 'true');
  host.append(ring);
  const enabled = () =>
    media.matches &&
    document.documentElement.dataset.motion === 'full' &&
    document.visibilityState === 'visible';
  const clearHover = () => {
    if (frame !== null) cancelAnimationFrame(frame);
    frame = null;
    current?.removeAttribute('data-spotlight-active');
    current?.style.removeProperty('--x');
    current?.style.removeProperty('--y');
    if (current) resize?.unobserve(current);
    current = null;
    bounds = null;
  };
  const reset = () => {
    clearHover();
    down = null;
    ripple?.cancel();
    ripple = null;
  };
  const schedule = () => {
    if (frame !== null) return;
    frame = requestAnimationFrame(() => {
      frame = null;
      if (!enabled()) {
        reset();
        return;
      }
      if (!current?.isConnected) {
        clearHover();
        return;
      }
      if (invalid) {
        bounds = current.getBoundingClientRect();
        invalid = false;
      }
      if (!bounds) return;
      current.style.setProperty('--x', `${point.x - bounds.left}px`);
      current.style.setProperty('--y', `${point.y - bounds.top}px`);
      current.dataset.spotlightActive = 'true';
    });
  };
  const move = (event: PointerEvent) => {
    if (!enabled() || event.pointerType === 'touch') {
      reset();
      return;
    }
    // Crossing the threshold invalidates this press permanently, even if the
    // pointer returns to its starting position before release.
    if (
      down &&
      (event.pointerId !== down.pointerId ||
        Math.hypot(event.clientX - down.x, event.clientY - down.y) > 5)
    )
      down = null;
    const target = event.target instanceof Element ? event.target : null;
    const surface = target?.closest<HTMLElement>('.experience-spotlight');
    // Inputs, dense tables and the canvas do not acquire a spotlight, even inside a card.
    if (
      !surface ||
      !host.contains(surface) ||
      target?.closest('input,textarea,select,[contenteditable],table,canvas')
    ) {
      clearHover();
      return;
    }
    if (current !== surface) {
      clearHover();
      current = surface;
      bounds = surface.getBoundingClientRect();
      invalid = false;
      resize?.observe(surface);
    }
    point = { x: event.clientX, y: event.clientY };
    schedule();
  };
  const invalidate = () => {
    invalid = true;
    if (current) schedule();
  };
  const visibility = () => {
    if (!enabled()) reset();
  };
  const empty = (target: EventTarget | null): target is HTMLElement =>
    target instanceof HTMLElement &&
    !target.closest(
      'a,button,input,textarea,select,[contenteditable],[role="button"],[role="link"],canvas,table,[inert],[hidden]',
    ) &&
    target.matches(
      '.experience-app,.experience-main,.experience-workspace,.experience-page-arrival,[data-atmosphere-background]',
    );
  const press = (event: PointerEvent) => {
    down = null;
    if (
      enabled() &&
      event.button === 0 &&
      event.isPrimary !== false &&
      event.pointerType !== 'touch' &&
      empty(event.target)
    )
      down = {
        target: event.target,
        x: event.clientX,
        y: event.clientY,
        pointerId: event.pointerId,
      };
  };
  const release = (event: PointerEvent) => {
    const start = down;
    down = null;
    if (
      !enabled() ||
      !start ||
      event.button !== 0 ||
      event.isPrimary === false ||
      event.pointerId !== start.pointerId ||
      start.target !== event.target ||
      !empty(event.target) ||
      Math.hypot(event.clientX - start.x, event.clientY - start.y) > 5 ||
      !ring.animate
    )
      return;
    ripple?.cancel();
    ring.style.left = `${event.clientX}px`;
    ring.style.top = `${event.clientY}px`;
    ripple = ring.animate(
      [
        { transform: 'translate(-50%, -50%) scale(.2)', opacity: 1 },
        { transform: 'translate(-50%, -50%) scale(1)', opacity: 0 },
      ],
      { duration: 150, easing: 'ease-out' },
    );
  };
  const observer = new MutationObserver(visibility);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-motion'],
  });
  const resize =
    typeof ResizeObserver === 'undefined'
      ? null
      : new ResizeObserver(invalidate);
  resize?.observe(host);
  const contents = new MutationObserver(() => {
    if (current && !current.isConnected) clearHover();
  });
  contents.observe(host, { childList: true, subtree: true });
  host.addEventListener('pointerover', move);
  host.addEventListener('pointermove', move);
  host.addEventListener('pointerleave', reset);
  host.addEventListener('pointerdown', press);
  host.addEventListener('pointerup', release);
  host.addEventListener('pointercancel', reset);
  window.addEventListener('resize', invalidate);
  window.addEventListener('scroll', invalidate, true);
  document.addEventListener('visibilitychange', visibility);
  media.addEventListener('change', visibility);
  return () => {
    reset();
    observer.disconnect();
    contents.disconnect();
    resize?.disconnect();
    ring.remove();
    host.removeEventListener('pointerover', move);
    host.removeEventListener('pointermove', move);
    host.removeEventListener('pointerleave', reset);
    host.removeEventListener('pointerdown', press);
    host.removeEventListener('pointerup', release);
    host.removeEventListener('pointercancel', reset);
    window.removeEventListener('resize', invalidate);
    window.removeEventListener('scroll', invalidate, true);
    document.removeEventListener('visibilitychange', visibility);
    media.removeEventListener('change', visibility);
  };
}
