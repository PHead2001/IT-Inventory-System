import {
  freshLocationBrowserState,
  locationBrowserHref,
  parseLocationBrowserState,
  type LocationBrowserState,
} from './location-browser-state';
import type { LocationRef } from '@/features/inventory/contracts-ui';

/** One bounded UI draft and debounce; never an authorization/readiness owner. */
export function createLocationBrowserNavigation(
  initial: LocationBrowserState,
  initialLocations: LocationRef[],
  locations: () => LocationRef[],
  emit: (state: LocationBrowserState) => void,
  replace: (href: string) => void,
  valid: () => boolean,
  rejected: (limited: boolean) => void = () => {},
) {
  let draft = freshLocationBrowserState(initial, initialLocations),
    timer: ReturnType<typeof setTimeout> | undefined,
    revision = 0,
    active = true;
  let requested: { href: string; revision: number } | null = null;
  let writable = valid;
  let unsent = false;
  const cancel = () => {
    revision++;
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
  };
  const write = () => {
    if (!active || !valid() || !writable() || !unsent) return;
    const href = locationBrowserHref(draft);
    requested = { href, revision };
    unsent = false;
    replace(href);
  };
  return {
    /** Commit the latest callbacks after render; no render-time ref reads. */
    bind: (next: {
      locations: () => LocationRef[];
      replace: (href: string) => void;
      valid: () => boolean;
      writable?: () => boolean;
    }) => {
      locations = next.locations;
      replace = next.replace;
      valid = next.valid;
      writable = next.writable ?? next.valid;
    },
    snapshot: () => draft,
    activate: () => {
      active = true;
    },
    /** Fresh admission can send a retained draft after its debounce expired. */
    resumeWrites: () => {
      if (timer === undefined) write();
    },
    refresh: () => {
      const fresh = freshLocationBrowserState(draft, locations());
      if (locationBrowserHref(fresh) !== locationBrowserHref(draft)) {
        draft = fresh;
        emit(draft);
      }
    },
    change: (patch: Partial<LocationBrowserState>, search = false) => {
      if (!active || !valid()) return;
      const candidate = parseLocationBrowserState(
        new URL(
          locationBrowserHref({ ...draft, ...patch }),
          'https://inventory.invalid',
        ).searchParams,
        locations(),
      );
      if (!candidate) {
        rejected(true);
        return;
      }
      rejected(false);
      cancel();
      draft = candidate;
      unsent = true;
      emit(draft);
      if (search) {
        const ticket = revision;
        timer = setTimeout(() => {
          timer = undefined;
          if (ticket === revision) write();
        }, 300);
      } else write();
    },
    reconcile: (state: LocationBrowserState, key: string) => {
      const canonical = locationBrowserHref(state);
      if (active && (timer !== undefined || unsent)) {
        draft = freshLocationBrowserState(draft, locations());
        emit(draft);
        return;
      }
      if (
        active &&
        requested &&
        requested.href !== key &&
        requested.href !== canonical
      ) {
        draft = freshLocationBrowserState(draft, locations());
        emit(draft);
        return;
      }
      if (active && requested && requested.revision !== revision) {
        draft = freshLocationBrowserState(draft, locations());
        emit(draft);
        return;
      }
      cancel();
      requested = null;
      unsent = false;
      draft = freshLocationBrowserState(state, locations());
      emit(draft);
    },
    /** Passive native history may be canceled or change only a hash. Cancel
     * pending writes without withdrawing the still-current browser controls. */
    cancelPending: () => {
      cancel();
      requested = null;
      unsent = false;
    },
    leave: () => {
      cancel();
      requested = null;
      unsent = false;
      active = false;
    },
    close: () => {
      cancel();
      requested = null;
      unsent = false;
      active = false;
    },
  };
}
