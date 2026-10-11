'use client';
import {
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { flushSync } from 'react-dom';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import {
  readLogoutPrivacyGeneration,
  readProtectedPrivacyIdentity,
} from '@/lib/auth/actions';
import {
  protectedBindingKey,
  type ProtectedPrivacyBinding,
} from '@/lib/auth/protected-binding';
import {
  assignmentEpoch,
  readPrivacyRevocationRevision,
  revokePrivatePresentation,
  subscribePrivacyRevocation,
  subscribeAssignmentInvalidation,
} from '@/features/scan/assign-batch';
import type {
  LogoutPrivacyGeneration,
  LogoutPrivacyReceipt,
} from '@/lib/auth/privacy-barrier';
import {
  cleanupIssue,
  reminderIssue,
  verifyTabPrivacy,
} from './privacy-cleanup';
import {
  PrivacyReadinessContext,
  useAuthoritativeCleanupRevision,
  usePrivacyRevocationRevision,
  useAssignmentInvalidationRevision,
} from './privacy-readiness';
import { AcceptedPrivacyContent } from './privacy-content';
import {
  createPrivateDocumentTitleController,
  PrivateDocumentTitleContext,
} from './private-document-title';

export function CleanupStatus({
  issue,
  retry,
  retainedOwner = false,
  retryLabel = 'Retry privacy cleanup',
}: {
  issue: string;
  retry: () => void;
  retainedOwner?: boolean;
  retryLabel?: string;
}) {
  return (
    <div className="space-y-5">
      <p role={issue ? 'alert' : 'status'}>
        {issue || 'Clearing private data from this tab…'}
      </p>
      {issue && (
        <Button type="button" onClick={retry}>
          {retryLabel}
        </Button>
      )}
      {retainedOwner && (
        <p>
          Restore this workspace’s original account access and retry. Keep this
          page open if an outcome is still unknown. You can{' '}
          <a
            href="/inventory"
            target="_blank"
            rel="noopener noreferrer"
            className="underline"
          >
            open Inventory in a new tab
          </a>{' '}
          to use the current account without replacing this page’s recovery.
        </p>
      )}
    </div>
  );
}

type BoundaryProps = {
  children: ReactNode | ((generation: string) => ReactNode);
  revision?: unknown;
  serverGeneration?: LogoutPrivacyGeneration;
};
/** Suspense supports query-aware readiness on otherwise static Auth routes. */
export function AuthPrivacyBoundary(props: BoundaryProps) {
  return (
    <Suspense fallback={<p role="status">Checking this tab’s private data…</p>}>
      <PrivacyController {...props} />
    </Suspense>
  );
}
/** Always pass the opaque server route slot through so its status can settle. */
export function ProtectedPrivacyBoundary(
  props: Omit<BoundaryProps, 'children'> & {
    children: ReactNode;
    binding: ProtectedPrivacyBinding;
  },
) {
  return <PrivacyController {...props} protectedRoute />;
}

function PrivacyController({
  children,
  revision = 0,
  serverGeneration,
  protectedRoute = false,
  binding,
}: BoundaryProps & {
  protectedRoute?: boolean;
  binding?: ProtectedPrivacyBinding;
}) {
  const pathname = usePathname() ?? '';
  const cleanupRevision = useAuthoritativeCleanupRevision();
  const revocationRevision = usePrivacyRevocationRevision();
  const callbackRevision = useAssignmentInvalidationRevision();
  const [titles] = useState(createPrivateDocumentTitleController);
  useLayoutEffect(() => {
    if (!protectedRoute) return;
    const retire = titles.mount();
    const revoke = subscribePrivacyRevocation(titles.clear);
    const invalidate = subscribeAssignmentInvalidation(titles.clear);
    return () => {
      revoke();
      invalidate();
      retire();
    };
  }, [titles, protectedRoute]);
  const [ownerBinding] = useState(binding);
  const [ownerAuthority] = useState(() => ({
    epoch: readPrivacyRevocationRevision(),
    callbacks: assignmentEpoch(),
  }));
  const bindingMatches =
    !protectedRoute ||
    (binding !== undefined &&
      ownerBinding !== undefined &&
      protectedBindingKey(binding) === protectedBindingKey(ownerBinding));
  const bindingRevision = binding ? protectedBindingKey(binding) : '';
  const query = useSearchParams()?.toString() ?? '';
  const serverRevision =
    serverGeneration?.status === 'valid'
      ? serverGeneration.generation
      : serverGeneration?.status;
  const key = useMemo(
    () => ({
      navigation: pathname + '?' + query,
      serverRevision,
      revision,
      bindingRevision,
    }),
    [pathname, query, serverRevision, revision, bindingRevision],
  );
  const [state, setState] = useState<{
    ready: boolean;
    checking: boolean;
    uncertain: boolean;
    generation: string;
    issue: string;
    key: typeof key | null;
    acceptedRevocation: number | null;
    acceptedServerRevision: typeof serverRevision;
    acceptedCallbackRevision: number;
  }>({
    ready: false,
    checking: false,
    uncertain: false,
    generation: '',
    issue: '',
    key: null,
    acceptedRevocation: null,
    acceptedServerRevision: undefined,
    acceptedCallbackRevision: assignmentEpoch(),
  });
  const stateRef = useRef(state);
  useLayoutEffect(() => {
    stateRef.current = state;
  }, [state]);
  const serverUncertain =
    serverGeneration !== undefined &&
    (serverGeneration.status === 'invalid' ||
      serverGeneration.status === 'unavailable' ||
      (serverGeneration.status === 'absent' &&
        state.acceptedRevocation !== null &&
        state.acceptedServerRevision !== undefined &&
        state.acceptedServerRevision !== 'absent'));
  const inFlight = useRef<{
    key: typeof key;
    epoch: number;
    callbacks: number;
  } | null>(null);
  const handledInvalidation = useRef({
    epoch: revocationRevision,
    callbacks: callbackRevision,
  });
  const request = useRef(0);
  const mounted = useRef(false);
  const cancel = useCallback(() => {
    mounted.current = false;
    request.current++;
  }, []);
  const retry = useCallback(async () => {
    const epoch = readPrivacyRevocationRevision();
    const callbacks = assignmentEpoch();
    if (
      inFlight.current?.key === key &&
      inFlight.current.epoch === epoch &&
      inFlight.current.callbacks === callbacks
    )
      return;
    handledInvalidation.current = { epoch, callbacks };
    const operation = { key, epoch, callbacks };
    inFlight.current = operation;
    const attempt = ++request.current;
    const active = () =>
      mounted.current &&
      request.current === attempt &&
      readPrivacyRevocationRevision() === operation.epoch &&
      assignmentEpoch() === operation.callbacks;
    let needsIdentity =
      protectedRoute &&
      (stateRef.current.uncertain ||
        (stateRef.current.acceptedRevocation ?? ownerAuthority.epoch) !==
          epoch ||
        (stateRef.current.acceptedRevocation === null
          ? ownerAuthority.callbacks
          : stateRef.current.acceptedCallbackRevision) !== callbacks ||
        !bindingMatches);
    const revoke = () => {
      if (stateRef.current.acceptedRevocation === null) return;
      if (
        readPrivacyRevocationRevision() === stateRef.current.acceptedRevocation
      )
        revokePrivatePresentation();
      operation.epoch = readPrivacyRevocationRevision();
      operation.callbacks = assignmentEpoch();
      handledInvalidation.current = {
        epoch: operation.epoch,
        callbacks: operation.callbacks,
      };
      needsIdentity = protectedRoute;
    };
    const pauseForCleanup = () => {
      revoke();
      // verifyTabPrivacy's next synchronous step invalidates callback tickets.
      // Only that owned invalidation belongs to this verification attempt.
      operation.callbacks = assignmentEpoch() + 1;
      handledInvalidation.current = {
        epoch: operation.epoch,
        callbacks: operation.callbacks,
      };
    };
    // Native reactivation can race other updates. Publish pending readiness before
    // any newly mounted restoration consumer can enter its storage bootstrap.
    flushSync(() =>
      setState((previous) => ({ ...previous, checking: true, issue: '' })),
    );
    try {
      const current = await readLogoutPrivacyGeneration();
      if (!active()) return;
      if (
        stateRef.current.acceptedRevocation !== null &&
        (!bindingMatches ||
          (current.status === 'valid' &&
            current.generation !== stateRef.current.generation))
      )
        revoke();
      if (
        protectedRoute &&
        current.status === 'absent' &&
        stateRef.current.acceptedRevocation !== null &&
        stateRef.current.generation !== 'absent'
      ) {
        needsIdentity = true;
        setState((previous) => ({ ...previous, uncertain: true }));
      }
      let result = await verifyTabPrivacy(
        current,
        active,
        false,
        pauseForCleanup,
      );
      if (!active()) return;
      if (result.ready && needsIdentity) {
        result = {
          ready: false,
          issue:
            'This workspace’s original account access could not be verified. Retry when that account’s access is restored.',
        };
        // A generation comparison can observe another logout after the identity
        // read. Recheck the original owner, bounded under sustained churn.
        for (let check = 0; check < 3 && active(); check++) {
          if (!ownerBinding) break;
          const identity = await readProtectedPrivacyIdentity(ownerBinding);
          if (!active()) return;
          if (identity.status !== 'match') {
            if (identity.status === 'denied') revoke();
            break;
          }
          const checked = await verifyTabPrivacy(
            identity.generation,
            active,
            false,
            pauseForCleanup,
          );
          if (!active()) return;
          if (!checked.ready) {
            result = checked;
            break;
          }
          const checkedGeneration =
            identity.generation.status === 'valid'
              ? identity.generation.generation
              : 'absent';
          if (checked.generation !== checkedGeneration) continue;
          if (bindingMatches) result = checked;
          break;
        }
      }
      if (serverUncertain)
        result = {
          ready: false,
          issue:
            'This workspace’s original account access could not be verified. Retry when that account’s access is restored.',
        };
      if (!result.ready) titles.clear();
      setState((previous) =>
        result.ready
          ? {
              ...previous,
              ready: true,
              checking: false,
              uncertain: false,
              generation: result.generation,
              issue: '',
              key,
              acceptedRevocation: operation.epoch,
              acceptedServerRevision: serverRevision,
              acceptedCallbackRevision: operation.callbacks,
            }
          : {
              ...previous,
              ready: false,
              checking: false,
              uncertain: true,
              issue: result.issue,
              key,
            },
      );
    } catch {
      if (active()) {
        titles.clear();
        setState((previous) => ({
          ...previous,
          ready: false,
          checking: false,
          uncertain: true,
          issue: cleanupIssue,
          key,
        }));
      }
    } finally {
      if (inFlight.current === operation) inFlight.current = null;
    }
  }, [
    key,
    protectedRoute,
    ownerBinding,
    ownerAuthority,
    bindingMatches,
    serverRevision,
    serverUncertain,
    titles,
  ]);
  useEffect(() => {
    mounted.current = true;
    const reactivate = () => {
      if (document.visibilityState !== 'hidden') void retry();
    };
    queueMicrotask(() => {
      if (mounted.current) void retry();
    });
    window.addEventListener('focus', reactivate);
    window.addEventListener('pageshow', reactivate);
    document.addEventListener('visibilitychange', reactivate);
    return () => {
      cancel();
      window.removeEventListener('focus', reactivate);
      window.removeEventListener('pageshow', reactivate);
      document.removeEventListener('visibilitychange', reactivate);
    };
  }, [retry, cancel]);
  useEffect(() => {
    // Cleanup owns its callback invalidation even when storage remains blocked.
    // Retry only for a new external signal, not our own unsuccessful cleanup.
    const handled = handledInvalidation.current;
    if (
      handled.epoch === revocationRevision &&
      handled.callbacks === callbackRevision
    )
      return;
    handledInvalidation.current = {
      epoch: revocationRevision,
      callbacks: callbackRevision,
    };
    queueMicrotask(() => {
      if (mounted.current) void retry();
    });
  }, [revocationRevision, callbackRevision, retry]);
  const knownServerChange =
    serverGeneration !== undefined &&
    serverGeneration.status === 'valid' &&
    state.acceptedRevocation !== null &&
    serverRevision !== state.acceptedServerRevision;
  if (serverUncertain && !state.uncertain)
    setState({ ...state, uncertain: true });
  useLayoutEffect(() => {
    if (
      state.acceptedRevocation !== null &&
      (!bindingMatches || knownServerChange) &&
      readPrivacyRevocationRevision() === state.acceptedRevocation
    )
      revokePrivatePresentation();
  }, [bindingMatches, knownServerChange, state.acceptedRevocation]);
  const acceptedVisible =
    !state.uncertain &&
    !serverUncertain &&
    state.acceptedRevocation !== null &&
    state.acceptedRevocation === revocationRevision &&
    bindingMatches &&
    !knownServerChange;
  const ready =
    state.ready &&
    !state.checking &&
    state.key === key &&
    state.acceptedRevocation === revocationRevision &&
    state.acceptedCallbackRevision === callbackRevision &&
    (!protectedRoute || acceptedVisible);
  const visible = protectedRoute ? acceptedVisible : ready;
  useLayoutEffect(() => {
    titles.accept(
      protectedRoute &&
        visible &&
        state.key === key &&
        state.acceptedRevocation !== null &&
        bindingMatches
        ? {
            navigation: key.navigation,
            binding: bindingRevision,
            revocation: state.acceptedRevocation,
            callbacks: state.acceptedCallbackRevision,
          }
        : null,
    );
  }, [
    titles,
    protectedRoute,
    visible,
    state.key,
    key,
    bindingMatches,
    bindingRevision,
    state.acceptedRevocation,
    state.acceptedCallbackRevision,
  ]);
  const privacy = useMemo(
    () => ({
      ready,
      visible,
      generation: state.generation,
      cleanupRevision,
      revocationRevision,
      verifiedEpoch:
        ready && protectedRoute ? state.acceptedCallbackRevision : undefined,
    }),
    [
      ready,
      visible,
      state.generation,
      cleanupRevision,
      revocationRevision,
      protectedRoute,
      state.acceptedCallbackRevision,
    ],
  );
  const cleanup = !visible && (
    <CleanupStatus
      issue={state.issue}
      retry={() => void retry()}
      retainedOwner={protectedRoute && state.acceptedRevocation !== null}
    />
  );
  return (
    <PrivateDocumentTitleContext value={titles}>
      <PrivacyReadinessContext value={privacy}>
        {protectedRoute && cleanup}
        {protectedRoute ? (
          (children as ReactNode)
        ) : (
          <AcceptedPrivacyContent ready={ready} generation={state.generation}>
            {children}
          </AcceptedPrivacyContent>
        )}
        {!protectedRoute && cleanup}
      </PrivacyReadinessContext>
    </PrivateDocumentTitleContext>
  );
}

export function AuthPrivacyRedirect({ destination }: { destination: string }) {
  return (
    <AuthPrivacyBoundary>
      <VerifiedPrivacyNavigation destination={destination} />
    </AuthPrivacyBoundary>
  );
}
function VerifiedPrivacyNavigation({ destination }: { destination: string }) {
  const router = useRouter();
  useEffect(() => {
    router.replace(destination);
    router.refresh();
  }, [router, destination]);
  return <p role="status">Opening your workspace…</p>;
}

/** A confirmed password/logout result retries cleanup only, never the mutation. */
export function PasswordLogoutCompletion({
  receipt,
  destination = '/login?password=updated',
}: {
  receipt: LogoutPrivacyReceipt;
  destination?: string;
}) {
  const router = useRouter();
  const [issue, setIssue] = useState('');
  const revoked = useRef(false);
  const request = useRef(0);
  const mounted = useRef(false);
  const cancel = useCallback(() => {
    mounted.current = false;
    request.current++;
  }, []);
  const retry = useCallback(async () => {
    const attempt = ++request.current;
    const active = () => mounted.current && request.current === attempt;
    if (!revoked.current) {
      revoked.current = true;
      revokePrivatePresentation();
    }
    if (receipt.cleanupReminderUnavailable) {
      setIssue(reminderIssue);
      return;
    }
    setIssue('');
    const result = await verifyTabPrivacy(
      { status: 'valid', generation: receipt.logoutGeneration },
      active,
      true,
    );
    if (!active()) return;
    if (!result.ready) {
      setIssue(result.issue);
      return;
    }
    router.replace(destination);
    router.refresh();
  }, [receipt, router, destination]);
  useEffect(() => {
    mounted.current = true;
    queueMicrotask(() => {
      if (mounted.current) void retry();
    });
    return cancel;
  }, [retry, cancel]);
  return (
    <CleanupStatus
      issue={issue}
      retry={() => void retry()}
      retryLabel="Finish signing out"
    />
  );
}
