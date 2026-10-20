type CaptureReceipt = {
  names: Set<string>;
  sealed: boolean;
};

/** React 19.3 dispatches a native capture's queued callbacks synchronously and
 * binds their returned cleanups to that same transition.finished. Seal once after
 * that dispatch, never accepting a later callback into an earlier capture. */
export function createRouteCaptureCompletion() {
  const captures = new WeakMap<object, CaptureReceipt>();
  const listeners = new Set<() => void>();
  let revision = 0;
  const seal = (receipt: CaptureReceipt) => {
    if (receipt.sealed) return;
    receipt.sealed = true;
    revision++;
    listeners.forEach((listener) => listener());
  };
  return {
    // Presentation-only publication: never supplies readiness or a new epoch.
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    snapshot: () => revision,
    available: (approval: object | null | undefined) =>
      !approval || captures.get(approval)?.sealed !== true,
    capture({
      approval,
      name,
      current,
      captured,
      complete,
      missing,
      body,
    }: {
      approval: object;
      name: string;
      current(): boolean;
      captured(): void;
      complete(): void;
      missing(): void;
      body(name: string): boolean;
    }) {
      if (!current()) return false;
      let receipt = captures.get(approval);
      if (receipt?.sealed || receipt?.names.has(name)) return false;
      if (!receipt) {
        receipt = { names: new Set(), sealed: false };
        captures.set(approval, receipt);
        const owned = receipt;
        queueMicrotask(() => {
          seal(owned);
          if (!current()) return;
          const names = Object.freeze([...owned.names]);
          const animations = (document.getAnimations?.() ?? []).filter(
            (animation) =>
              names.some((participant) =>
                (
                  animation.effect as KeyframeEffect | null
                )?.pseudoElement?.endsWith(`(${participant})`),
              ),
          );
          captured();
          if (
            !animations.some((animation) =>
              names.some(
                (participant) =>
                  body(participant) &&
                  (
                    animation.effect as KeyframeEffect | null
                  )?.pseudoElement?.endsWith(`(${participant})`),
              ),
            )
          ) {
            missing();
            return;
          }
          void Promise.allSettled(
            animations.map((animation) => animation.finished),
          ).then(() => {
            if (current()) complete();
          });
        });
      }
      // The explicit closed region capability is below this defensive ceiling.
      if (receipt.names.size >= 64) {
        seal(receipt);
        missing();
        return false;
      }
      receipt.names.add(name);
      return true;
    },
  };
}
