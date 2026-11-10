import { routeKey } from './route-key';
import { cancelThemeSnapshot } from './native-transition-owner';
import {
  recordDetailReturnPath,
  presentationUuid,
  locationRowAnchor,
  type LocationOccurrence,
} from '@/features/inventory/detail-return';

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
export type LocationIdentity = { kind: 'location'; id: string; code: string };
export type PresentationTarget = RecordIdentity | LocationIdentity;
type TitleFields = {
  listHref: string;
  rawSourceRouteKey?: string;
  anchor: string;
  detailPath: string;
};
export type TitleTarget = TitleFields &
  (
    | (RecordIdentity & {
        source: { kind: 'inventory'; holding: HoldingIdentity };
        holding: HoldingIdentity;
      })
    | (RecordIdentity & {
        source: {
          kind: 'history-event';
          eventKind: 'asset' | 'quantity';
          eventId: string;
        };
        holding?: never;
      })
    | (LocationIdentity & {
        source: {
          kind: 'location-row';
          locationId: string;
          occurrence: LocationOccurrence;
        };
        holding?: never;
      })
  );
export type TitleIntent = TitleTarget & { name: string };
export function samePresentationTarget(
  left: PresentationTarget | null,
  right: PresentationTarget,
) {
  return (
    left?.kind === right.kind &&
    left.id === right.id &&
    (left.kind !== 'location' ||
      (right.kind === 'location' && left.code === right.code))
  );
}
export function sameTitleSource(left: TitleTarget, right: TitleTarget) {
  if (!samePresentationTarget(left, right)) return false;
  const a = left.source,
    b = right.source;
  if (a.kind !== b.kind) return false;
  if (a.kind === 'inventory' && b.kind === 'inventory')
    return sameHolding(a.holding, b.holding);
  if (a.kind === 'history-event' && b.kind === 'history-event')
    return a.eventKind === b.eventKind && a.eventId === b.eventId;
  return (
    a.kind === 'location-row' &&
    b.kind === 'location-row' &&
    a.locationId === b.locationId &&
    a.occurrence === b.occurrence
  );
}
export type RouteArrivalIntent = {
  name: string;
  presentation: 'outer' | 'primary';
  sourceKey: string;
  destinationKey: string;
  epoch: number;
};

export function recordPath(record: PresentationTarget) {
  if (record.kind === 'location')
    return '/locations/' + encodeURIComponent(record.code);
  return `/inventory/${record.kind === 'asset' ? 'assets' : 'quantity'}/${encodeURIComponent(record.id)}`;
}

export function titleTarget(
  record: RecordIdentity,
  returnTo: string,
  holding: HoldingIdentity | null,
  rawSourceRouteKey?: string,
): Extract<TitleTarget, { source: { kind: 'inventory' } }> | null {
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
  if (rawSourceRouteKey !== undefined) {
    let source: URL;
    try {
      source = new URL(rawSourceRouteKey, 'https://inventory.invalid');
    } catch {
      return null;
    }
    if (
      source.origin !== 'https://inventory.invalid' ||
      source.pathname !== '/inventory' ||
      source.hash !== '' ||
      rawSourceRouteKey !== routeKey(source.pathname, source.searchParams)
    )
      return null;
  }
  return {
    ...record,
    source: { kind: 'inventory', holding },
    holding,
    listHref: routeKey(url.pathname, url.searchParams),
    anchor: url.hash.slice(1),
    detailPath: recordPath(record),
    ...(rawSourceRouteKey === undefined ? {} : { rawSourceRouteKey }),
  };
}

function scopedTitleFields(
  record: PresentationTarget,
  returnTo: string,
  anchor: string,
  pathname: string,
  rawSourceRouteKey?: string,
): TitleFields | null {
  const accepted = recordDetailReturnPath(returnTo, '/invalid-return');
  if (accepted === '/invalid-return') return null;
  const url = new URL(accepted, 'https://inventory.invalid');
  if (url.pathname !== pathname || url.hash !== '#' + anchor) return null;
  if (rawSourceRouteKey !== undefined) {
    let raw: URL;
    try {
      raw = new URL(rawSourceRouteKey, 'https://inventory.invalid');
    } catch {
      return null;
    }
    if (
      raw.origin !== 'https://inventory.invalid' ||
      raw.pathname !== pathname ||
      raw.hash ||
      rawSourceRouteKey !== routeKey(raw.pathname, raw.searchParams) ||
      recordDetailReturnPath(rawSourceRouteKey, '/invalid-return') ===
        '/invalid-return'
    )
      return null;
    const canonicalRaw = new URL(
      recordDetailReturnPath(rawSourceRouteKey),
      'https://inventory.invalid',
    );
    if (
      routeKey(url.pathname, url.searchParams) !==
      routeKey(canonicalRaw.pathname, canonicalRaw.searchParams)
    )
      return null;
  }
  return {
    listHref: routeKey(url.pathname, url.searchParams),
    anchor,
    detailPath: recordPath(record),
    ...(rawSourceRouteKey === undefined ? {} : { rawSourceRouteKey }),
  };
}
export function historyTitleTarget(
  record: RecordIdentity,
  event: { kind: 'asset' | 'quantity'; id: string },
  returnTo: string,
  rawSourceRouteKey?: string,
): TitleTarget | null {
  if (
    !presentationUuid.test(record.id) ||
    !presentationUuid.test(event.id) ||
    event.kind !== record.kind
  )
    return null;
  const scope = new URL(
    recordDetailReturnPath(returnTo, '/invalid-return'),
    'https://inventory.invalid',
  );
  if (
    (scope.searchParams.get('type') &&
      scope.searchParams.get('type') !== record.kind) ||
    (scope.searchParams.get('entityId') &&
      scope.searchParams.get('entityId') !== record.id)
  )
    return null;
  const fields = scopedTitleFields(
    record,
    returnTo,
    `history-event-${event.kind}-${event.id}`,
    '/history',
    rawSourceRouteKey,
  );
  return fields
    ? {
        ...record,
        ...fields,
        source: {
          kind: 'history-event',
          eventKind: event.kind,
          eventId: event.id,
        },
      }
    : null;
}
export function locationTitleTarget(
  record: LocationIdentity,
  occurrence: LocationOccurrence,
  returnTo: string,
  rawSourceRouteKey?: string,
): TitleTarget | null {
  if (
    !presentationUuid.test(record.id) ||
    !record.code ||
    record.code.length > 160 ||
    /[\\/\x00-\x1f\x7f]/.test(record.code) ||
    record.code === '.' ||
    record.code === '..'
  )
    return null;
  const fields = scopedTitleFields(
    record,
    returnTo,
    locationRowAnchor(record.id, occurrence),
    '/locations',
    rawSourceRouteKey,
  );
  return fields
    ? {
        ...record,
        ...fields,
        source: { kind: 'location-row', locationId: record.id, occurrence },
      }
    : null;
}

