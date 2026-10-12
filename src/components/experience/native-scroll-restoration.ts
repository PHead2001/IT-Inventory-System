import type { createRouteReadiness } from './route-readiness';

type Authority = { key: string; ready: boolean } | null;
type Entry = { key: string; url: string };
type Checkpoint = Entry & { authority: string; x: number; y: number };

/** Provider-local, ephemeral repair for privacy-gated native history restores.
 * Observation grants no readiness and never intercepts browser navigation. */
export function createNativeScrollRestoration(
  readiness: Pick<
    ReturnType<typeof createRouteReadiness>,
    'currentPrimary' | 'subscribePrimary'
  >,
  initialAuthority: () => Authority = () => null,
) {
  let authority = initialAuthority;
  const checkpoints = new Map<string, Checkpoint>();
  let owner: string | undefined;
  let associated: Entry | undefined;
  let pending: Checkpoint | undefined;
  let departing = false;
  let disposed = false;
  let listening = false;
  let incarnation = 0;
  let navigation: Navigation | undefined;
  let unbind: (() => void) | undefined;

  const clear = () => {
    checkpoints.clear();
    associated = undefined;
    pending = undefined;
    departing = false;
  };
  const grant = () => {
    const value = disposed || !listening ? null : authority();
    if (!value || value.key !== owner) {
      clear();
      owner = value?.key;
    }
    return value;
  };
  const exactURL = (href: string | null) => {
    if (!href) return undefined;
    try {
      const url = new URL(href, location.href);
      if (url.origin !== location.origin) return undefined;
      return url.pathname + url.search + url.hash;
    } catch {
      return undefined;
    }
  };
  const current = (): Entry | undefined => {
    try {
      const entry = navigation?.currentEntry;
      const url = exactURL(entry?.url ?? null);
      if (!entry?.key || !url || url !== exactURL(location.href)) return;
      return { key: entry.key, url };
    } catch {
      return undefined;
    }
  };
  const matches = (left: Entry | undefined, right: Entry | undefined) =>
    !!left && !!right && left.key === right.key && left.url === right.url;
  const capture = () => {
    const value = grant();
    if (!value?.ready || departing || pending || !readiness.currentPrimary())
      return;
    const entry = current();
    if (!entry || !matches(entry, associated)) return;
    const x = window.scrollX;
    const y = window.scrollY;
    if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 0) return;
    // Reinsert to keep the bounded map in last-observed order.
    checkpoints.delete(entry.key);
    checkpoints.set(entry.key, { ...entry, authority: value.key, x, y });
    if (checkpoints.size > 50)
      checkpoints.delete(checkpoints.keys().next().value!);
  };
  const reconcile = () => {
    const value = grant();
    if (!navigation || !value?.ready || !readiness.currentPrimary()) return;
    const entry = current();
    if (!entry) return;
    if (pending) {
      if (!matches(entry, pending) || pending.authority !== value.key) return;
      const checkpoint = pending;
      // Consume before scrollTo: its scroll event cannot replay this restore.
      pending = undefined;
      departing = false;
      associated = entry;
      try {
        window.scrollTo({
          left: checkpoint.x,
          top: checkpoint.y,
          behavior: 'instant',
        });
      } catch {
        // Restoration failure cannot interrupt canonical readiness or retry.
      }
      return;
    }
    associated = entry;
    departing = false;
    capture();
  };
  const navigate = (raw: Event) => {
    const value = grant();
    if (!value || disposed) return;
    const event = raw as NavigateEvent;
    const url = exactURL(event.destination?.url ?? null);
    const entry = current();
    // Next updates its own state with a same-entry, same-URL replace after
    // traversal. URL coincidence on another entry cannot preserve the token.
    if (
      pending &&
      event.navigationType === 'replace' &&
      matches(entry, pending) &&
      url === pending.url
    )
      return;
    capture();
    pending = undefined;
    departing = true;
    if (event.navigationType !== 'traverse' || !url) return;
    const saved = checkpoints.get(event.destination.key);
    if (saved?.url === url && saved.authority === value.key)
      pending = { ...saved };
  };
  const entryChanged = () => {
    if (disposed || !listening) return;
    grant();
    // Destination admission comes from a real readiness/privacy notification,
    // after the browser changes entries, rather than from its history event.
    if (!pending) reconcile();
  };
  const interrupt = () => {
    if (disposed || !listening || !pending) return;
    pending = undefined;
    associated = undefined;
    departing = true;
  };
  const keydown = (event: KeyboardEvent) => {
    if (
      [
        'ArrowUp',
        'ArrowDown',
        'ArrowLeft',
        'ArrowRight',
        'PageUp',
        'PageDown',
        'Home',
        'End',
        ' ',
        'Spacebar',
      ].includes(event.key)
    )
      interrupt();
  };
  const attach = () => {
    if (disposed || unbind) return;
    const session = ++incarnation;
    const removals: Array<() => void> = [];
    const cleanup = () => {
      for (const remove of removals.splice(0)) {
        try {
          remove();
        } catch {
          // Callback incarnation checks survive failed observer cleanup.
        }
      }
    };
    const observe = (callback: (event: Event) => void) => (event: Event) => {
      if (session === incarnation && listening && !disposed) callback(event);
    };
    try {
      const candidate = window.navigation;
      if (
        !candidate?.currentEntry?.key ||
        typeof candidate.addEventListener !== 'function' ||
        typeof candidate.removeEventListener !== 'function'
      )
        return;
      navigation = candidate;
      listening = true;
      for (const [type, callback] of [
        ['navigate', navigate],
        ['currententrychange', entryChanged],
      ] as const) {
        const listener = observe(callback);
        removals.push(() => candidate.removeEventListener(type, listener));
        candidate.addEventListener(type, listener);
      }
      for (const [type, callback] of [
        ['scroll', capture],
        ['wheel', interrupt],
        ['touchstart', interrupt],
        ['keydown', (event: Event) => keydown(event as KeyboardEvent)],
      ] as const) {
        const listener = observe(callback);
        removals.push(() => window.removeEventListener(type, listener));
        window.addEventListener(type, listener, { passive: true });
      }
      removals.push(
        readiness.subscribePrimary(() => {
          if (session === incarnation && listening && !disposed) reconcile();
        }),
      );
      unbind = cleanup;
      reconcile();
    } catch {
      // Partial/failed support leaves ordinary browser restoration in charge.
      listening = false;
      cleanup();
      unbind = undefined;
      navigation = undefined;
      clear();
    }
  };
  const detach = () => {
    listening = false;
    incarnation++;
    try {
      unbind?.();
    } catch {
      // Callback guards still retire a failed native observer cleanup.
    }
    unbind = undefined;
    clear();
    navigation = undefined;
  };
  return {
    bindAuthority: (read: () => Authority) => {
      authority = read;
    },
    attach,
    detach,
    reconcile,
    invalidate: () => {
      clear();
      owner = undefined;
    },
    dispose: () => {
      disposed = true;
      detach();
    },
  };
}
