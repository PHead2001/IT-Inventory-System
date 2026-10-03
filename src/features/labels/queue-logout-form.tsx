'use client';
import { logout } from '@/lib/auth/actions';
import { Button } from '@/components/ui/button';
import { clearLabelQueueSession } from './queue-model';
import {
  clearAllDesignerRecovery,
  hasUnresolvedDesignerRecovery,
} from '@/features/metadata/designer-recovery';
export function QueueLogoutForm() {
  return (
    <form
      action={logout}
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
      <Button variant="outline">Sign out</Button>
    </form>
  );
}
