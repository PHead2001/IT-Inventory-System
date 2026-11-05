import type { ReactNode } from 'react';

/** Decorative layers inherit their stationary action's semantics and pointer owner. */
export function MagneticVisual({
  children,
  className = '',
  kind = 'magnetic',
}: {
  children: ReactNode;
  className?: string;
  kind?: 'magnetic' | 'tilt';
}) {
  if (kind === 'tilt')
    return (
      <div className={`experience-tilt-visual ${className}`}>{children}</div>
    );
  return (
    <>
      <span aria-hidden="true" className="experience-magnetic-face" />
      <span className={`experience-magnetic-visual ${className}`}>
        {children}
      </span>
    </>
  );
}
