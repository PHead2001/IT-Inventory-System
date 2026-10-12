'use client';
import { signOutSession } from '@/lib/auth/logout-transport';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { useInvalidateRouteMotion } from '@/components/experience/route-motion';
import { clearLabelQueueSession } from './queue-model';
import { invalidateAssignmentCallbacks } from '@/features/scan/assign-batch';
import { PasswordLogoutCompletion } from '@/components/auth/auth-privacy';
import { ProtectedPrivacyContent } from '@/components/auth/privacy-content';
import type { LogoutPrivacyReceipt } from '@/lib/auth/privacy-barrier';
import { hasUnresolvedDesignerRecovery } from '@/features/metadata/designer-recovery';
export function QueueLogoutForm() {
  const invalidateRouteMotion = useInvalidateRouteMotion();
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
          setBusy(true);
          setIssue('');
          // Generation invalidation precedes the network call even away from Scan.
          invalidateAssignmentCallbacks();
          try {
            const result = await signOutSession();
            if (!mounted.current) return;
            if (!result.ok) {
              setIssue(result.message);
              return;
            }
            setReceipt(result);
          } catch {
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
          if (
            hasUnresolvedDesignerRecovery() &&
            !window.confirm(
              'A form save outcome is unknown. Signing out removes this tab’s original save recovery and does not undo a save that may have committed. Stay signed in to retry the original request, or sign out and remove recovery?',
            )
          ) {
            event.preventDefault();
            return;
          }
          invalidateRouteMotion();
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
