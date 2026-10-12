'use client';

import {
  startTransition,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useReducer,
  type ReactNode,
} from 'react';
import { PrivacyReadinessContext } from './privacy-readiness';
import {
  assignmentEpoch,
  readPrivacyRevocationRevision,
} from '@/features/scan/assign-batch';

/** Server pages return this only after their reads and not-found/redirect checks. */
export function ProtectedPrivacyContent({
  children,
  transitionAdmission = false,
  routeKey,
}: {
  children: ReactNode;
  transitionAdmission?: boolean;
  routeKey?: string;
}) {
  const privacy = useContext(PrivacyReadinessContext);
  const admission = routeKey
    ? privacy.navigation?.admission(routeKey)
    : undefined;
  if (admission?.wait) throw admission.wait;
  const ready = admission?.ready ?? privacy.ready;
  const verifiedEpoch =
    ready === privacy.ready ? privacy.verifiedEpoch : admission?.verifiedEpoch;
  const content = (
    <AcceptedPrivacyContent
      ready={ready}
      visible={privacy.visible}
      generation={privacy.generation}
      preserveLayout
      transitionAdmission={transitionAdmission}
      admissionRevision={privacy.revocationRevision}
      admissionEpoch={verifiedEpoch}
    >
      {children}
    </AcceptedPrivacyContent>
  );
  // This authorized server primary may arrive before pathname context commits.
  // Restoration descendants use the same fresh target decision as their gate.
  return (
    <PrivacyReadinessContext
      value={
        ready === privacy.ready
          ? privacy
          : {
              ...privacy,
              ready,
              verifiedEpoch,
            }
      }
    >
      {content}
    </PrivacyReadinessContext>
  );
}

type PrivacyChildren = ReactNode | ((generation: string) => ReactNode);
type AcceptedContent = {
  source: PrivacyChildren;
  generation: string;
  node: ReactNode;
};
type Admission = {
  source: PrivacyChildren;
  generation: string;
  ready: boolean;
  visible: boolean;
  revision: number | undefined;
  epoch: number | undefined;
  live: boolean;
};
type AdmissionAction =
  | { kind: 'immediate'; candidate: AcceptedContent }
  | { kind: 'proposal'; candidate: AcceptedContent; ticket: Admission };

/** Preserve only accepted direct children. Hidden/inert does not freeze internal
 * effects: private bootstrap components also consult the readiness context. */
export function AcceptedPrivacyContent({
  ready,
  visible = ready,
  generation,
  children,
  preserveLayout = false,
  transitionAdmission = false,
  admissionRevision,
  admissionEpoch,
}: {
  ready: boolean;
  visible?: boolean;
  generation: string;
  children: PrivacyChildren;
  preserveLayout?: boolean;
  transitionAdmission?: boolean;
  admissionRevision?: number;
  admissionEpoch?: number;
}) {
  // useReducer rechecks every proposal on replay. useState's eager updater cache
  // can otherwise commit an already-computed private candidate after revocation.
  const [accepted, admit] = useReducer(
    (previous: AcceptedContent | null, action: AdmissionAction) => {
      if (action.kind === 'immediate') return action.candidate;
      const ticket = action.ticket;
      return transitionAdmission &&
        ready &&
        visible &&
        ticket.live &&
        ticket.ready &&
        ticket.visible &&
        ticket.source === children &&
        ticket.generation === generation &&
        ticket.revision === admissionRevision &&
        ticket.epoch === admissionEpoch &&
        ticket.revision === readPrivacyRevocationRevision() &&
        ticket.epoch === assignmentEpoch()
        ? action.candidate
        : previous;
    },
    null,
  );
  // Identity/authority ticket only. The accepted state above remains the sole
  // node cache, including during a suspended positive route admission.
  const admission = useRef<Admission | null>(null);
  useLayoutEffect(() => {
    if (!transitionAdmission) return;
    const ticket: Admission = {
      source: children,
      generation,
      ready,
      visible,
      revision: admissionRevision,
      epoch: admissionEpoch,
      live: true,
    };
    admission.current = ticket;
    return () => {
      ticket.live = false;
      if (admission.current === ticket) admission.current = null;
    };
  }, [
    children,
    generation,
    ready,
    visible,
    admissionRevision,
    admissionEpoch,
    transitionAdmission,
  ]);
  useEffect(() => {
    if (
      !transitionAdmission ||
      !ready ||
      !visible ||
      accepted === null ||
      (accepted.source === children && accepted.generation === generation)
    )
      return;
    const ticket = admission.current;
    const current = () =>
      admission.current === ticket &&
      ticket !== null &&
      ticket.live &&
      ticket.ready &&
      ticket.visible &&
      ticket.source === children &&
      ticket.generation === generation &&
      ticket.revision === readPrivacyRevocationRevision() &&
      ticket.epoch === assignmentEpoch();
    if (!ticket || !current()) return;
    startTransition(() => {
      const node =
        typeof children === 'function' ? children(generation) : children;
      admit({
        kind: 'proposal',
        candidate: { source: children, generation, node },
        ticket,
      });
    });
  }, [
    accepted,
    children,
    generation,
    ready,
    visible,
    transitionAdmission,
    admissionRevision,
    admissionEpoch,
  ]);
  if (
    ready &&
    (!transitionAdmission ||
      (visible &&
        accepted === null &&
        admissionRevision === readPrivacyRevocationRevision() &&
        admissionEpoch === assignmentEpoch())) &&
    (accepted === null ||
      accepted.source !== children ||
      accepted.generation !== generation)
  )
    admit({
      kind: 'immediate',
      candidate: {
        source: children,
        generation,
        node: typeof children === 'function' ? children(generation) : children,
      },
    });
  return (
    <div
      hidden={!visible}
      inert={!visible}
      className={preserveLayout && visible ? 'contents' : undefined}
    >
      {accepted?.node}
    </div>
  );
}
