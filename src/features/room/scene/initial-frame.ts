/** Default framing waits for a real viewport and runs once. Explicit camera
 * intent and restored context have authority over later canvas measurements. */
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
      if (width <= 0 || height <= 0) return 'wait';
      if (applied) return 'preserve';
      applied = true;
      return restored ? 'restore' : pristine ? 'fit' : 'preserve';
    },
  };
}
