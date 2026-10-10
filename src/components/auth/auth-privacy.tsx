'use client';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import {
  invalidateAssignmentPrivacy,
  readAuthoritativeLogoutCleanup,
} from '@/features/scan/assign-batch';

const cleanupIssue =
  'Signed out, but this tab could not clear its private saved data. Restore browser storage access and retry cleanup, or close this tab before signing in.';

function CleanupStatus({ issue, retry }: { issue: string; retry: () => void }) {
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

/** A query string or anonymous session never authorizes recovery deletion. */
export function AuthPrivacyBoundary({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [issue, setIssue] = useState('');
  const retry = useCallback(() => {
    const status = readAuthoritativeLogoutCleanup();
    if (status === 'none') {
      setReady(true);
      return;
    }
    if (status === 'pending' && invalidateAssignmentPrivacy(true)) {
      setReady(true);
      return;
    }
    setIssue(
      status === 'blocked'
        ? 'This tab’s privacy cleanup state cannot be verified. Keep its saved data intact and close this tab before signing in.'
        : cleanupIssue,
    );
  }, []);
  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (active) retry();
    });
    return () => {
      active = false;
    };
  }, [retry]);
  return ready ? children : <CleanupStatus issue={issue} retry={retry} />;
}

/** Mounted only for the trusted password action's confirmed logout result. */
export function PasswordLogoutCompletion() {
  const router = useRouter();
  const [issue, setIssue] = useState('');
  const retry = useCallback(() => {
    if (!invalidateAssignmentPrivacy(true)) {
      setIssue(cleanupIssue);
      return;
    }
    router.replace('/login?password=updated');
    router.refresh();
  }, [router]);
  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (active) retry();
    });
    return () => {
      active = false;
    };
  }, [retry]);
  return <CleanupStatus issue={issue} retry={retry} />;
}
