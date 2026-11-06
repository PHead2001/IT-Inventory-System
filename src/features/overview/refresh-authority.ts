'use client';

import { useContext, useInsertionEffect, useLayoutEffect, useRef } from 'react';
import { usePrivacyReadiness } from '@/components/auth/privacy-readiness';
import { freshPresentationGrant } from '@/components/experience/presentation-privacy';
import {
  useRouteActionResult,
  RoutePendingContext,
} from '@/components/experience/route-pending';
import {
  RoutePresentationLifetimeContext,
  RoutePresentationSourceContext,
} from '@/components/experience/route-presentation-source';
import {
  subscribeAuthoritativeCleanup,
  subscribeAssignmentInvalidation,
  subscribePrivacyRevocation,
} from '@/features/scan/assign-batch';

/** A read completion may update only the original, still verified mounted caller.
 * This is a callback fence, never a privacy owner or request cancellation. */
export function useOverviewRefreshAuthority() {
  const privacy = usePrivacyReadiness();
  const pending = useContext(RoutePendingContext);
  const lifetime = useContext(RoutePresentationLifetimeContext);
  const source = useContext(RoutePresentationSourceContext);
  const observe = useRouteActionResult();
  const mounted = useRef(false);
  const revision = useRef(0);
  const current = useRef({ privacy, pending, lifetime, source, observe });
  useInsertionEffect(() => {
    const old = current.current;
    if (
      old.privacy.generation !== privacy.generation ||
      old.privacy.ready !== privacy.ready ||
      old.privacy.visible !== privacy.visible ||
      old.privacy.cleanupRevision !== privacy.cleanupRevision ||
      old.privacy.revocationRevision !== privacy.revocationRevision ||
      old.privacy.verifiedEpoch !== privacy.verifiedEpoch ||
      old.pending !== pending ||
      old.lifetime !== lifetime ||
      old.source !== source ||
      old.observe !== observe
    ) {
      revision.current++;
      current.current = { privacy, pending, lifetime, source, observe };
    }
  });
  useLayoutEffect(() => {
    mounted.current = true;
    const retire = () => {
      revision.current++;
    };
    const revoke = subscribePrivacyRevocation(retire);
    const invalidate = subscribeAssignmentInvalidation(retire);
    const cleanup = subscribeAuthoritativeCleanup(retire);
    return () => {
      mounted.current = false;
      retire();
      revoke();
      invalidate();
      cleanup();
    };
  }, []);
  return {
    observe,
    capture() {
      const captured = current.current;
      const epoch = revision.current;
      const pendingEpoch = captured.pending?.state.snapshot().epoch;
      const admitted =
        mounted.current && freshPresentationGrant(captured.privacy);
      const localCurrent = () =>
        admitted &&
        mounted.current &&
        revision.current === epoch &&
        current.current === captured &&
        freshPresentationGrant(captured.privacy);
      return {
        current: () =>
          localCurrent() &&
          (!captured.pending || captured.pending.state.current(pendingEpoch!)),
        // Call only after this request passed current() before its own denial
        // observer. That observer retires the pending epoch synchronously; its
        // authoritative denial must still clear this caller's retained data.
        afterCurrentDenial: localCurrent,
      };
    },
  };
}
