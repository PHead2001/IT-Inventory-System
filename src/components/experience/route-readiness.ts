import { routeKey } from './route-key';
import type { RoutePendingState } from './route-pending';

export type ReadyContent = {
  actorId: string;
  routeKey: string;
  contentIdentity: string;
  root: HTMLElement;
};
export function createRouteReadiness(
  actorId: string,
  pending: RoutePendingState,
  committed: (key: string) => void,
) {
  const roots = new Map<symbol, ReadyContent>();
  let closed = false;
  let history: { epoch: number; finish: () => void } | undefined;
  const active = (content: ReadyContent) => {
    if (closed) return false;
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
  return {
    register: (content: ReadyContent) => {
      if (closed) return () => {};
      const token = Symbol();
      roots.set(token, content);
      acknowledge(content);
      return () => {
        roots.delete(token);
      };
    },
    history: () => {
      if (closed) return;
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
    close: () => {
      closed = true;
      history?.finish();
      history = undefined;
      roots.clear();
    },
  };
}
