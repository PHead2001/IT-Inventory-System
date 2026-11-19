/** Native closed details exposes only its first directly owned summary. */
export function surfaceTargetCurrent(host: HTMLElement, target: Element) {
  if (!host.isConnected || !target.isConnected || !host.contains(target))
    return false;
  let depth = 0;
  for (
    let ancestor: Element | null = target;
    ancestor;
    ancestor = ancestor.parentElement
  ) {
    if (
      ++depth > 64 ||
      ancestor.hasAttribute('hidden') ||
      ancestor.hasAttribute('inert')
    )
      return false;
    if (ancestor instanceof HTMLDetailsElement && !ancestor.open) {
      let summary: Element | null = null;
      let siblings = 0;
      for (
        let child = ancestor.firstElementChild;
        child && ++siblings <= 64;
        child = child.nextElementSibling
      ) {
        if (child.tagName === 'SUMMARY') {
          summary = child;
          break;
        }
      }
      if (!summary?.contains(target)) return false;
    }
  }
  return true;
}

/** Pointer effects mutate only decorative CSS properties, never application state. */
export function attachSurfaceEffects(
  host: HTMLElement,
  current: (target: Element) => boolean,
) {
  if (
    typeof window.matchMedia !== 'function' ||
    typeof requestAnimationFrame !== 'function'
  )
    return Object.assign(() => {}, { withdraw: () => {}, reconcile: () => {} });
  const media = window.matchMedia('(hover: hover) and (pointer: fine)');
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  const active = new Map<
    HTMLElement,
    {
      bounds: DOMRect;
      invalid: boolean;
      spotlight: boolean;
      magnetic: boolean;
      tilt: boolean;
    }
  >();
  let frame: number | null = null;
  let point = { x: 0, y: 0 };
  let down: {
    target: EventTarget | null;
    x: number;
    y: number;
    pointerId: number;
  } | null = null;
  let ripple: Animation | null = null;
  let rippleTarget: Element | null = null;
  let disposed = false;
  const ring = document.createElement('span');
  ring.className = 'experience-background-ripple';
  ring.setAttribute('aria-hidden', 'true');
  host.append(ring);
  const ambientEnabled = () =>
    !disposed &&
    current(host) &&
    !reduced.matches &&
    document.documentElement.dataset.motion === 'full' &&
    document.visibilityState === 'visible';
  const enabled = () => media.matches && ambientEnabled();
  const clearSurface = (element: HTMLElement) => {
    element.dataset.pointerWithdrawn = 'true';
    element.removeAttribute('data-spotlight-active');
    element.removeAttribute('data-pointer-active');
    for (const property of ['--x', '--y', '--pointer-x', '--pointer-y'])
      element.style.removeProperty(property);
    resize?.unobserve(element);
    active.delete(element);
  };
  const clearHover = () => {
    if (frame !== null) cancelAnimationFrame(frame);
    frame = null;
    for (const element of active.keys()) clearSurface(element);
  };
  const reset = () => {
    host.dataset.pointerEffectsReady = 'false';
    clearHover();
    point = { x: 0, y: 0 };
    down = null;
    ripple?.cancel();
    ripple = null;
    rippleTarget = null;
    ring.style.removeProperty('left');
    ring.style.removeProperty('top');
  };
  const withdraw = () => {
    reset();
    host.dataset.atmosphereActive = 'false';
    host
      .querySelector('.experience-ambient-shell')
      ?.setAttribute('data-active', 'false');
  };
  const disabled = (element: HTMLElement) =>
    element.matches(':disabled,[aria-disabled="true"]');
  const schedule = () => {
    if (frame !== null) return;
    frame = requestAnimationFrame(() => {
      frame = null;
      if (!enabled()) {
        reset();
        return;
      }
      for (const [element, state] of active) {
        if (!host.contains(element) || !current(element) || disabled(element)) {
          clearSurface(element);
          continue;
        }
        if (state.invalid) {
          state.bounds = element.getBoundingClientRect();
          state.invalid = false;
        }
        const x = point.x - state.bounds.left;
        const y = point.y - state.bounds.top;
        if (state.spotlight) {
          element.style.setProperty('--x', `${x}px`);
          element.style.setProperty('--y', `${y}px`);
          element.dataset.spotlightActive = 'true';
        }
        if (state.magnetic || state.tilt) {
          const normalize = (position: number, size: number) =>
            size > 0
              ? Math.max(-1, Math.min(1, (position / size - 0.5) * 2))
              : 0;
          const horizontal = normalize(x, state.bounds.width);
          const vertical = normalize(y, state.bounds.height);
          // Radial normalization also caps diagonal displacement/combined tilt.
          const length = Math.max(1, Math.hypot(horizontal, vertical));
          element.style.setProperty('--pointer-x', String(horizontal / length));
          element.style.setProperty('--pointer-y', String(vertical / length));
          element.dataset.pointerActive = 'true';
        }
      }
    });
  };
  const move = (event: PointerEvent) => {
    if (
      !ambientEnabled() ||
      !(event.target instanceof Element) ||
      !current(event.target)
    ) {
      host.dataset.pointerEffectsReady = 'false';
      reset();
      return;
    }
    // A drag remains aborted even when the pointer returns before release.
    if (
      down &&
      (event.pointerId !== down.pointerId ||
        Math.hypot(event.clientX - down.x, event.clientY - down.y) > 5)
    )
      down = null;
    if (!media.matches || event.pointerType !== 'mouse') {
      host.dataset.pointerEffectsReady = 'false';
      clearHover();
      return;
    }
    if (host.dataset.pointerEffectsReady !== 'true')
      host.dataset.pointerEffectsReady = 'true';
    const target = event.target instanceof Element ? event.target : null;
    if (
      !target ||
      target.closest('input,textarea,select,[contenteditable],table,canvas')
    ) {
      clearHover();
      return;
    }
    const next = new Map<
      HTMLElement,
      { spotlight: boolean; magnetic: boolean; tilt: boolean }
    >();
    for (const role of ['spotlight', 'magnetic', 'tilt'] as const) {
      const element = target.closest<HTMLElement>(`.experience-${role}`);
      if (
        !element ||
        !host.contains(element) ||
        !current(element) ||
        disabled(element)
      )
        continue;
      const roles = next.get(element) ?? {
        spotlight: false,
        magnetic: false,
        tilt: false,
      };
      roles[role] = true;
      next.set(element, roles);
    }
    for (const element of active.keys())
      if (!next.has(element)) clearSurface(element);
    for (const [element, roles] of next) {
      delete element.dataset.pointerWithdrawn;
      if (!active.has(element)) {
        active.set(element, {
          ...roles,
          bounds: element.getBoundingClientRect(),
          invalid: false,
        });
        resize?.observe(element);
      }
    }
    point = { x: event.clientX, y: event.clientY };
    if (active.size) schedule();
    else if (frame !== null) {
      cancelAnimationFrame(frame);
      frame = null;
    }
  };
  const invalidate = () => {
    if (!enabled()) {
      reset();
      return;
    }
    for (const state of active.values()) state.invalid = true;
    if (active.size) schedule();
  };
  const visibility = () => {
    const ambient = ambientEnabled();
    host.dataset.atmosphereActive = String(ambient);
    host
      .querySelector('.experience-ambient-shell')
      ?.setAttribute('data-active', String(ambient));
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
      ambientEnabled() &&
      event.button === 0 &&
      event.isPrimary !== false &&
      event.target instanceof Element &&
      current(event.target) &&
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
      !ambientEnabled() ||
      event.button !== 0 ||
      event.isPrimary === false ||
      !start ||
      event.pointerId !== start.pointerId ||
      start.target !== event.target ||
      !empty(event.target) ||
      !current(event.target) ||
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
    rippleTarget = event.target;
    const animation = ripple;
    animation.onfinish = () => {
      if (ripple !== animation) return;
      ripple = null;
      rippleTarget = null;
      ring.style.removeProperty('left');
      ring.style.removeProperty('top');
    };
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
  const contents = new MutationObserver((records) => {
    // Even a closed->open transition batched in one turn retires old pointer state.
    if (
      records.some(
        (record) =>
          record.type === 'attributes' &&
          ['hidden', 'inert', 'open'].includes(record.attributeName ?? ''),
      )
    )
      reset();
    if (!ambientEnabled()) {
      withdraw();
      return;
    }
    if (down?.target instanceof Element && !current(down.target)) reset();
    if (
      rippleTarget &&
      (!host.contains(rippleTarget) || !current(rippleTarget))
    )
      reset();
    for (const element of active.keys())
      if (!host.contains(element) || !current(element) || disabled(element))
        clearSurface(element);
  });
  contents.observe(host, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['disabled', 'aria-disabled', 'hidden', 'inert', 'open'],
  });
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
  reduced.addEventListener('change', visibility);
  visibility();
  return Object.assign(
    () => {
      disposed = true;
      withdraw();
      observer.disconnect();
      contents.disconnect();
      resize?.disconnect();
      ring.remove();
      delete host.dataset.pointerEffectsReady;
      delete host.dataset.atmosphereActive;
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
      reduced.removeEventListener('change', visibility);
    },
    { withdraw, reconcile: visibility },
  );
}
