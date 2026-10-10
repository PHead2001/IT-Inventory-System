'use client';
import {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { flushSync } from 'react-dom';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { readLogoutPrivacyGeneration } from '@/lib/auth/actions';
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
} from './privacy-readiness';

export function CleanupStatus({
  issue,
  retry,
}: {
  issue: string;
  retry: () => void;
}) {
  return (
    <div className="space-y-5">
      <p role={issue ? 'alert' : 'status'}>
        {issue || 'Clearing private data from this tab…'}
      </p>
      {issue && (
        <Button type="button" onClick={retry}>
          Retry privacy cleanup
        </Button>
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
function PrivacyController({
  children,
  revision = 0,
  serverGeneration,
}: BoundaryProps) {
  const pathname = usePathname() ?? '';
  const cleanupRevision = useAuthoritativeCleanupRevision();
  const query = useSearchParams()?.toString() ?? '';
  const serverRevision =
    serverGeneration?.status === 'valid'
      ? serverGeneration.generation
      : serverGeneration?.status;
  const key = useMemo(
    () => ({ navigation: pathname + '?' + query, serverRevision, revision }),
    [pathname, query, serverRevision, revision],
  );
  const [state, setState] = useState<{
    ready: boolean;
    checking: boolean;
    generation: string;
    issue: string;
    key: typeof key | null;
  }>({
    ready: false,
    checking: false,
    generation: '',
    issue: '',
    key: null,
  });
  const request = useRef(0);
  const mounted = useRef(false);
  const cancel = useCallback(() => {
    mounted.current = false;
    request.current++;
  }, []);
  const retry = useCallback(async () => {
    const attempt = ++request.current;
    const active = () => mounted.current && request.current === attempt;
    // Native reactivation can race other updates. Publish pending readiness before
    // any newly mounted restoration consumer can enter its storage bootstrap.
    flushSync(() =>
      setState((previous) => ({ ...previous, checking: true, issue: '' })),
    );
    try {
      const current = await readLogoutPrivacyGeneration();
      if (!active()) return;
      const result = await verifyTabPrivacy(current, active, false, () =>
        setState((previous) => ({ ...previous, ready: false })),
      );
      if (!active()) return;
      setState((previous) =>
        result.ready
          ? {
              ...previous,
              ready: true,
              checking: false,
              generation: result.generation,
              issue: '',
              key,
            }
          : {
              ...previous,
              ready: false,
              checking: false,
              issue: result.issue,
              key,
            },
      );
    } catch {
      if (active())
        setState((previous) => ({
          ...previous,
          ready: false,
          checking: false,
          issue: cleanupIssue,
          key,
        }));
    }
  }, [key]);
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
  const ready = state.ready && !state.checking && state.key === key;
  const privacy = useMemo(
    () => ({
      ready,
      generation: state.generation,
      cleanupRevision,
    }),
    [ready, state.generation, cleanupRevision],
  );
  return (
    <PrivacyReadinessContext value={privacy}>
      <AcceptedPrivacyContent ready={ready} generation={state.generation}>
        {children}
      </AcceptedPrivacyContent>
      {!ready && (
        <CleanupStatus issue={state.issue} retry={() => void retry()} />
      )}
    </PrivacyReadinessContext>
  );
}

/** Preserve only accepted direct children. Inert/hidden is not an internal-effect freeze;
 * private bootstrap components independently consult the readiness context. */
function AcceptedPrivacyContent({
  ready,
  generation,
  children,
}: {
  ready: boolean;
  generation: string;
  children: BoundaryProps['children'];
}) {
  const [accepted, setAccepted] = useState<{
    source: BoundaryProps['children'];
    generation: string;
    node: ReactNode;
  } | null>(null);
  if (
    ready &&
    (accepted === null ||
      accepted.source !== children ||
      accepted.generation !== generation)
  )
    setAccepted({
      source: children,
      generation,
      node: typeof children === 'function' ? children(generation) : children,
    });
  return (
    <div hidden={!ready} inert={!ready}>
      {accepted?.node}
    </div>
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
  const request = useRef(0);
  const mounted = useRef(false);
  const cancel = useCallback(() => {
    mounted.current = false;
    request.current++;
  }, []);
  const retry = useCallback(async () => {
    const attempt = ++request.current;
    const active = () => mounted.current && request.current === attempt;
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
  return <CleanupStatus issue={issue} retry={() => void retry()} />;
}
