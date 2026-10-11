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
