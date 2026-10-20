import { cancelRouteSnapshots } from './route-motion-state';
import { registerRouteSnapshotClock } from './route-snapshot-clock';

function pixels(value: unknown) {
  if (typeof value !== 'string' || !/^\d+(?:\.\d+)?px$/.test(value))
    return null;
  const number = Number.parseFloat(value);
  return Number.isFinite(number) && number > 0 ? number : null;
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

/** Preserve the outgoing bitmap's captured box and the incoming image's natural
 * size. Unlike the shared title, bodies never scale or morph between pages.
 * All replacements are registered synchronously, before completion collectors.
 */
export function routeContentMotion(
  instance: { name: string },
  valid: () => boolean,
  unsupported?: () => void,
) {
  // A stale callback must not cancel a newer navigation's snapshots.
  if (!valid()) return;
  const group = `::view-transition-group(${instance.name})`;
  const oldImage = `::view-transition-old(${instance.name})`;
  const newImage = `::view-transition-new(${instance.name})`;
  const replacements: Animation[] = [];
  try {
    const owned = document
      .getAnimations()
      .filter((animation) =>
        [group, oldImage, newImage].includes(
          (animation.effect as KeyframeEffect | null)?.pseudoElement ?? '',
        ),
      );
    const geometry = owned.filter(
      (animation) =>
        (animation.effect as KeyframeEffect).pseudoElement === group,
    );
    const first = geometry
      .flatMap((animation) =>
        (animation.effect as KeyframeEffect).getKeyframes(),
      )
      .find((frame) => frame.offset === 0 || frame.computedOffset === 0) as
      (ComputedKeyframe & Record<string, unknown>) | undefined;
    // The paused native first frame belongs to the old scroll position. Only
    // after cancelling it does computed style expose the real destination.
    owned.forEach((animation) => animation.cancel());
    const destination = getComputedStyle(document.documentElement, group);
    const width = pixels(destination.width);
    const height = pixels(destination.height);
    // React removes both unchanged dimensions before this callback. Only that
    // paired omission means the captured and destination dimensions are equal.
    // A removed transform is specifically its identity (`none`), never the
    // destination translation; partial/invalid geometry still fails closed.
    const unchangedDimensions =
      first?.width === undefined && first?.height === undefined;
    const oldWidth = pixels(
      unchangedDimensions ? destination.width : first?.width,
    );
    const oldHeight = pixels(
      unchangedDimensions ? destination.height : first?.height,
    );
    const old = translation(
      first?.transform === undefined ? 'none' : first.transform,
    );
    const next = translation(destination.transform);
    const tokens = getComputedStyle(document.documentElement);
    const time = /^([+-]?(?:\d+(?:\.\d+)?|\.\d+)(?:e[+-]?\d+)?)(ms|s)$/i.exec(
      tokens.getPropertyValue('--motion-route').trim(),
    );
    const duration = time
      ? Number(time[1]) * (time[2].toLowerCase() === 's' ? 1000 : 1)
      : NaN;
    const easing = tokens.getPropertyValue('--ease-workspace').trim();
    if (
      !geometry.length ||
      !first ||
      !width ||
      !height ||
      !oldWidth ||
      !oldHeight ||
      !old ||
      !next ||
      !Number.isFinite(duration) ||
      duration <= 0 ||
      duration > 250 ||
      !easing ||
      !valid()
    )
      throw new Error('Unsupported body snapshot geometry or timing');
    const animate = (pseudoElement: string, frames: Keyframe[]) => {
      replacements.push(
        document.documentElement.animate(frames, {
          duration,
          delay: 0,
          easing,
          fill: 'both',
          pseudoElement,
        }),
      );
    };
    // A constant group keeps both images in destination coordinates without
    // interpolating width/height, including a 1,429px -> 7,622px page change.
    const box = {
      width: `${width}px`,
      height: `${height}px`,
      transform: `translate(${next.x}px, ${next.y}px)`,
    };
    animate(group, [box, box]);
    const previous = {
      width: `${oldWidth}px`,
      height: `${oldHeight}px`,
      transform: `translate(${old.x - next.x}px, ${old.y - next.y}px)`,
    };
    animate(oldImage, [
      { ...previous, opacity: 1 },
      { ...previous, opacity: 0 },
    ]);
    // The incoming replaced image follows its live intrinsic size. Its captured
    // group can outlive trailing content changes; forcing that earlier box onto
    // this image stretches the entire page until the snapshot is released.
    animate(newImage, [
      { transform: 'translateY(8px)', opacity: 0 },
      { transform: 'translateY(0px)', opacity: 1 },
    ]);
    const retireClock = registerRouteSnapshotClock(
      replacements,
      valid,
      unsupported,
    );
    return () => {
      retireClock();
      replacements.forEach((animation) => animation.cancel());
    };
  } catch {
    replacements.forEach((animation) => animation.cancel());
    unsupported?.();
    cancelRouteSnapshots();
  }
}
