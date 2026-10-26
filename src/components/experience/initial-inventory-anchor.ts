import { afterTransitionCapture } from '@/components/forms/transition-capture';
import { inventoryReturnPath } from '@/features/inventory/create-return';
import type { createRouteReadiness } from './route-readiness';
import { routeKey } from './route-key';

type Authority = { key: string; ready: boolean } | null;
type Attempt = { actorId: string; phase: 'waiting' | 'consumed' | 'cancelled' };
// A provider incarnation cannot manufacture another first-document attempt.
const documents = new WeakMap<Document, Attempt>();
const originalDocument =
  typeof document === 'undefined'
    ? undefined
    : { document, href: location.href };

/** One initial inventory fragment after private content arrives. This grants no
 * readiness, changes no history/focus, and never owns native traversal. */
export function createInitialInventoryAnchor(
  readiness: Pick<
    ReturnType<typeof createRouteReadiness>,
    'currentPrimary' | 'subscribePrimary'
  >,
  actorId: string,
  authority: () => Authority,
  sourceRow: (anchor: string, rawRouteKey: string) => HTMLElement | undefined,
) {
  let attempt: Attempt | undefined;
  let href: string | undefined;
  let anchor: string | undefined;
  let rawRouteKey: string | undefined;
  let boundAuthority: string | undefined;
  let detach: (() => void) | undefined;
  let scheduled: (() => void) | undefined;
  let disposed = false;
  let retired = false;
  const cancel = () => {
    retired = true;
    // Privacy/navigation can retire ownership in layout before passive attach.
    // Remember it for this document, including a later provider incarnation.
    if (
      !attempt &&
      originalDocument !== undefined &&
      originalDocument.document === document &&
      !documents.has(document)
    ) {
      attempt = { actorId, phase: 'cancelled' };
      documents.set(document, attempt);
    }
    if (attempt?.phase === 'waiting') attempt.phase = 'cancelled';
    scheduled?.();
    scheduled = undefined;
  };
  const current = () => {
    if (disposed || !detach || attempt?.phase !== 'waiting') return;
    if (attempt.actorId !== actorId || location.href !== href) {
      cancel();
      return;
    }
    const value = authority();
    if (boundAuthority !== undefined && value?.key !== boundAuthority) {
      cancel();
      return;
    }
    // A provisional privacy check can change generation before its first grant.
    // Once granted, any authority replacement (even not-ready/null) retires it.
    if (value?.ready) boundAuthority ??= value.key;
    return value?.ready ? value : undefined;
  };
  const reconcile = () => {
    const value = current();
    if (!value || !anchor || !rawRouteKey || scheduled) return;
    const primary = readiness.currentPrimary();
    if (
      !primary ||
      primary.actorId !== actorId ||
      primary.routeKey !== rawRouteKey
    )
      return;
    const row = sourceRow(anchor, rawRouteKey);
    // An admitted primary is terminal for a missing/ambiguous source. Never
    // guess an occurrence from a later unrelated render or arbitrary hash.
    if (!row || !primary.root.contains(row)) {
      cancel();
      return;
    }
    let active = true;
    let release = () => {};
    scheduled = () => {
      active = false;
      release();
    };
    queueMicrotask(() => {
      if (!active || attempt?.phase !== 'waiting') return;
      release = afterTransitionCapture(row.ownerDocument, () => {
        scheduled = undefined;
        if (!active || !current()) return;
        if (
          readiness.currentPrimary() !== primary ||
          sourceRow(anchor!, rawRouteKey!) !== row ||
          !primary.root.contains(row)
        ) {
          cancel();
          return;
        }
        const root = document.scrollingElement ?? document.documentElement;
        const margin =
          Number.parseFloat(getComputedStyle(row).scrollMarginTop) || 0;
        const padding =
          Number.parseFloat(
            getComputedStyle(document.documentElement).scrollPaddingTop,
          ) || 0;
        const expected = Math.min(
          Math.max(
            0,
            row.getBoundingClientRect().top + window.scrollY - margin - padding,
          ),
          Math.max(0, root.scrollHeight - innerHeight),
        );
        // Consume before scrolling: the resulting event cannot replay it.
        attempt!.phase = 'consumed';
        if (Math.abs(window.scrollY - expected) <= 1) return;
        try {
          window.scrollTo({
            left: window.scrollX,
            top: expected,
            behavior: 'instant',
          });
        } catch {
          // A failed presentation operation cannot retry or alter readiness.
        }
      });
    });
  };
  return {
    reconcile,
    invalidate: cancel,
    attach: () => {
      if (
        disposed ||
        retired ||
        detach ||
        !originalDocument ||
        originalDocument.document !== document ||
        documents.has(document)
      )
        return;
      attempt = { actorId, phase: 'cancelled' };
      documents.set(document, attempt);
      try {
        const navigation = performance.getEntriesByType('navigation')[0] as
          PerformanceNavigationTiming | undefined;
        if (
          !navigation ||
          !['navigate', 'reload'].includes(navigation.type) ||
          originalDocument.href !== location.href
        )
          return;
        const initial = new URL(originalDocument.href),
          entry = new URL(navigation.name);
        if (
          entry.origin !== initial.origin ||
          entry.pathname !== initial.pathname ||
          entry.search !== initial.search
        )
          return;
        const accepted = inventoryReturnPath(
          initial.pathname + initial.search + initial.hash,
          '',
        );
        if (
          !accepted ||
          !initial.hash ||
          new URL(accepted, initial.origin).hash !== initial.hash
        )
          return;
        href = initial.href;
        anchor = initial.hash.slice(1);
        rawRouteKey = routeKey(initial.pathname, initial.searchParams);
        attempt.phase = 'waiting';
      } catch {
        return;
      }
      const interrupt = () => cancel();
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
            'Tab',
          ].includes(event.key)
        )
          cancel();
      };
      const events = [
        'scroll',
        'wheel',
        'touchstart',
        'pointerdown',
        'mousedown',
        'popstate',
        'hashchange',
        'pagehide',
      ];
      for (const event of events)
        window.addEventListener(event, interrupt, { passive: true });
      window.addEventListener('keydown', keydown);
      const off = readiness.subscribePrimary(reconcile);
      let navigation: Navigation | undefined;
      try {
        navigation = window.navigation;
        navigation?.addEventListener('navigate', interrupt);
      } catch {
        /* Pop/hash and accepted application navigation still cancel. */
      }
      detach = () => {
        cancel();
        off();
        for (const event of events)
          window.removeEventListener(event, interrupt);
        window.removeEventListener('keydown', keydown);
        try {
          navigation?.removeEventListener('navigate', interrupt);
        } catch {}
        detach = undefined;
      };
      reconcile();
    },
    detach: () => detach?.(),
    dispose: () => {
      disposed = true;
      detach?.();
      cancel();
    },
  };
}
