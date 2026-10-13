import { routeKey } from './route-key';
import type { RouteArrivalIntent } from './route-motion-state';
import type { RoutePendingState } from './route-pending';

type LoadingIdentity = {
  name: string;
  destination: string;
  epoch: number;
  promise: Promise<void>;
};
export type PairedLoadingOwner = LoadingIdentity &
  ({ kind: 'title' } | { kind: 'primary'; arrival: RouteArrivalIntent });

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
  const arm = (
    name: string,
    href: string,
    epoch: number,
    arrival?: RouteArrivalIntent,
  ) => {
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
      ...(arrival
        ? { kind: 'primary' as const, arrival }
        : { kind: 'title' as const }),
      release: () => {
        finish();
        resolve();
      },
    };
    notify();
  };
  return {
    snapshot: (): PairedLoadingOwner | null => owner,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    arm: (name: string, href: string, epoch: number) => arm(name, href, epoch),
    armPrimary: (arrival: RouteArrivalIntent) => {
      if (arrival.presentation === 'primary')
        arm(arrival.name, arrival.destinationKey, arrival.epoch, arrival);
    },
    // Called only by the existing actor/full-query/visible readiness protocol.
    ready: (key: string) => {
      if (owner?.destination === key && pending.current(owner.epoch)) retire();
    },
    cancel: retire,
  };
}
