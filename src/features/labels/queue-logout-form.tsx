'use client';
import { logout } from '@/lib/auth/actions';
import { Button } from '@/components/ui/button';
import { clearLabelQueueSession } from './queue-model';
import { clearAllDesignerRecovery } from '@/features/metadata/designer-recovery';
export function QueueLogoutForm() {
  return (
    <form
      action={logout}
      onSubmit={() => {
        clearLabelQueueSession();
        clearAllDesignerRecovery();
      }}
    >
      <Button variant="outline">Sign out</Button>
    </form>
  );
}
