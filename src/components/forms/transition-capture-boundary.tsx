'use client';

import { useCallback, type ReactNode } from 'react';
import { observeTransitionCapture } from './transition-capture';

const captureInertOwners = new WeakSet<HTMLElement>();

/** Only capture-owned interactivity may be ignored for snapshot geometry.
 * Privacy/hidden ancestors, including a previously inert fieldset, still block. */
export function hasBlockingPresentationAncestor(element: HTMLElement) {
  for (
    let node: HTMLElement | null = element;
    node;
    node = node.parentElement
  ) {
    if (
      node.hidden ||
      ((node.inert || node.hasAttribute('inert')) &&
        !captureInertOwners.has(node))
    )
      return true;
  }
  return false;
}

/** Owns only capture interactivity. Child controls retain domain disabled state. */
export function TransitionCaptureBoundary({
  children,
}: {
  children: ReactNode;
}) {
  const bind = useCallback((node: HTMLFieldSetElement | null) => {
    if (!node) return;
    let active = false;
    let previousInert = false;
    let focus: HTMLElement | null = null;
    const document = node.ownerDocument;
    const outsideIntent = (event: Event) => {
      if (
        active &&
        event.target instanceof Node &&
        !node.contains(event.target)
      )
        focus = null;
    };
    const navigation = () => {
      if (active) focus = null;
    };
    document.addEventListener('focusin', outsideIntent, true);
    document.addEventListener('pointerdown', outsideIntent, true);
    document.defaultView?.addEventListener('popstate', navigation);
    document.defaultView?.addEventListener('pagehide', navigation);
    const dispose = observeTransitionCapture(
      node.ownerDocument,
      (capturing) => {
        if (active === capturing) return;
        active = capturing;
        if (capturing) {
          previousInert = node.inert || node.hasAttribute('inert');
          if (!previousInert) captureInertOwners.add(node);
          const candidate = node.ownerDocument.activeElement;
          focus =
            candidate instanceof HTMLElement && node.contains(candidate)
              ? candidate
              : null;
        }
        node.disabled = capturing;
        if (!capturing) captureInertOwners.delete(node);
        node.inert = capturing || previousInert;
        if (capturing) node.setAttribute('aria-busy', 'true');
        else node.removeAttribute('aria-busy');
        if (!capturing) {
          const previous = focus;
          focus = null;
          if (
            previous?.isConnected &&
            node.contains(previous) &&
            node.ownerDocument.activeElement === node.ownerDocument.body &&
            !previous.closest('[inert], [hidden]') &&
            !previous.matches(':disabled') &&
            previous.getClientRects().length
          )
            previous.focus({ preventScroll: true });
        }
      },
    );
    return () => {
      dispose();
      document.removeEventListener('focusin', outsideIntent, true);
      document.removeEventListener('pointerdown', outsideIntent, true);
      document.defaultView?.removeEventListener('popstate', navigation);
      document.defaultView?.removeEventListener('pagehide', navigation);
      focus = null;
      node.disabled = false;
      captureInertOwners.delete(node);
      if (active) node.inert = previousInert;
      node.removeAttribute('aria-busy');
    };
  }, []);
  return (
    <fieldset ref={bind} style={{ display: 'contents' }}>
      {children}
    </fieldset>
  );
}