/** Presentation-only approval, after exact raw readiness/privacy checks. */
export function matchesTitleListRoute(
  intent: Pick<TitleIntent, 'listHref' | 'rawSourceRouteKey'>,
  key: string,
) {
  return key === intent.listHref || key === intent.rawSourceRouteKey;
}

/** Only ephemeral identity/URL metadata; no titles, DOM, credentials or storage. */
export function createRouteMotionState() {
  let intent: TitleIntent | null = null;
  let arrival: RouteArrivalIntent | null = null;
  let titleArrival: RouteArrivalIntent | null = null;
  let arrivalSupported = false;
  let origin: TitleTarget | null = null;
  let navigation: {
    token: symbol;
    href: string;
    epoch: number;
    target: TitleTarget | null;
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
    arrivalSnapshot: () => arrival,
    titleArrivalSnapshot: () => titleArrival,
    arrivalSupportSnapshot: () => arrivalSupported,
    supportArrival(supported: boolean) {
      arrivalSupported = supported;
      if (!supported) {
        arrival = null;
        intent = null;
        titleArrival = null;
      }
      notify();
    },
    acceptArrival(
      href: string,
      sourceKey: string,
      epoch: number,
      base: string,
      presentation: RouteArrivalIntent['presentation'] = 'outer',
    ) {
      arrival = null;
      titleArrival = null;
      if (valid && !suspended && arrivalSupported) {
        try {
          const destination = new URL(href, base);
          if (destination.origin === new URL(base).origin)
            arrival = {
              name: `route-primary-${crypto.randomUUID()}`,
              presentation,
              sourceKey,
              destinationKey: routeKey(
                destination.pathname,
                destination.searchParams,
              ),
              epoch,
            };
        } catch {
          // Unsupported destinations retain ordinary navigation without capture.
        }
      }
      // The outer pathname can consume generic arrival before Next reveals its
      // inner primary. Keep this exact accepted gesture with its title owner;
      // it cannot authorize a generic capture or survive title retirement.
      if (intent && arrival) titleArrival = arrival;
      notify();
    },
    finishArrival(expected?: RouteArrivalIntent) {
      if (expected && arrival !== expected) return;
      arrival = null;
      notify();
    },
    valid: () => valid && !suspended,
    suspend(notifyListeners = true) {
      suspended = true;
      navigation = null;
      arrival = null;
      intent = null;
      titleArrival = null;
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
    stageNavigation(target: TitleTarget | null) {
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
    arm(target: TitleTarget) {
      if (!valid || suspended) return;
      intent = { ...target, name: `inventory-title-${crypto.randomUUID()}` };
      titleArrival = null;
      origin = target;
      notify();
    },
    finish(name?: string) {
      if (name && intent?.name !== name) return;
      intent = null;
      titleArrival = null;
      notify();
    },
    retire() {
      navigation = null;
      arrival = null;
      intent = null;
      titleArrival = null;
      origin = null;
      notify();
    },
    backTarget(record: PresentationTarget, returnTo: string) {
      if (!valid || suspended) return null;
      if (!origin || !samePresentationTarget(origin, record)) return null;
      const target =
        origin.source.kind === 'inventory' && record.kind !== 'location'
          ? titleTarget(record, returnTo, origin.source.holding)
          : origin.source.kind === 'history-event' && record.kind !== 'location'
            ? historyTitleTarget(
                record,
                { kind: origin.source.eventKind, id: origin.source.eventId },
                returnTo,
              )
            : origin.source.kind === 'location-row' &&
                record.kind === 'location'
              ? locationTitleTarget(record, origin.source.occurrence, returnTo)
              : null;
      return target?.listHref === origin.listHref &&
        target.anchor === origin.anchor
        ? origin
        : null;
    },
    invalidate(notifyListeners = true) {
      navigation = null;
      arrival = null;
      valid = false;
      intent = null;
      titleArrival = null;
      origin = null;
      if (notifyListeners) notify();
    },
  };
}

const snapshotWithdrawals = new Set<() => void>();
export function observeRouteSnapshotWithdrawal(withdraw: () => void) {
  snapshotWithdrawals.add(withdraw);
  return () => {
    snapshotWithdrawals.delete(withdraw);
  };
}

export function cancelRouteSnapshots() {
  snapshotWithdrawals.forEach((withdraw) => withdraw());
  cancelThemeSnapshot();
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
