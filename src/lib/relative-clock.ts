/** One browser clock for all mounted relative timestamps; paused while hidden. */
let now: number | null = null;
let timer: ReturnType<typeof setInterval> | null = null;
const listeners = new Set<() => void>();
function stop() {
  if (timer !== null) clearInterval(timer);
  timer = null;
}
function update() {
  now = Date.now();
  listeners.forEach((listener) => listener());
}
function visibility() {
  stop();
  if (document.visibilityState !== 'hidden') {
    update();
    timer = setInterval(update, 30_000);
  }
}
export function subscribeRelativeClock(listener: () => void) {
  listeners.add(listener);
  if (listeners.size === 1) {
    document.addEventListener('visibilitychange', visibility);
    visibility();
    if (document.visibilityState === 'hidden') update();
  } else update(); // New events must not inherit a previous subscriber's stale tick.
  return () => {
    listeners.delete(listener);
    if (!listeners.size) {
      stop();
      document.removeEventListener('visibilitychange', visibility);
      now = null;
    }
  };
}
export const relativeClockSnapshot = () => now;
export const relativeClockServerSnapshot = () => null;
export function relativeTimeLabel(
  value: string,
  current: number | null,
): string | null {
  if (current === null) return null;
  const elapsed = current - new Date(value).getTime();
  if (!Number.isFinite(elapsed)) return null;
  if (elapsed >= -120_000 && elapsed < 60_000) return 'Just now';
  const seconds = Math.abs(elapsed) / 1000;
  const unit = seconds < 3600 ? 'min' : seconds < 86400 ? 'hr' : 'day';
  const size = seconds < 3600 ? 60 : seconds < 86400 ? 3600 : 86400;
  const amount = Math.floor(seconds / size);
  const text = `${amount} ${unit}${unit === 'day' && amount !== 1 ? 's' : ''}`;
  return elapsed >= 0 ? `${text} ago` : `In ${text}`;
}
