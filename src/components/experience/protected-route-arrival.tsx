'use client';

import { Suspense, type ReactNode } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import { ProtectedPrivacyContent } from '@/components/auth/privacy-content';
import { PageArrival } from './page-arrival';
import { RouteLoading } from './route-pending';
import { RouteContentIdentityContext } from './route-content-identity';
import { routeKey } from './route-key';

/** Canonical privacy acceptance binds the page's pathname and children together.
 * Live URL changes cannot key/remount a still-retained outgoing private page. */
export function ProtectedRouteArrival({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const query = useSearchParams();
  return (
    <ProtectedPrivacyContent transitionAdmission>
      <RouteContentIdentityContext
        value={{
          pathname,
          listHref: routeKey(pathname ?? '', query ?? new URLSearchParams()),
        }}
      >
        <Suspense fallback={<RouteLoading />}>
          <PageArrival pathname={pathname}>{children}</PageArrival>
        </Suspense>
      </RouteContentIdentityContext>
    </ProtectedPrivacyContent>
  );
}
