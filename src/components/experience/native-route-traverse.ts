import { routeKey } from './route-key';

type TraverseEvent = Pick<
  NavigateEvent,
  'isTrusted' | 'navigationType' | 'destination' | 'signal'
>;
export type NativeTraverseCapture = Readonly<{
  provider: symbol;
  source: string;
  sourceRouteKey: string;
  destinationEntryKey: string;
  destinationHref: string;
  destinationRouteKey: string;
  destinationRelativeHref: string;
}>;
type Preparation = Readonly<{
  epoch: number;
  identity: symbol;
  current: () => boolean;
  cancel: () => void;
  history: () => void;
}>;

/** Observes browser traversal only. It never intercepts navigation or owns
 * readiness/authorization. One immutable preparation survives Next's same-entry
 * replace bookkeeping after the native URL commit. */
export function createNativeRouteTraverse(options: {
  provider: symbol;
  source: () => string;
  sourceRouteKey: () => string;
  origin: string;
  href: () => string;
  entryKey: () => string | undefined;
  prepare: (capture: NativeTraverseCapture) => Preparation | undefined;
}) {
  let candidate: Readonly<{
    capture: NativeTraverseCapture;
    preparation: Preparation;
    detach: () => void;
  }> | null = null;
  let committed = false;
  let consumed = false;
  const matches = (expected: NonNullable<typeof candidate>) =>
    options.entryKey() === expected.capture.destinationEntryKey &&
    options.href() === expected.capture.destinationHref;
  const clear = (cancel = true) => {
    const previous = candidate;
    candidate = null;
    committed = false;
    consumed = false;
    previous?.detach();
    if (cancel && previous?.preparation.current())
      previous.preparation.cancel();
  };
  return {
    navigate(event: TraverseEvent) {
      if (!event.isTrusted) return;
      // Next updates its history state after ACTION_RESTORE. Its replace event
      // can carry another destination key, although currentEntry is still the
      // exact traversed entry. Do not replace/cancel that committed ticket.
      if (
        candidate &&
        committed &&
        matches(candidate) &&
        event.navigationType === 'replace' &&
        event.destination.sameDocument &&
        event.destination.url === candidate.capture.destinationHref
      )
        return;
      clear();
      if (
        event.navigationType !== 'traverse' ||
        !event.destination.sameDocument ||
        !event.destination.key ||
        event.signal.aborted
      )
        return;
      let destination: URL;
      try {
        destination = new URL(event.destination.url);
      } catch {
        return;
      }
      if (destination.origin !== options.origin) return;
      const capture = Object.freeze({
        provider: options.provider,
        source: options.source(),
        sourceRouteKey: options.sourceRouteKey(),
        destinationEntryKey: event.destination.key,
        destinationHref: event.destination.url,
        destinationRouteKey: routeKey(
          destination.pathname,
          destination.searchParams,
        ),
        destinationRelativeHref:
          destination.pathname + destination.search + destination.hash,
      });
      const preparation = options.prepare(capture);
      if (!preparation?.current()) return;
      const abort = () => {
        if (candidate !== next || committed) return;
        clear();
      };
      const next = Object.freeze({
        capture,
        preparation: Object.freeze(preparation),
        detach: () => event.signal.removeEventListener('abort', abort),
      });
      candidate = next;
      event.signal.addEventListener('abort', abort, { once: true });
      if (event.signal.aborted) abort();
    },
    committed() {
      if (!candidate) return;
      if (!matches(candidate)) {
        clear();
        return;
      }
      committed = true;
      candidate.detach();
    },
    pop() {
      if (!candidate) return false;
      if (!committed || !matches(candidate)) {
        clear();
        return false;
      }
      // Duplicate notifications for the same entry cannot re-arm or replace a
      // privacy ticket. Actual visible primary readiness remains authoritative.
      if (!consumed) {
        consumed = true;
        if (candidate.preparation.current()) candidate.preparation.history();
      }
      return true;
    },
    clear,
  };
}
