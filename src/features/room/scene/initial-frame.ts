/** Default framing waits for a real viewport and runs once. Explicit camera
 * intent and restored context have authority over later canvas measurements. */
export function hasMeasuredViewport(width: number, height: number) {
  return (
    Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0
  );
}
export function createInitialFramePolicy() {
  let applied = false;
  let pristine = true;
  return {
    manual() {
      pristine = false;
    },
    reset() {
      applied = false;
      pristine = true;
    },
    measure(
      width: number,
      height: number,
      restored: boolean,
    ): 'wait' | 'fit' | 'restore' | 'preserve' {
      if (!hasMeasuredViewport(width, height)) return 'wait';
      if (applied) return 'preserve';
      applied = true;
      return restored ? 'restore' : pristine ? 'fit' : 'preserve';
    },
  };
}
