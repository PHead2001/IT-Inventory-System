import type { RouteTransitionAction } from './route-pending';

export type PendingOwner = {
  id: string;
  live: boolean;
  incarnation: number;
  run: RouteTransitionAction | null;
  finish: (() => void) | null;
};
/** Imperative owner registrations live outside React props/state mutation. */
export function bindPendingRunner(
  owner: PendingOwner,
  run: RouteTransitionAction,
) {
  owner.run = run;
  return () => {
    if (owner.run === run) owner.run = null;
  };
}
export function bindPendingFinish(owner: PendingOwner, finish: () => void) {
  owner.finish = finish;
  return () => {
    finish();
    if (owner.finish === finish) owner.finish = null;
  };
}
export function mountStandalonePendingOwner(owner: PendingOwner) {
  owner.live = true;
  const incarnation = ++owner.incarnation;
  return () => {
    if (owner.incarnation === incarnation) {
      owner.live = false;
      owner.incarnation += 1;
    }
  };
}
/** Caller lifetime, never backend cancellation or a URL identity. */
export function createRoutePendingOwners() {
  const owners = new Set<PendingOwner>();
  const listeners = new Set<() => void>();
  let snapshot: readonly PendingOwner[] = [];
  let closed = false;
  const notify = () => {
    snapshot = Array.from(owners);
    listeners.forEach((listener) => listener());
  };
  return {
    snapshot: () => snapshot,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    mount: (owner: PendingOwner) => {
      if (closed) return () => {};
      owner.live = true;
      owner.incarnation += 1;
      owners.add(owner);
      notify();
      return () => {
        if (!owners.delete(owner)) return;
        owner.live = false;
        owner.incarnation += 1;
        owner.run = null;
        owner.finish?.();
        owner.finish = null;
        notify();
      };
    },
    dispose: () => {
      closed = true;
      owners.forEach((owner) => {
        owner.live = false;
        owner.incarnation += 1;
        owner.run = null;
        owner.finish?.();
        owner.finish = null;
      });
      owners.clear();
      snapshot = [];
      listeners.clear();
    },
  };
}
