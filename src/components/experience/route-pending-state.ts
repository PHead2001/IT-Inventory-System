/** Ephemeral presentation registrations. Timers reveal work; they never finish it. */
export function createRoutePendingState() {
  let epoch = 0;
  let open = true;
  let suspended = false;
  let delayed = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const registrations = new Set<symbol>();
  const listeners = new Set<() => void>();
  let snapshot = { epoch, pending: false, delayed: false };
  const notify = () => {
    snapshot = { epoch, pending: registrations.size > 0, delayed };
    listeners.forEach((listener) => listener());
  };
  const clearTimer = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
  };
  return {
    snapshot: () => snapshot,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    register: (generation = epoch) => {
      if (!open || suspended || generation !== epoch) return () => {};
      const token = Symbol();
      registrations.add(token);
      if (registrations.size === 1) {
        timer = setTimeout(() => {
          timer = undefined;
          if (
            open &&
            !suspended &&
            generation === epoch &&
            registrations.size
          ) {
            delayed = true;
            notify();
          }
        }, 150);
      }
      notify();
      return () => {
        if (generation !== epoch || !registrations.delete(token)) return;
        if (!registrations.size) {
          clearTimer();
          delayed = false;
        }
        notify();
      };
    },
    cancel: (close = false, notifyListeners = true) => {
      epoch += 1;
      if (close) open = false;
      registrations.clear();
      delayed = false;
      clearTimer();
      if (notifyListeners) notify();
      else snapshot = { epoch, pending: false, delayed: false };
    },
    suspend: () => {
      if (suspended) return;
      suspended = true;
      epoch += 1;
      registrations.clear();
      delayed = false;
      clearTimer();
      notify();
    },
    resume: () => {
      if (!open || !suspended) return;
      suspended = false;
      epoch += 1;
      notify();
    },
    current: (generation: number) => open && !suspended && generation === epoch,
  };
}
