'use client';

import { createContext, useContext, useLayoutEffect } from 'react';
import {
  assignmentEpoch,
  readPrivacyRevocationRevision,
} from '@/features/scan/assign-batch';

import {
  safeDocumentTitle,
  safeRouteDocumentTitle,
} from './safe-route-document-title';
export { safeDocumentTitle } from './safe-route-document-title';
// Ownership only: never retain a document name outside its mounted controller.
let documentOwner: object | null = null;
type Grant = {
  navigation: string;
  binding: string;
  revocation: number;
  callbacks: number;
};
type Registration = { token: object; routePath: string; title: string };

/** One mounted privacy controller owns this memory; no names survive its lifetime. */
export function createPrivateDocumentTitleController() {
  let registration: Registration | null = null;
  let grant: Grant | null = null;
  const owner = {};
  let retired = true;
  let observer: MutationObserver | null = null;
  const apply = () => {
    if (retired || documentOwner !== owner) return;
    const liveGrant =
      grant &&
      grant.revocation === readPrivacyRevocationRevision() &&
      grant.callbacks === assignmentEpoch()
        ? grant
        : null;
    const allowed =
      liveGrant &&
      registration &&
      liveGrant.navigation.split('?')[0] === registration.routePath;
    const title = allowed
      ? registration!.title
      : liveGrant
        ? safeRouteDocumentTitle(liveGrant.navigation)
        : safeDocumentTitle;
    if (document.title !== title) document.title = title;
  };
  return {
    register(routePath: string, title: string) {
      const token = {};
      registration = { token, routePath, title };
      apply();
      return () => {
        if (registration?.token !== token) return;
        registration = null;
        if (!retired && documentOwner === owner)
          document.title = safeDocumentTitle;
        apply();
      };
    },
    accept(next: Grant | null) {
      grant = next;
      apply();
    },
    clear() {
      grant = null;
      apply();
    },
    mount() {
      retired = false;
      documentOwner = owner;
      observer = new MutationObserver((records) => {
        // Next may replace or update a safe title after this route slot commits.
        // Other head changes do not participate in document-title ownership.
        if (
          records.some(
            (record) =>
              record.target instanceof HTMLTitleElement ||
              record.target.parentNode instanceof HTMLTitleElement ||
              [...record.addedNodes, ...record.removedNodes].some(
                (node) => node instanceof HTMLTitleElement,
              ),
          )
        )
          apply();
      });
      observer.observe(document.head, {
        childList: true,
        subtree: true,
        characterData: true,
      });
      apply();
      return () => {
        grant = null;
        apply();
        retired = true;
        if (documentOwner === owner) documentOwner = null;
        observer?.disconnect();
        observer = null;
      };
    },
  };
}
export const PrivateDocumentTitleContext = createContext<ReturnType<
  typeof createPrivateDocumentTitleController
> | null>(null);

/** Server success slots supply their own route, never the retained client's pathname. */
export function PrivateDocumentTitle({
  routePath,
  title,
}: {
  routePath: string;
  title: string;
}) {
  const controller = useContext(PrivateDocumentTitleContext);
  useLayoutEffect(
    () => controller?.register(routePath, title),
    [controller, routePath, title],
  );
  return null;
}
