'use client';
import { useLayoutEffect, useState, type RefObject } from 'react';
import { usePrivacyReadiness } from '@/components/auth/privacy-readiness';
import {
  subscribeAssignmentInvalidation,
  subscribePrivacyRevocation,
} from '@/features/scan/assign-batch';
import { useMotionReady } from './motion-ready';
import { strictPresentationCurrent } from './strict-presentation';
import { renderedPresentation } from './rendered-motion';

type Update = { animate: boolean; initial: boolean; current: () => boolean };
type Input = {
  host: Element | null;
  hydrated: boolean;
  privacy: ReturnType<typeof usePrivacyReadiness>;
  key: string;
  snapshotReady: boolean;
  owner?: object;
  update: (admission: Update) => (() => void) | undefined;
  reset: () => void;
};
function fullMotion() {
  return (
    document.documentElement.dataset.motion === 'full' &&
    typeof window.matchMedia === 'function' &&
    !window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}
function admitted(input: Input) {
  return (
    input.hydrated &&
    strictPresentationCurrent(input.privacy, input.host) &&
    renderedPresentation(input.host)
  );
}
/** Local presentation only: no storage, data authority, private DOM cache or idle RAF. */
function createAdmission() {
  let input: Input | undefined;
  let active = false;
  let accepted = false;
  let initialized = false;
  let reseed = false;
  let identity = '';
  let owner: object | undefined;
  let key = '';
  let deniedKey: string | undefined;
  let motion = false;
  let revision = 0;
  let cleanup: (() => void) | undefined;
  let observeHost: (() => void) | undefined;
  const cancel = () => {
    revision++;
    const stop = cleanup;
    cleanup = undefined;
    stop?.();
  };
  const withdraw = () => {
    cancel();
    if (!input) return;
    if (accepted || !reseed || deniedKey !== input.key) input.reset();
    deniedKey = input.key;
    accepted = false;
    reseed = true;
  };
  const reconcile = () => {
    if (!active || !input) return;
    observeHost?.();
    if (!input.host) {
      cancel();
      accepted = false;
      return;
    }
    if (!admitted(input)) {
      // Hydration's conservative server snapshot is not a hidden historical visit.
      if (input.hydrated) withdraw();
      return;
    }
    const nextIdentity = JSON.stringify([
      input.privacy.generation,
      input.privacy.revocationRevision,
      input.privacy.verifiedEpoch,
    ]);
    const replaced =
      initialized && (identity !== nextIdentity || owner !== input.owner);
    if (replaced) {
      cancel();
      input.reset();
      reseed = true;
    }
    const nextMotion = fullMotion();
    if (!input.snapshotReady) {
      cancel();
      accepted = false;
      identity = nextIdentity;
      owner = input.owner;
      return;
    }
    if (accepted && !replaced && key === input.key && motion === nextMotion)
      return;
    cancel();
    const initial = !initialized && !reseed;
    const animate = nextMotion && !reseed;
    accepted = true;
    initialized = true;
    identity = nextIdentity;
    owner = input.owner;
    key = input.key;
    motion = nextMotion;
    reseed = false;
    deniedKey = undefined;
    const token = revision;
    cleanup = input.update({
      animate,
      initial,
      current: () => {
        if (!active || token !== revision || !input) return false;
        if (!admitted(input)) {
          withdraw();
          return false;
        }
        if (!fullMotion()) {
          reconcile();
          return false;
        }
        return true;
      },
    });
  };
  return {
    configure(next: Input) {
      input = next;
      reconcile();
    },
    connect() {
      active = true;
      const observer = new MutationObserver(reconcile);
      let chain: Element[] = [];
      observeHost = () => {
        const ancestors: Element[] = [];
        for (let node = input?.host; node; node = node.parentElement)
          ancestors.push(node);
        if (
          ancestors.length === chain.length &&
          ancestors.every((node, index) => node === chain[index])
        )
          return;
        chain = ancestors;
        observer.disconnect();
        // Direct ancestor removals detect detachment; never observe descendant
        // text/children, including ticker writes, or unrelated document subtrees.
        chain.forEach((node, index) =>
          observer.observe(node, {
            attributes: true,
            attributeFilter: [
              'hidden',
              'inert',
              'open',
              'data-motion',
              'class',
              'style',
            ],
            childList: index > 0,
          }),
        );
        if (!chain.includes(document.documentElement))
          observer.observe(document.documentElement, {
            attributes: true,
            attributeFilter: ['data-motion'],
          });
      };
      observeHost();
      const media =
        typeof window.matchMedia === 'function'
          ? window.matchMedia('(prefers-reduced-motion: reduce)')
          : undefined;
      const revoke = subscribePrivacyRevocation(withdraw);
      const invalidate = subscribeAssignmentInvalidation(withdraw);
      document.addEventListener('visibilitychange', reconcile);
      window.addEventListener('resize', reconcile);
      media?.addEventListener('change', reconcile);
      reconcile();
      return () => {
        active = false;
        cancel();
        observer.disconnect();
        observeHost = undefined;
        revoke();
        invalidate();
        document.removeEventListener('visibilitychange', reconcile);
        window.removeEventListener('resize', reconcile);
        media?.removeEventListener('change', reconcile);
        // Effect reconnect alone preserves comparisons and receipt replay fences.
      };
    },
  };
}
export function usePresentationAdmission(
  host: RefObject<Element | null>,
  key: string,
  update: Input['update'],
  reset: Input['reset'],
  owner?: object,
  snapshotReady = true,
) {
  const privacy = usePrivacyReadiness();
  const hydrated = useMotionReady();
  const [controller] = useState(createAdmission);
  useLayoutEffect(() => {
    controller.configure({
      host: host.current,
      hydrated,
      privacy,
      key,
      update,
      reset,
      owner,
      snapshotReady,
    });
  });
  useLayoutEffect(() => controller.connect(), [controller]);
}
