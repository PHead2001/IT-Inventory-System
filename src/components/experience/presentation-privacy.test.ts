import { expect, it } from 'vitest';
import {
  assignmentEpoch,
  readPrivacyRevocationRevision,
  revokePrivatePresentation,
  invalidateAssignmentCallbacks,
} from '@/features/scan/assign-batch';
import {
  freshPresentationGrant,
  retainedPresentationGrantCurrent,
} from './presentation-privacy';

const current = () => ({
  ready: true,
  visible: true,
  generation: 'original',
  revocationRevision: readPrivacyRevocationRevision(),
  verifiedEpoch: assignmentEpoch(),
});
it('retains only an already verified current grant during a visible ordinary recheck', () => {
  const privacy = current(),
    accepted = {
      revision: privacy.revocationRevision,
      epoch: privacy.verifiedEpoch,
    };
  expect(freshPresentationGrant(privacy)).toBe(true);
  expect(retainedPresentationGrantCurrent(privacy, accepted)).toBe(true);
  const recheck = { ...privacy, ready: false, verifiedEpoch: undefined };
  expect(freshPresentationGrant(recheck)).toBe(false);
  expect(retainedPresentationGrantCurrent(recheck, accepted)).toBe(true);
  expect(retainedPresentationGrantCurrent(recheck, null)).toBe(false);
  expect(
    retainedPresentationGrantCurrent({ ...recheck, visible: false }, accepted),
  ).toBe(false);
  expect(
    retainedPresentationGrantCurrent(
      { ...privacy, verifiedEpoch: accepted.epoch + 1 },
      accepted,
    ),
  ).toBe(false);
});
it.each(['revocation', 'assignment'] as const)(
  'checks live %s immediately even before React updates an old readiness object',
  (kind) => {
    const privacy = current(),
      accepted = {
        revision: privacy.revocationRevision,
        epoch: privacy.verifiedEpoch,
      };
    if (kind === 'revocation') revokePrivatePresentation();
    else invalidateAssignmentCallbacks();
    expect(freshPresentationGrant(privacy)).toBe(false);
    expect(retainedPresentationGrantCurrent(privacy, accepted)).toBe(false);
    expect(
      retainedPresentationGrantCurrent(
        { ...privacy, ready: false, verifiedEpoch: undefined },
        accepted,
      ),
    ).toBe(false);
  },
);
