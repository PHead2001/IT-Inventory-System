import type { usePrivacyReadiness } from '@/components/auth/privacy-readiness';
import {
  assignmentEpoch,
  readPrivacyRevocationRevision,
} from '@/features/scan/assign-batch';
export function freshPresentationGrant(
  privacy: ReturnType<typeof usePrivacyReadiness>,
) {
  return (
    privacy.ready &&
    (privacy.visible ?? privacy.ready) &&
    privacy.revocationRevision === readPrivacyRevocationRevision() &&
    privacy.verifiedEpoch === assignmentEpoch()
  );
}

/** A previously verified original binding may stay visible during its ordinary
 * recheck. Live revisions are read at use time, never inferred from a URL. */
export function retainedPresentationGrantCurrent(
  privacy: ReturnType<typeof usePrivacyReadiness>,
  accepted: { revision: number; epoch: number } | null,
) {
  return (
    (privacy.visible ?? privacy.ready) &&
    privacy.revocationRevision === readPrivacyRevocationRevision() &&
    accepted?.revision === privacy.revocationRevision &&
    accepted?.epoch === assignmentEpoch() &&
    (!privacy.ready || privacy.verifiedEpoch === accepted.epoch)
  );
}
