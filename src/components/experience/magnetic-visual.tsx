import type { ReactNode } from 'react';

/** Decorative layers inherit their stationary action's semantics and pointer owner. */
export function MagneticVisual({
  children,
  className = '',
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <>
      <span aria-hidden="true" className="experience-magnetic-face" />
      <span className={`experience-magnetic-visual ${className}`}>
        {children}
      </span>
    </>
  );
}
