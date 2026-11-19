/** One document snapshot owner; no DOM/identity survives the owner's lifetime. */
let generation = 0;
let active: { cancel: () => void; token: number } | null = null;
let routePending: (() => boolean) | null = null;
export function bindRouteSnapshotPending(read: () => boolean) {
  routePending = read;
  return () => {
    if (routePending === read) routePending = null;
  };
}
export function hasRouteSnapshotWork() {
  return routePending?.() ?? false;
}
export function cancelThemeSnapshot() {
  generation += 1;
  const previous = active;
  active = null;
  previous?.cancel();
}
export function ownThemeSnapshot(cancel: () => void) {
  cancelThemeSnapshot();
  const token = generation;
  active = { token, cancel };
  return {
    current: () => active?.token === token && generation === token,
    release: () => {
      if (active?.token === token) active = null;
    },
  };
}

let privateEligibility: (() => boolean) | null = null;
export function bindPrivateSnapshotEligibility(read: () => boolean) {
  cancelThemeSnapshot();
  privateEligibility = read;
  return () => {
    if (privateEligibility === read) {
      privateEligibility = null;
      cancelThemeSnapshot();
    }
  };
}
// No public theme controls exist; a missing private owner always fails closed.
export const privateSnapshotEligible = () => privateEligibility?.() ?? false;
