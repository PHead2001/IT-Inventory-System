export type PresentationDenialTicket = Readonly<{
  current: () => boolean;
  release: () => void;
}>;
export type PresentationExitDescriptor = Readonly<object>;
type Source = {
  token: symbol;
  mounted: boolean;
  retired: boolean;
  departing: boolean;
  tickets: number;
  lease: symbol | null;
};

/** No DOM/content cache. Business-owner retirement is distinct from the exact
 * outgoing snapshot lifetime that React supplies through onExit cleanup. */
export function createRoutePresentationLifetime() {
  const sources = new Map<symbol, Source>();
  const exits = new WeakMap<
    PresentationExitDescriptor,
    () => (() => void) | undefined
  >();
  let active: Source | null = null;
  let departing: Source | null = null;
  const fresh = (token: symbol): Source => ({
    token,
    mounted: true,
    retired: false,
    departing: false,
    tickets: 0,
    lease: null,
  });
  const retire = (source: Source) => {
    source.retired = true;
    source.lease = null;
    if (sources.get(source.token) === source) sources.delete(source.token);
    if (departing === source) departing = null;
  };
  const renew = (source: Source) => {
    const mounted = active === source && source.mounted;
    retire(source);
    if (mounted) {
      active = fresh(source.token);
      sources.set(source.token, active);
    }
  };
  const invalidate = () => {
    const mounted = active?.mounted ? active.token : null;
    sources.forEach(retire);
    active = null;
    departing = null;
    // Retained accepted content need not remount during privacy recovery. New
    // authorized work may capture it again; old callbacks/tickets stay retired.
    if (mounted) {
      active = fresh(mounted);
      sources.set(mounted, active);
    }
  };
  return {
    mount(token: symbol) {
      const source = fresh(token);
      sources.set(token, source);
      active = source;
      return () => {
        const mounted = sources.get(token) ?? source;
        mounted.mounted = false;
        if (active === mounted) active = null;
        if (mounted.retired || mounted.tickets === 0) retire(mounted);
        else {
          // Dormant until this exact source's committed native exit callback.
          // React cleanup alone never authorizes a denial or starts a grace time.
          if (departing && departing !== mounted) retire(departing);
          departing = mounted;
        }
      };
    },
    navigation() {
      const current = active;
      sources.forEach((source) => {
        if (source.departing || source !== active) retire(source);
        else source.departing = true;
      });
      if (current?.retired && current.mounted) {
        active = fresh(current.token);
        active.departing = true;
        sources.set(current.token, active);
      }
    },
    capture(
      token: symbol,
      ownerCurrent: () => boolean,
      grantCurrent: () => boolean,
    ) {
      const source = sources.get(token);
      if (
        !source ||
        source !== active ||
        !source.mounted ||
        source.retired ||
        !ownerCurrent() ||
        !grantCurrent()
      )
        return undefined;
      source.tickets += 1;
      let released = false;
      return Object.freeze({
        current: () =>
          !released &&
          !source.retired &&
          grantCurrent() &&
          ((source === active && source.mounted && ownerCurrent()) ||
            source.lease !== null),
        release: () => {
          if (released) return;
          released = true;
          source.tickets -= 1;
          if (!source.mounted && source.tickets === 0) retire(source);
        },
      });
    },
    exitCallback(token: symbol) {
      // Captured by a committed layout effect, before cleanup. A later native
      // callback cannot borrow a renewed source with the same mounted token.
      const source = sources.get(token);
      return () => {
        if (
          !source ||
          source.retired ||
          sources.get(token) !== source ||
          source.tickets === 0 ||
          source.lease ||
          (!source.mounted && departing !== source)
        )
          return undefined;
        const lease = Symbol();
        source.departing = true;
        source.lease = lease;
        // React 19.3 invokes this return value through the matching native
        // transition.finished.finally, including rejection/cancellation.
        return () => {
          if (source.lease === lease) renew(source);
        };
      };
    },
    bindExit(descriptor: PresentationExitDescriptor, token: symbol) {
      if (!exits.has(descriptor))
        exits.set(descriptor, this.exitCallback(token));
    },
    handoff(descriptor: PresentationExitDescriptor) {
      return exits.get(descriptor)?.();
    },
    invalidate,
  };
}
