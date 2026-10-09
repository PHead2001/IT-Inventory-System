'use client';
import { useEffect } from 'react';
import { createSupabaseBrowserClient } from '@/lib/supabase/browser';
import {
  adoptAssignmentScope,
  invalidateAssignmentPrivacy,
} from './assign-batch';

export function AssignmentScopeGuard({
  actorId,
  backend,
}: {
  actorId: string;
  backend: string;
}) {
  useEffect(() => {
    try {
      adoptAssignmentScope({
        actor: actorId,
        origin: window.location.origin,
        backend: new URL(backend).origin,
      });
      const client = createSupabaseBrowserClient();
      const { data } = client.auth.onAuthStateChange((event, session) => {
        if (event === 'SIGNED_OUT') invalidateAssignmentPrivacy(true);
        else if (session?.user.id && session.user.id !== actorId)
          invalidateAssignmentPrivacy(false);
      });
      return () => data.subscription.unsubscribe();
    } catch {
      // No valid scope can authorize a batch. The workspace reports unavailable
      // configuration/storage without replacing any uncertain recovery.
      invalidateAssignmentPrivacy(false);
    }
  }, [actorId, backend]);
  return null;
}
