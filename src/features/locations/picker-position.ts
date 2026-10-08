/** Desktop panel shares the trigger width and never covers its own control. */
export function pickerPosition(
  trigger: { left: number; top: number; bottom: number; width: number },
  labelTop: number,
  viewport: { width: number; height: number },
) {
  const margin = 16;
  const gap = 4;
  const width = Math.min(
    trigger.width,
    Math.max(1, viewport.width - margin * 2),
  );
  const below = Math.max(1, viewport.height - margin - trigger.bottom - gap);
  const above = Math.max(1, labelTop - margin - gap);
  const flip = below < 320 && above > below;
  const height = Math.min(416, flip ? above : below);
  return {
    width,
    height,
    left: Math.max(
      margin,
      Math.min(trigger.left, viewport.width - width - margin),
    ),
    top: flip ? labelTop - gap - height : trigger.bottom + gap,
  };
}
