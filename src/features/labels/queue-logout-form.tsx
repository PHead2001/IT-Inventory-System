'use client';
import { signOutSession } from '@/lib/auth/actions';
import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { clearLabelQueueSession } from './queue-model';
import {
  invalidateAssignmentCallbacks,
  invalidateAssignmentPrivacy,
} from '@/features/scan/assign-batch';
import {
  clearAllDesignerRecovery,
  hasUnresolvedDesignerRecovery,
} from '@/features/metadata/designer-recovery';
export function QueueLogoutForm() {
  const router = useRouter();
  const submitting = useRef(false);
  const [busy, setBusy] = useState(false);
  const [issue, setIssue] = useState('');
  return (
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
          if (!result.ok) {
            setIssue(result.message);
            return;
          }
          if (!invalidateAssignmentPrivacy(true)) {
            setIssue(
              'Signed out, but this tab could not clear its saved batch. Close this tab to remove its private session data.',
            );
            return;
          }
          router.replace('/login');
          router.refresh();
        } catch {
          setIssue(
            'Sign-out could not be confirmed. Retry when your connection is available.',
          );
        } finally {
          submitting.current = false;
          setBusy(false);
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
        clearLabelQueueSession();
        clearAllDesignerRecovery();
      }}
    >
      <Button variant="outline" disabled={busy}>
        {busy ? 'Signing out…' : 'Sign out'}
      </Button>
      {issue && <p role="alert">{issue}</p>}
    </form>
  );
}
