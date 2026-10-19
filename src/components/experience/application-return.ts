import { afterTransitionCapture } from '@/components/forms/transition-capture';
import { hasBlockingPresentationAncestor } from '@/components/forms/transition-capture-boundary';
import { recordDetailReturnPath } from '@/features/inventory/detail-return';
import type { createRouteReadiness } from './route-readiness';
import {
  samePresentationTarget,
  sameTitleSource,
  matchesTitleListRoute,
  type PresentationTarget,
  type TitleTarget,
} from './route-motion-state';
import { routeKey } from './route-key';

type Authority = { key: string; ready: boolean } | null;
type Source = Extract<TitleTarget, { source: { kind: 'inventory' } }>;
type Pending = {
  source: Source;
  authority: string;
  href: string;
  fromKey: string;
};

/** Repair a consumed application Back hash after its authorized primary reveals.
 * Native history owns its own restoration; this never changes focus or history. */
export function createApplicationReturn(
  readiness: Pick<
    ReturnType<typeof createRouteReadiness>,
    'currentPrimary' | 'subscribePrimary'
  >,
) {
  const sources = new Map<symbol, { target: Source; element: HTMLElement }>();
  let authority: () => Authority = () => null;
  let owner: string | undefined;
  let origin: Source | undefined;
  let pending: Pending | undefined;
  let scheduled: (() => void) | undefined;
  let stopAbort: (() => void) | undefined;
  let transaction:
    | {
        token: symbol;
        href: string;
        epoch: number;
        stage?: { kind: 'forward' | 'back'; source: Source };
      }
    | undefined;
  let disposed = false;
  let detach: (() => void) | undefined;
  const cancel = () => {
    pending = undefined;
    scheduled?.();
    scheduled = undefined;
    stopAbort?.();
    stopAbort = undefined;
  };
  const invalidate = () => {
    cancel();
    origin = undefined;
    transaction = undefined;
  };
  const grant = () => {
    const value = disposed ? null : authority();
    if (!value || value.key !== owner) {
      invalidate();
      owner = value?.key;
    }
    return value;
  };
  const exact = (href: string) => {
    try {
      const url = new URL(href, location.href);
      if (url.origin === location.origin)
        return routeKey(url.pathname, url.searchParams) + url.hash;
    } catch {
      // Unsupported destinations retain ordinary navigation.
    }
  };
  const returnHref = (source: Source) => source.listHref + '#' + source.anchor;
  const visibleSource = (source: Source) => {
    const primary = readiness.currentPrimary();
    if (
      !primary ||
      !matchesTitleListRoute(source, primary.routeKey) ||
      document.querySelectorAll(`[id="${source.anchor}"]`).length !== 1
    )
      return;
    const matches = [...sources.values()].filter(
      ({ target, element }) =>
        target.anchor === source.anchor &&
        target.listHref === source.listHref &&
        sameTitleSource(target, source) &&
        primary.root.contains(element) &&
        element.isConnected &&
        !hasBlockingPresentationAncestor(element) &&
        element.getClientRects().length > 0 &&
        getComputedStyle(element).visibility !== 'hidden',
    );
    return matches.length === 1 ? matches[0].element : undefined;
  };
  const reconcile = () => {
    const value = grant();
    const operation = pending;
    if (!operation || !value?.ready || operation.authority !== value.key)
      return;
    if (exact(location.href) !== operation.href) return;
    const primary = readiness.currentPrimary();
    if (!primary || primary.routeKey !== operation.source.listHref) return;
    // Once this exact primary is admitted, missing/changed/ambiguous rows are
    // terminal. A later unrelated render must not guess an original occurrence.
    const element = visibleSource(operation.source);
    if (!element) {
      cancel();
      return;
    }
    if (scheduled) return;
    const apply = () => {
      scheduled = undefined;
      const current = grant();
      if (pending !== operation) return;
      if (
        exact(location.href) !== operation.href ||
        visibleSource(operation.source) !== element
      ) {
        cancel();
        return;
      }
      // A temporary same-authority verification pause can resume on the next
      // readiness notification; a changed source or URL can never resume.
      if (!current?.ready || current.key !== operation.authority) return;
      // Consume before scrolling; notifications and scroll events cannot replay.
      pending = undefined;
      stopAbort?.();
      stopAbort = undefined;
      try {
        element
          .closest<HTMLElement>(`[id="${operation.source.anchor}"]`)
          ?.scrollIntoView({
            block: 'start',
            inline: 'nearest',
            behavior: 'instant',
          });
      } catch {
        // Presentation repair must not interrupt readiness or retry a scroll.
      }
    };
    const release = afterTransitionCapture(element.ownerDocument, apply);
    if (pending === operation) scheduled = release;
  };
  return {
    bindAuthority: (read: () => Authority) => {
      authority = read;
    },
    registerSource: (target: TitleTarget, element: HTMLElement) => {
      if (target.source.kind !== 'inventory' || disposed) return () => {};
      const token = Symbol();
      sources.set(token, { target: target as Source, element });
      // Canonical readiness registers only after all child layout effects.
      return () => {
        sources.delete(token);
      };
    },
    beginNavigation: (href: string, epoch: number) => {
      if (!grant()?.ready) return () => {};
      const token = Symbol();
      transaction = { token, href, epoch };
      return () => {
        if (transaction?.token === token) transaction = undefined;
      };
    },
    stageForward: (target: TitleTarget) => {
      const value = grant();
      if (
        transaction &&
        value?.ready &&
        target.source.kind === 'inventory' &&
        visibleSource(target as Source)
      )
        transaction.stage = { kind: 'forward', source: target as Source };
    },
    stageBack: (record: PresentationTarget, href: string) => {
      const value = grant();
      if (
        transaction &&
        value?.ready &&
        origin &&
        samePresentationTarget(origin, record) &&
        location.pathname === origin.detailPath &&
        exact(href) === returnHref(origin)
      )
        transaction.stage = { kind: 'back', source: origin };
    },
    acceptNavigation: (href: string, epoch: number) => {
      const value = grant();
      const accepted = transaction;
      transaction = undefined;
      cancel();
      if (
        !value?.ready ||
        accepted?.href !== href ||
        accepted.epoch !== epoch ||
        !accepted.stage
      ) {
        origin = undefined;
        return;
      }
      const { kind, source } = accepted.stage;
      if (kind === 'back') {
        pending = {
          source,
          authority: value.key,
          href: returnHref(source),
          fromKey: routeKey(
            location.pathname,
            new URLSearchParams(location.search),
          ),
        };
        return;
      }
      origin = undefined;
      try {
        const destination = new URL(href, location.href);
        if (
          destination.origin === location.origin &&
          destination.pathname === source.detailPath &&
          recordDetailReturnPath(destination.searchParams.get('returnTo')) ===
            returnHref(source) &&
          visibleSource(source)
        )
          origin = structuredClone(source);
      } catch {
        // Malformed links retain ordinary navigation without a return owner.
      }
    },
    reconcile,
    routeChanged: (key: string) => {
      if (pending && key !== pending.fromKey && key !== pending.source.listHref)
        cancel();
    },
    invalidate,
    cancel,
    attach: () => {
      if (detach || disposed) return;
      const interrupt = () => cancel();
      const keydown = (event: KeyboardEvent) => {
        if (
          [
            'ArrowUp',
            'ArrowDown',
            'PageUp',
            'PageDown',
            'Home',
            'End',
            ' ',
            'Tab',
          ].includes(event.key)
        )
          cancel();
      };
      const off = readiness.subscribePrimary(reconcile);
      let navigation: Navigation | undefined;
      const navigate = (raw: Event) => {
        const operation = pending;
        if (!operation) return;
        const event = raw as NavigateEvent;
        if (
          event.navigationType === 'traverse' ||
          event.destination?.sameDocument !== true ||
          exact(event.destination.url) !== operation.href
        ) {
          cancel();
          return;
        }
        stopAbort?.();
        const abort = () => {
          if (pending === operation) cancel();
        };
        if (
          typeof event.signal?.addEventListener === 'function' &&
          typeof event.signal.removeEventListener === 'function'
        ) {
          event.signal.addEventListener('abort', abort, { once: true });
          stopAbort = () => event.signal.removeEventListener('abort', abort);
          if (event.signal.aborted) abort();
        }
      };
      try {
        const candidate = window.navigation;
        if (
          typeof candidate?.addEventListener === 'function' &&
          typeof candidate.removeEventListener === 'function'
        ) {
          navigation = candidate;
          navigation.addEventListener('navigate', navigate);
        }
      } catch {
        // Ordinary accepted-Link and popstate cancellation remain available.
      }
      for (const type of [
        'wheel',
        'touchstart',
        'pointerdown',
        'mousedown',
        'popstate',
      ])
        window.addEventListener(type, interrupt, { passive: true });
      window.addEventListener('keydown', keydown);
      detach = () => {
        off();
        try {
          navigation?.removeEventListener('navigate', navigate);
        } catch {
          // Invalidated ownership still fences an observer whose removal fails.
        }
        for (const type of [
          'wheel',
          'touchstart',
          'pointerdown',
          'mousedown',
          'popstate',
        ])
          window.removeEventListener(type, interrupt);
        window.removeEventListener('keydown', keydown);
        detach = undefined;
        invalidate();
      };
    },
    detach: () => detach?.(),
    dispose: () => {
      disposed = true;
      detach?.();
      invalidate();
      sources.clear();
    },
  };
}
