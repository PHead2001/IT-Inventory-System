'use client';
import { signOutSession } from '@/lib/auth/logout-transport';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { useRouteMotionLogoutAttempt } from '@/components/experience/route-motion';
import { clearLabelQueueSession } from './queue-model';
import { invalidateAssignmentCallbacks } from '@/features/scan/assign-batch';
import { PasswordLogoutCompletion } from '@/components/auth/auth-privacy';
import { ProtectedPrivacyContent } from '@/components/auth/privacy-content';
import type { LogoutPrivacyReceipt } from '@/lib/auth/privacy-barrier';
import { hasUnresolvedDesignerRecovery } from '@/features/metadata/designer-recovery';
export function QueueLogoutForm() {
  const beginLogoutAttempt = useRouteMotionLogoutAttempt();
  const settleAttempt = useRef<((confirmed: boolean) => void) | null>(null);
  const submitting = useRef(false);
  const [busy, setBusy] = useState(false);
  const [issue, setIssue] = useState('');
  const [receipt, setReceipt] = useState<LogoutPrivacyReceipt | null>(null);
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  if (receipt)
    return <PasswordLogoutCompletion receipt={receipt} destination="/login" />;
  return (
    <ProtectedPrivacyContent>
      <form
        action={async () => {
          if (submitting.current) return;
          submitting.current = true;
          const settle = settleAttempt.current;
          settleAttempt.current = null;
          setBusy(true);
          setIssue('');
          // Generation invalidation precedes the network call even away from Scan.
          invalidateAssignmentCallbacks();
          try {
            const result = await signOutSession();
            settle?.(result.ok);
            if (!mounted.current) return;
            if (!result.ok) {
              setIssue(result.message);
              return;
            }
            setReceipt(result);
          } catch {
            settle?.(false);
            if (mounted.current)
              setIssue(
                'Sign-out could not be confirmed. Retry when your connection is available.',
              );
          } finally {
            submitting.current = false;
            if (mounted.current) setBusy(false);
          }
        }}
        onSubmit={(event) => {
          if (submitting.current) {
            event.preventDefault();
            return;
          }
          if (
            hasUnresolvedDesignerRecovery() &&
            !window.confirm(
              'A form save outcome is unknown. Signing out removes this tab’s original save recovery and does not undo a save that may have committed. Stay signed in to retry the original request, or sign out and remove recovery?',
            )
          ) {
            event.preventDefault();
            return;
          }
          // This event precedes React's async action transition, so pending UI
          // commits while the transport is still unresolved.
          setBusy(true);
          setIssue('');
          settleAttempt.current = beginLogoutAttempt();
          clearLabelQueueSession();
        }}
      >
        <Button variant="outline" disabled={busy}>
          {busy ? 'Signing out…' : 'Sign out'}
        </Button>
        {issue && <p role="alert">{issue}</p>}
      </form>
    </ProtectedPrivacyContent>
  );
}
