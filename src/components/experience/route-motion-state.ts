import { routeKey } from './route-key';

export type RecordIdentity = { kind: 'asset' | 'quantity'; id: string };
export type HoldingIdentity =
  { domain: 'storage' | 'site'; id: string } | { domain: 'unplaced' };
export function sameHolding(left: HoldingIdentity, right: HoldingIdentity) {
  return (
    left.domain === right.domain &&
    (left.domain === 'unplaced' ||
      (right.domain !== 'unplaced' && left.id === right.id))
  );
}
export function inventoryHolding(record: {
  location: { id: string } | null;
  site?: { id: string } | null;
}): HoldingIdentity | null {
  // Ambiguous/unsupported source identity cannot safely pair a snapshot.
  if (record.location && record.site) return null;
  if (record.location) return { domain: 'storage', id: record.location.id };
  if (record.site) return { domain: 'site', id: record.site.id };
  return { domain: 'unplaced' };
}
export function recordHoldingKey(
  record: RecordIdentity,
  holding: HoldingIdentity | null,
) {
  return holding
    ? JSON.stringify([
        record.kind,
        record.id,
        holding.domain,
        holding.domain === 'unplaced' ? null : holding.id,
      ])
    : null;
}
export type TitleIntent = RecordIdentity & {
  holding: HoldingIdentity;
  name: string;
  listHref: string;
  anchor: string;
  detailPath: string;
};

export function recordPath(record: RecordIdentity) {
  return `/inventory/${record.kind === 'asset' ? 'assets' : 'quantity'}/${encodeURIComponent(record.id)}`;
}

export function titleTarget(
  record: RecordIdentity,
  returnTo: string,
  holding: HoldingIdentity | null,
): Omit<TitleIntent, 'name'> | null {
  let url: URL;
  try {
    url = new URL(returnTo, 'https://inventory.invalid');
  } catch {
    return null;
  }
  if (
    !holding ||
    url.origin !== 'https://inventory.invalid' ||
    url.pathname !== '/inventory' ||
    !/^#inventory-row-[1-9]\d{0,2}$/.test(url.hash)
  )
    return null;
  return {
    ...record,
    holding,
    listHref: routeKey(url.pathname, url.searchParams),
    anchor: url.hash.slice(1),
    detailPath: recordPath(record),
  };
}

/** Only ephemeral identity/URL metadata; no titles, DOM, credentials or storage. */
export function createRouteMotionState() {
  let intent: TitleIntent | null = null;
  let origin: Omit<TitleIntent, 'name'> | null = null;
  let navigation: {
    token: symbol;
    href: string;
    epoch: number;
    target: Omit<TitleIntent, 'name'> | null;
  } | null = null;
  let valid = true;
  let suspended = false;
  const listeners = new Set<() => void>();
  const notify = () => listeners.forEach((listener) => listener());
  return {
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    snapshot: () => intent,
    valid: () => valid && !suspended,
    suspend(notifyListeners = true) {
      suspended = true;
      navigation = null;
      intent = null;
      origin = null;
      if (notifyListeners) notify();
    },
    resume() {
      if (!valid) return false;
      suspended = false;
      notify();
      return true;
    },
    beginNavigation(href: string, epoch: number) {
      if (!valid || suspended) return () => {};
      const token = Symbol();
      navigation = { token, href, epoch, target: null };
      return () => {
        if (navigation?.token === token) navigation = null;
      };
    },
    stageNavigation(target: Omit<TitleIntent, 'name'> | null) {
      if (!valid || suspended) return;
      if (navigation) navigation.target = target;
    },
    acceptNavigation(href: string, epoch: number) {
      if (!valid || suspended) return null;
      const accepted = navigation;
      navigation = null;
      return accepted?.href === href && accepted.epoch === epoch
        ? accepted.target
        : null;
    },
    arm(target: Omit<TitleIntent, 'name'>) {
      if (!valid || suspended) return;
      intent = { ...target, name: `inventory-title-${crypto.randomUUID()}` };
      origin = target;
      notify();
    },
    finish(name?: string) {
      if (name && intent?.name !== name) return;
      intent = null;
      notify();
    },
    retire() {
      navigation = null;
      intent = null;
      origin = null;
      notify();
    },
    backTarget(record: RecordIdentity, returnTo: string) {
      if (!valid || suspended) return null;
      if (!origin || record.kind !== origin.kind || record.id !== origin.id)
        return null;
      const target = titleTarget(record, returnTo, origin.holding);
      return target?.listHref === origin.listHref &&
        target.anchor === origin.anchor
        ? origin
        : null;
    },
    back(from: string, to: string) {
      if (!valid || suspended) return;
      // History can reuse an origin, but never authorize a future Link gesture.
      navigation = null;
      if (!origin || from !== origin.detailPath) return;
      let destination: URL;
      try {
        destination = new URL(to, 'https://inventory.invalid');
      } catch {
        return;
      }
      const list = new URL(origin.listHref, 'https://inventory.invalid');
      if (
        destination.origin !== list.origin ||
        routeKey(destination.pathname, destination.searchParams) !==
          routeKey(list.pathname, list.searchParams) ||
        (destination.hash !== '' && destination.hash !== `#${origin.anchor}`)
      )
        return;
      // The first native Back returns to the departing list URL, which usually
      // has no hash. Recover the approved initiating ordinal from metadata;
      // never change history just to introduce an animation anchor. The row
      // still has to match this exact results scope, record AND stable holding.
      // The ordinal is an anchor locator, not the holding's identity.
      this.arm(origin);
    },
    invalidate(notifyListeners = true) {
      navigation = null;
      valid = false;
      intent = null;
      origin = null;
      if (notifyListeners) notify();
    },
  };
}

export function cancelRouteSnapshots() {
  // activeViewTransition is progressive. Cancel pseudo-element animations too
  // for browsers that implement snapshots without the active handle.
  (
    document as Document & { activeViewTransition?: { skipTransition(): void } }
  ).activeViewTransition?.skipTransition();
  document.getAnimations?.().forEach((animation) => {
    const effect = animation.effect as KeyframeEffect | null;
    if (effect?.pseudoElement?.startsWith('::view-transition'))
      animation.cancel();
  });
}
