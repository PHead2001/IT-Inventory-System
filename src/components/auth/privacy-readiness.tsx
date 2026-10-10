'use client';
import {
  createContext,
  Fragment,
  useContext,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import {
  readAuthoritativeCleanupRevision,
  subscribeAuthoritativeCleanup,
} from '@/features/scan/assign-batch';
const serverCleanupRevision = () => 0;
export const useAuthoritativeCleanupRevision = () =>
  useSyncExternalStore(
    subscribeAuthoritativeCleanup,
    readAuthoritativeCleanupRevision,
    serverCleanupRevision,
  );

/** Restoration coordination; membership and mutations retain their existing authority. */
export const PrivacyReadinessContext = createContext<{
  ready: boolean;
  generation: string;
  cleanupRevision?: number;
}>({
  ready: true,
  generation: 'unmanaged',
});
export const usePrivacyReadiness = () => useContext(PrivacyReadinessContext);

/** Existing verified instances stay mounted; new instances/scopes wait for verification. */
export function PrivateRestorationGate({
  children,
  scope,
}: {
  children: ReactNode;
  scope: string;
}) {
  const privacy = usePrivacyReadiness();
  const binding = JSON.stringify([
    scope,
    privacy.generation,
    privacy.cleanupRevision ?? 0,
  ]);
  const [accepted, setAccepted] = useState<string | null>(() =>
    privacy.ready ? binding : null,
  );
  if (privacy.ready && accepted !== binding) setAccepted(binding);
  if (accepted !== binding) return null;
  return <Fragment key={binding}>{children}</Fragment>;
}
