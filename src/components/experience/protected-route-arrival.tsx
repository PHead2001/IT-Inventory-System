'use client';

import { Suspense, type ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import { ProtectedPrivacyContent } from '@/components/auth/privacy-content';
import { PageArrival } from './page-arrival';
import { RouteLoading } from './route-pending';

/** Privacy accepts the stable outer presentation. Next owns the live router
 * slot inside it; actual primary identity belongs to RouteReady. */
export function ProtectedRouteArrival({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  return (
    <ProtectedPrivacyContent transitionAdmission>
      <Suspense fallback={<RouteLoading />}>
        <PageArrival pathname={pathname}>{children}</PageArrival>
      </Suspense>
    </ProtectedPrivacyContent>
  );
}
