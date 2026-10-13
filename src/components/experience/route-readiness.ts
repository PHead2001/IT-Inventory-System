import { routeKey, canonicalRecordPath } from './route-key';
import type { RoutePendingState } from './route-pending';

export type ReadyContent = {
  actorId: string;
  routeKey: string;
  contentIdentity: string;
  root: HTMLElement;
  consumedTask?: { sourceKey: string; destinationKey: string };
};
export function createRouteReadiness(
  actorId: string,
  pending: RoutePendingState,
  committed: (key: string) => void,
) {
  const roots = new Map<symbol, ReadyContent>();
  const listeners = new Set<() => void>();
  const notify = () => {
    for (const listener of listeners) listener();
  };
  let closed = false;
  let suspended = false;
  let history: { epoch: number; finish: () => void } | undefined;
  const active = (content: ReadyContent) => {
    if (closed || suspended) return false;
    if (
      content.actorId !== actorId ||
      !content.contentIdentity ||
      !content.root.isConnected ||
      content.root.closest('[hidden], [inert]')
    )
      return false;
    if (
      content.routeKey !==
      routeKey(location.pathname, new URLSearchParams(location.search))
    )
      return false;
    // The root uses display:contents. A real revealed descendant supplies the
    // geometry; React Activity's display:none ancestors have no client rects.
    return Array.from(content.root.children).some(
      (child) =>
        child.getClientRects().length > 0 &&
        getComputedStyle(child).visibility !== 'hidden',
    );
  };
  const acknowledge = (content: ReadyContent) => {
    if (!active(content)) return;
    committed(content.routeKey);
    if (history && pending.current(history.epoch)) history.finish();
    history = undefined;
  };
  const primary = () => {
    for (const content of roots.values()) {
      if (active(content)) return content;
    }
    return null;
  };
  return {
    // Read-only observation reuses the canonical readiness checks. It never
    // acknowledges a commit or settles another owner's pending registration.
    currentPrimary: primary,
    subscribePrimary: (listener: () => void) => {
      if (closed) return () => {};
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    consumeTask(
      root: HTMLElement,
      sourceKey: string,
      recordPath: string,
      task: string,
      apply: (href: string) => void,
    ) {
      const content = Array.from(roots.values()).find(
        (value) => value.root === root && value.routeKey === sourceKey,
      );
      if (!content || primary() !== content) return null;
      const url = new URL(location.href);
      if (
        canonicalRecordPath(url.pathname) !== canonicalRecordPath(recordPath) ||
        url.searchParams.getAll('task').length !== 1 ||
        url.searchParams.get('task') !== task
      )
        return null;
      url.searchParams.delete('task');
      const destinationKey = routeKey(url.pathname, url.searchParams);
      try {
        apply(url.pathname + url.search + url.hash);
      } catch {
        return null;
      }
      if (location.href !== url.href) return null;
      content.routeKey = destinationKey;
      content.consumedTask = { sourceKey, destinationKey };
      // Same mounted primary, explicit query handoff. No new readiness receipt,
      // history settlement, navigation intent or authorization is fabricated.
      notify();
      return content.consumedTask;
    },
    register: (content: ReadyContent) => {
      if (closed) return () => {};
      const token = Symbol();
      roots.set(token, content);
      acknowledge(content);
      notify();
      return () => {
        roots.delete(token);
        notify();
      };
    },
    history: () => {
      if (closed || suspended) return;
      history?.finish();
      history = { epoch: pending.snapshot().epoch, finish: pending.register() };
      for (const content of roots.values()) {
        if (active(content)) {
          acknowledge(content);
          break;
        }
      }
    },
    cancel: () => {
      history?.finish();
      history = undefined;
    },
    suspend: () => {
      suspended = true;
      history?.finish();
      history = undefined;
      notify();
    },
    resume: () => {
      if (!closed) suspended = false;
      notify();
    },
    close: (publish = true) => {
      closed = true;
      history?.finish();
      history = undefined;
      roots.clear();
      if (publish) notify();
      listeners.clear();
    },
  };
}
