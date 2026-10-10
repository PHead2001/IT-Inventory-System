'use client';

import { useContext, useState, type ReactNode } from 'react';
import { PrivacyReadinessContext } from './privacy-readiness';

/** Server pages return this only after their reads and not-found/redirect checks. */
export function ProtectedPrivacyContent({ children }: { children: ReactNode }) {
  const privacy = useContext(PrivacyReadinessContext);
  return (
    <AcceptedPrivacyContent
      ready={privacy.ready}
      generation={privacy.generation}
      preserveLayout
    >
      {children}
    </AcceptedPrivacyContent>
  );
}

type PrivacyChildren = ReactNode | ((generation: string) => ReactNode);

/** Preserve only accepted direct children. Hidden/inert does not freeze internal
 * effects: private bootstrap components also consult the readiness context. */
export function AcceptedPrivacyContent({
  ready,
  generation,
  children,
  preserveLayout = false,
}: {
  ready: boolean;
  generation: string;
  children: PrivacyChildren;
  preserveLayout?: boolean;
}) {
  const [accepted, setAccepted] = useState<{
    source: PrivacyChildren;
    generation: string;
    node: ReactNode;
  } | null>(null);
  if (
    ready &&
    (accepted === null ||
      accepted.source !== children ||
      accepted.generation !== generation)
  )
    setAccepted({
      source: children,
      generation,
      node: typeof children === 'function' ? children(generation) : children,
    });
  return (
    <div
      hidden={!ready}
      inert={!ready}
      className={preserveLayout && ready ? 'contents' : undefined}
    >
      {accepted?.node}
    </div>
  );
}
