/** Presentation-only geometry check; it grants no data or restoration authority. */
export function renderedPresentation(element: Element | null) {
  if (!element?.isConnected || element.getClientRects().length === 0)
    return false;
  const visibility = getComputedStyle(element).visibility;
  return visibility !== 'hidden' && visibility !== 'collapse';
}
/** One finite owner per native animation group, including delayed list arrivals. */
export function guardRenderedMotion(
  entries: { element: Element; stop: () => void }[],
  current: () => boolean,
  duration: number,
) {
  if (!entries.length) return () => {};
  let live = true,
    frame = 0;
  const deadline = performance.now() + duration;
  const active = new Set(entries);
  const stop = () => {
    if (!live) return;
    live = false;
    cancelAnimationFrame(frame);
    active.forEach((entry) => entry.stop());
    active.clear();
  };
  const check = (time: number) => {
    if (!live) return;
    if (!current() || time >= deadline) {
      stop();
      return;
    }
    for (const entry of active)
      if (!renderedPresentation(entry.element)) {
        entry.stop();
        active.delete(entry);
      }
    if (active.size) frame = requestAnimationFrame(check);
    else stop();
  };
  frame = requestAnimationFrame(check);
  return stop;
}
