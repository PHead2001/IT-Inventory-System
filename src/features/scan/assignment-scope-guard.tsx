'use client';
import { useEffect, useRef } from 'react';
import { createSupabaseBrowserClient } from '@/lib/supabase/browser';
import { usePrivacyReadiness } from '@/components/auth/privacy-readiness';
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
  const privacy = usePrivacyReadiness();
  const adopted = useRef<string | null>(null);
  const binding = JSON.stringify([
    actorId,
    backend,
    privacy.generation,
    privacy.cleanupRevision ?? 0,
  ]);
  useEffect(() => {
    if (!privacy.ready || adopted.current === binding) return;
    try {
      adoptAssignmentScope({
        actor: actorId,
        origin: window.location.origin,
        backend: new URL(backend).origin,
      });
      adopted.current = binding;
    } catch {
      // Storage failure must fail closed without suppressing authoritative logout.
      invalidateAssignmentPrivacy(false);
    }
  }, [actorId, backend, binding, privacy.ready]);
  // Pending privacy verification is not logout authority. Keep the authoritative
  // Auth observer active even while restoration/adoption is withheld.
  useEffect(() => {
    try {
      const client = createSupabaseBrowserClient();
      const { data } = client.auth.onAuthStateChange((event, session) => {
        if (event === 'SIGNED_OUT') invalidateAssignmentPrivacy(true);
        else if (session?.user.id && session.user.id !== actorId)
          invalidateAssignmentPrivacy(false);
      });
      return () => data.subscription.unsubscribe();
    } catch {
      invalidateAssignmentPrivacy(false);
    }
  }, [actorId, backend]);
  return null;
}
