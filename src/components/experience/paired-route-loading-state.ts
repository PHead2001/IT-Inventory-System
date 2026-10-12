import { routeKey } from './route-key';
import type { RoutePendingState } from './route-pending';

export type PairedLoadingOwner = {
  name: string;
  destination: string;
  epoch: number;
  promise: Promise<void>;
};

/** One accepted navigation owns an opaque wait, never outgoing children or data. */
export function createPairedRouteLoading(pending: RoutePendingState) {
  let owner: (PairedLoadingOwner & { release: () => void }) | null = null;
  const listeners = new Set<() => void>();
  const notify = () => listeners.forEach((listener) => listener());
  const retire = (notifyListeners = true) => {
    if (!owner) return;
    const retired = owner;
    owner = null;
    retired.release();
    if (notifyListeners) notify();
  };
  return {
    snapshot: (): PairedLoadingOwner | null => owner,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    arm: (name: string, href: string, epoch: number) => {
      retire();
      let destination: URL;
      try {
        destination = new URL(href, location.origin);
      } catch {
        return;
      }
      if (
        !name ||
        destination.origin !== location.origin ||
        !pending.current(epoch)
      )
        return;
      let resolve!: () => void;
      const promise = new Promise<void>((done) => {
        resolve = done;
      });
      const finish = pending.register(epoch);
      owner = {
        name,
        destination: routeKey(destination.pathname, destination.searchParams),
        epoch,
        promise,
        release: () => {
          finish();
          resolve();
        },
      };
      notify();
    },
    // Called only by the existing actor/full-query/visible readiness protocol.
    ready: (key: string) => {
      if (owner?.destination === key && pending.current(owner.epoch)) retire();
    },
    cancel: retire,
  };
}
