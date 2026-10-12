import { cancelRouteSnapshots } from './route-motion-state';

function pixels(value: unknown) {
  if (typeof value !== 'string' || !/^\d+(?:\.\d+)?px$/.test(value))
    return null;
  const number = Number.parseFloat(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function milliseconds(value: string) {
  // CSS optimization may serialize 200ms as .2s; WAAPI accepts milliseconds.
  const time = /^([+-]?(?:\d+(?:\.\d+)?|\.\d+)(?:e[+-]?\d+)?)(ms|s)$/i.exec(
    value.trim(),
  );
  if (!time) return NaN;
  return Number(time[1]) * (time[2].toLowerCase() === 's' ? 1000 : 1);
}

function translation(value: unknown) {
  if (typeof value !== 'string') return null;
  const matrix = new DOMMatrixReadOnly(value === 'none' ? undefined : value);
  if (
    !matrix.is2D ||
    matrix.a !== 1 ||
    matrix.b !== 0 ||
    matrix.c !== 0 ||
    matrix.d !== 1 ||
    !Number.isFinite(matrix.e) ||
    !Number.isFinite(matrix.f)
  )
    return null;
  return { x: matrix.e, y: matrix.f };
}

/** React owns pairing/capture. Replace only its exact native geometry effect.
 * No live elements or cached click boxes are measured; scroll/Back are captured
 * by the browser. Native dimensions are fixed before animating transform only.
 */
export function sharedTitleMotion(
  instance: { name: string },
  valid: () => boolean,
) {
  if (!valid()) {
    cancelRouteSnapshots();
    return;
  }
  const group = `::view-transition-group(${instance.name})`;
  let replacement: Animation | undefined;
  try {
    const animations = document
      .getAnimations()
      .filter(
        (animation) =>
          (animation.effect as KeyframeEffect | null)?.pseudoElement === group,
      );
    const frames = animations.flatMap((animation) =>
      (animation.effect as KeyframeEffect).getKeyframes(),
    );
    const first = frames.find(
      (frame) => frame.offset === 0 || frame.computedOffset === 0,
    ) as (ComputedKeyframe & Record<string, unknown>) | undefined;
    // Cancel BEFORE inspecting the implicit endpoint: computed style while the
    // native animation runs would be an interpolated box, not the destination.
    animations.forEach((animation) => animation.cancel());
    const destination = getComputedStyle(document.documentElement, group);
    const width = pixels(destination.width);
    const height = pixels(destination.height);
    const oldWidth = pixels(first?.width ?? destination.width);
    const oldHeight = pixels(first?.height ?? destination.height);
    const old = translation(first?.transform ?? destination.transform);
    const next = translation(destination.transform);
    if (
      !animations.length ||
      !first ||
      !width ||
      !height ||
      !oldWidth ||
      !oldHeight ||
      !old ||
      !next ||
      !valid()
    )
      throw new Error('Unsupported snapshot geometry');
    const scaleX = oldWidth / width;
    const scaleY = oldHeight / height;
    if (
      !Number.isFinite(scaleX) ||
      !Number.isFinite(scaleY) ||
      scaleX <= 0 ||
      scaleY <= 0
    )
      throw new Error('Unsupported snapshot scale');
    const duration = milliseconds(
      getComputedStyle(document.documentElement).getPropertyValue(
        '--motion-route',
      ),
    );
    const easing = getComputedStyle(document.documentElement)
      .getPropertyValue('--ease-workspace')
      .trim();
    if (
      !Number.isFinite(duration) ||
      duration <= 0 ||
      duration > 250 ||
      !easing
    )
      throw new Error('Unsupported snapshot timing');
    replacement = document.documentElement.animate(
      [
        {
          transform: `translate(${old.x}px, ${old.y}px) scale(${scaleX}, ${scaleY})`,
        },
        { transform: `translate(${next.x}px, ${next.y}px) scale(1, 1)` },
      ],
      { duration, delay: 0, easing, pseudoElement: group },
    );
    return () => replacement?.cancel();
  } catch {
    // A post-capture failure cannot rebuild the parent's image without retaining
    // private DOM. Skip the entire snapshot, revealing the live destination now.
    replacement?.cancel();
    cancelRouteSnapshots();
  }
}
