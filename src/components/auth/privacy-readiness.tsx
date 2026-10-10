'use client';
import {
  createContext,
  useContext,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import {
  readAuthoritativeCleanupRevision,
  subscribeAuthoritativeCleanup,
  readPrivacyRevocationRevision,
  subscribePrivacyRevocation,
  assignmentEpoch,
  subscribeAssignmentInvalidation,
  revokePrivatePresentation,
} from '@/features/scan/assign-batch';
const serverCleanupRevision = () => 0;
export const useAuthoritativeCleanupRevision = () =>
  useSyncExternalStore(
    subscribeAuthoritativeCleanup,
    readAuthoritativeCleanupRevision,
    serverCleanupRevision,
  );
export const usePrivacyRevocationRevision = () =>
  useSyncExternalStore(
    subscribePrivacyRevocation,
    readPrivacyRevocationRevision,
    serverCleanupRevision,
  );
export const useAssignmentInvalidationRevision = () =>
  useSyncExternalStore(
    subscribeAssignmentInvalidation,
    assignmentEpoch,
    serverCleanupRevision,
  );

/** Restoration coordination; membership and mutations retain their existing authority. */
export const PrivacyReadinessContext = createContext<{
  ready: boolean;
  visible?: boolean;
  generation: string;
  cleanupRevision?: number;
  revocationRevision?: number;
  verifiedEpoch?: number;
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
  const [ownerScope] = useState(scope);
  const drifted = useRef(false);
  const [scopeChanged, setScopeChanged] = useState(false);
  if (scope !== ownerScope && !scopeChanged) setScopeChanged(true);
  useLayoutEffect(() => {
    if (scope !== ownerScope && !drifted.current) {
      drifted.current = true;
      revokePrivatePresentation();
    }
  }, [scope, ownerScope]);
  const [accepted, setAccepted] = useState<ReactNode>(() =>
    privacy.ready ? children : null,
  );
  if (privacy.ready && scope === ownerScope && accepted !== children)
    setAccepted(children);
  if (accepted === null) return null;
  const visible =
    scope === ownerScope &&
    (privacy.visible ?? privacy.ready) &&
    (!scopeChanged || privacy.verifiedEpoch === assignmentEpoch());
  return (
    <div
      hidden={!visible}
      inert={!visible}
      className={visible ? 'contents' : undefined}
    >
      {accepted}
    </div>
  );
}
