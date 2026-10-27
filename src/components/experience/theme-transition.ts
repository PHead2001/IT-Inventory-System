'use client';
import { cancelRouteSnapshots } from './route-motion-state';
import {
  hasRouteSnapshotWork,
  privateSnapshotEligible,
  ownThemeSnapshot,
} from './native-transition-owner';
type Transition = {
  ready: Promise<void>;
  updateCallbackDone: Promise<void>;
  finished: Promise<void>;
  skipTransition: () => void;
};
type Rect = { left: number; top: number; width: number; height: number };
const mediaSelector = 'canvas,video,[data-theme-live]';
const readRect = (element: Element): Rect => {
  const { left, top, width, height } = element.getBoundingClientRect();
  return { left, top, width, height };
};
const sameRect = (left: Rect, right: Rect) =>
  left.left === right.left &&
  left.top === right.top &&
  left.width === right.width &&
  left.height === right.height;
export function themeCircle(rect: Rect, viewport: Rect) {
  const x = rect.left + rect.width / 2;
  const y = rect.top + rect.height / 2;
  const radius = Math.max(
    ...[viewport.left, viewport.left + viewport.width].flatMap((right) =>
      [viewport.top, viewport.top + viewport.height].map((bottom) =>
        Math.hypot(right - x, bottom - y),
      ),
    ),
  );
  return { x, y, radius };
}
/** Bound work before allocating names or reading any layout. */
export function collectThemeGeometry(
  root: HTMLElement,
  includeRoot = true,
  skip?: Element,
) {
  const nodes: {
    element: Element;
    parent: number;
    blocked: boolean;
    captured: boolean;
  }[] = [];
  const indices = new Map<Element, number>();
  const media: Element[] = [];
  let cursor: Element | null = root;
  while (cursor) {
    if (nodes.length >= 2048) return null;
    const parent = indices.get(cursor.parentElement!) ?? -1;
    const blocked =
      (parent >= 0 && nodes[parent].blocked) ||
      cursor === skip ||
      cursor.matches('script,style,link,.experience-ambient');
    indices.set(cursor, nodes.length);
    nodes.push({ element: cursor, parent, blocked, captured: false });
    if (cursor !== skip && cursor.matches(mediaSelector)) {
      if (media.length >= 32) return null;
      media.push(cursor);
    }
    if (cursor.firstElementChild) cursor = cursor.firstElementChild;
    else {
      while (cursor !== root && !cursor.nextElementSibling)
        cursor = cursor.parentElement!;
      cursor = cursor === root ? null : cursor.nextElementSibling;
    }
  }
  const liveAncestors = new Set<number>();
  for (const element of media) {
    for (
      let index = indices.get(element)!;
      index >= 0;
      index = nodes[index].parent
    ) {
      if (liveAncestors.has(index)) break;
      liveAncestors.add(index);
    }
  }
  const regions: HTMLElement[] = [];
  for (let index = 0; index < nodes.length; index++) {
    const node = nodes[index];
    if (node.parent >= 0 && nodes[node.parent].captured) {
      node.captured = true;
      continue;
    }
    if (
      node.blocked ||
      liveAncestors.has(index) ||
      (!includeRoot && index === 0) ||
      !(node.element instanceof HTMLElement)
    )
      continue;
    if (regions.length >= 256) return null;
    regions.push(node.element);
    node.captured = true;
  }
  return { regions, media };
}
/** Disjoint conventional subtrees: no named ancestor ever captures live media. */
export function themeRegions(root: HTMLElement): HTMLElement[] {
  return collectThemeGeometry(root)?.regions ?? [];
}
export function mediaHolePath(width: number, height: number, media: Rect[]) {
  const box = (x: number, y: number, w: number, h: number) =>
    `M${x} ${y}h${w}v${h}h${-w}Z`;
  // Union into disjoint strips. Overlapping even-odd holes would otherwise
  // cancel each other and paint over live media at the intersection.
  const rectangles = media
    .map((rect) => ({
      left: Math.max(0, rect.left),
      top: Math.max(0, rect.top),
      right: Math.min(width, rect.left + rect.width),
      bottom: Math.min(height, rect.top + rect.height),
    }))
    .filter((rect) => rect.right > rect.left && rect.bottom > rect.top);
  const edges = [
    ...new Set(rectangles.flatMap((rect) => [rect.left, rect.right])),
  ].sort((a, b) => a - b);
  let holes = '';
  for (let index = 0; index < edges.length - 1; index += 1) {
    const left = edges[index];
    const right = edges[index + 1];
    const intervals = rectangles
      .filter((rect) => rect.left < right && rect.right > left)
      .map((rect) => [rect.top, rect.bottom])
      .sort((a, b) => a[0] - b[0]);
    const merged: number[][] = [];
    for (const interval of intervals) {
      const last = merged.at(-1);
      if (last && interval[0] <= last[1])
        last[1] = Math.max(last[1], interval[1]);
      else merged.push([...interval]);
    }
    for (const [top, bottom] of merged)
      holes += box(left, top, right - left, bottom - top);
  }
  return `path(evenodd, "${box(0, 0, width, height)}${holes}")`;
}
export function revealTheme({
  apply,
  changed,
  control,
  automatic,
}: {
  apply: () => void;
  changed: boolean;
  control?: HTMLElement;
  automatic: boolean;
}) {
  // Theme intent is synchronous. Motion must never wait for navigation or OS policy.
  cancelRouteSnapshots();
  const reduce =
    document.documentElement.dataset.motion !== 'full' ||
    (typeof matchMedia === 'function' &&
      matchMedia('(prefers-reduced-motion: reduce)').matches);
  if (
    !changed ||
    reduce ||
    document.hidden ||
    hasRouteSnapshotWork() ||
    !privateSnapshotEligible() ||
    typeof document.startViewTransition !== 'function' ||
    typeof document.documentElement.animate !== 'function' ||
    typeof ResizeObserver !== 'function' ||
    (control &&
      (!control.isConnected ||
        !!control.closest('[hidden],[inert],details:not([open])')))
  ) {
    apply();
    return;
  }
  const root = document.documentElement;
  const geometry = collectThemeGeometry(document.body, false);
  if (!geometry) {
    apply();
    return;
  }
  const viewport = window.visualViewport;
  const area = {
    left: viewport?.offsetLeft ?? 0,
    top: viewport?.offsetTop ?? 0,
    width: viewport?.width ?? innerWidth,
    height: viewport?.height ?? innerHeight,
  };
  const origin = control?.getBoundingClientRect() ?? {
    left: area.left + area.width / 2,
    top: area.top + area.height / 2,
    width: 0,
    height: 0,
  };
  control = undefined;
  const circle = themeCircle(origin, area);
  const liveMedia = geometry.media.map((element) => ({
    element,
    rect: readRect(element),
  }));
  const media = liveMedia.map(({ rect }) => rect);
  const regions = geometry.regions;
  const captured = regions.map((element, index) => ({
    element,
    name: `theme-region-${index}`,
    rect: readRect(element),
  }));
  if (
    media.length &&
    (typeof CSS === 'undefined' ||
      typeof CSS.supports !== 'function' ||
      !CSS.supports('clip-path', mediaHolePath(innerWidth, innerHeight, media)))
  ) {
    apply();
    return;
  }
  if (
    !Number.isFinite(circle.radius) ||
    circle.radius <= 0 ||
    captured.some(
      ({ rect }) =>
        ![rect.left, rect.top, rect.width, rect.height].every(Number.isFinite),
    )
  ) {
    apply();
    return;
  }
  // This decorative-only layer supplies the background, with holes for live media.
  const background = document.createElement('div');
  background.className = 'experience-theme-background';
  background.setAttribute('aria-hidden', 'true');
  background.style.clipPath = mediaHolePath(innerWidth, innerHeight, media);
  document.body.prepend(background);
  captured.unshift({
    element: background,
    name: 'theme-background',
    rect: background.getBoundingClientRect(),
  });
  const previous = captured.map(({ element }) =>
    element.getAttribute('data-theme-region'),
  );
  const names = captured.map(({ element }) =>
    element.style.getPropertyValue('--theme-region-name'),
  );
  captured.forEach(({ element, name }) => {
    element.dataset.themeRegion = 'true';
    element.style.setProperty('--theme-region-name', name);
  });
  root.dataset.themeTransition = 'true';
  let transition: Transition | undefined;
  let cleaned = false;
  let geometryFrame: number | undefined;
  let deadline: ReturnType<typeof setTimeout> | undefined;
  const animations: Animation[] = [];
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    clearTimeout(deadline);
    if (geometryFrame !== undefined) {
      cancelAnimationFrame(geometryFrame);
      geometryFrame = undefined;
    }
    captured.forEach(({ element }, index) => {
      if (previous[index] === null) delete element.dataset.themeRegion;
      else element.setAttribute('data-theme-region', previous[index]!);
      if (names[index])
        element.style.setProperty('--theme-region-name', names[index]);
      else element.style.removeProperty('--theme-region-name');
    });
    background.remove();
    delete root.dataset.themeTransition;
    window.removeEventListener('resize', geometryChanged);
    window.removeEventListener('scroll', geometryChanged, true);
    document.removeEventListener('visibilitychange', visibilityChanged);
    viewport?.removeEventListener('resize', geometryChanged);
    viewport?.removeEventListener('scroll', geometryChanged);
    motion?.removeEventListener('change', motionChanged);
    observer.disconnect();
    resizeObserver.disconnect();
    captured.length = 0;
    previous.length = 0;
    names.length = 0;
    liveMedia.length = 0;
    regions.length = 0;
    geometry.media.length = 0;
    animations.length = 0;
    transition = undefined;
  };
  const lease = ownThemeSnapshot(() => {
    // skipTransition may still invoke update; its lease guard below makes it inert.
    transition?.skipTransition();
    animations.forEach((animation) => animation.cancel());
    apply();
    cleanup();
  });
  const stop = () => {
    if (lease.current()) {
      transition?.skipTransition();
      animations.forEach((animation) => animation.cancel());
      apply();
      cleanup();
      lease.release();
    }
  };
  const geometryChanged = () => stop();
  const geometryMatches = () => {
    if (
      !privateSnapshotEligible() ||
      hasRouteSnapshotWork() ||
      document.hidden ||
      root.dataset.motion !== 'full' ||
      motion?.matches
    )
      return false;
    const currentGeometry = collectThemeGeometry(
      document.body,
      false,
      background,
    );
    if (!currentGeometry) return false;
    const currentMedia = currentGeometry.media;
    if (
      currentMedia.length !== liveMedia.length ||
      liveMedia.some(
        ({ element, rect }, index) =>
          currentMedia[index] !== element || !sameRect(readRect(element), rect),
      )
    )
      return false;
    const currentRegions = currentGeometry.regions;
    return (
      currentRegions.length === regions.length &&
      currentRegions.every((element, index) => element === regions[index]) &&
      captured.every(({ element, rect }) => sameRect(readRect(element), rect))
    );
  };
  // Size observers do not report position-only movement or new live media.
  // Keep one geometry frame only for this lease, and retire it on every exit.
  const checkGeometry = () => {
    geometryFrame = undefined;
    if (!lease.current() || cleaned) return;
    if (!geometryMatches()) {
      stop();
      return;
    }
    geometryFrame = requestAnimationFrame(checkGeometry);
  };
  const visibilityChanged = () => {
    if (document.hidden) stop();
  };
  const motion =
    typeof matchMedia === 'function'
      ? matchMedia('(prefers-reduced-motion: reduce)')
      : null;
  const motionChanged = () => {
    if (motion?.matches) stop();
  };
  const observer = new MutationObserver(() => {
    if (root.dataset.motion !== 'full') stop();
  });
  const resizeObserver = new ResizeObserver(() => {
    if (!geometryMatches()) stop();
  });
  captured.forEach(({ element }) => resizeObserver.observe(element));
  liveMedia.forEach(({ element }) => resizeObserver.observe(element));
  observer.observe(root, {
    attributes: true,
    attributeFilter: ['data-motion'],
  });
  window.addEventListener('resize', geometryChanged);
  window.addEventListener('scroll', geometryChanged, true);
  document.addEventListener('visibilitychange', visibilityChanged);
  viewport?.addEventListener('resize', geometryChanged);
  viewport?.addEventListener('scroll', geometryChanged);
  motion?.addEventListener('change', motionChanged);
  try {
    deadline = setTimeout(stop, 650);
    transition = document.startViewTransition(() => {
      if (lease.current()) {
        if (geometryMatches()) apply();
        else stop();
      }
    });
    if (lease.current() && !cleaned)
      geometryFrame = requestAnimationFrame(checkGeometry);
    // Observe every native promise, including the update error path. No unhandled rejection.
    void transition.updateCallbackDone.catch(stop);
    void transition.ready
      .then(() => {
        if (!lease.current()) return;
        if (!geometryMatches()) {
          stop();
          return;
        }
        for (const { name, rect } of captured) {
          const pseudo = `::view-transition-new(${name})`;
          const keyframes = automatic
            ? [{ opacity: 0 }, { opacity: 1 }]
            : [
                {
                  clipPath: `circle(0px at ${circle.x - rect.left}px ${circle.y - rect.top}px)`,
                },
                {
                  clipPath: `circle(${circle.radius}px at ${circle.x - rect.left}px ${circle.y - rect.top}px)`,
                },
              ];
          const animation = root.animate(keyframes, {
            duration: automatic ? 180 : 500,
            easing:
              getComputedStyle(root)
                .getPropertyValue('--ease-workspace')
                .trim() || 'ease',
            fill: 'both',
            pseudoElement: pseudo,
          });
          animations.push(animation);
          if (
            (animation.effect as KeyframeEffect | null)?.pseudoElement !==
            pseudo
          ) {
            stop();
            return;
          }
        }
      })
      .catch(stop);
    void transition.finished
      .then(() => {
        if (lease.current()) {
          cleanup();
          lease.release();
        }
      })
      .catch(stop);
  } catch {
    stop();
  }
}
