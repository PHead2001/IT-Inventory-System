'use client';

import {
  useCallback,
  useInsertionEffect,
  useLayoutEffect,
  useRef,
  type RefObject,
} from 'react';
import { usePrivacyReadiness } from '@/components/auth/privacy-readiness';
import {
  subscribeAssignmentInvalidation,
  subscribePrivacyRevocation,
} from '@/features/scan/assign-batch';
import { freshPresentationGrant } from './presentation-privacy';

export function strictPresentationCurrent(
  privacy: ReturnType<typeof usePrivacyReadiness>,
  host: Element | null,
) {
  if (typeof document === 'undefined') return false;
  return (
    privacy.generation !== 'unmanaged' &&
    freshPresentationGrant(privacy) &&
    document.visibilityState !== 'hidden' &&
    !!host?.isConnected &&
    !host.closest('[hidden], [inert], details:not([open])')
  );
}

/** Motion-independent, mounted verification. Never borrow an outgoing route lease. */
export function useStrictPresentation(
  host: RefObject<Element | null>,
  identity: string,
  withdraw: () => void,
  changed?: () => void,
) {
  const privacy = usePrivacyReadiness();
  const originalIdentity = useRef(identity);
  const retired = useRef(false);
  const latest = useRef({ privacy, identity, withdraw, changed });
  const live = useRef(false);
  const current = useCallback(
    () =>
      live.current &&
      !retired.current &&
      strictPresentationCurrent(latest.current.privacy, host.current),
    [host],
  );
  useInsertionEffect(() => {
    const previous = latest.current;
    latest.current = { privacy, identity, withdraw, changed };
    if (identity !== originalIdentity.current) retired.current = true;
    if (
      retired.current ||
      previous.identity !== identity ||
      previous.privacy.generation !== privacy.generation ||
      previous.privacy.verifiedEpoch !== privacy.verifiedEpoch ||
      previous.privacy.revocationRevision !== privacy.revocationRevision ||
      !strictPresentationCurrent(privacy, host.current)
    )
      withdraw();
  }, [privacy, identity, withdraw, changed, host]);
  useLayoutEffect(() => {
    changed?.();
  });
  useLayoutEffect(() => {
    live.current = true;
    const reconcile = () => {
      observe();
      if (!current()) latest.current.withdraw();
      else latest.current.changed?.();
    };
    const observer = new MutationObserver(reconcile);
    let chain: Element[] = [];
    const observe = () => {
      const next: Element[] = [];
      for (let node = host.current; node; node = node.parentElement)
        next.push(node);
      if (
        chain.length === next.length &&
        chain.every((node, index) => node === next[index])
      )
        return;
      chain = next;
      observer.disconnect();
      chain.forEach((node, index) =>
        observer.observe(node, {
          attributes: true,
          attributeFilter: ['hidden', 'inert', 'open', 'data-motion'],
          childList: index > 0,
        }),
      );
    };
    const revoke = subscribePrivacyRevocation(() => latest.current.withdraw());
    const invalidate = subscribeAssignmentInvalidation(() =>
      latest.current.withdraw(),
    );
    document.addEventListener('visibilitychange', reconcile);
    observe();
    reconcile();
    return () => {
      live.current = false;
      observer.disconnect();
      revoke();
      invalidate();
      document.removeEventListener('visibilitychange', reconcile);
      latest.current.withdraw();
    };
  }, [current, host]);
  return current;
}
